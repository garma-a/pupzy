import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { Clinic, DATA_DIR, readData } from '../catalog';
const clinics = readData<Clinic[]>('egypt-vet-clinics.json');
const targets = ['Alexandria', 'Port Said', 'Cairo', 'Giza'];
const lines = [
  '# Stage 2 dataset review report',
  '',
  `${clinics.filter((c) => c.active).length} active / ${clinics.filter((c) => !c.active).length} inactive nationally in this staged release.`,
  '',
  '| Governorate | Active | Inactive | Exact / street / area | 24-hour |',
  '| --- | ---: | ---: | --- | ---: |',
  ...targets.map((g) => {
    const rows = clinics.filter((c) => c.governorate === g);
    return `| ${g} | ${rows.filter((c) => c.active).length} | ${rows.filter((c) => !c.active).length} | ${['exact', 'street', 'area'].map((p) => rows.filter((c) => c.locationPrecision === p).length).join(' / ')} | ${rows.filter((c) => c.is24Hours).length} |`;
  }),
  '',
  'Parts A/B: 0067 contains the escaped phone constraint and location_precision; 0068 is the regenerated release. Both snapshots and the journal agree. Shared admin/backend phone fixtures, translated generic name descriptors, source aliases, checklist normalization, reviewed shared-phone ownership, GraphQL hours/Facebook documentation and approximate-location Maps handoff are implemented. Main files: vet-clinics.schema.ts, vet-clinics/{catalog,geocoding,pipeline,migration,vet-clinics.service,vet-clinics.repository}.ts, vet-clinics.graphql and admin-service clinic resources/mutations.',
  '',
  'Generated from the checked-in reviewed inputs. Consultation/block/exclusion details are in vet-clinics-research.md and vet-clinics-research-extra.md. Random samples use SHA-256 ordering with seed 20261112, without replacement.',
  '',
];
for (const governorate of targets) {
  const rows = clinics.filter((c) => c.governorate === governorate);
  const slug = governorate.toLowerCase().replace(/ /g, '-');
  const reportFile = path.join(DATA_DIR, `research-${slug}-import-report.json`);
  const imported = fs.existsSync(reportFile) ? fs.readFileSync(reportFile, 'utf8').trim() : 'Research not yet imported';
  const countReasons = (rows: Array<{ reason: string }>) =>
    [...new Set(rows.map((r) => r.reason))]
      .map((reason) => `${reason}: ${rows.filter((r) => r.reason === reason).length}`)
      .join('; ');
  let discoveryDecisions: string;
  if (governorate === 'Giza') {
    const ledger = readData<Array<{ disposition: string; reasonCode: string }>>('research-giza-ledger.json');
    discoveryDecisions = ['excluded', 'merged', 'held']
      .map(
        (d) =>
          `${d}: ${countReasons(ledger.filter((r) => r.disposition === d).map((r) => ({ reason: r.reasonCode })))}`,
      )
      .join('. ');
  } else if (governorate === 'Cairo') {
    const ledger = readData<{ records: Array<{ decision: string; reason: string }> }>('research-cairo-ledger.json');
    discoveryDecisions = `Additional-entry holds/exclusions: ${countReasons(ledger.records.filter((r) => r.decision === 'held-or-excluded'))}. Attached to existing identities: ${ledger.records.filter((r) => r.decision === 'attached-to-existing-identity').length}.`;
  } else if (governorate === 'Port Said') {
    const ledger = readData<{ excluded: Array<{ reason: string }>; held: Array<{ reason: string }> }>(
      'research-port-said-ledger.json',
    );
    discoveryDecisions = `20 discovery candidates: excluded ${countReasons(ledger.excluded)}; held ${countReasons(ledger.held)}; 2 historical/page identities consolidated; 12 retained.`;
  } else {
    const ledger = readData<{ excludedGroups: Array<{ reason: string }>; heldGroups: Array<{ reason: string }> }>(
      'research-alexandria-ledger.json',
    );
    const holds = readData<Array<{ reason: string }>>('research-alexandria-review-holds.json');
    discoveryDecisions = `Discovery group exclusions (groups can contain multiple businesses): ${countReasons(ledger.excludedGroups)}. Earlier discovery holds: ${countReasons(ledger.heldGroups)}. Additional final review holds: ${countReasons(holds)}. These historical discovery groups overlap; final import/release counts above govern.`;
  }
  const mergeReport = readData<{ merges: Array<{ sourceKey: string; mergedSourceKeys: string[] }> }>(
    'baseline-report.json',
  );
  const mergeCount = mergeReport.merges
    .filter((m) => rows.some((c) => c.sourceKey === m.sourceKey))
    .reduce((n, m) => n + m.mergedSourceKeys.length, 0);
  const sites = new Map<string, Set<string>>();
  for (const c of rows)
    for (const s of c.sources) {
      if (new URL(s.url).hostname === 'nominatim.openstreetmap.org') continue;
      const host = new URL(s.url).hostname;
      const values = sites.get(host) ?? new Set<string>();
      values.add(s.url);
      sites.set(host, values);
    }
  const clinicSources = (c: Clinic) =>
    c.sources.filter((s) => new URL(s.url).hostname !== 'nominatim.openstreetmap.org');
  const sourceDomains = (c: Clinic) => new Set(clinicSources(c).map((s) => new URL(s.url).hostname));
  const multiSource = rows.filter((c) => sourceDomains(c).size > 1).length;
  const dated = rows.filter((c) => !!c.lastSeenActive).length;
  const referenced = new Set<string>();
  const collect = (value: unknown) => {
    if (typeof value === 'string' && /^https?:\/\//.test(value)) referenced.add(decodeURI(value));
    else if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === 'object') Object.values(value).forEach(collect);
  };
  for (const file of fs.readdirSync(DATA_DIR).filter((f) => f.startsWith(`research-${slug}`) && f.endsWith('.json')))
    collect(JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), 'utf8')));
  const consultations = new Map<string, Set<string>>();
  const blocked = new Map<string, Set<string>>();
  for (const file of fs.readdirSync(path.join(DATA_DIR, 'web-evidence'))) {
    const snapshot = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'web-evidence', file), 'utf8')) as {
      url?: string;
      text?: string;
      httpStatus?: number;
      status?: number;
      error?: string;
    };
    if (!snapshot.url || !(file.startsWith(slug + '-') || referenced.has(decodeURI(snapshot.url)))) continue;
    const group =
      (snapshot.httpStatus ?? snapshot.status) === 200 &&
      snapshot.text &&
      !/تأكيد الدخول|checking your browser|just a moment/i.test(snapshot.text.slice(0, 250))
        ? consultations
        : blocked;
    const host = new URL(snapshot.url).hostname;
    const pages = group.get(host) ?? new Set<string>();
    pages.add(snapshot.url);
    group.set(host, pages);
  }
  lines.push(
    `## ${governorate}`,
    '',
    `**${rows.filter((c) => c.active).length} active / ${rows.filter((c) => !c.active).length} inactive; ${rows.filter((c) => c.is24Hours).length} explicit 24-hour clinics.**`,
    '',
    `Cross-source duplicate records merged: ${mergeCount}.`,
    '',
    `Clinic sources from multiple domains: ${multiSource}/${rows.length}; single-domain: ${rows.length - multiSource}; dated operating/listing evidence: ${dated}/${rows.length}. Geocoder responses do not count as clinic corroboration. Mirrors may reproduce clinic posts and are not independent witnesses of operation.`,
    '',
    `Precision (all retained): ${['exact', 'street', 'area'].map((p) => p + ': ' + rows.filter((c) => c.locationPrecision === p).length).join('; ')}.`,
    '',
    `Inactive reasons: ${JSON.stringify(Object.fromEntries([...new Set(rows.filter((c) => !c.active).map((c) => c.inactiveReason))].map((r) => [r, rows.filter((c) => c.inactiveReason === r).length])))}`,
    '',
    `Distinct retained source pages by site: ${[...sites].map(([h, s]) => h + ': ' + s.size).join('; ') || 'none'}.`,
    '',
    `Cached consultations by site (distinct readable pages, including discovery and held leads): ${[...consultations].map(([h, s]) => h + ': ' + s.size).join('; ') || 'none'}.`,
    '',
    `Blocked/error response pages by site: ${[...blocked].map(([h, s]) => h + ': ' + s.size).join('; ') || 'none'}. Individually rendered web facts are separately labeled in snapshots when direct fetching was blocked.`,
    '',
    'Import accounting (web candidates before cross-source/OSM merging):',
    '',
    '```json',
    imported,
    '```',
    '',
    discoveryDecisions,
    '',
    `Discovery exclusions, historical identity merges and unresolved holds: see [${governorate} research](vet-clinics-research${governorate === 'Alexandria' ? '' : '-' + slug}.md) and the corresponding research-${slug}-ledger.json. Discovery categories and ledger groups can overlap and are not added to the authored candidate denominator above.`,
    '',
    '| Random active clinic | Phone | Precision | Sources |',
    '| --- | --- | --- | --- |',
  );
  if (rows.filter((c) => c.active).length < 10)
    lines.push(`| All ${rows.filter((c) => c.active).length} available active clinics are sampled below. | | | |`);
  const rank = (c: Clinic) =>
    createHash('sha256')
      .update('20261112:' + c.sourceKey)
      .digest('hex');
  for (const c of rows
    .filter((c) => c.active)
    .sort((a, b) => rank(a).localeCompare(rank(b)))
    .slice(0, 10))
    lines.push(
      `| ${c.nameEnglish} / ${c.nameArabic} | ${c.phone} | ${c.locationPrecision} | ${[...new Set(c.sources.map((s) => s.url))].map((u, i) => `[${i + 1}](${u})`).join(', ')} |`,
    );
  lines.push('');
}
const validationFile = path.resolve(__dirname, '../../../docs/vet-clinics-stage2-validation.md');
if (fs.existsSync(validationFile)) lines.push(fs.readFileSync(validationFile, 'utf8'));
fs.writeFileSync(path.resolve(__dirname, '../../../docs/vet-clinics-stage2-report.md'), lines.join('\n'));
