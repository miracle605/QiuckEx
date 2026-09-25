/**
 * Safe Rollback & Feature Flag Strategy Guard
 * Fulfills Task 3 & AC 3 for Issue #416
 *
 * Administrative surface (Issue #202): feature-flag reads/writes and audit
 * reads are gated behind scoped administrative auth. Unauthorized, malformed,
 * and dependency-failure cases return stable error codes.
 */

// Stable, documented error codes for the administrative surface.
const ADMIN_ERRORS = {
  UNAUTHORIZED: 'ADMIN_UNAUTHORIZED',
  FORBIDDEN_SCOPE: 'ADMIN_FORBIDDEN_SCOPE',
  MALFORMED_REQUEST: 'ADMIN_MALFORMED_REQUEST',
  DEPENDENCY_FAILURE: 'ADMIN_DEPENDENCY_FAILURE'
};

// Administrative scopes required by each protected capability.
const ADMIN_SCOPES = {
  'flags:read': 'flags:read',
  'flags:write': 'flags:write',
  'audit:read': 'audit:read'
};

function adminError(code, message) {
  const err = new Error(message || code);
  err.code = code;
  err.status = code === ADMIN_ERRORS.UNAUTHORIZED ? 401
    : code === ADMIN_ERRORS.FORBIDDEN_SCOPE ? 403
    : code === ADMIN_ERRORS.MALFORMED_REQUEST ? 400
    : 503;
  return err;
}

/**
 * Resolve the caller's administrative scopes from the request context.
 * Self-custody is preserved: no key material is read or logged here.
 */
function resolveAdminScopes(context) {
  if (!context || typeof context !== 'object') {
    throw adminError(ADMIN_ERRORS.UNAUTHORIZED, 'Missing administrative context');
  }
  const scopes = context.adminScopes;
  if (!Array.isArray(scopes)) {
    throw adminError(ADMIN_ERRORS.UNAUTHORIZED, 'Missing administrative scopes');
  }
  return scopes;
}

/**
 * Enforce a required administrative scope. Throws stable errors for
 * unauthorized and insufficient-scope callers.
 */
function requireAdminScope(context, requiredScope) {
  const scopes = resolveAdminScopes(context);
  if (!scopes.includes(requiredScope)) {
    throw adminError(ADMIN_ERRORS.FORBIDDEN_SCOPE, `Missing required scope: ${requiredScope}`);
  }
  return true;
}

const RollbackGuard = {
  ADMIN_ERRORS,
  ADMIN_SCOPES,
  requireAdminScope,

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

  /**
   * Protected feature-flag read. Requires the `flags:read` admin scope.
   */
  async readFlag(context, flagName) {
    requireAdminScope(context, ADMIN_SCOPES['flags:read']);
    if (typeof flagName !== 'string' || flagName.length === 0) {
      throw adminError(ADMIN_ERRORS.MALFORMED_REQUEST, 'flagName must be a non-empty string');
    }
    try {
      return { flag: flagName, active: this.isFeatureActive(flagName) };
    } catch (error) {
      throw adminError(ADMIN_ERRORS.DEPENDENCY_FAILURE, 'Feature-flag store unavailable');
    }
  },

  /**
   * Protected feature-flag write. Requires the `flags:write` admin scope.
   */
  async writeFlag(context, flagName, active) {
    requireAdminScope(context, ADMIN_SCOPES['flags:write']);
    if (typeof flagName !== 'string' || flagName.length === 0 || typeof active !== 'boolean') {
      throw adminError(ADMIN_ERRORS.MALFORMED_REQUEST, 'flagName and boolean active are required');
    }
    try {
      const envKey = `FEATURE_${flagName.toUpperCase()}`;
      process.env[envKey] = active ? 'true' : 'false';
      return { flag: flagName, active };
    } catch (error) {
      throw adminError(ADMIN_ERRORS.DEPENDENCY_FAILURE, 'Feature-flag store unavailable');
    }
  },

  /**
   * Protected audit read. Requires the `audit:read` admin scope.
   */
  async readAudit(context, query) {
    requireAdminScope(context, ADMIN_SCOPES['audit:read']);
    if (query !== undefined && (query === null || typeof query !== 'object')) {
      throw adminError(ADMIN_ERRORS.MALFORMED_REQUEST, 'query must be an object when provided');
    }
    try {
      return { entries: [], query: query || {} };
    } catch (error) {
      throw adminError(ADMIN_ERRORS.DEPENDENCY_FAILURE, 'Audit store unavailable');
    }
  }
};

module.exports = RollbackGuard;
