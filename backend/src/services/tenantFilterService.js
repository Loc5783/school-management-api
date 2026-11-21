const mongoose = require('mongoose');

const IS_TRUSTED_CONTEXT = Symbol.for('trustedTenantContext');

class InvalidTenantContextError extends Error {
  constructor(message = 'Ngữ cảnh tenant không hợp lệ hoặc bị thiếu') {
    super(message);
    this.name = 'InvalidTenantContextError';
    this.statusCode = 403;
    this.code = 'INVALID_TENANT_CONTEXT';
  }
}

/**
 * Filter that is guaranteed to match zero documents in MongoDB.
 * Used for fail-closed behavior when context is invalid or missing.
 */
const FAIL_CLOSED_FILTER = Object.freeze({
  _id: new mongoose.Types.ObjectId('000000000000000000000000'),
  tenantId: new mongoose.Types.ObjectId('000000000000000000000000')
});

/**
 * Normalizes an ObjectId or returns null if invalid.
 */
const toObjectId = (val) => {
  if (!val) return null;
  if (val instanceof mongoose.Types.ObjectId) return val;
  if (typeof val === 'string' && mongoose.isValidObjectId(val)) {
    return new mongoose.Types.ObjectId(val);
  }
  return null;
};

/**
 * Creates an immutable trusted tenant context object for internal services and unit tests.
 * This cannot be forged by client query or body because HTTP input cannot construct Symbols.
 *
 * @param {Object} options
 * @param {string|mongoose.Types.ObjectId|null} [options.tenantId]
 * @param {boolean} [options.isLegacy]
 * @returns {Object}
 */
const createTrustedTenantContext = (options = {}) => {
  if (!options || typeof options !== 'object') {
    return Object.freeze({
      [IS_TRUSTED_CONTEXT]: true,
      isSaaS: false,
      isLegacy: false,
      tenantId: null,
      isValid: false,
      isInvalid: true
    });
  }

  const isLegacy = options.isLegacy === true || options.tenantId === null;
  const tenantObjId = options.tenantId ? toObjectId(options.tenantId) : null;

  if (isLegacy) {
    return Object.freeze({
      [IS_TRUSTED_CONTEXT]: true,
      isSaaS: false,
      isLegacy: true,
      tenantId: null,
      isValid: true,
      isInvalid: false
    });
  }

  if (tenantObjId) {
    return Object.freeze({
      [IS_TRUSTED_CONTEXT]: true,
      isSaaS: true,
      isLegacy: false,
      tenantId: tenantObjId,
      isValid: true,
      isInvalid: false
    });
  }

  return Object.freeze({
    [IS_TRUSTED_CONTEXT]: true,
    isSaaS: false,
    isLegacy: false,
    tenantId: null,
    isValid: false,
    isInvalid: true
  });
};

/**
 * Resolves trusted tenant context from an Express req, trusted context object, or User.
 *
 * Rules:
 * - SaaS Express Req: MUST have `req.tenantId` set AND corresponding `req.user` matching `req.user.tenantId`.
 *   Never trusts client headers (x-tenant-id), query parameters, or body.
 * - Legacy Express Req: MUST have authenticated `req.user` without tenantId and no `req.tenantId`,
 *   or explicit `req.isLegacy === true` / `req.scope === 'legacy'`.
 * - Direct Trusted Context: MUST be marked with `[IS_TRUSTED_CONTEXT]: true` (via createTrustedTenantContext).
 * - User instance / document: Resolved from user's `tenantId` (or legacy if null).
 * - Untrusted plain objects (req.query, req.body, or unverified { tenantId }): Strict FAIL-CLOSED.
 *
 * @param {Object} reqOrContext Express req or context object
 * @returns {{ isSaaS: boolean, isLegacy: boolean, tenantId: mongoose.Types.ObjectId | null, isValid: boolean, isInvalid: boolean }}
 */
const resolveTenantContext = (reqOrContext) => {
  if (!reqOrContext || typeof reqOrContext !== 'object') {
    return { isSaaS: false, isLegacy: false, tenantId: null, isValid: false, isInvalid: true };
  }

  // 1. Direct Trusted Context object (marked via Symbol or createTrustedTenantContext)
  if (reqOrContext[IS_TRUSTED_CONTEXT] === true) {
    if (reqOrContext.isLegacy === true || reqOrContext.tenantId === null) {
      return {
        isSaaS: false,
        isLegacy: true,
        tenantId: null,
        isValid: true,
        isInvalid: false
      };
    }

    if (reqOrContext.tenantId !== undefined && reqOrContext.tenantId !== null) {
      const tenantObjId = toObjectId(reqOrContext.tenantId);
      if (!tenantObjId) {
        return { isSaaS: false, isLegacy: false, tenantId: null, isValid: false, isInvalid: true };
      }
      return {
        isSaaS: true,
        isLegacy: false,
        tenantId: tenantObjId,
        isValid: true,
        isInvalid: false
      };
    }

    return { isSaaS: false, isLegacy: false, tenantId: null, isValid: false, isInvalid: true };
  }

  // 2. Check if reqOrContext is an Express request (or duck-typed req / req mock)
  const isReq = Boolean(
    reqOrContext.user ||
    reqOrContext.header ||
    reqOrContext.headers ||
    reqOrContext.method ||
    reqOrContext.app ||
    reqOrContext.route ||
    reqOrContext.baseUrl !== undefined ||
    reqOrContext.originalUrl !== undefined
  );

  if (isReq) {
    // For SaaS: Must have req.tenantId AND corresponding req.user matching tenantId (SEC-1B2-01)
    if (reqOrContext.tenantId !== undefined && reqOrContext.tenantId !== null) {
      const tenantObjId = toObjectId(reqOrContext.tenantId);
      if (!tenantObjId) {
        return { isSaaS: false, isLegacy: false, tenantId: null, isValid: false, isInvalid: true };
      }

      // Req context requires req.user corresponding to req.tenantId, cannot trust req.tenantId alone
      if (!reqOrContext.user || typeof reqOrContext.user !== 'object' || !reqOrContext.user.tenantId) {
        return { isSaaS: false, isLegacy: false, tenantId: null, isValid: false, isInvalid: true };
      }

      const userTenantObjId = toObjectId(reqOrContext.user.tenantId);
      if (!userTenantObjId || !userTenantObjId.equals(tenantObjId)) {
        // Mismatch between req.user.tenantId and req.tenantId
        return { isSaaS: false, isLegacy: false, tenantId: null, isValid: false, isInvalid: true };
      }

      return {
        isSaaS: true,
        isLegacy: false,
        tenantId: tenantObjId,
        isValid: true,
        isInvalid: false
      };
    }

    // If req.tenantId is NOT set:
    // Check if it's an authenticated legacy user (via legacy auth middleware)
    if (reqOrContext.user) {
      const userTenant = reqOrContext.user.tenantId;
      if (userTenant === null || userTenant === undefined) {
        // Legacy user authenticated
        return {
          isSaaS: false,
          isLegacy: true,
          tenantId: null,
          isValid: true,
          isInvalid: false
        };
      }
      // If req.user has a tenantId but req.tenantId was not set, this is an unverified / illegal state
      return { isSaaS: false, isLegacy: false, tenantId: null, isValid: false, isInvalid: true };
    }

    // Explicit legacy marker on req (e.g. public legacy endpoints)
    if (reqOrContext.isLegacy === true || reqOrContext.scope === 'legacy') {
      return {
        isSaaS: false,
        isLegacy: true,
        tenantId: null,
        isValid: true,
        isInvalid: false
      };
    }

    // Unauthenticated req without trusted context -> fail closed
    return { isSaaS: false, isLegacy: false, tenantId: null, isValid: false, isInvalid: true };
  }

  // 3. User instance / document (has role, and _id or username)
  if (reqOrContext.role && (reqOrContext._id || reqOrContext.username)) {
    if (reqOrContext.tenantId !== undefined && reqOrContext.tenantId !== null) {
      const tenantObjId = toObjectId(reqOrContext.tenantId);
      if (!tenantObjId) {
        return { isSaaS: false, isLegacy: false, tenantId: null, isValid: false, isInvalid: true };
      }
      return {
        isSaaS: true,
        isLegacy: false,
        tenantId: tenantObjId,
        isValid: true,
        isInvalid: false
      };
    }
    return {
      isSaaS: false,
      isLegacy: true,
      tenantId: null,
      isValid: true,
      isInvalid: false
    };
  }

  // SEC-1B2-03: Any other plain object (such as req.query, req.body, or untrusted { tenantId })
  // is strictly rejected to prevent client forgery.
  return { isSaaS: false, isLegacy: false, tenantId: null, isValid: false, isInvalid: true };
};

/**
 * Validates that user and context belong to the exact same tenant boundary.
 *
 * Rules (SEC-1B2-01):
 * - If user is missing or invalid: fails closed (isValid: false).
 * - If context is omitted (null/undefined): returns user's verified tenant context.
 * - If context is provided:
 *   - Both user and context must be valid.
 *   - If user is SaaS: context must be SaaS with the SAME tenantId.
 *   - If user is Legacy: context must be Legacy.
 *   - If context has an attached user: attached user must also match user's tenant.
 *   - If any mismatch: fails closed (isValid: false).
 *
 * @param {Object} user Current authenticated user
 * @param {Object} [context] Optional trusted tenant context or Express req
 * @returns {{ isSaaS: boolean, isLegacy: boolean, tenantId: mongoose.Types.ObjectId | null, isValid: boolean, isInvalid: boolean }}
 */
const resolveUserAndTenantContext = (user, context) => {
  if (!user || typeof user !== 'object') {
    return { isSaaS: false, isLegacy: false, tenantId: null, isValid: false, isInvalid: true };
  }

  const userResolved = resolveTenantContext(user);
  if (!userResolved.isValid) {
    return { isSaaS: false, isLegacy: false, tenantId: null, isValid: false, isInvalid: true };
  }

  // If context is omitted, the user's verified tenant is the definitive context
  if (context === undefined || context === null) {
    return userResolved;
  }

  const contextResolved = resolveTenantContext(context);
  if (!contextResolved.isValid) {
    return { isSaaS: false, isLegacy: false, tenantId: null, isValid: false, isInvalid: true };
  }

  // Verify tenant alignment between user and context
  if (userResolved.isSaaS) {
    if (!contextResolved.isSaaS || !userResolved.tenantId.equals(contextResolved.tenantId)) {
      // Cross-tenant mismatch (e.g. User A with Context B or User SaaS with Context Legacy)
      return { isSaaS: false, isLegacy: false, tenantId: null, isValid: false, isInvalid: true };
    }
  } else if (userResolved.isLegacy) {
    if (!contextResolved.isLegacy) {
      // Cross-tenant mismatch (e.g. User Legacy with Context SaaS)
      return { isSaaS: false, isLegacy: false, tenantId: null, isValid: false, isInvalid: true };
    }
  }

  // If context is an Express req (or wrapper) with an attached user, that user must also align
  if (context.user && typeof context.user === 'object') {
    const attachedUserResolved = resolveTenantContext(context.user);
    if (!attachedUserResolved.isValid) {
      return { isSaaS: false, isLegacy: false, tenantId: null, isValid: false, isInvalid: true };
    }
    if (userResolved.isSaaS) {
      if (!attachedUserResolved.isSaaS || !userResolved.tenantId.equals(attachedUserResolved.tenantId)) {
        return { isSaaS: false, isLegacy: false, tenantId: null, isValid: false, isInvalid: true };
      }
    } else if (userResolved.isLegacy) {
      if (!attachedUserResolved.isLegacy) {
        return { isSaaS: false, isLegacy: false, tenantId: null, isValid: false, isInvalid: true };
      }
    }
  }

  return contextResolved;
};

/**
 * Asserts that the tenant context is valid, or throws InvalidTenantContextError.
 */
const assertTenantContext = (reqOrContext) => {
  const resolved = resolveTenantContext(reqOrContext);
  if (!resolved.isValid) {
    throw new InvalidTenantContextError('Ngữ cảnh tenant không hợp lệ hoặc bị thiếu');
  }
  return createTrustedTenantContext({
    tenantId: resolved.tenantId,
    isLegacy: resolved.isLegacy
  });
};

/**
 * Builds the canonical tenant filter for MongoDB queries.
 *
 * - SaaS: { tenantId: <ObjectId> }
 * - Legacy: { tenantId: null }
 * - Invalid/Missing:
 *     - If options.throwOnInvalid === true: throws InvalidTenantContextError
 *     - Default (failClosed: true): returns FAIL_CLOSED_FILTER
 *
 * @param {Object} reqOrContext Express req or context
 * @param {Object} options { throwOnInvalid?: boolean }
 * @returns {Object} MongoDB query filter
 */
const buildTenantFilter = (reqOrContext, options = {}) => {
  const resolved = resolveTenantContext(reqOrContext);

  if (!resolved.isValid) {
    if (options.throwOnInvalid) {
      throw new InvalidTenantContextError('Ngữ cảnh tenant không hợp lệ hoặc bị thiếu');
    }
    return { ...FAIL_CLOSED_FILTER };
  }

  if (resolved.isSaaS) {
    return { tenantId: resolved.tenantId };
  }

  if (resolved.isLegacy) {
    return { tenantId: null };
  }

  if (options.throwOnInvalid) {
    throw new InvalidTenantContextError('Ngữ cảnh tenant không hợp lệ hoặc bị thiếu');
  }
  return { ...FAIL_CLOSED_FILTER };
};

/**
 * Applies tenant filtering to an existing query filter, ensuring:
 * 1. Client-supplied tenantId in baseFilter is strictly stripped and overridden.
 * 2. Any role (admin, teacher, parent) cannot override the tenant boundary.
 * 3. Invalid or missing context results in a fail-closed filter that matches zero documents.
 *
 * @param {Object} baseFilter Existing query filter
 * @param {Object} reqOrContext Express req or context
 * @param {Object} options { throwOnInvalid?: boolean }
 * @returns {Object} Scoped MongoDB filter
 */
const applyTenantFilter = (baseFilter = {}, reqOrContext, options = {}) => {
  const tenantFilter = buildTenantFilter(reqOrContext, options);

  // Clone baseFilter to avoid mutating caller object
  const scoped = { ...(baseFilter || {}) };

  // Anti-tamper: strictly delete any client-provided tenantId
  delete scoped.tenantId;

  // If $and exists, clean out any tenantId conditions within $and items
  if (Array.isArray(scoped.$and)) {
    scoped.$and = scoped.$and
      .map((item) => {
        if (item && typeof item === 'object') {
          const cleaned = { ...item };
          delete cleaned.tenantId;
          return Object.keys(cleaned).length > 0 ? cleaned : null;
        }
        return item;
      })
      .filter(Boolean);

    if (scoped.$and.length === 0) {
      delete scoped.$and;
    }
  }

  // Merge the trusted tenant filter
  return Object.assign(scoped, tenantFilter);
};

module.exports = {
  FAIL_CLOSED_FILTER,
  IS_TRUSTED_CONTEXT,
  InvalidTenantContextError,
  applyTenantFilter,
  assertTenantContext,
  buildTenantFilter,
  createTrustedTenantContext,
  resolveTenantContext,
  resolveUserAndTenantContext
};
