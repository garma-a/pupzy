import { validateSnapshot, type CitySnapshot } from './catalog';

export const DEFAULT_RESOURCE_URL =
  'https://data.humdata.org/dataset/b90d81ba-7c7a-4283-9899-827480d80a79/resource/81126a96-2991-48e1-93cb-24c164a4de88/download/ocha-adm2-egypt-snapshot.json';

/**
 * Fetches an actual candidate upstream snapshot from a remote resource URL.
 * Developer-only tool — application runtime and migrations remain completely offline.
 * Rejects dataset landing pages (HTML) and validates schema/provenance before returning.
 */
export async function fetchUpstreamSnapshot(url = DEFAULT_RESOURCE_URL): Promise<CitySnapshot> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Pupzy-Refresher/1.0',
      Accept: 'application/json',
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch upstream snapshot: ${res.status} ${res.statusText}`);
  }

  const contentType = res.headers.get('content-type') || '';
  const text = await res.text();

  if (contentType.includes('text/html') || text.trim().startsWith('<!DOCTYPE') || text.trim().startsWith('<html')) {
    throw new Error(
      `Failed to fetch upstream snapshot: received HTML landing page instead of a JSON snapshot resource at ${url}`,
    );
  }

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse upstream snapshot JSON from ${url}: ${msg}`);
  }

  const validation = validateSnapshot(data);
  if (!validation.isValid) {
    throw new Error(
      `Fetched upstream snapshot failed schema/provenance validation:\n- ${validation.errors.join('\n- ')}`,
    );
  }

  return data as CitySnapshot;
}
