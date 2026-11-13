import { readFileSync } from 'fs';
import { resolve } from 'path';
import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core';
import { vetClinics } from '../database/schema/vet-clinics.schema';

it('renders the phone check exactly as the 0067 constraint, including the literal plus escape', () => {
  const check = getTableConfig(vetClinics).checks.find((c) => c.name === 'chk_vet_clinics_phone')!;
  const sql = new PgDialect().sqlToQuery(check.value).sql;
  const rendered = sql.replace(/"vet_clinics"\."phone_number"/g, 'phone_number');
  const migration = readFileSync(
    resolve(__dirname, '../../drizzle/migrations/0067_vet_clinic_release_fields.sql'),
    'utf8',
  );
  const constraint = migration.match(/chk_vet_clinics_phone CHECK\s*\((.*?)\) NOT VALID/s)![1];
  expect(rendered).toBe(constraint);
  expect(rendered).toContain('^\\+20');
  for (const number of ['0067', '0068']) {
    const snapshot = JSON.parse(
      readFileSync(resolve(__dirname, `../../drizzle/migrations/meta/${number}_snapshot.json`), 'utf8'),
    ) as { tables: Record<string, { checkConstraints: Record<string, { value: string }> }> };
    expect(snapshot.tables['public.vet_clinics'].checkConstraints.chk_vet_clinics_phone.value).toBe(sql);
  }
});
