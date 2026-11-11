jest.mock('../auth/firebase.guard', () => ({ Public: () => () => undefined }));
import { CitiesResolver } from './cities.resolver';
import { CitiesService } from './cities.service';
import type { GqlContext } from '../common/types/gql-context.type';
import type { City } from '../database/schema';
import { readFileSync } from 'fs';
import * as path from 'path';
import { buildSchema, graphql } from 'graphql';

it('exposes the persisted Arabic governorate through the non-null GraphQL City field', async () => {
  const schema = buildSchema(
    'enum CityLifecycleStatus { OFFICIAL LEGACY RETIRED } type Query { _test: Boolean }\n' +
      readFileSync(path.join(__dirname, 'cities.graphql'), 'utf8'),
  );
  const service = {
    findAll: jest.fn().mockResolvedValue([{ governorate: 'Alexandria', governorateArabic: 'الاسكندرية' }]),
  };
  const resolver = new CitiesResolver(service as unknown as CitiesService);
  const result = await graphql({
    schema,
    source: '{ cities { governorate governorateArabic } }',
    rootValue: { cities: () => resolver.cities() },
  });
  expect(result.errors).toBeUndefined();
  expect(result.data?.cities).toEqual([{ governorate: 'Alexandria', governorateArabic: 'الاسكندرية' }]);
  expect(readFileSync(path.join(__dirname, 'cities.graphql'), 'utf8')).toContain('governorateArabic: String!');
});
describe('City district field', () => {
  it('uses the request DataLoader and makes no lookup for a district', async () => {
    const resolver = new CitiesResolver({} as CitiesService);
    const load = jest.fn().mockResolvedValue({ id: 'district-id' });
    const ctx = { loaders: { cityById: { load } } } as unknown as GqlContext;
    await expect(resolver.district({ districtId: null } as City, ctx)).resolves.toBeNull();
    expect(load).not.toHaveBeenCalled();
    await expect(resolver.district({ districtId: 'district-id' } as City, ctx)).resolves.toEqual({ id: 'district-id' });
    expect(load).toHaveBeenCalledWith('district-id');
  });
});
