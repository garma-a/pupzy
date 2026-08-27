/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return */
import * as ExcelJS from 'exceljs';
import * as fs from 'fs';
import * as path from 'path';
import {
  fetchUpstreamSnapshot,
  parseXlsxSnapshot,
  parseJsonSnapshot,
  DEFAULT_RESOURCE_URL,
  DEFAULT_DATASET_URL,
  DEFAULT_METADATA_URL,
} from './fetch';
import { type RawCitySnapshotRecord } from './catalog';

describe('Upstream City Snapshot Fetch and Ingestion Module', () => {
  const trackedCatalogPath = path.resolve(__dirname, 'data/egypt-cities-catalog.json');
  const trackedSnapshotPath = path.resolve(__dirname, 'data/ocha-adm2-egypt-snapshot.json');

  let catalogMtimeBefore: number;
  let snapshotMtimeBefore: number;

  beforeEach(() => {
    catalogMtimeBefore = fs.statSync(trackedCatalogPath).mtimeMs;
    snapshotMtimeBefore = fs.statSync(trackedSnapshotPath).mtimeMs;
  });

  afterEach(() => {
    // Assert fail-closed: tracked catalog and snapshot files are NEVER modified by fetch operations
    expect(fs.statSync(trackedCatalogPath).mtimeMs).toBe(catalogMtimeBefore);
    expect(fs.statSync(trackedSnapshotPath).mtimeMs).toBe(snapshotMtimeBefore);
  });

  async function createMockXlsxBuffer(
    records: Partial<RawCitySnapshotRecord>[],
    sheetName = 'egy_admin2',
    columns?: string[],
  ): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(sheetName);

    const cols = columns || [
      'adm2_name',
      'adm2_name1',
      'adm2_name2',
      'adm2_name3',
      'adm2_pcode',
      'adm1_name',
      'adm1_name1',
      'adm1_name2',
      'adm1_name3',
      'adm1_pcode',
      'adm0_name',
      'adm0_name1',
      'adm0_name2',
      'adm0_name3',
      'adm0_pcode',
      'valid_on',
      'valid_to',
      'area_sqkm',
      'version',
      'lang',
      'lang1',
      'lang2',
      'lang3',
      'adm2_ref_name',
      'center_lat',
      'center_lon',
    ];

    ws.addRow(cols);

    for (const r of records) {
      const rowValues = cols.map((col) => (r as any)[col] ?? null);
      ws.addRow(rowValues);
    }

    const uint8Array = await wb.xlsx.writeBuffer();
    return Buffer.from(uint8Array);
  }

  const sampleValidRecords: RawCitySnapshotRecord[] = [
    {
      adm2_name: '10 Ramadan 1',
      adm2_name1: 'قسم اول مدينة العاشر من رمضان',
      adm2_name2: null,
      adm2_name3: null,
      adm2_pcode: 'EG1309',
      adm1_name: 'Sharkia',
      adm1_name1: 'الشرقية',
      adm1_name2: null,
      adm1_name3: null,
      adm1_pcode: 'EG13',
      adm0_name: 'Egypt',
      adm0_name1: 'مصر',
      adm0_name2: null,
      adm0_name3: null,
      adm0_pcode: 'EG',
      valid_on: '2017-04-21',
      valid_to: null,
      area_sqkm: 16.519,
      version: 'v01',
      lang: 'en',
      lang1: 'ar',
      lang2: null,
      lang3: null,
      adm2_ref_name: '10 Ramadan 1',
      center_lat: 30.222369,
      center_lon: 31.732154,
    },
    {
      adm2_name: 'Zemam Out',
      adm2_name1: 'خارج الزمام',
      adm2_name2: null,
      adm2_name3: null,
      adm2_pcode: 'EG1300',
      adm1_name: 'Sharkia',
      adm1_name1: 'الشرقية',
      adm1_name2: null,
      adm1_name3: null,
      adm1_pcode: 'EG13',
      adm0_name: 'Egypt',
      adm0_name1: 'مصر',
      adm0_name2: null,
      adm0_name3: null,
      adm0_pcode: 'EG',
      valid_on: '2017-04-21',
      valid_to: null,
      area_sqkm: 100.0,
      version: 'v01',
      lang: 'en',
      lang1: 'ar',
      lang2: null,
      lang3: null,
      adm2_ref_name: 'Zemam Out',
      center_lat: 30.1,
      center_lon: 31.5,
    },
  ];

  function authoritativeDatasetMetadata(
    resourceUrl: string,
    overrides: {
      license?: string;
      notes?: string;
      lastModified?: string;
    } = {},
  ) {
    return {
      success: true,
      result: {
        name: 'cod-ab-egy',
        title: 'Egypt - Subnational Administrative Boundaries',
        notes:
          overrides.notes ??
          'Egypt administrative level 0-2 boundaries (COD-AB) dataset version 01.\n' +
            '- Admin 1: 1 Governorate\n' +
            '- Admin 2: 2 Region\n' +
            '- 19 December 2024: dataset reviewed for accuracy and completeness\n' +
            '- 21 April 2017: valid for use by the humanitarian community\n' +
            'Contributed by OCHA ROMENA. Quality assured and published by OCHA FISS and HDX.',
        license_title:
          overrides.license ?? 'Creative Commons Attribution for Intergovernmental Organisations (CC BY-IGO)',
        license_url: 'https://creativecommons.org/licenses/by/3.0/igo/',
        organization: { title: 'OCHA Field Information Services Section (FISS)' },
        resources: [
          {
            id: '81126a96-2991-48e1-93cb-24c164a4de88',
            url: resourceUrl,
            name: 'egy_admin_boundaries.xlsx',
            format: 'XLSX',
            last_modified: overrides.lastModified ?? '2026-01-26T15:32:45.946546',
          },
        ],
      },
    };
  }

  function jsonResponse(payload: unknown, contentType = 'application/json') {
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: (header: string) => (header.toLowerCase() === 'content-type' ? contentType : null) },
      text: () => Promise.resolve(JSON.stringify(payload)),
      arrayBuffer: () => Promise.resolve(Buffer.from(JSON.stringify(payload))),
    } as any;
  }

  function parsedArtifactMetadata(records: RawCitySnapshotRecord[], resourceUrl = DEFAULT_RESOURCE_URL) {
    const outsideZemamCount = records.filter(
      (record) => record.adm2_name === 'Zemam Out' || record.adm2_pcode.endsWith('00'),
    ).length;
    return {
      source: 'Egypt - Subnational Administrative Boundaries',
      sourceUrl: DEFAULT_DATASET_URL,
      resourceUrl,
      upstreamVersion: '01',
      upstreamDates: {
        validOn: '2017-04-21',
        reviewedDate: '2024-12-19',
        lastModified: '2026-01-26T15:32:45.946546',
      },
      retrievalDate: '2026-08-27',
      license: 'Creative Commons Attribution for Intergovernmental Organisations (CC BY-IGO)',
      licenseUrl: 'https://creativecommons.org/licenses/by/3.0/igo/',
      attribution: 'CAPMAS; OCHA ROMENA; OCHA FISS and HDX',
      totalRows: records.length,
      outsideZemamCount,
      selectableCount: records.length - outsideZemamCount,
      governorateCount: new Set(records.map((record) => record.adm1_name)).size,
    };
  }

  describe('Default Configured Resource URLs', () => {
    it('configures a direct, downloadable XLSX resource URL rather than a landing page or placeholder', () => {
      expect(DEFAULT_RESOURCE_URL).toBe(
        'https://data.humdata.org/dataset/b90d81ba-7c7a-4283-9899-827480d80a79/resource/81126a96-2991-48e1-93cb-24c164a4de88/download/egy_admin_boundaries.xlsx',
      );
      expect(DEFAULT_RESOURCE_URL).toMatch(/\.xlsx$/);
      expect(DEFAULT_RESOURCE_URL).not.toContain('placeholder');
      expect(DEFAULT_RESOURCE_URL).not.toContain('ocha-adm2-egypt-snapshot.json');
    });

    it('configures the authoritative OCHA COD-AB Egypt dataset landing page URL', () => {
      expect(DEFAULT_DATASET_URL).toBe('https://data.humdata.org/dataset/cod-ab-egy');
    });

    it('uses HDX’s package metadata endpoint as the authoritative provenance source', () => {
      expect(DEFAULT_METADATA_URL).toBe('https://data.humdata.org/api/3/action/package_show?id=cod-ab-egy');
    });
  });

  describe('Authoritative provenance verification (fetchUpstreamSnapshot)', () => {
    it('derives candidate provenance from HDX metadata and cross-validates metadata counts and XLSX fields', async () => {
      const resourceUrl = 'https://example.com/egy_admin_boundaries.xlsx';
      const xlsxBuffer = await createMockXlsxBuffer(sampleValidRecords);
      const fetchFn = jest.fn((url: string) => {
        if (url === DEFAULT_METADATA_URL) return jsonResponse(authoritativeDatasetMetadata(resourceUrl));
        if (url === resourceUrl) {
          return {
            ok: true,
            status: 200,
            statusText: 'OK',
            headers: { get: () => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
            arrayBuffer: () =>
              Promise.resolve(
                xlsxBuffer.buffer.slice(xlsxBuffer.byteOffset, xlsxBuffer.byteOffset + xlsxBuffer.byteLength),
              ),
          } as any;
        }
        throw new Error(`Unexpected URL: ${url}`);
      });

      const snapshot = await fetchUpstreamSnapshot({ url: resourceUrl, fetchFn: fetchFn as typeof fetch });

      expect(snapshot.metadata).toMatchObject({
        source: 'Egypt - Subnational Administrative Boundaries',
        sourceUrl: DEFAULT_DATASET_URL,
        resourceUrl,
        upstreamVersion: '01',
        upstreamDates: {
          validOn: '2017-04-21',
          reviewedDate: '2024-12-19',
          lastModified: '2026-01-26T15:32:45.946546',
        },
        license: 'Creative Commons Attribution for Intergovernmental Organisations (CC BY-IGO)',
        licenseUrl: 'https://creativecommons.org/licenses/by/3.0/igo/',
        totalRows: 2,
        governorateCount: 1,
      });
      expect(snapshot.metadata.attribution).toContain('OCHA ROMENA');
      expect(fetchFn).toHaveBeenNthCalledWith(2, DEFAULT_METADATA_URL, expect.anything());
    });

    it('fails closed when authoritative metadata conflicts with the downloaded artifact', async () => {
      const resourceUrl = 'https://example.com/egy_admin_boundaries.xlsx';
      const xlsxBuffer = await createMockXlsxBuffer(sampleValidRecords);
      const fetchFn = jest.fn((url: string) => {
        if (url === DEFAULT_METADATA_URL) {
          return jsonResponse(
            authoritativeDatasetMetadata(resourceUrl, {
              notes:
                'dataset version 02.\n- Admin 1: 1 Governorate\n- Admin 2: 2 Region\n- 19 December 2024: dataset reviewed for accuracy and completeness\n- 21 April 2017: valid for use by the humanitarian community\nContributed by OCHA ROMENA.',
            }),
          );
        }
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: { get: () => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
          arrayBuffer: () => Promise.resolve(xlsxBuffer),
        } as any;
      });

      await expect(fetchUpstreamSnapshot({ url: resourceUrl, fetchFn: fetchFn as typeof fetch })).rejects.toThrow(
        /upstream version/i,
      );
    });

    it('fails closed when HDX does not provide required provenance metadata', async () => {
      const resourceUrl = 'https://example.com/egy_admin_boundaries.xlsx';
      const xlsxBuffer = await createMockXlsxBuffer(sampleValidRecords);
      const fetchFn = jest.fn((url: string) => {
        if (url === resourceUrl) {
          return {
            ok: true,
            status: 200,
            statusText: 'OK',
            headers: { get: () => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
            arrayBuffer: () => Promise.resolve(xlsxBuffer),
          } as any;
        }
        return jsonResponse(authoritativeDatasetMetadata(resourceUrl, { license: '' }));
      });

      await expect(fetchUpstreamSnapshot({ url: resourceUrl, fetchFn: fetchFn as typeof fetch })).rejects.toThrow(
        /license/i,
      );
    });

    it('fails closed when the authoritative resource metadata is stale', async () => {
      const resourceUrl = 'https://example.com/egy_admin_boundaries.xlsx';
      const xlsxBuffer = await createMockXlsxBuffer(sampleValidRecords);
      const fetchFn = jest.fn((url: string) => {
        if (url === resourceUrl) {
          return {
            ok: true,
            status: 200,
            statusText: 'OK',
            headers: { get: () => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
            arrayBuffer: () => Promise.resolve(xlsxBuffer),
          } as any;
        }
        return jsonResponse(authoritativeDatasetMetadata(resourceUrl, { lastModified: '2010-01-01T00:00:00Z' }));
      });

      await expect(fetchUpstreamSnapshot({ url: resourceUrl, fetchFn: fetchFn as typeof fetch })).rejects.toThrow(
        /metadata is stale/i,
      );
    });

    it('fails closed when HDX cannot verify the requested resource URL', async () => {
      const resourceUrl = 'https://example.com/egy_admin_boundaries.xlsx';
      const xlsxBuffer = await createMockXlsxBuffer(sampleValidRecords);
      const fetchFn = jest.fn((url: string) => {
        if (url === resourceUrl) {
          return {
            ok: true,
            status: 200,
            statusText: 'OK',
            headers: { get: () => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
            arrayBuffer: () => Promise.resolve(xlsxBuffer),
          } as any;
        }
        return jsonResponse(authoritativeDatasetMetadata('https://example.com/other.xlsx'));
      });

      await expect(fetchUpstreamSnapshot({ url: resourceUrl, fetchFn: fetchFn as typeof fetch })).rejects.toThrow(
        /does not verify requested resource URL/i,
      );
    });
  });

  describe('XLSX Upstream Artifact Parsing (parseXlsxSnapshot)', () => {
    it('parses a valid XLSX buffer with egypt_admin2 worksheet into a validated CitySnapshot', async () => {
      const buffer = await createMockXlsxBuffer(sampleValidRecords);
      const snapshot = await parseXlsxSnapshot(buffer, {
        url: 'https://data.humdata.org/dataset/egy_admin_boundaries.xlsx',
        metadata: parsedArtifactMetadata(
          sampleValidRecords,
          'https://data.humdata.org/dataset/egy_admin_boundaries.xlsx',
        ),
      });

      expect(snapshot.records).toHaveLength(2);
      expect(snapshot.records[0].adm2_pcode).toBe('EG1309');
      expect(snapshot.records[0].adm2_name).toBe('10 Ramadan 1');
      expect(snapshot.records[0].adm2_name1).toBe('قسم اول مدينة العاشر من رمضان');
      expect(snapshot.records[0].center_lat).toBeCloseTo(30.222369);
      expect(snapshot.records[0].center_lon).toBeCloseTo(31.732154);

      // Provenance metadata stats
      expect(snapshot.metadata.totalRows).toBe(2);
      expect(snapshot.metadata.outsideZemamCount).toBe(1);
      expect(snapshot.metadata.selectableCount).toBe(1);
      expect(snapshot.metadata.governorateCount).toBe(1);
      expect(snapshot.metadata.sourceUrl).toBe(DEFAULT_DATASET_URL);
      expect(snapshot.metadata.resourceUrl).toBe('https://data.humdata.org/dataset/egy_admin_boundaries.xlsx');
      expect(snapshot.metadata.license).toContain('Creative Commons Attribution');
      expect(snapshot.metadata.attribution).toContain('CAPMAS');
    });

    it('handles Date objects and numeric conversions in XLSX cells correctly', async () => {
      const recordsWithDate = [
        {
          ...sampleValidRecords[0],
          valid_on: new Date('2017-04-21T00:00:00.000Z') as any,
          center_lat: '30.222369' as any,
          center_lon: '31.732154' as any,
        },
      ];

      const buffer = await createMockXlsxBuffer(recordsWithDate);
      const snapshot = await parseXlsxSnapshot(buffer, { metadata: parsedArtifactMetadata(recordsWithDate) });

      expect(snapshot.records[0].valid_on).toBe('2017-04-21');
      expect(typeof snapshot.records[0].center_lat).toBe('number');
      expect(typeof snapshot.records[0].center_lon).toBe('number');
    });

    it('throws when the XLSX workbook has no admin2 worksheet', async () => {
      const buffer = await createMockXlsxBuffer(sampleValidRecords, 'unrelated_sheet');
      await expect(parseXlsxSnapshot(buffer)).rejects.toThrow(/missing required admin2 worksheet/i);
    });

    it('throws when the admin2 worksheet is missing required columns', async () => {
      const buffer = await createMockXlsxBuffer(sampleValidRecords, 'egy_admin2', ['adm2_name', 'some_other_col']);
      await expect(parseXlsxSnapshot(buffer)).rejects.toThrow(/missing required columns/i);
    });

    it('throws when the buffer is malformed or not a valid XLSX archive', async () => {
      const badBuffer = Buffer.from('This is not an XLSX file, it is plain text');
      await expect(parseXlsxSnapshot(badBuffer)).rejects.toThrow(/failed to parse upstream xlsx/i);
    });
  });

  describe('JSON Upstream Artifact Parsing (parseJsonSnapshot)', () => {
    it('parses and validates a valid JSON snapshot object', () => {
      const validJson = JSON.stringify({
        metadata: {
          source: 'OCHA COD-AB',
          sourceUrl: 'https://data.humdata.org/dataset/cod-ab-egy',
          resourceUrl: 'https://example.com/snapshot.json',
          upstreamVersion: '01',
          upstreamDates: {
            validOn: '2017-04-21',
            reviewedDate: '2024-12-19',
            lastModified: '2026-01-26',
          },
          retrievalDate: '2026-08-27',
          license: 'CC-BY-IGO',
          licenseUrl: 'http://creativecommons.org/licenses/by/3.0/igo/legalcode',
          attribution: 'CAPMAS / UN OCHA',
          totalRows: 1,
          outsideZemamCount: 0,
          selectableCount: 1,
          governorateCount: 1,
        },
        records: [sampleValidRecords[0]],
      });

      const snapshot = parseJsonSnapshot(validJson);
      expect(snapshot.records).toHaveLength(1);
      expect(snapshot.metadata.totalRows).toBe(1);
    });

    it('wraps a raw records JSON array with computed provenance metadata', () => {
      const jsonArray = JSON.stringify(sampleValidRecords);
      const snapshot = parseJsonSnapshot(jsonArray, {
        url: 'https://example.com/records.json',
        metadata: parsedArtifactMetadata(sampleValidRecords, 'https://example.com/records.json'),
      });

      expect(snapshot.records).toHaveLength(2);
      expect(snapshot.metadata.totalRows).toBe(2);
      expect(snapshot.metadata.outsideZemamCount).toBe(1);
      expect(snapshot.metadata.selectableCount).toBe(1);
    });

    it('throws on invalid JSON syntax', () => {
      expect(() => parseJsonSnapshot('{"broken": json')).toThrow(/failed to parse upstream snapshot json/i);
    });
  });

  describe('Transport, Redirect, and HTTP Error Handling (fetchUpstreamSnapshot)', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('fetches and parses XLSX binary stream over HTTP with redirect support', async () => {
      const xlsxBuffer = await createMockXlsxBuffer(sampleValidRecords);

      global.fetch = jest.fn().mockImplementation((url: string) => {
        if (url === DEFAULT_METADATA_URL) return jsonResponse(authoritativeDatasetMetadata(DEFAULT_RESOURCE_URL));
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: {
            get: (header: string) => {
              if (header.toLowerCase() === 'content-type') {
                return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
              }
              return null;
            },
          },
          arrayBuffer: () =>
            Promise.resolve(
              xlsxBuffer.buffer.slice(xlsxBuffer.byteOffset, xlsxBuffer.byteOffset + xlsxBuffer.byteLength),
            ),
          text: () => Promise.resolve(''),
        } as any);
      });

      const snapshot = await fetchUpstreamSnapshot(DEFAULT_RESOURCE_URL);
      expect(snapshot.records).toHaveLength(2);
      expect(snapshot.metadata.totalRows).toBe(2);
      expect(global.fetch).toHaveBeenCalledWith(
        DEFAULT_RESOURCE_URL,
        expect.objectContaining({
          redirect: 'follow',
          headers: expect.objectContaining({
            'User-Agent': 'Pupzy-Refresher/1.0',
          }),
        }),
      );
    });

    it('throws descriptive error on HTTP 404 Not Found', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        headers: { get: () => 'text/plain' },
        text: () => Promise.resolve('Resource not found'),
      } as any);

      await expect(fetchUpstreamSnapshot('https://example.com/missing.xlsx')).rejects.toThrow(
        /failed to fetch upstream snapshot: 404 Not Found from https:\/\/example\.com\/missing\.xlsx/i,
      );
    });

    it('throws descriptive error on HTTP 500 Server Error', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        headers: { get: () => 'text/plain' },
        text: () => Promise.resolve('Server error'),
      } as any);

      await expect(fetchUpstreamSnapshot('https://example.com/error.xlsx')).rejects.toThrow(
        /failed to fetch upstream snapshot: 500 Internal Server Error/i,
      );
    });

    it('rejects HTTP redirects returning HTML landing pages instead of binary resource', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: {
          get: (header: string) => (header.toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : null),
        },
        arrayBuffer: () => Promise.resolve(Buffer.from('<!DOCTYPE html><html><body>Landing Page</body></html>')),
        text: () => Promise.resolve('<!DOCTYPE html><html><body>Landing Page</body></html>'),
      } as any);

      await expect(fetchUpstreamSnapshot(DEFAULT_DATASET_URL)).rejects.toThrow(
        /received HTML landing page instead of a snapshot resource/i,
      );
    });

    it('rejects AWS S3 XML error documents returned with 200/403 responses', async () => {
      const xmlError =
        '<?xml version="1.0" encoding="UTF-8"?><Error><Code>AccessDenied</Code><Message>Access Denied</Message></Error>';
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: {
          get: (header: string) => (header.toLowerCase() === 'content-type' ? 'application/xml' : null),
        },
        arrayBuffer: () => Promise.resolve(Buffer.from(xmlError)),
        text: () => Promise.resolve(xmlError),
      } as any);

      await expect(fetchUpstreamSnapshot('https://example.com/expired-s3-link')).rejects.toThrow(
        /received XML error document instead of a valid snapshot resource/i,
      );
    });

    it('validates provenance and record fields before returning candidate snapshot', async () => {
      const invalidRecords = [
        {
          ...sampleValidRecords[0],
          center_lat: 190.0, // Invalid latitude
        },
      ];

      const xlsxBuffer = await createMockXlsxBuffer(invalidRecords);

      global.fetch = jest.fn().mockImplementation((url: string) => {
        if (url === DEFAULT_METADATA_URL) {
          return jsonResponse(
            authoritativeDatasetMetadata('https://example.com/bad-coords.xlsx', {
              notes:
                'Egypt administrative level 0-2 boundaries (COD-AB) dataset version 01.\n' +
                '- Admin 1: 1 Governorate\n' +
                '- Admin 2: 1 Region\n' +
                '- 19 December 2024: dataset reviewed for accuracy and completeness\n' +
                '- 21 April 2017: valid for use by the humanitarian community\n' +
                'Contributed by OCHA ROMENA. Quality assured and published by OCHA FISS and HDX.',
            }),
          );
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: {
            get: (h: string) =>
              h.toLowerCase() === 'content-type'
                ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                : null,
          },
          arrayBuffer: () =>
            Promise.resolve(
              xlsxBuffer.buffer.slice(xlsxBuffer.byteOffset, xlsxBuffer.byteOffset + xlsxBuffer.byteLength),
            ),
          text: () => Promise.resolve(''),
        } as any);
      });

      await expect(fetchUpstreamSnapshot('https://example.com/bad-coords.xlsx')).rejects.toThrow(
        /fetched upstream snapshot failed schema\/provenance validation/i,
      );
    });
  });
});
