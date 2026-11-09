jest.mock('../auth/firebase.guard', () => ({ Public: () => () => undefined }));
import { CitiesResolver } from './cities.resolver';
import { CitiesService } from './cities.service';
import type { GqlContext } from '../common/types/gql-context.type';
import type { City } from '../database/schema';
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
