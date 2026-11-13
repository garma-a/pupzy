# Egypt Vet Clinic release

`egypt-vet-clinics.json` is the reviewed release: 549 clinics, shipped by migration
`0068_release_egypt_vet_clinics.sql`. The SQL is generated from this file and must match it byte for byte.

Files in this folder:

- `egypt-vet-clinics.json` - the release dataset (generated; do not hand edit).
- `coverage-exceptions.json` - owner-reviewed governorates allowed to have no active clinic (New Valley only).
- `known-clinics-checklist.json` - independent lead checklist; at least 90% must match an active clinic.
- `branch-display-areas.json` - place labels used when qualifying repeated branch names.
- `phone-fixtures.json` - shared phone normalization fixtures for unit tests.

Gates that always run (`npx jest src/vet-clinics --testPathIgnorePatterns integration --runInBand`):
record schema, names and casing, address rules, phones and shared phones, exclusions, 27-governorate coverage with the
exceptions file, the checklist, and regeneration of the 0068 SQL from the dataset.

The research evidence is not in this branch. Raw OSM snapshot, web evidence, geocode responses, per-governorate
research inputs, ledgers, review decisions and stage reports live on the never-merged branch `vet-clinics-evidence`.
The scripts in `../scripts/` (build, import, geocode, fetch, report) and `pipeline.ts` need those files: check them out
into this folder to rebuild the release. The provenance and research checks (OSM snapshot binding, geocode
responses, depth dispositions, ledgers, rebuild from inputs) run on that branch, in its original
`data-quality.spec.ts`; they are not part of this branch's test run.

After release, administrators own the data. Later additions are new insert-only migrations: allocate a new migration
number and keep `firstRelease` false in `generateMigration`.
