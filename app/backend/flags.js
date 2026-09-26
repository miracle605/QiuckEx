/**
 * Safe Rollback & Feature Flag Strategy Guard
 * Fulfills Task 3 & AC 3 for Issue #416
 */
const RollbackGuard = {
  // Checks if a newly deployed feature is active via environment configuration
  isFeatureActive(flagName) {
    const envKey = `FEATURE_${flagName.toUpperCase()}`;
    return process.env[envKey] === 'true';
  },

  // Safely wraps new code. If it crashes, it instantly falls back to the previous logic.
  async executeSafely(flagName, newFeaturePath, previousStablePath) {
    if (this.isFeatureActive(flagName)) {
      try {
        return await newFeaturePath();
      } catch (error) {
        console.error(`[ROLLBACK GUARD] Feature '${flagName}' failed! Falling back to safe state.`, error);
        return await previousStablePath();
      }
    }
    return await previousStablePath();
  },

  // Issue #216: Horizon circuit-breaker recovery and bounded stale-cache behavior.
  // Feature-gated so it is not enabled on mainnet until explicitly opted in.
  isHorizonCircuitBreakerEnabled() {
    return this.isFeatureActive('HORIZON_CIRCUIT_BREAKER');
  },

  // Bounded staleness window (ms) for serving cached Horizon data during outages.
  // Defaults to 30s; clamped to a safe upper bound so stale data can never be
  // served indefinitely. Returns 0 when the capability is disabled.
  getHorizonStaleCacheTtlMs() {
    if (!this.isHorizonCircuitBreakerEnabled()) {
      return 0;
    }
    const DEFAULT_TTL_MS = 30000;
    const MAX_TTL_MS = 300000;
    const raw = Number(process.env.HORIZON_STALE_CACHE_TTL_MS);
    if (!Number.isFinite(raw) || raw <= 0) {
      return DEFAULT_TTL_MS;
    }
    return Math.min(raw, MAX_TTL_MS);
  }
};

module.exports = RollbackGuard;
