import * as ExcelJS from 'exceljs';
import { validateSnapshot, type CitySnapshot, type CitySnapshotMetadata, type RawCitySnapshotRecord } from './catalog';

export const DEFAULT_RESOURCE_URL =
  'https://data.humdata.org/dataset/b90d81ba-7c7a-4283-9899-827480d80a79/resource/81126a96-2991-48e1-93cb-24c164a4de88/download/egy_admin_boundaries.xlsx';

export const DEFAULT_DATASET_URL = 'https://data.humdata.org/dataset/cod-ab-egy';
export const DEFAULT_METADATA_URL = 'https://data.humdata.org/api/3/action/package_show?id=cod-ab-egy';

export interface ParseSnapshotOptions {
  url?: string;
  metadata?: Partial<CitySnapshotMetadata>;
}

export interface FetchUpstreamSnapshotOptions extends ParseSnapshotOptions {
  fetchFn?: typeof fetch;
  metadataUrl?: string;
}

interface HdxResourceMetadata {
  id?: unknown;
  name?: unknown;
  url?: unknown;
  format?: unknown;
  last_modified?: unknown;
}

interface HdxDatasetMetadata {
  success?: unknown;
  result?: {
    name?: unknown;
    title?: unknown;
    notes?: unknown;
    license_title?: unknown;
    license_url?: unknown;
    organization?: { title?: unknown };
    resources?: HdxResourceMetadata[];
  };
}

function toCleanString(val: unknown): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'string') return val.trim();
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  return '';
}

function toOptionalString(val: unknown): string | null {
  const str = toCleanString(val);
  return str.length > 0 ? str : null;
}

function assertValidSnapshot(snapshot: CitySnapshot): void {
  const validation = validateSnapshot(snapshot);
  if (!validation.isValid) {
    throw new Error(
      `Fetched upstream snapshot failed schema/provenance validation:\n- ${validation.errors.join('\n- ')}`,
    );
  }
}

/**
 * Builds complete provenance metadata for an upstream snapshot with verified counts.
 */
export function buildDefaultSnapshotMetadata(
  records: RawCitySnapshotRecord[],
  options?: ParseSnapshotOptions,
): CitySnapshotMetadata {
  const totalRows = records.length;
  const outsideZemamCount = records.filter(
    (r) => r.adm2_name === 'Zemam Out' || (typeof r.adm2_pcode === 'string' && r.adm2_pcode.endsWith('00')),
  ).length;
  const selectableCount = totalRows - outsideZemamCount;
  const governorateCount = new Set(records.map((r) => r.adm1_name).filter(Boolean)).size;
  const metadata = options?.metadata;
  if (!metadata) {
    throw new Error('Authoritative upstream metadata is required to build a candidate snapshot');
  }

  assertProvidedCount('totalRows', metadata.totalRows, totalRows);
  assertProvidedCount('outsideZemamCount', metadata.outsideZemamCount, outsideZemamCount);
  assertProvidedCount('selectableCount', metadata.selectableCount, selectableCount);
  assertProvidedCount('governorateCount', metadata.governorateCount, governorateCount);

  return {
    ...metadata,
    totalRows,
    outsideZemamCount,
    selectableCount,
    governorateCount,
  } as CitySnapshotMetadata;
}

function assertProvidedCount(name: string, evidenceValue: number | undefined, artifactValue: number): void {
  if (evidenceValue !== undefined && evidenceValue !== artifactValue) {
    throw new Error(
      `Authoritative provenance ${name} (${evidenceValue}) conflicts with downloaded artifact (${artifactValue})`,
    );
  }
}

function parseHdxDate(notes: string, description: string): string {
  const match = notes.match(
    new RegExp(`(?:^|\\n)\\s*(?:-\\s*)?(\\d{1,2}\\s+[A-Za-z]+\\s+\\d{4}):\\s*${description}`, 'i'),
  );
  if (!match) {
    throw new Error(`Authoritative upstream metadata is missing the ${description} date`);
  }
  const parsed = new Date(`${match[1]} UTC`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Authoritative upstream metadata has an invalid ${description} date '${match[1]}'`);
  }
  return parsed.toISOString().slice(0, 10);
}

function markdownToText(value: string): string {
  return value
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizedUrl(value: string): string {
  const parsed = new URL(value);
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/$/, '');
}

function deriveAuthoritativeMetadata(payload: unknown, requestedResourceUrl: string): Partial<CitySnapshotMetadata> {
  const document = payload as HdxDatasetMetadata;
  const dataset = document?.result;
  if (document?.success !== true || !dataset) {
    throw new Error('Authoritative upstream metadata response is not a successful HDX package response');
  }

  const datasetName = toCleanString(dataset.name);
  const source = toCleanString(dataset.title);
  const notes = toCleanString(dataset.notes);
  const license = toCleanString(dataset.license_title);
  const licenseUrl = toCleanString(dataset.license_url);
  const organization = toCleanString(dataset.organization?.title);
  const resource = dataset.resources?.find((candidate) => {
    const candidateUrl = toCleanString(candidate.url);
    return candidateUrl !== '' && normalizedUrl(candidateUrl) === normalizedUrl(requestedResourceUrl);
  });

  if (datasetName !== 'cod-ab-egy') {
    throw new Error(`Authoritative upstream metadata identifies unexpected dataset '${datasetName || 'missing'}'`);
  }
  if (!source || !notes || !license || !licenseUrl || !organization) {
    throw new Error(
      'Authoritative upstream metadata is missing required source, notes, license, license URL, or organization',
    );
  }
  if (!resource) {
    throw new Error(`Authoritative upstream metadata does not verify requested resource URL '${requestedResourceUrl}'`);
  }

  const resourceUrl = toCleanString(resource.url);
  const resourceName = toCleanString(resource.name);
  const resourceFormat = toCleanString(resource.format);
  const lastModified = toCleanString(resource.last_modified);
  const expectedFormat = requestedResourceUrl.toLowerCase().endsWith('.xlsx') ? 'xlsx' : 'json';
  if (!resourceUrl || !resourceName || resourceFormat.toLowerCase() !== expectedFormat || !lastModified) {
    throw new Error(
      `Authoritative upstream resource metadata is missing required URL, name, ${expectedFormat.toUpperCase()} format, or last-modified time`,
    );
  }
  if (Number.isNaN(new Date(lastModified).getTime())) {
    throw new Error(`Authoritative upstream resource metadata has invalid last-modified time '${lastModified}'`);
  }

  const versionMatch = notes.match(/dataset\s+version\s+v?([A-Za-z0-9][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)*)/i);
  if (!versionMatch) {
    throw new Error('Authoritative upstream metadata is missing the dataset version');
  }
  const totalRowsMatch = notes.match(/admin\s*2\s*:\s*(\d+)\s+region/i);
  const governorateCountMatch = notes.match(/admin\s*1\s*:\s*(\d+)\s+governorate/i);
  if (!totalRowsMatch || !governorateCountMatch) {
    throw new Error('Authoritative upstream metadata is missing ADM1 or ADM2 record counts');
  }

  const contribution = markdownToText(notes.match(/Contributed by\s+([\s\S]*?)(?:Part of the dataset:|$)/i)?.[1] ?? '');
  if (!contribution) {
    throw new Error('Authoritative upstream metadata is missing attribution');
  }

  const validOn = parseHdxDate(notes, 'valid for use by the humanitarian community');
  const reviewedDate = parseHdxDate(notes, 'dataset reviewed for accuracy and completeness');
  if (new Date(lastModified).getTime() < new Date(validOn).getTime()) {
    throw new Error(
      `Authoritative upstream resource metadata is stale: last-modified time '${lastModified}' predates valid-on date '${validOn}'`,
    );
  }

  return {
    source,
    sourceUrl: `https://data.humdata.org/dataset/${datasetName}`,
    resourceUrl,
    upstreamVersion: versionMatch[1],
    upstreamDates: {
      validOn,
      reviewedDate,
      lastModified,
    },
    retrievalDate: new Date().toISOString().slice(0, 10),
    license,
    licenseUrl,
    attribution: `${organization}; ${contribution}`,
    totalRows: Number(totalRowsMatch[1]),
    governorateCount: Number(governorateCountMatch[1]),
  };
}

function assertArtifactFieldsMatchAuthoritativeMetadata(
  records: RawCitySnapshotRecord[],
  metadata: Pick<CitySnapshotMetadata, 'upstreamVersion' | 'upstreamDates'>,
): void {
  const versions = new Set(
    records.map((record) => toOptionalString(record.version)?.replace(/^v/i, '')).filter(Boolean),
  );
  if (versions.size !== 1 || !versions.has(metadata.upstreamVersion)) {
    throw new Error(
      `Downloaded artifact upstream version '${[...versions].join(', ') || 'missing'}' conflicts with authoritative metadata '${metadata.upstreamVersion}'`,
    );
  }

  const validOnDates = new Set(records.map((record) => toOptionalString(record.valid_on)).filter(Boolean));
  if (validOnDates.size !== 1 || !validOnDates.has(metadata.upstreamDates.validOn)) {
    throw new Error(
      `Downloaded artifact valid-on date '${[...validOnDates].join(', ') || 'missing'}' conflicts with authoritative metadata '${metadata.upstreamDates.validOn}'`,
    );
  }
}

/**
 * Parses an upstream XLSX workbook buffer (e.g. `egy_admin_boundaries.xlsx`) into a validated candidate snapshot.
 * Detects the admin2 worksheet and maps all canonical columns, date types, and representative coordinates.
 */
export async function parseXlsxSnapshot(
  buffer: Buffer | ArrayBuffer | Uint8Array,
  options?: ParseSnapshotOptions,
): Promise<CitySnapshot> {
  const workbook = new ExcelJS.Workbook();
  try {
    const rawBuffer = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer as ArrayBuffer);
    await workbook.xlsx.load(rawBuffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse upstream XLSX: ${msg}`);
  }

  // Find admin2 worksheet (e.g. 'egy_admin2' or containing 'admin2' / 'adm2' / 'admin_2')
  let worksheet = workbook.getWorksheet('egy_admin2');
  if (!worksheet) {
    worksheet = workbook.worksheets.find(
      (w) =>
        w.name.toLowerCase() === 'egy_admin2' ||
        w.name.toLowerCase() === 'egy_adm2' ||
        w.name.toLowerCase().includes('admin2') ||
        w.name.toLowerCase().includes('adm2') ||
        w.name.toLowerCase().includes('admin_2'),
    );
  }

  if (!worksheet) {
    throw new Error("Failed to parse upstream XLSX: missing required admin2 worksheet (e.g. 'egy_admin2')");
  }

  // Read header row
  const headers: string[] = [];
  worksheet.getRow(1).eachCell({ includeEmpty: true }, (cell, colNumber) => {
    const val = cell.value;
    headers[colNumber] = toCleanString(val);
  });

  const requiredColumns = [
    'adm2_pcode',
    'adm2_name',
    'adm2_name1',
    'adm1_name',
    'adm1_pcode',
    'center_lat',
    'center_lon',
  ];

  const missingColumns = requiredColumns.filter((col) => !headers.includes(col));
  if (missingColumns.length > 0) {
    throw new Error(`Failed to parse upstream XLSX: missing required columns: ${missingColumns.join(', ')}`);
  }

  const records: RawCitySnapshotRecord[] = [];

  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return; // Skip header row

    const record: Record<string, unknown> = {};

    headers.forEach((header, colIdx) => {
      if (!header) return;
      const cell = row.getCell(colIdx);
      let val: unknown = cell.value;

      if (val && typeof val === 'object') {
        if ('text' in val && typeof val.text === 'string') {
          val = (val as { text: string }).text;
        } else if ('result' in val) {
          val = val.result;
        } else if (val instanceof Date) {
          val = val.toISOString().slice(0, 10);
        }
      }

      if (val === undefined || val === null || (typeof val === 'string' && val.trim() === '')) {
        record[header] = null;
      } else {
        record[header] = val;
      }
    });

    // Format coordinates and numeric conversions
    const centerLat = record.center_lat !== null && record.center_lat !== undefined ? Number(record.center_lat) : NaN;
    const centerLon = record.center_lon !== null && record.center_lon !== undefined ? Number(record.center_lon) : NaN;
    const areaSqkm = record.area_sqkm !== null && record.area_sqkm !== undefined ? Number(record.area_sqkm) : null;

    const rowObj: RawCitySnapshotRecord = {
      adm2_name: toCleanString(record.adm2_name),
      adm2_name1: toCleanString(record.adm2_name1),
      adm2_name2: toOptionalString(record.adm2_name2),
      adm2_name3: toOptionalString(record.adm2_name3),
      adm2_pcode: toCleanString(record.adm2_pcode),
      adm1_name: toCleanString(record.adm1_name),
      adm1_name1: toCleanString(record.adm1_name1),
      adm1_name2: toOptionalString(record.adm1_name2),
      adm1_name3: toOptionalString(record.adm1_name3),
      adm1_pcode: toCleanString(record.adm1_pcode),
      adm0_name: toCleanString(record.adm0_name) || 'Egypt',
      adm0_name1: toCleanString(record.adm0_name1) || 'مصر',
      adm0_name2: toOptionalString(record.adm0_name2),
      adm0_name3: toOptionalString(record.adm0_name3),
      adm0_pcode: toCleanString(record.adm0_pcode) || 'EG',
      valid_on: toOptionalString(record.valid_on),
      valid_to: toOptionalString(record.valid_to),
      area_sqkm: Number.isFinite(areaSqkm) ? areaSqkm : null,
      version: toOptionalString(record.version),
      lang: toCleanString(record.lang) || 'en',
      lang1: toCleanString(record.lang1) || 'ar',
      lang2: toOptionalString(record.lang2),
      lang3: toOptionalString(record.lang3),
      adm2_ref_name: toOptionalString(record.adm2_ref_name),
      center_lat: centerLat,
      center_lon: centerLon,
    };

    records.push(rowObj);
  });

  const metadata = buildDefaultSnapshotMetadata(records, options);
  const snapshot: CitySnapshot = { metadata, records };
  assertValidSnapshot(snapshot);

  return snapshot;
}

/**
 * Parses a JSON candidate snapshot string or raw records array.
 */
export function parseJsonSnapshot(text: string, options?: ParseSnapshotOptions): CitySnapshot {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse upstream snapshot JSON: ${msg}`);
  }

  let snapshot: CitySnapshot;

  if (Array.isArray(data)) {
    const records = data as RawCitySnapshotRecord[];
    const metadata = buildDefaultSnapshotMetadata(records, options);
    snapshot = { metadata, records };
  } else if (data && typeof data === 'object') {
    const obj = data as Partial<CitySnapshot>;
    const records = Array.isArray(obj.records) ? obj.records : [];
    const metadata = buildDefaultSnapshotMetadata(records, { ...options, metadata: options?.metadata ?? obj.metadata });
    snapshot = { metadata, records };
  } else {
    throw new Error('Failed to parse upstream snapshot JSON: expected JSON object or array');
  }

  assertValidSnapshot(snapshot);

  return snapshot;
}

/**
 * Fetches an actual candidate upstream snapshot from a remote resource URL.
 * Developer-only tool — application runtime and migrations remain completely offline.
 *
 * Supports downloading the real upstream OCHA XLSX spreadsheet resource or direct JSON snapshots.
 * Validates transport (HTTP 200, redirect following), content types (rejecting HTML/XML errors),
 * and verifies full provenance metadata before returning the candidate snapshot.
 */
export async function fetchUpstreamSnapshot(
  urlOrOptions?: string | FetchUpstreamSnapshotOptions,
): Promise<CitySnapshot> {
  const options: FetchUpstreamSnapshotOptions =
    typeof urlOrOptions === 'string' ? { url: urlOrOptions } : (urlOrOptions ?? {});

  const url = options.url || DEFAULT_RESOURCE_URL;
  const fetchFn = options.fetchFn || global.fetch;
  const metadataUrl = options.metadataUrl || DEFAULT_METADATA_URL;

  const res = await fetchFn(url, {
    redirect: 'follow',
    headers: {
      'User-Agent': 'Pupzy-Refresher/1.0',
      Accept: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/json, */*',
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch upstream snapshot: ${res.status} ${res.statusText} from ${url}`);
  }

  const contentType = res.headers.get('content-type') || '';
  let buffer: Buffer;
  if (typeof res.arrayBuffer === 'function') {
    const arrayBuffer = await res.arrayBuffer();
    buffer = Buffer.from(arrayBuffer);
  } else if (typeof res.text === 'function') {
    const text = await res.text();
    buffer = Buffer.from(text, 'utf8');
  } else {
    buffer = Buffer.alloc(0);
  }

  // Check for HTML error or landing pages and XML error documents
  const textPrefix = buffer.toString('utf8', 0, Math.min(buffer.length, 512)).trim();
  if (
    contentType.includes('text/html') ||
    contentType.includes('application/xhtml') ||
    textPrefix.startsWith('<!DOCTYPE') ||
    textPrefix.startsWith('<html')
  ) {
    throw new Error(
      `Failed to fetch upstream snapshot: received HTML landing page instead of a snapshot resource at ${url}`,
    );
  }

  if (
    (contentType.includes('xml') && textPrefix.includes('<Error>')) ||
    (textPrefix.startsWith('<?xml') && textPrefix.includes('<Error>'))
  ) {
    throw new Error(
      `Failed to fetch upstream snapshot: received XML error document instead of a valid snapshot resource at ${url}`,
    );
  }

  const metadataResponse = await fetchFn(metadataUrl, {
    headers: {
      'User-Agent': 'Pupzy-Refresher/1.0',
      Accept: 'application/json',
    },
  });
  if (!metadataResponse.ok) {
    throw new Error(
      `Failed to fetch authoritative upstream metadata: ${metadataResponse.status} ${metadataResponse.statusText} from ${metadataUrl}`,
    );
  }
  if (typeof metadataResponse.text !== 'function') {
    throw new Error('Failed to fetch authoritative upstream metadata: response body is unavailable');
  }

  let metadataPayload: unknown;
  try {
    metadataPayload = JSON.parse(await metadataResponse.text());
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse authoritative upstream metadata: ${message}`);
  }
  const authoritativeMetadata = deriveAuthoritativeMetadata(metadataPayload, url);

  // Detect XLSX format (via magic bytes PK\x03\x04, content type, or URL extension)
  const isXlsx =
    url.toLowerCase().endsWith('.xlsx') ||
    contentType.includes('spreadsheet') ||
    contentType.includes('application/vnd.ms-excel') ||
    contentType.includes('application/octet-stream') ||
    (buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04);

  if (isXlsx) {
    const snapshot = await parseXlsxSnapshot(buffer, { url, metadata: authoritativeMetadata });
    assertArtifactFieldsMatchAuthoritativeMetadata(snapshot.records, snapshot.metadata);
    return snapshot;
  }

  const text = buffer.toString('utf8');
  const snapshot = parseJsonSnapshot(text, { url, metadata: authoritativeMetadata });
  assertArtifactFieldsMatchAuthoritativeMetadata(snapshot.records, snapshot.metadata);
  return snapshot;
}
