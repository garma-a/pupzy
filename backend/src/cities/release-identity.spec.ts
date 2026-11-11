import { readCityData } from './data-files';
import type { CityCatalog as DistrictFixtureCatalog } from './catalog';
import { applyReviewedRelease } from './plan';
import { compareSnapshots } from './diff';
import { loadRawSnapshot } from './catalog';

const districtFixture = () => readCityData<DistrictFixtureCatalog>('neighbourhoods/district-seed.json.gz').records;

function recodedSnapshot() {
  const snapshot = structuredClone(loadRawSnapshot());
  snapshot.records.find((row) => row.adm2_pcode === 'EG0101')!.adm2_pcode = 'EG0198';
  return snapshot;
}

describe('Reviewed City identity after display-name cleanup', () => {
  it('requires an explicit transfer when the upstream source name survives a display rename', () => {
    const current = districtFixture();
    expect(current.find((row) => row.sourceCode === 'EG0101')).toMatchObject({
      nameEnglish: 'Tebbin',
      sourceNameEnglish: 'Al Tibbin',
    });
    expect(current.find((row) => row.sourceCode === 'EG0101')?.aliases).toContain('Al Tibbin');
    expect(() => applyReviewedRelease(current, recodedSnapshot())).toThrow(
      /Unreviewed City recode detected for 'Al Tibbin'/,
    );
  });
});

describe('Recode identity matching safeguards', () => {
  it('recognizes a retained alias when both display and upstream names have changed', () => {
    const current = districtFixture().map((row) =>
      row.sourceCode === 'EG0101' ? { ...row, aliases: [...(row.aliases ?? []), 'El Tebbin'] } : row,
    );
    const snapshot = recodedSnapshot();
    snapshot.records.find((row) => row.adm2_pcode === 'EG0198')!.adm2_name = 'El Tebbin';
    expect(() => applyReviewedRelease(current, snapshot)).toThrow(/Unreviewed City recode/);
  });

  it('allows an explicitly reviewed one-to-one transfer after display cleanup', () => {
    const release = applyReviewedRelease(districtFixture(), recodedSnapshot(), {
      identityTransfers: [{ retiredCitySourceCode: 'EG0101', replacementCitySourceCode: 'EG0198' }],
    });
    expect(release.identityTransfers).toEqual([
      { retiredCitySourceCode: 'EG0101', replacementCitySourceCode: 'EG0198', notes: undefined },
    ]);
    expect(release.updatedCatalog.find((row) => row.sourceCode === 'EG0198')?.status).toBe('OFFICIAL');
    expect(release.updatedCatalog.some((row) => row.sourceCode === 'EG0101')).toBe(false);
  });

  it('does not mistake an additional district for a recode while the alias owner still exists', () => {
    const current = districtFixture().map((row) =>
      row.sourceCode === 'EG0101' ? { ...row, aliases: [...(row.aliases ?? []), 'Test Additional District'] } : row,
    );
    const snapshot = structuredClone(loadRawSnapshot());
    const extra = {
      ...snapshot.records.find((row) => row.adm2_pcode === 'EG0101')!,
      adm2_pcode: 'EG0198',
      adm2_name: 'Test Additional District',
    };
    snapshot.records.push(extra);
    snapshot.metadata.totalRows++;
    const diff = compareSnapshots(current, snapshot);
    expect(diff.recoded).toEqual([]);
    expect(diff.added.map((row) => row.sourceCode)).toContain('EG0198');
  });
});

describe('Canonical district disambiguation during recodes', () => {
  it('keeps Kism and Markaz transfers distinct despite their shared upstream name', () => {
    const snapshot = structuredClone(loadRawSnapshot());
    snapshot.records.find((row) => row.adm2_pcode === 'EG2801')!.adm2_pcode = 'EG2898';
    snapshot.records.find((row) => row.adm2_pcode === 'EG2802')!.adm2_pcode = 'EG2899';
    const release = applyReviewedRelease(districtFixture(), snapshot, {
      identityTransfers: [
        { retiredCitySourceCode: 'EG2801', replacementCitySourceCode: 'EG2898' },
        { retiredCitySourceCode: 'EG2802', replacementCitySourceCode: 'EG2899' },
      ],
    });
    expect(release.diffReport.recoded.map((row) => [row.oldSourceCode, row.newSourceCode])).toEqual([
      ['EG2801', 'EG2898'],
      ['EG2802', 'EG2899'],
    ]);
  });
});
