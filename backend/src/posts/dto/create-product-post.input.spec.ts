import { validateCreateProductPostInput } from './create-product-post.input';
import { ValidationError } from '../../common/errors/app.errors';

describe('validateCreateProductPostInput', () => {
  const validCoordinates = { latitude: 30.0444, longitude: 31.2357 };

  it('validates a correct paid product post input', () => {
    const validRaw = {
      title: 'Wooden Bird Cage',
      description: 'Handmade wooden bird cage in great condition.',
      coordinates: validCoordinates,
      category: 'CARE',
      condition: 'LIKE_NEW',
      isFree: false,
      priceAmount: 350,
      priceCurrency: 'EGP',
      openToOffers: true,
    };

    const parsed = validateCreateProductPostInput(validRaw);
    expect(parsed.title).toBe('Wooden Bird Cage');
    expect(parsed.priceAmount).toBe(350);
    expect(parsed.isFree).toBe(false);
  });

  it('validates a correct free product post input', () => {
    const validRaw = {
      title: 'Free Cat Scratching Post',
      description: 'Used but still good condition, giving away for free.',
      coordinates: validCoordinates,
      category: 'ACCESSORIES',
      condition: 'USED',
      isFree: true,
    };

    const parsed = validateCreateProductPostInput(validRaw);
    expect(parsed.isFree).toBe(true);
    expect(parsed.priceAmount).toBeUndefined();
  });

  it('throws ValidationError when isFree is false but priceAmount is missing', () => {
    const invalidRaw = {
      title: 'Dog Leash',
      description: 'High quality nylon leash.',
      coordinates: validCoordinates,
      category: 'ACCESSORIES',
      condition: 'NEW',
      isFree: false,
    };

    expect(() => validateCreateProductPostInput(invalidRaw)).toThrow(ValidationError);
  });

  it('throws ValidationError when isFree is true but priceAmount is provided', () => {
    const invalidRaw = {
      title: 'Free Leash',
      description: 'Giving away leash.',
      coordinates: validCoordinates,
      category: 'ACCESSORIES',
      condition: 'NEW',
      isFree: true,
      priceAmount: 100,
    };

    expect(() => validateCreateProductPostInput(invalidRaw)).toThrow(ValidationError);
  });
});
