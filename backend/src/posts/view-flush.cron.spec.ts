import { ViewFlushCron } from './view-flush.cron';
import { PostsRepository } from './posts.repository';

describe('ViewFlushCron', () => {
  let cron: ViewFlushCron;
  let mockPostsRepo: jest.Mocked<Partial<PostsRepository>>;

  beforeEach(() => {
    mockPostsRepo = {
      bulkIncrementViews: jest.fn().mockResolvedValue(undefined),
    };
    cron = new ViewFlushCron(mockPostsRepo as PostsRepository);
  });

  it('buffers views and increments count per post', () => {
    cron.bufferView('post-1');
    cron.bufferView('post-1');
    cron.bufferView('post-2');

    expect(cron.viewBuffer.get('post-1')).toBe(2);
    expect(cron.viewBuffer.get('post-2')).toBe(1);
  });

  it('flushes buffer to repository and clears in-memory map', async () => {
    cron.bufferView('post-1');
    cron.bufferView('post-2');

    await cron.handleFlush();

    expect(mockPostsRepo.bulkIncrementViews).toHaveBeenCalled();
    expect(cron.viewBuffer.size).toBe(0);
  });

  it('does nothing when buffer is empty', async () => {
    await cron.handleFlush();
    expect(mockPostsRepo.bulkIncrementViews).not.toHaveBeenCalled();
  });

  it('handles error gracefully without crashing', async () => {
    mockPostsRepo.bulkIncrementViews = jest.fn().mockRejectedValue(new Error('DB connection failed'));
    cron.bufferView('post-1');

    await expect(cron.handleFlush()).resolves.not.toThrow();
  });
});
