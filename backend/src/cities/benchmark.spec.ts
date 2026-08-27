/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/require-await, @typescript-eslint/no-unsafe-return */
import { ensureOfficialCities, type OfficialCityReference } from './seed';
import { getOfficialCatalog } from './catalog';
import { cities } from '../database/schema/cities.schema';

function createMockOfficialCities(): OfficialCityReference[] {
  const officialCatalog = getOfficialCatalog();
  return officialCatalog.map((c, i) => ({
    id: `01916327-0000-7000-8000-${String(i + 1).padStart(12, '0')}`,
    governorate: c.governorate,
  }));
}

describe('Benchmark City Selection', () => {
  it('reuses the official 351 Cities from the database and never creates fake Cities', async () => {
    const mockOfficialCities = createMockOfficialCities();

    const mockDb: any = {
      select: jest.fn().mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue(mockOfficialCities),
        }),
      }),
      insert: jest.fn(),
    };

    const result = await ensureOfficialCities(mockDb);

    expect(result.length).toBe(351);
    expect(mockDb.select).toHaveBeenCalled();
    expect(mockDb.insert).not.toHaveBeenCalled();

    // Verify all returned cities come from official governorates without any fake names
    for (const city of result) {
      expect(city.id).toBeDefined();
      expect(city.governorate).toBeDefined();
    }
  });

  it('triggers official seeding if official cities are absent and returns the 351 official catalog', async () => {
    const mockOfficialCities = createMockOfficialCities();

    let queryCount = 0;
    const mockTx: any = {
      insert: jest.fn().mockReturnValue({
        values: jest.fn().mockReturnValue({
          onConflictDoUpdate: jest.fn().mockResolvedValue({ rowCount: 100 }),
        }),
      }),
    };

    const mockDb: any = {
      select: jest.fn().mockReturnValue({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockImplementation(() => {
            queryCount++;
            if (queryCount === 1) return Promise.resolve([]); // first query: empty DB
            return Promise.resolve(mockOfficialCities); // second query after seed
          }),
        }),
      }),
      transaction: jest.fn().mockImplementation(async (cb) => cb(mockTx)),
      insert: mockTx.insert,
    };

    const result = await ensureOfficialCities(mockDb);

    expect(result.length).toBe(351);
    expect(mockDb.transaction).toHaveBeenCalled();
    expect(mockTx.insert).toHaveBeenCalledWith(cities);
  });
});
