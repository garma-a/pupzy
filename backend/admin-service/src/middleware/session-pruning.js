const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;

/** Opportunistically prune expired sessions on AdminJS traffic without keeping a sleep-blocking timer alive. */
export function buildRequestTriggeredSessionPruning(
  store,
  { clock = () => Date.now(), intervalMs = DEFAULT_INTERVAL_MS, logger } = {},
) {
  let nextPruneAt = 0;

  return function requestTriggeredSessionPruning(_request, _response, next) {
    const now = clock();
    if (now >= nextPruneAt) {
      nextPruneAt = now + intervalMs;
      store.pruneSessions((error) => {
        if (error) logger?.error({ err: error }, 'failed to prune expired admin sessions');
      });
    }
    next();
  };
}
