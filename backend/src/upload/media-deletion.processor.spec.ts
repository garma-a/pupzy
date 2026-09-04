/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument */
import { MediaDeletionProcessor } from './media-deletion.processor';
import { UploadService } from './upload.service';
import { mediaDeletionWork, stagedUploads, type MediaDeletionWork, type StagedUpload } from '../database/schema';

describe('MediaDeletionProcessor', () => {
  let processor: MediaDeletionProcessor;
  let mockDb: any;
  let mockUploadService: {
    deleteObject: jest.Mock;
    purgeCdn: jest.Mock;
    getPublicCdnUrl: jest.Mock;
  };

  let workStore: Map<string, MediaDeletionWork>;
  let stagingStore: Map<string, StagedUpload>;

  beforeEach(() => {
    workStore = new Map();
    stagingStore = new Map();

    mockUploadService = {
      deleteObject: jest.fn().mockResolvedValue(undefined),
      purgeCdn: jest.fn().mockResolvedValue(undefined),
      getPublicCdnUrl: jest.fn().mockImplementation((k: string) => `https://cdn.pupzy.net/${k}`),
    };

    mockDb = {
      select: jest.fn().mockImplementation(() => ({
        from: jest.fn().mockImplementation((table: any) => {
          const makeQuery = () => {
            if (table === mediaDeletionWork) {
              return Array.from(workStore.values()).filter((w) => w.status === 'PENDING');
            }
            if (table === stagedUploads) {
              return Array.from(stagingStore.values());
            }
            return [];
          };

          return {
            where: jest.fn().mockImplementation(() => {
              const res = makeQuery();
              return {
                limit: jest.fn().mockImplementation((n: number) => Promise.resolve(res.slice(0, n))),
                then: (resolve: any, reject: any) => Promise.resolve(res).then(resolve, reject),
              };
            }),
            limit: jest.fn().mockImplementation((n: number) => Promise.resolve(makeQuery().slice(0, n))),
            then: (resolve: any, reject: any) => Promise.resolve(makeQuery()).then(resolve, reject),
          };
        }),
      })),
      update: jest.fn().mockImplementation(() => ({
        set: jest.fn().mockImplementation(() => ({
          where: jest.fn().mockImplementation(() => {
            return {
              returning: jest.fn().mockResolvedValue([]),
              then: (resolve: any) => Promise.resolve([]).then(resolve),
            };
          }),
        })),
      })),
      insert: jest.fn().mockImplementation(() => ({
        values: jest.fn().mockImplementation(() => Promise.resolve([])),
      })),
    };

    processor = new MediaDeletionProcessor(mockDb, mockUploadService as unknown as UploadService);
  });

  describe('processPendingWork', () => {
    it('processes pending work items: deletes R2 object, purges CDN, and marks COMPLETED', async () => {
      const workItem: MediaDeletionWork = {
        id: 'work-1',
        storageKey: 'comments/c1/m1.webp',
        cdnUrl: 'https://cdn.pupzy.net/comments/c1/m1.webp',
        status: 'PENDING',
        attempts: 0,
        lastError: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      workStore.set('work-1', workItem);

      mockDb.update = jest.fn().mockImplementation(() => ({
        set: jest.fn().mockImplementation((setValues: any) => ({
          where: jest.fn().mockImplementation(() => {
            Object.assign(workItem, setValues);
            return Promise.resolve([workItem]);
          }),
        })),
      }));

      const processedCount = await processor.processPendingWork();

      expect(processedCount).toBe(1);
      expect(mockUploadService.deleteObject).toHaveBeenCalledWith('comments/c1/m1.webp');
      expect(mockUploadService.purgeCdn).toHaveBeenCalledWith('https://cdn.pupzy.net/comments/c1/m1.webp');
      expect(workItem.status).toBe('COMPLETED');
    });

    it('handles transient failure with exponential backoff and resets to PENDING if attempts < 5', async () => {
      const workItem: MediaDeletionWork = {
        id: 'work-transient',
        storageKey: 'comments/c1/m1.webp',
        cdnUrl: 'https://cdn.pupzy.net/comments/c1/m1.webp',
        status: 'PENDING',
        attempts: 1,
        lastError: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      workStore.set('work-transient', workItem);

      mockUploadService.deleteObject.mockRejectedValueOnce(new Error('Transient R2 error'));

      mockDb.update = jest.fn().mockImplementation(() => ({
        set: jest.fn().mockImplementation((setValues: any) => ({
          where: jest.fn().mockImplementation(() => {
            Object.assign(workItem, setValues);
            return Promise.resolve([workItem]);
          }),
        })),
      }));

      const processedCount = await processor.processPendingWork();

      expect(processedCount).toBe(0);
      expect(workItem.status).toBe('PENDING');
      expect(workItem.attempts).toBe(2);
      expect(workItem.lastError).toContain('Transient R2 error');
    });

    it('marks work item FAILED after reaching maximum retry attempts (>= 5)', async () => {
      const workItem: MediaDeletionWork = {
        id: 'work-max-attempts',
        storageKey: 'comments/c1/m1.webp',
        cdnUrl: 'https://cdn.pupzy.net/comments/c1/m1.webp',
        status: 'PENDING',
        attempts: 4,
        lastError: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      workStore.set('work-max-attempts', workItem);

      mockUploadService.deleteObject.mockRejectedValueOnce(new Error('Persistent R2 deletion error'));

      mockDb.update = jest.fn().mockImplementation(() => ({
        set: jest.fn().mockImplementation((setValues: any) => ({
          where: jest.fn().mockImplementation(() => {
            Object.assign(workItem, setValues);
            return Promise.resolve([workItem]);
          }),
        })),
      }));

      const processedCount = await processor.processPendingWork();

      expect(processedCount).toBe(0);
      expect(workItem.status).toBe('FAILED');
      expect(workItem.attempts).toBe(5);
      expect(workItem.lastError).toContain('Persistent R2 deletion error');
    });
  });

  describe('cleanupExpiredStaging', () => {
    it('deletes R2 staging objects and marks expired staged uploads as EXPIRED', async () => {
      const expiredStaging: StagedUpload = {
        id: 'staged-expired-1',
        userId: 'user-1',
        purpose: 'COMMENT_IMAGE',
        stagingKey: 'staging/user-1/staged-expired-1.webp',
        declaredContentType: 'image/webp',
        declaredFileSizeBytes: 50000,
        status: 'ISSUED',
        expiresAt: new Date(Date.now() - 3600_000), // 1 hour ago
        postId: null,
        finalStorageKey: null,
        errorMessage: null,
        createdAt: new Date(Date.now() - 3600_000),
        updatedAt: new Date(Date.now() - 3600_000),
      };
      stagingStore.set('staged-expired-1', expiredStaging);

      mockDb.update = jest.fn().mockImplementation(() => ({
        set: jest.fn().mockImplementation((setValues: any) => ({
          where: jest.fn().mockImplementation(() => {
            Object.assign(expiredStaging, setValues);
            return Promise.resolve([expiredStaging]);
          }),
        })),
      }));

      const cleanedCount = await processor.cleanupExpiredStaging();

      expect(cleanedCount).toBe(1);
      expect(mockUploadService.deleteObject).toHaveBeenCalledWith('staging/user-1/staged-expired-1.webp');
      expect(expiredStaging.status).toBe('EXPIRED');
    });
  });

  describe('reconcile', () => {
    it('runs reconciliation: cleans expired staging, recovers stuck items, and drains pending work', async () => {
      const cleanupSpy = jest.spyOn(processor, 'cleanupExpiredStaging').mockResolvedValue(2);
      const processSpy = jest.spyOn(processor, 'processPendingWork').mockResolvedValue(1);

      const report = await processor.reconcile();

      expect(cleanupSpy).toHaveBeenCalled();
      expect(processSpy).toHaveBeenCalled();
      expect(report.cleanedStaging).toBe(2);
      expect(report.processedDeletionWork).toBe(1);
    });
  });
});
