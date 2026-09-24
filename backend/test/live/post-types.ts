import { gql, ok } from './harness';

export type Interaction = 'contactRequest' | 'adoptionApplication' | 'sellerContact' | 'none';

export interface PostTypeCase {
  key: string;
  postType: 'RESCUE' | 'LOST' | 'ADOPTION' | 'PRODUCT' | 'MATING';
  /** Whether at least one photo is mandatory at creation. */
  photoRequired: boolean;
  /** Owner closure target (post-lifecycle.contract.ts). */
  closeTo: string;
  renewable: boolean;
  /** ADOPTION / PRODUCT / MATING never reveal coordinates (city only). */
  coordinatesPublic: boolean;
  /** Photo comments are allowed only beneath RESCUE and LOST. */
  photoComments: boolean;
  /** How a viewer reaches the owner. */
  interaction: Interaction;
  create(token: string, cityId: string, mediaIds: string[], minimal?: boolean): Promise<string>;
  /** Ids visible in this type's own feed for the given city. */
  feedIds(token: string, cityId: string): Promise<string[]>;
  /** Type-specific detail query; resolves to the extension row or null. */
  detail(token: string, id: string): Promise<{ data: unknown; code: string | null }>;
}

const coords = { latitude: 30.0444, longitude: 31.2357 };
const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);

async function idsFrom(token: string, query: string, field: string, variables: Record<string, unknown>) {
  const data = await ok<Record<string, { edges: Array<{ node: { id: string } }> }>>(token, query, variables);
  return data[field].edges.map((e) => e.node.id);
}

const helpFeed = (token: string, city: string) =>
  idsFrom(token, `query($c: ID) { helpFeed(cityId: $c, first: 50) { edges { node { id } } } }`, 'helpFeed', { c: city });

async function detailCall(token: string, field: string, id: string) {
  const r = await gql(token, `query($id: ID!) { ${field}(postId: $id) { __typename } }`, { id });
  return { data: r.data?.[field] ?? null, code: r.code };
}

const createPost = async (token: string, mutation: string, input: Record<string, unknown>) => {
  const data = await ok<Record<string, { id: string }>>(token, `mutation($i: ${mutation[0].toUpperCase()}${mutation.slice(1)}Input!) { ${mutation}(input: $i) { id } }`, { i: input });
  return data[mutation].id;
};

export const POST_TYPES: PostTypeCase[] = [
  {
    key: 'RESCUE',
    postType: 'RESCUE',
    photoRequired: false,
    closeTo: 'RESOLVED',
    renewable: false,
    coordinatesPublic: true,
    photoComments: true,
    interaction: 'none',
    create: (t, city, mediaIds, minimal) =>
      createPost(t, 'createRescuePost', {
        title: 'E2E injured cat on the corner',
        description: 'Limping cat hiding under a parked car, needs a carrier.',
        cityId: city,
        coordinates: coords,
        ...(minimal ? {} : { areaName: 'Garden City' }),
        species: 'CAT',
        conditionSummary: 'Limping, alert, not bleeding.',
        reporterRole: 'REPORTING',
        isLifeThreatening: false,
        hasVisibleSeriousInjury: true,
        isInDangerousLocation: false,
        canAnimalMoveOrEscape: true,
        ...(mediaIds.length ? { mediaIds } : {}),
      }),
    feedIds: helpFeed,
    detail: (t, id) => detailCall(t, 'rescuePostDetail', id),
  },
  {
    key: 'LOST_PET',
    postType: 'LOST',
    photoRequired: false,
    closeTo: 'REUNITED',
    renewable: false,
    coordinatesPublic: true,
    photoComments: true,
    interaction: 'contactRequest',
    create: (t, city, mediaIds, minimal) =>
      createPost(t, 'createLostPost', {
        title: 'E2E lost beagle',
        description: 'Brown and white beagle, answers to Max, very friendly.',
        cityId: city,
        coordinates: coords,
        reportType: 'LOST_PET',
        species: 'DOG',
        hasMedicalNeeds: false,
        isElderlyOrVeryYoung: false,
        lastSeenNearHazard: false,
        dateLastSeen: iso(1), // required for LOST_PET
        ...(minimal
          ? {}
          : {
              petName: 'Max',
              breed: 'Beagle',
              colorAndMarkings: 'Brown and white',
              hasCollarWithIdentificationTag: true,
              circumstances: 'Slipped the leash near the park gate.',
            }),
        ...(mediaIds.length ? { mediaIds } : {}),
      }),
    feedIds: helpFeed,
    detail: (t, id) => detailCall(t, 'lostPostDetail', id),
  },
  {
    key: 'FOUND_STRAY',
    postType: 'LOST',
    photoRequired: false,
    closeTo: 'RESOLVED',
    renewable: false,
    coordinatesPublic: true,
    photoComments: true,
    interaction: 'contactRequest',
    create: (t, city, mediaIds, minimal) =>
      createPost(t, 'createLostPost', {
        title: 'E2E found grey kitten',
        description: 'Found a grey kitten near the bus stop, safe with me now.',
        cityId: city,
        coordinates: coords,
        reportType: 'FOUND_STRAY',
        species: 'CAT',
        currentCondition: 'HEALTHY',
        isCurrentlySafeWithReporter: true,
        dateFound: iso(0),
        ...(minimal ? {} : { colorAndMarkings: 'Grey tabby', circumstances: 'Crying alone under a bench.' }),
        ...(mediaIds.length ? { mediaIds } : {}),
      }),
    feedIds: helpFeed,
    detail: (t, id) => detailCall(t, 'lostPostDetail', id),
  },
  {
    key: 'ADOPTION',
    postType: 'ADOPTION',
    photoRequired: false,
    closeTo: 'ADOPTED',
    renewable: true,
    coordinatesPublic: false,
    photoComments: false,
    interaction: 'adoptionApplication',
    create: (t, city, mediaIds, minimal) =>
      createPost(t, 'createAdoptionPost', {
        title: 'E2E Nala needs a home',
        description: 'Gentle two-year-old cat, litter trained, loves naps.',
        cityId: city,
        coordinates: coords,
        petName: 'Nala',
        species: 'CAT',
        gender: 'FEMALE',
        vaccinated: true,
        neutered: true,
        priorPetExperienceRequired: false,
        ...(minimal
          ? {}
          : { breed: 'Mixed', ageValue: 2, ageUnit: 'YEARS', personalityTags: ['GENTLE', 'INDOOR'], healthNotes: 'Healthy' }),
        ...(mediaIds.length ? { mediaIds } : {}),
      }),
    feedIds: (t, city) =>
      idsFrom(t, `query($c: ID) { adoptFeed(cityId: $c, first: 50) { edges { node { id } } } }`, 'adoptFeed', { c: city }),
    detail: (t, id) => detailCall(t, 'adoptionPostDetail', id),
  },
  {
    key: 'PRODUCT',
    postType: 'PRODUCT',
    photoRequired: false,
    closeTo: 'SOLD',
    renewable: true,
    coordinatesPublic: false,
    photoComments: false,
    interaction: 'sellerContact',
    create: (t, city, mediaIds, minimal) =>
      createPost(t, 'createProductPost', {
        title: 'E2E cat scratching post',
        description: 'Tall sisal scratching post, lightly used.',
        cityId: city,
        coordinates: coords,
        category: 'ACCESSORIES',
        condition: 'USED',
        isFree: false,
        priceAmount: 250,
        ...(minimal ? {} : { priceCurrency: 'EGP', openToOffers: true }),
        ...(mediaIds.length ? { mediaIds } : {}),
      }),
    feedIds: (t, city) =>
      idsFrom(t, `query($c: ID) { marketFeed(cityId: $c, first: 50) { edges { node { id } } } }`, 'marketFeed', { c: city }),
    detail: (t, id) => detailCall(t, 'productPostDetail', id),
  },
  {
    key: 'MATING',
    postType: 'MATING',
    photoRequired: true,
    closeTo: 'RESOLVED',
    renewable: false,
    coordinatesPublic: false,
    photoComments: false,
    interaction: 'contactRequest',
    create: (t, city, mediaIds, minimal) =>
      createPost(t, 'createMatingPost', {
        petName: 'Duke',
        species: 'DOG',
        breed: 'Golden Retriever',
        gender: 'MALE',
        ageValue: 3,
        ageUnit: 'YEARS',
        isPurebred: true,
        cityId: city,
        mediaIds,
        ...(minimal
          ? {}
          : {
              hasPedigreeCertificate: true,
              vaccinated: true,
              dewormed: true,
              termsSummary: 'First pick of the litter',
              matingConditions: 'Vaccination records required.',
            }),
      }),
    feedIds: (t, city) =>
      idsFrom(
        t,
        `query($c: ID) { matingFeed(filter: { cityId: $c }, first: 50) { edges { node { id } } } }`,
        'matingFeed',
        { c: city },
      ),
    detail: (t, id) => detailCall(t, 'matingPostDetail', id),
  },
];
