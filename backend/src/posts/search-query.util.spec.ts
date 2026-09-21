import { ValidationError } from '../common/errors/app.errors';
import {
  SEARCH_QUERY_MAX_LENGTH,
  SEARCH_QUERY_MIN_LENGTH,
  buildFeedSearchPattern,
  normalizeSearchText,
} from './search-query.util';

describe('normalizeSearchText', () => {
  it('lowercases English text and collapses whitespace runs', () => {
    expect(normalizeSearchText('  Lost   DOG \t near\nMaadi  ')).toBe('lost dog near maadi');
  });

  it('strips Arabic diacritics and tatweel', () => {
    expect(normalizeSearchText('كَلب')).toBe('كلب');
    expect(normalizeSearchText('كـــلب')).toBe('كلب');
    expect(normalizeSearchText('مِنطَقَة')).toBe('منطقه');
  });

  it('unifies alef variants with bare alef', () => {
    expect(normalizeSearchText('أحمد')).toBe(normalizeSearchText('احمد'));
    expect(normalizeSearchText('إبراهيم')).toBe(normalizeSearchText('ابراهيم'));
    expect(normalizeSearchText('آية')).toBe(normalizeSearchText('ايه'));
    expect(normalizeSearchText('ٱلْقَاهِرَة')).toBe(normalizeSearchText('القاهرة'));
  });

  it('unifies yeh variants, waw hamza and teh marbuta', () => {
    expect(normalizeSearchText('المعادى')).toBe(normalizeSearchText('المعادي'));
    expect(normalizeSearchText('مسئول')).toBe(normalizeSearchText('مسيول'));
    expect(normalizeSearchText('مؤن')).toBe(normalizeSearchText('مون'));
    expect(normalizeSearchText('القاهرة')).toBe(normalizeSearchText('القاهره'));
    expect(normalizeSearchText('قطة')).toBe(normalizeSearchText('قطه'));
  });

  it('normalizes both sides of a real Arabic variant pair to the same text', () => {
    expect(normalizeSearchText('قاهره')).toBe('قاهره');
    expect(normalizeSearchText('القاهرة')).toBe('القاهره');
    expect(normalizeSearchText('المعادى')).toBe('المعادي');
    expect(normalizeSearchText('المعادي')).toBe('المعادي');
  });

  it('returns empty text for diacritics-only input', () => {
    expect(normalizeSearchText('ًَُ')).toBe('');
    expect(normalizeSearchText('   ')).toBe('');
  });
});

describe('buildFeedSearchPattern', () => {
  it('treats missing, empty and whitespace-only search as no search', () => {
    expect(buildFeedSearchPattern(undefined)).toBeNull();
    expect(buildFeedSearchPattern(null)).toBeNull();
    expect(buildFeedSearchPattern('')).toBeNull();
    expect(buildFeedSearchPattern('   \t\n ')).toBeNull();
  });

  it('treats text that normalizes away as no search', () => {
    expect(buildFeedSearchPattern('ًَ')).toBeNull();
  });

  it('wraps normalized text in a LIKE pattern', () => {
    expect(buildFeedSearchPattern('  LOST   Dog ')).toBe('%lost dog%');
    expect(buildFeedSearchPattern('احمد')).toBe('%احمد%');
    expect(buildFeedSearchPattern('المعادى')).toBe('%المعادي%');
  });

  it(`rejects normalized text shorter than ${SEARCH_QUERY_MIN_LENGTH} characters`, () => {
    expect(() => buildFeedSearchPattern('x')).toThrow(ValidationError);
    expect(() => buildFeedSearchPattern(' أ ')).toThrow('search must be at least 2 characters');
  });

  it(`rejects text longer than ${SEARCH_QUERY_MAX_LENGTH} characters after trimming`, () => {
    const oversize = 'a'.repeat(SEARCH_QUERY_MAX_LENGTH + 1);
    expect(() => buildFeedSearchPattern(oversize)).toThrow(ValidationError);
    expect(() => buildFeedSearchPattern(`  ${oversize}  `)).toThrow('search must be at most 100 characters');
    expect(buildFeedSearchPattern('a'.repeat(SEARCH_QUERY_MAX_LENGTH))).toBe(
      `%${'a'.repeat(SEARCH_QUERY_MAX_LENGTH)}%`,
    );
  });

  it('escapes LIKE metacharacters so they match literally', () => {
    expect(buildFeedSearchPattern('100%')).toBe('%100\\%%');
    expect(buildFeedSearchPattern('a_b')).toBe('%a\\_b%');
    expect(buildFeedSearchPattern('back\\slash')).toBe('%back\\\\slash%');
  });
});
