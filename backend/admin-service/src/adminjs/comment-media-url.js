/**
 * Where Comment images are served from, shared by the review workspace, the
 * Comment and Comment Report evidence, and the CDN purge queued when a Comment
 * is removed, so they can never disagree. Matches the backend's delivery policy.
 *
 * Environment (set on the admin service):
 * - `COMMENT_MEDIA_CDN_BASE`, else `R2_PUBLIC_URL`: the public base URL of the
 *   media bucket; defaults to `https://cdn.pupzy.net`.
 * - `COMMENT_MEDIA_DOMAIN_TRANSITION=true` or `COMMENT_MEDIA_PREVIOUS_CDN_BASE`:
 *   also purge the default and previous domains (purge only, never display).
 */
export const DEFAULT_COMMENT_MEDIA_BASE = 'https://cdn.pupzy.net';

const trimTrailingSlashes = (value) => value.replace(/\/+$/, '');

export function commentMediaBase(env = process.env) {
  return trimTrailingSlashes(env?.COMMENT_MEDIA_CDN_BASE || env?.R2_PUBLIC_URL || DEFAULT_COMMENT_MEDIA_BASE);
}

/** Public URL of a Comment image from its immutable storage key, or null. */
export function resolveCommentMediaUrl(storageKey, env = process.env) {
  if (typeof storageKey !== 'string') return null;
  const cleanKey = storageKey.replace(/^\/+/, '');
  if (!cleanKey) return null;
  return `${commentMediaBase(env)}/${cleanKey}`;
}

/** Every URL to purge from the CDN for one storage key. */
export function commentMediaPurgeUrls(storageKey, env = process.env) {
  const cleanKey = storageKey.replace(/^\/+/, '');
  const urls = new Set([`${commentMediaBase(env)}/${cleanKey}`]);
  const transition = env.COMMENT_MEDIA_DOMAIN_TRANSITION;
  const isTransition = transition === 'true' || transition === '1' || Boolean(env.COMMENT_MEDIA_PREVIOUS_CDN_BASE);
  if (isTransition) {
    urls.add(`${DEFAULT_COMMENT_MEDIA_BASE}/${cleanKey}`);
    const previous = env.COMMENT_MEDIA_PREVIOUS_CDN_BASE;
    if (previous) urls.add(`${trimTrailingSlashes(previous)}/${cleanKey}`);
  }
  return Array.from(urls);
}
