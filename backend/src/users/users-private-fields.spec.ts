jest.mock('firebase-admin/auth', () => ({ getAuth: jest.fn() }));

import { UsersResolver } from './users.resolver';
import type { User } from '../database/schema';
import type { GqlContext } from '../common/types/gql-context.type';

/**
 * `User` is returned for other people too (Post.creator, comment authors,
 * contact requesters, adoption applicants). Before these field guards existed,
 * any signed-in viewer could read any poster's email address, phone
 * ciphertext, home city and activity just by selecting the fields.
 */
describe('UsersResolver account-private fields', () => {
  const resolver = new UsersResolver({} as never, {} as never);
  const owner = {
    id: 'user-owner',
    email: 'owner@example.com',
    phoneNumber: '+201000000001',
    homeCityId: 'city-1',
    languagePreference: 'en',
    notificationsEnabled: true,
    lastSeenAt: new Date('2026-09-24T10:00:00Z'),
  } as unknown as User;
  const cityLoader = jest.fn().mockResolvedValue({ id: 'city-1' });
  const ctxFor = (viewerId: string | undefined) =>
    ({
      user: viewerId ? { id: viewerId } : undefined,
      loaders: { cityById: { load: cityLoader } },
    }) as unknown as GqlContext;

  beforeEach(() => cityLoader.mockClear());

  it('returns every private field to the account itself', async () => {
    const self = ctxFor('user-owner');
    expect(resolver.email(owner, self)).toBe('owner@example.com');
    expect(resolver.phoneNumber(owner, self)).toBe('+201000000001');
    expect(resolver.homeCityId(owner, self)).toBe('city-1');
    expect(resolver.languagePreference(owner, self)).toBe('en');
    expect(resolver.notificationsEnabled(owner, self)).toBe(true);
    expect(resolver.lastSeenAt(owner, self)).toEqual(new Date('2026-09-24T10:00:00Z'));
    await expect(resolver.city(owner, self)).resolves.toEqual({ id: 'city-1' });
  });

  it.each([
    ['another signed-in user', 'user-viewer'],
    ['an anonymous context', undefined],
  ])('hides every private field from %s', async (_label, viewerId) => {
    const other = ctxFor(viewerId);
    expect(resolver.email(owner, other)).toBeNull();
    expect(resolver.phoneNumber(owner, other)).toBeNull();
    expect(resolver.homeCityId(owner, other)).toBeNull();
    expect(resolver.languagePreference(owner, other)).toBeNull();
    expect(resolver.notificationsEnabled(owner, other)).toBeNull();
    expect(resolver.lastSeenAt(owner, other)).toBeNull();
    await expect(resolver.city(owner, other)).resolves.toBeNull();
    expect(cityLoader).not.toHaveBeenCalled();
  });
});
