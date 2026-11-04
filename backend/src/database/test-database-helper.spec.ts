import { EventEmitter } from 'node:events';
import { Pool } from 'pg';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { TestDatabaseHelper } from '../../test/test-database.helper';

jest.mock('pg', () => {
  const actual = jest.requireActual<typeof import('pg')>('pg');
  return { ...actual, Pool: jest.fn() };
});
jest.mock('@testcontainers/postgresql', () => ({ PostgreSqlContainer: jest.fn() }));
jest.mock('./migrate', () => ({ runMigrations: jest.fn().mockResolvedValue(undefined) }));

describe('TestDatabaseHelper shutdown', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.replaceProperty(process, 'env', { ...process.env, TEST_DATABASE_URL: '' });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function startHelper() {
    const pool = Object.assign(new EventEmitter(), {
      end: jest.fn().mockResolvedValue(undefined),
    });
    const container = {
      getConnectionUri: () => 'postgresql://test:test@localhost/pupzy_test',
      stop: jest.fn().mockResolvedValue(undefined),
    };
    const builder = {
      withDatabase: jest.fn().mockReturnThis(),
      withUsername: jest.fn().mockReturnThis(),
      withPassword: jest.fn().mockReturnThis(),
      start: jest.fn().mockResolvedValue(container),
    };
    (Pool as unknown as jest.Mock).mockReturnValue(pool);
    (PostgreSqlContainer as unknown as jest.Mock).mockReturnValue(builder);

    const helper = new TestDatabaseHelper();
    await helper.start();
    return { helper, pool, container };
  }

  it('waits for every PostgreSQL client to disconnect before stopping the database container', async () => {
    const { helper, pool, container } = await startHelper();
    const firstClient = new EventEmitter();
    const secondClient = new EventEmitter();
    pool.emit('connect', firstClient);
    pool.emit('connect', secondClient);

    // pg-pool can resolve end() while idle clients are still disconnecting.
    const stopped = helper.stop();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(pool.end).toHaveBeenCalledTimes(1);
    expect(container.stop).not.toHaveBeenCalled();

    firstClient.emit('end');
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(container.stop).not.toHaveBeenCalled();

    secondClient.emit('end');
    await stopped;
    expect(container.stop).toHaveBeenCalledTimes(1);
  });

  it('does not wait again for clients that disconnected before shutdown', async () => {
    const { helper, pool, container } = await startHelper();
    const client = new EventEmitter();
    pool.emit('connect', client);
    client.emit('end');

    await helper.stop();

    expect(pool.end).toHaveBeenCalledTimes(1);
    expect(container.stop).toHaveBeenCalledTimes(1);
  });
});
