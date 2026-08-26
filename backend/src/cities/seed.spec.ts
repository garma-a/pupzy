/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call */
import { seedOfficialCities } from './seed';
import { getOfficialCatalog, type CityCatalogRecord } from './catalog';
import { cities } from '../database/schema/cities.schema';
import { runDatabaseSeed } from '../database/seed';

describe('seedOfficialCities', () => {
  let mockDb: any;
  let mockTx: any;
  let insertedBatches: any[];

  beforeEach(() => {
    insertedBatches = [];
    mockTx = {
      insert: jest.fn().mockReturnValue({
        values: jest.fn().mockImplementation((vals) => {
          insertedBatches.push(vals);
          return {
            onConflictDoUpdate: jest.fn().mockResolvedValue({ rowCount: vals.length }),
          };
        }),
      }),
    };
    mockDb = {
      transaction: jest.fn().mockImplementation(async (cb) => cb(mockTx)),
      insert: mockTx.insert,
      delete: jest.fn(),
    };
  });

  it('validates the complete dataset before writing and rejects invalid catalogs', async () => {
    const invalidCatalog: CityCatalogRecord[] = [
      {
        sourceCode: 'INVALID',
        nameEnglish: '',
        nameArabic: '',
        governorate: 'Cairo',
        governorateCode: 'EG01',
        sourceNameEnglish: 'Test',
        sourceNameArabic: 'اختبار',
        latitude: 30.0,
        longitude: 31.0,
        status: 'OFFICIAL',
      },
    ];

    await expect(
      seedOfficialCities(mockDb, {
        catalog: invalidCatalog,
        validateBeforeSeed: true,
      }),
    ).rejects.toThrow(/City catalog validation failed/);

    expect(mockDb.transaction).not.toHaveBeenCalled();
    expect(mockTx.insert).not.toHaveBeenCalled();
  });

  it('seeds exactly 351 official cities across 27 governorates atomically in a transaction', async () => {
    const officialCatalog = getOfficialCatalog();
    expect(officialCatalog.length).toBe(351);

    const result = await seedOfficialCities(mockDb, { batchSize: 100 });

    expect(mockDb.transaction).toHaveBeenCalledTimes(1);
    expect(result.totalSeeded).toBe(351);
    expect(result.governorateCount).toBe(27);

    // Verify 4 batches: 100, 100, 100, 51
    expect(insertedBatches.length).toBe(4);
    const totalRecords = insertedBatches.reduce((acc, b) => acc + b.length, 0);
    expect(totalRecords).toBe(351);

    // Verify target table and structure
    expect(mockTx.insert).toHaveBeenCalledWith(cities);
    for (const batch of insertedBatches) {
      for (const row of batch) {
        expect(row.status).toBe('OFFICIAL');
        expect(row.sourceCode).toMatch(/^EG\d{4}$/);
        expect(row.nameEnglish.length).toBeGreaterThan(0);
        expect(row.nameArabic.length).toBeGreaterThan(0);
        expect(row.governorate.length).toBeGreaterThan(0);
      }
    }
  });

  it('configures ON CONFLICT on source_code with DO UPDATE for idempotency without modifying primary keys or deleting historical records', async () => {
    let conflictOptions: any = null;
    mockTx.insert = jest.fn().mockReturnValue({
      values: jest.fn().mockReturnValue({
        onConflictDoUpdate: jest.fn().mockImplementation((opts) => {
          conflictOptions = opts;
          return Promise.resolve({ rowCount: 1 });
        }),
      }),
    });

    await seedOfficialCities(mockDb, { batchSize: 351 });

    expect(conflictOptions).toBeDefined();
    expect(conflictOptions.target).toEqual(cities.sourceCode);
    expect(conflictOptions.set).toBeDefined();
    // Verify columns that get updated on re-seed
    expect(conflictOptions.set.nameEnglish).toBeDefined();
    expect(conflictOptions.set.nameArabic).toBeDefined();
    expect(conflictOptions.set.governorate).toBeDefined();
    expect(conflictOptions.set.sourceNameEnglish).toBeDefined();
    expect(conflictOptions.set.sourceNameArabic).toBeDefined();
    expect(conflictOptions.set.status).toBeDefined();
    expect(conflictOptions.set.centerPoint).toBeDefined();
    // Verify primary key id is NOT updated
    expect(conflictOptions.set.id).toBeUndefined();
    // Verify no deletion was invoked
    expect(mockDb.delete).not.toHaveBeenCalled();
  });

  it('runs database seed and resolves vet clinic city assignments against official cities only', async () => {
    const mockDbSeed: any = {
      transaction: jest.fn().mockImplementation(async (cb) => cb(mockTx)),
      insert: jest.fn().mockReturnValue({
        values: jest.fn().mockReturnValue({
          onConflictDoNothing: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([{ id: 'vet-clinic-1' }]),
          }),
        }),
      }),
      execute: jest.fn().mockResolvedValue({
        rows: [{ id: '01916327-0000-7000-8000-000000000001' }],
      }),
    };

    await runDatabaseSeed(mockDbSeed);

    expect(mockDbSeed.transaction).toHaveBeenCalled();
    // Verify spatial execute query filters on status = 'OFFICIAL'
    expect(mockDbSeed.execute).toHaveBeenCalled();
    const queryCall = mockDbSeed.execute.mock.calls[0][0];
    const queryString = queryCall.queryChunks
      ? queryCall.queryChunks.map((chunk: any) => chunk?.value ?? chunk).join('')
      : JSON.stringify(queryCall);
    expect(queryString).toContain('OFFICIAL');
  });
});
