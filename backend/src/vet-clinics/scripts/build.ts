import * as fs from 'fs';
import * as path from 'path';
import * as prettier from 'prettier';
import { DATA_DIR, clinicSchema } from '../catalog';
import { buildBaseline } from '../pipeline';
import { generateMigration } from '../migration';
async function main() {
  const { clinics, report } = buildBaseline();
  clinics.forEach((c) => clinicSchema.parse(c));
  const config = await prettier.resolveConfig(path.join(DATA_DIR, 'egypt-vet-clinics.json'));
  for (const [name, value] of [
    ['egypt-vet-clinics.json', clinics],
    ['baseline-report.json', report],
  ] as const)
    fs.writeFileSync(
      path.join(DATA_DIR, name),
      await prettier.format(JSON.stringify(value), { ...config, parser: 'json' }),
    );
  fs.writeFileSync(
    path.resolve(__dirname, '../../../drizzle/migrations/0068_release_egypt_vet_clinics.sql'),
    generateMigration(clinics, { firstRelease: true }),
  );
  console.log(
    JSON.stringify(
      {
        raw: report.rawElements,
        candidates: report.candidates,
        rejected: report.rejected.length,
        merges: report.merges.length,
        active: clinics.filter((c) => c.active).length,
        inactive: clinics.filter((c) => !c.active).length,
        counts: report.counts,
      },
      null,
      2,
    ),
  );
}
void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
