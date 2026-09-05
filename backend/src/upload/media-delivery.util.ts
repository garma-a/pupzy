/**
 * Resolves CDN purge URLs for a storage key according to configured delivery policy.
 *
 * Policy:
 * 1. Default primary domain: https://cdn.pupzy.net
 * 2. Explicit fallback / override: COMMENT_MEDIA_CDN_BASE (or R2_PUBLIC_URL)
 * 3. Domain transition: when COMMENT_MEDIA_DOMAIN_TRANSITION is true/1,
 *    COMMENT_MEDIA_PREVIOUS_CDN_BASE is set, or explicit options request it,
 *    both primary and fallback/previous domains are purged to avoid stale cached copies.
 */
export function getCommentMediaPurgeUrls(
  storageKey: string,
  options?: {
    cdnBase?: string;
    domainTransition?: boolean;
    previousCdnBase?: string;
  },
): string[] {
  const primaryBase = 'https://cdn.pupzy.net';
  const configuredBase =
    options?.cdnBase || process.env.COMMENT_MEDIA_CDN_BASE || process.env.R2_PUBLIC_URL || primaryBase;

  const cleanKey = storageKey.replace(/^\/+/, '');
  const cleanConfigured = configuredBase.replace(/\/+$/, '');
  const cleanPrimary = primaryBase.replace(/\/+$/, '');

  const urls = new Set<string>();
  urls.add(`${cleanConfigured}/${cleanKey}`);

  const transitionEnv = process.env.COMMENT_MEDIA_DOMAIN_TRANSITION;
  const isTransition =
    options?.domainTransition ??
    (transitionEnv === 'true' || transitionEnv === '1' || Boolean(process.env.COMMENT_MEDIA_PREVIOUS_CDN_BASE));

  if (isTransition) {
    urls.add(`${cleanPrimary}/${cleanKey}`);
    const prev = options?.previousCdnBase || process.env.COMMENT_MEDIA_PREVIOUS_CDN_BASE;
    if (prev) {
      urls.add(`${prev.replace(/\/+$/, '')}/${cleanKey}`);
    }
  }

  return Array.from(urls);
}
