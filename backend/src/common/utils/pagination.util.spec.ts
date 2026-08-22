import { clampFirst } from './pagination.util';

describe('clampFirst', () => {
  it('clamps negative numbers to 1', () => {
    expect(clampFirst(-5)).toBe(1);
    expect(clampFirst(-1)).toBe(1);
  });

  it('clamps 0 to 1', () => {
    expect(clampFirst(0)).toBe(1);
  });

  it('clamps numbers above max (50) to 50', () => {
    expect(clampFirst(100)).toBe(50);
    expect(clampFirst(51)).toBe(50);
  });

  it('returns fallback for null or undefined or NaN', () => {
    expect(clampFirst(null)).toBe(20);
    expect(clampFirst(undefined)).toBe(20);
    expect(clampFirst(NaN)).toBe(20);
  });

  it('floors float numbers', () => {
    expect(clampFirst(15.7)).toBe(15);
  });

  it('preserves valid numbers in range [1, 50]', () => {
    expect(clampFirst(1)).toBe(1);
    expect(clampFirst(25)).toBe(25);
    expect(clampFirst(50)).toBe(50);
  });
});
