import { canonicalAccountPairKey, canonicalAccountPairKeys } from './account-isolation.policy';

const ACCOUNT_A = '0192f0aa-0000-7000-8000-00000000000a';
const ACCOUNT_B = '0192f0bb-0000-7000-8000-00000000000b';
const ACCOUNT_C = '0192f0cc-0000-7000-8000-00000000000c';

describe('canonicalAccountPairKey', () => {
  it('derives one undirected key from sorted account IDs regardless of argument order', () => {
    expect(canonicalAccountPairKey(ACCOUNT_A, ACCOUNT_B)).toBe(`block:${ACCOUNT_A}:${ACCOUNT_B}`);
    expect(canonicalAccountPairKey(ACCOUNT_B, ACCOUNT_A)).toBe(`block:${ACCOUNT_A}:${ACCOUNT_B}`);
  });

  it('normalizes UUID casing before serializing the pair', () => {
    expect(canonicalAccountPairKey(ACCOUNT_A.toUpperCase(), ACCOUNT_B)).toBe(`block:${ACCOUNT_A}:${ACCOUNT_B}`);
    expect(canonicalAccountPairKey(ACCOUNT_A, ACCOUNT_B.toUpperCase())).toBe(`block:${ACCOUNT_A}:${ACCOUNT_B}`);
  });
});

describe('canonicalAccountPairKeys', () => {
  it('deduplicates and sorts pairs deterministically regardless of input order', () => {
    const forward = canonicalAccountPairKeys([
      [ACCOUNT_A, ACCOUNT_B],
      [ACCOUNT_B, ACCOUNT_C],
      [ACCOUNT_C, ACCOUNT_A],
      [ACCOUNT_B, ACCOUNT_A],
    ]);
    const reversed = canonicalAccountPairKeys([
      [ACCOUNT_C, ACCOUNT_A],
      [ACCOUNT_B, ACCOUNT_C],
      [ACCOUNT_A, ACCOUNT_B],
    ]);

    expect(forward).toEqual(reversed);
    expect(forward).toEqual([...forward].sort());
    expect(new Set(forward).size).toBe(forward.length);
    expect(forward).toEqual([
      `block:${ACCOUNT_A}:${ACCOUNT_B}`,
      `block:${ACCOUNT_A}:${ACCOUNT_C}`,
      `block:${ACCOUNT_B}:${ACCOUNT_C}`,
    ]);
  });
});
