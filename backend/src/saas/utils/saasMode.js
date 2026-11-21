/**
 * SaaS Mode Definitions and Allowlist Predicates
 * 
 * Enforces strict fail-closed mode controls across SaaS lifecycle phases:
 * - Read modules (Classrooms, Students GETs): approved in phase1b, phase1c, phase1d, and phase1e.
 * - Attendance module and Student Transfer writes: approved in phase1c, phase1d, and phase1e.
 * - HR, Internal Accounts, Homeroom Assignment, and Timekeeping modules: approved in phase1d and phase1e.
 * - Finance module (Zone 4 approved allowlist): approved in phase1e only.
 * - Unknown, typo, or future modes (e.g., 'unknown', 'phase1f', 'phase1g', 'phase1e '): fail-closed (HTTP 501).
 * - Default mode when unset: 'phase1b' (reads active, attendance/transfer gated).
 */

const DEFAULT_SAAS_MODE = 'phase1b';

// Explicitly supported allowlists for current phases - do NOT pre-enable future phases (phase1f/g)
const SUPPORTED_READ_MODES = Object.freeze(['phase1b', 'phase1c', 'phase1d', 'phase1e']);
const SUPPORTED_WRITE_MODES = Object.freeze(['phase1c', 'phase1d', 'phase1e']);
const SUPPORTED_HR_MODES = Object.freeze(['phase1d', 'phase1e']);
const SUPPORTED_FINANCE_MODES = Object.freeze(['phase1e']);

/**
 * Resolves the SaaS mode during app initialization (factory time).
 * 
 * Precedence:
 * 1. Explicit options.saasMode (if provided and not undefined/null)
 * 2. process.env.SAAS_MODE (if non-empty string)
 * 3. DEFAULT_SAAS_MODE ('phase1b')
 * 
 * @param {Object} options 
 * @returns {string} resolved mode
 */
const resolveSaasMode = (options = {}) => {
  if (options && options.saasMode !== undefined && options.saasMode !== null) {
    return String(options.saasMode);
  }
  if (process.env.SAAS_MODE && String(process.env.SAAS_MODE).trim()) {
    return String(process.env.SAAS_MODE).trim();
  }
  return DEFAULT_SAAS_MODE;
};

/**
 * Resolves the SaaS mode for an incoming HTTP request.
 * 
 * Avoids environment fallback when the Express app instance already has `saasMode` configured.
 * 
 * @param {import('express').Request} req 
 * @returns {string} resolved mode
 */
const getRequestSaasMode = (req) => {
  if (req && req.app && typeof req.app.get === 'function') {
    const appMode = req.app.get('saasMode');
    if (appMode !== undefined && appMode !== null) {
      return String(appMode);
    }
  }
  // Only fallback to env/default if the app mode is not configured on the app instance
  if (process.env.SAAS_MODE && String(process.env.SAAS_MODE).trim()) {
    return String(process.env.SAAS_MODE).trim();
  }
  return DEFAULT_SAAS_MODE;
};

/**
 * Predicate: Are read modules (Classrooms & Students GET endpoints) allowed?
 * Allowed in phase1b, phase1c, and phase1d. All other modes fail-closed.
 * 
 * @param {string} mode 
 * @returns {boolean}
 */
const isReadModuleAllowed = (mode) => {
  return SUPPORTED_READ_MODES.includes(mode);
};

/**
 * Predicate: Is the Attendance module allowed?
 * Allowed in phase1c and phase1d. Default phase1b, phase1a, unknown, and future modes fail-closed.
 * 
 * @param {string} mode 
 * @returns {boolean}
 */
const isAttendanceAllowed = (mode) => {
  return SUPPORTED_WRITE_MODES.includes(mode);
};

/**
 * Predicate: Is Student Transfer write endpoint allowed?
 * Allowed in phase1c, phase1d, and phase1e. Default phase1b, phase1a, unknown, and future modes fail-closed.
 * 
 * @param {string} mode 
 * @returns {boolean}
 */
const isStudentTransferAllowed = (mode) => {
  return SUPPORTED_WRITE_MODES.includes(mode);
};

/**
 * Predicate: Are HR and Internal Accounts modules allowed?
 * Allowed in phase1d and phase1e. All other modes fail-closed.
 * 
 * @param {string} mode 
 * @returns {boolean}
 */
const isHrAllowed = (mode) => {
  return SUPPORTED_HR_MODES.includes(mode);
};

/**
 * Predicate: Is Homeroom Teacher assignment write endpoint allowed?
 * Allowed in phase1d and phase1e. All other modes fail-closed.
 * 
 * @param {string} mode 
 * @returns {boolean}
 */
const isHomeroomAssignmentAllowed = (mode) => {
  return SUPPORTED_HR_MODES.includes(mode);
};

/**
 * Predicate: Is Timekeeping module allowed?
 * Allowed in phase1d and phase1e. All other modes fail-closed.
 * 
 * @param {string} mode 
 * @returns {boolean}
 */
const isTimekeepingAllowed = (mode) => {
  return SUPPORTED_HR_MODES.includes(mode);
};

/**
 * Predicate: Is Finance module allowed?
 * Allowed strictly in phase1e. All other modes fail-closed.
 * 
 * @param {string} mode 
 * @returns {boolean}
 */
const isFinanceAllowed = (mode) => {
  return SUPPORTED_FINANCE_MODES.includes(mode);
};

/**
 * Predicate: Is Nutrition (Kitchen) module allowed?
 * Allowed in phase1e. All other modes fail-closed.
 * 
 * @param {string} mode 
 * @returns {boolean}
 */
const isNutritionAllowed = (mode) => {
  return SUPPORTED_FINANCE_MODES.includes(mode);
};

/**
 * Predicate: Is Notification module allowed?
 * Allowed in phase1e. All other modes fail-closed.
 * 
 * @param {string} mode 
 * @returns {boolean}
 */
const isNotificationAllowed = (mode) => {
  return SUPPORTED_FINANCE_MODES.includes(mode);
};

/**
 * Predicate: Is Chat and Class Communication module allowed?
 * Allowed in phase1e. All other modes fail-closed.
 * 
 * @param {string} mode 
 * @returns {boolean}
 */
const isChatAllowed = (mode) => {
  return SUPPORTED_FINANCE_MODES.includes(mode);
};

/**
 * Predicate: Is Student & Classroom Write/Mutation module allowed?
 * Allowed in phase1e. All other modes fail-closed.
 * 
 * @param {string} mode 
 * @returns {boolean}
 */
const isStudentMutationAllowed = (mode) => {
  return SUPPORTED_FINANCE_MODES.includes(mode);
};

/**
 * Predicate: Is Pickup and Guard Security module allowed?
 * Allowed in phase1e. All other modes fail-closed.
 * 
 * @param {string} mode 
 * @returns {boolean}
 */
const isPickupAllowed = (mode) => {
  return SUPPORTED_FINANCE_MODES.includes(mode);
};

/**
 * Predicate: Is Procurement and Asset module allowed?
 * Allowed in phase1e. All other modes fail-closed.
 * 
 * @param {string} mode 
 * @returns {boolean}
 */
const isProcurementAllowed = (mode) => {
  return SUPPORTED_FINANCE_MODES.includes(mode);
};

/**
 * Predicate: Are Parent Feedback & Profile Change Requests allowed?
 * Allowed in phase1e. All other modes fail-closed.
 * 
 * @param {string} mode 
 * @returns {boolean}
 */
const isFeedbackAllowed = (mode) => {
  return SUPPORTED_FINANCE_MODES.includes(mode);
};

module.exports = {
  DEFAULT_SAAS_MODE,
  SUPPORTED_READ_MODES,
  SUPPORTED_WRITE_MODES,
  SUPPORTED_HR_MODES,
  SUPPORTED_FINANCE_MODES,
  resolveSaasMode,
  getRequestSaasMode,
  isReadModuleAllowed,
  isAttendanceAllowed,
  isStudentTransferAllowed,
  isHrAllowed,
  isHomeroomAssignmentAllowed,
  isTimekeepingAllowed,
  isFinanceAllowed,
  isNutritionAllowed,
  isNotificationAllowed,
  isChatAllowed,
  isStudentMutationAllowed,
  isPickupAllowed,
  isProcurementAllowed,
  isFeedbackAllowed
};
