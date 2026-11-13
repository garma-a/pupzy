import { assertGovernorateCoverage } from './coverage';

const decision = {
  governorate: 'New Valley',
  decidedBy: 'owner',
  decidedAt: '2026-11-12',
  reason: 'No qualifying private pet clinic could be sourced; owner approved shipping without one.',
  ledger: 'research-new-valley-stage3-ledger.json',
};
const governorates = ['Cairo', 'New Valley'];
const cairo = { governorate: 'Cairo', active: true };

describe('reviewed governorate coverage exceptions', () => {
  it('accepts an explicitly reviewed gap and does not count inactive clinics as coverage', () => {
    expect(() =>
      assertGovernorateCoverage(governorates, [cairo, { governorate: 'New Valley', active: false }], [decision]),
    ).not.toThrow();
  });
  it('rejects every unexcepted gap, even with another valid exception', () => {
    expect(() => assertGovernorateCoverage(governorates, [], [decision])).toThrow('Cairo');
    expect(() => assertGovernorateCoverage(governorates, [cairo], [])).toThrow('New Valley');
  });
  it('requires removal of an exception as soon as an active clinic is added', () => {
    const covered = [cairo, { governorate: 'New Valley', active: true }];
    expect(() => assertGovernorateCoverage(governorates, covered, [decision])).toThrow(
      'Remove obsolete coverage exception',
    );
    expect(() => assertGovernorateCoverage(governorates, covered, [])).not.toThrow();
  });
  it('rejects unknown, duplicate or undocumented exceptions', () => {
    expect(() => assertGovernorateCoverage(governorates, [cairo], [{ ...decision, governorate: 'Typo' }])).toThrow(
      'Unknown',
    );
    expect(() => assertGovernorateCoverage(governorates, [cairo], [decision, decision])).toThrow('Duplicate');
    expect(() =>
      assertGovernorateCoverage(governorates, [cairo], [{ ...decision, decidedBy: 'researcher' }]),
    ).toThrow();
    expect(() => assertGovernorateCoverage(governorates, [cairo], [{ ...decision, ledger: '' }])).toThrow();
  });
});
