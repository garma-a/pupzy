#!/usr/bin/env python3
"""Disposable socket-free SQL check; requires local PostgreSQL + PostGIS binaries. No network."""
from pathlib import Path
import json, subprocess, tempfile, shutil, sys, time, argparse
root=Path(__file__).resolve().parents[3];folder=root/'drizzle/migrations'
parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--catalog',type=Path);parser.add_argument('--migration',type=Path);args=parser.parse_args()
if bool(args.catalog)!=bool(args.migration):parser.error('--catalog and --migration must be specified together')
pgbin=Path(subprocess.check_output(['pg_config','--bindir'],text=True).strip())
cluster=Path(tempfile.mkdtemp(prefix='pupzy-city-sql-'))
subprocess.run([str(pgbin/'initdb'),'-D',str(cluster),'-A','trust','-U','test','--no-locale','-E','UTF8'],check=True,stdout=subprocess.DEVNULL)
chunks=["CREATE EXTENSION IF NOT EXISTS postgis; CREATE EXTENSION IF NOT EXISTS pgcrypto; CREATE OR REPLACE FUNCTION uuidv7() RETURNS uuid AS $$ SELECT gen_random_uuid() $$ LANGUAGE sql VOLATILE;"]
for f in sorted(folder.glob('*.sql')):
 if int(f.name[:4])<=64:chunks.append(f.read_text())
chunks.append((root/'drizzle/custom.sql').read_text())
chunks.append("CREATE TABLE test_city_identities AS SELECT id, source_code FROM cities; INSERT INTO users (firebase_user_id,email,home_city_id) SELECT 'offline-neighbourhood','offline@example.invalid',id FROM cities WHERE source_code='EG0202'; INSERT INTO posts (creator_id,post_type,title,description,city_id,urgency,coordinates) SELECT users.id,'RESCUE','Offline test','Offline test',cities.id,'URGENT',cities.center_point FROM users CROSS JOIN cities WHERE users.firebase_user_id='offline-neighbourhood' AND cities.source_code='EG0202';")
# Match pre-deploy's transactional pending migrations, followed by repeatable SQL.
expected_rows = json.dumps({r['sourceCode']: {k:r.get(k) for k in ['nameEnglish','nameArabic','sourceNameEnglish','sourceNameArabic']} for r in json.loads((args.catalog or root/'src/cities/data/egypt-cities-catalog.json').read_text())['records']},ensure_ascii=False).replace("'", "''")
canonical_check = "DO $$ BEGIN IF EXISTS (SELECT 1 FROM jsonb_each('" + expected_rows + "'::jsonb) expected LEFT JOIN cities ON cities.source_code = expected.key WHERE cities.name_english IS DISTINCT FROM expected.value->>'nameEnglish' OR cities.name_arabic IS DISTINCT FROM expected.value->>'nameArabic' OR cities.source_name_english IS DISTINCT FROM expected.value->>'sourceNameEnglish' OR cities.source_name_arabic IS DISTINCT FROM expected.value->>'sourceNameArabic') THEN RAISE EXCEPTION 'Deploy changed reviewed City display/source names'; END IF; END $$;"
state_check = "DO $$ BEGIN IF EXISTS (SELECT row_data FROM test_released_city_state EXCEPT SELECT to_jsonb(c) FROM cities c) OR EXISTS (SELECT to_jsonb(c) FROM cities c EXCEPT SELECT row_data FROM test_released_city_state) THEN RAISE EXCEPTION 'Re-run changed released City rows'; END IF; END $$;"
for attempt in range(2):
 chunks.append("SELECT clock_timestamp() AS apply_started;")
 chunks.append('BEGIN;\n' + (folder/'0065_add_city_neighbourhood_fields.sql').read_text() + '\n' + (args.migration or folder/'0066_release_city_catalog.sql').read_text() + '\nCOMMIT;')
 chunks.append("SELECT clock_timestamp() AS apply_finished;")
 chunks.append((root/'drizzle/custom.sql').read_text())
 chunks.append('SELECT district_id, aliases FROM cities LIMIT 1;')
 chunks.append(canonical_check)
 if attempt == 0:
  chunks.append('CREATE TABLE test_released_city_state AS SELECT to_jsonb(c) AS row_data FROM cities c;')
 else:
  chunks.append(state_check)
# A subsequent deploy has no pending journal entries: only custom.sql is repeated.
# The integration test exercises runMigrations itself; this socket-free check verifies its SQL effects.
chunks.append('CREATE TABLE test_redeploy_revision AS SELECT revision FROM city_catalog_revisions WHERE id = 1;')
for _ in range(2):
 chunks.append((root/'drizzle/custom.sql').read_text())
 chunks.append(canonical_check)
 chunks.append(state_check)
 chunks.append("DO $$ BEGIN IF (SELECT revision FROM city_catalog_revisions WHERE id = 1) <> (SELECT revision FROM test_redeploy_revision) THEN RAISE EXCEPTION 'No-op deploy advanced catalog revision'; END IF; END $$;")
chunks.append("""
INSERT INTO cities (source_code,name_english,name_arabic,governorate,status,center_point,district_id)
SELECT 'PUPZY:sql-test-quarter','SQL Test Quarter','حي الاختبار','Alexandria','OFFICIAL',ST_Translate(center_point,0.001,0),id FROM cities WHERE source_code='EG0202';
DO $$ DECLARE child_id uuid; nearest_code text; BEGIN
SELECT id INTO child_id FROM cities WHERE source_code='PUPZY:sql-test-quarter';
SELECT source_code INTO nearest_code FROM cities WHERE status='OFFICIAL' ORDER BY ST_Distance(center_point::geography,(SELECT center_point::geography FROM cities WHERE id=child_id)) LIMIT 1;
IF nearest_code <> 'PUPZY:sql-test-quarter' THEN RAISE EXCEPTION 'Nearest excludes neighbourhood'; END IF;
BEGIN
UPDATE cities SET district_id=child_id WHERE source_code='EG0202'; SET CONSTRAINTS ALL IMMEDIATE;
RAISE EXCEPTION 'Nested parent accepted'; EXCEPTION WHEN check_violation THEN NULL; END;
BEGIN
UPDATE cities SET status='RETIRED' WHERE source_code='EG0202'; SET CONSTRAINTS ALL IMMEDIATE;
RAISE EXCEPTION 'Retired parent accepted'; EXCEPTION WHEN check_violation THEN NULL; END;
BEGIN
UPDATE cities SET governorate='Giza' WHERE id=child_id; SET CONSTRAINTS ALL IMMEDIATE;
RAISE EXCEPTION 'Cross-governorate parent accepted'; EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
DELETE FROM cities WHERE source_code='PUPZY:sql-test-quarter';
""")
chunks.append("DO $$ BEGIN IF EXISTS(SELECT 1 FROM test_city_identities old LEFT JOIN cities USING(source_code) WHERE cities.id IS DISTINCT FROM old.id) THEN RAISE EXCEPTION 'UUID changed'; END IF; IF NOT EXISTS(SELECT 1 FROM users JOIN posts ON posts.creator_id=users.id WHERE users.firebase_user_id='offline-neighbourhood' AND users.home_city_id=posts.city_id) THEN RAISE EXCEPTION 'References lost'; END IF; END $$; SELECT 'OFFLINE_UPGRADE_OK' AS result;")
content='\n\n'.join('\n'.join(line for line in chunk.splitlines() if line.strip()) for chunk in chunks)+'\n\n'
started=time.perf_counter()
run=subprocess.run([str(pgbin/'postgres'),'--single','-j','-D',str(cluster),'template1'],input=content,text=True,capture_output=True)
log=run.stdout+'\n'+run.stderr
(root/'output/neighbourhood-cities').mkdir(parents=True,exist_ok=True)
(root/'output/neighbourhood-cities/single-user-postgres.log').write_text(log)
shutil.rmtree(cluster)
errors=[line for line in run.stderr.splitlines() if 'ERROR:' in line or 'FATAL:' in line]
elapsed=time.perf_counter()-started
print('SQL workload seconds',round(elapsed,3),'expected catalog rows',len(json.loads((args.catalog or root/'src/cities/data/egypt-cities-catalog.json').read_text())['records']))
print('single-user exit',run.returncode,'errors',len(errors),'marker present','OFFLINE_UPGRADE_OK' in run.stdout)
print('\n'.join(errors[:15]))

sys.exit(1 if errors or run.returncode or 'OFFLINE_UPGRADE_OK' not in run.stdout else 0)
