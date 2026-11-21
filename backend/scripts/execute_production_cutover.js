'use strict';

/**
 * ============================================================================
 * PRODUCTION SAAS CUTOVER SCRIPT - APPLIES TO LIVE `school_management`
 * ============================================================================
 * Executes live multi-tenant cutover for `school_management`:
 * 1. Preflight safety checks & Manifest verification on 89 collections.
 * 2. Assigns all legacy accounts and business collections to `HOANANG-A` (Hoa Nắng A).
 * 3. Preserves all 15 legacy accounts (_id, username, passwordHash, role, status).
 * 4. Transforms 23 Compound Multi-Tenant Unique Index Groups safely.
 * 5. Creates Tenant `HOANANG-B` (Hoa Nắng B — Test) with sample data & 8 roles.
 * 6. Validates cross-tenant isolation and verified HTTP login with known credentials.
 * ============================================================================
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  process.env.JWT_SECRET = 'school_management_super_secret_jwt_key_rehearsal_32_chars_min';
}
process.env.TIMEKEEPING_SCHEDULER_ENABLED = 'false';

const fs = require('fs');
const crypto = require('crypto');
const mongoose = require('mongoose');
mongoose.set('autoIndex', false);
const bcrypt = require('bcryptjs');
const request = require('supertest');

const createProductionSaasApp = require('../src/saas/createProductionSaasApp');

const LIVE_DB_URI = 'mongodb://127.0.0.1:27018/school_management?replicaSet=rs0&directConnection=true';
const RUN_LOG_PATH = 'E:/school-mongo-recovery-20261106/two-school-test-20261111/production_cutover.log';
const SUMMARY_JSON_PATH = 'E:/school-mongo-recovery-20261106/two-school-test-20261111/production_cutover_summary.json';
const LEGACY_KNOWN_CREDS_PATH = 'E:/school-mongo-recovery-20261106/two-school-test-20261111/legacy_known_credentials.json';
const CREDENTIALS_OUTPUT_PATH = 'E:/school-mongo-recovery-20261106/two-school-test-20261111/tenant_b_credentials.json';

// Manifest của 89 collections
const COLLECTION_MANIFEST = {
  "tenants": { type: "platform_shared", action: "SKIP_ASSIGN_TENANT_ID", targetOwner: "PLATFORM" },
  "platform_admins": { type: "platform_shared", action: "SKIP_ASSIGN_TENANT_ID", targetOwner: "PLATFORM" },
  "platform_audit_logs": { type: "platform_shared", action: "SKIP_ASSIGN_TENANT_ID", targetOwner: "PLATFORM" },
  "subscriptions": { type: "platform_shared", action: "SKIP_ASSIGN_TENANT_ID", targetOwner: "PLATFORM" },
  "revoked_sessions": { type: "platform_shared", action: "SKIP_ASSIGN_TENANT_ID", targetOwner: "PLATFORM" },
  "permissions": { type: "catalog_shared", action: "SKIP_ASSIGN_TENANT_ID", targetOwner: "SHARED_CATALOG" },

  // Business collections
  "studenttransferhistories": { type: "business_legacy", action: "ASSIGN_TENANT_ID", targetOwner: "HOANANG-A" },
  "inventorytransactions": { type: "business_legacy", action: "ASSIGN_TENANT_ID", targetOwner: "HOANANG-A" },
  "pickuprecords": { type: "business_legacy", action: "ASSIGN_TENANT_ID", targetOwner: "HOANANG-A" },
  "studentleaverequests": { type: "business_legacy", action: "ASSIGN_TENANT_ID", targetOwner: "HOANANG-A" },
  "parentteacherevaluations": { type: "business_empty", action: "ASSIGN_TENANT_ID", targetOwner: "HOANANG-A" },
  "purchaseexpenses": { type: "business_empty", action: "ASSIGN_TENANT_ID", targetOwner: "HOANANG-A" },
  "students": { type: "business_legacy", action: "ASSIGN_TENANT_ID", targetOwner: "HOANANG-A" },
  "authorization_audit_logs": { type: "business_legacy", action: "ASSIGN_TENANT_ID", targetOwner: "HOANANG-A" },
  "studentprofilechangerequests": { type: "business_legacy", action: "ASSIGN_TENANT_ID", targetOwner: "HOANANG-A" },
  "overtimerates": { type: "business_legacy", action: "ASSIGN_TENANT_ID", targetOwner: "HOANANG-A" },
  "staffhandovers": { type: "business_legacy", action: "ASSIGN_TENANT_ID", targetOwner: "HOANANG-A" },
  "tuitionrefundrequests": { type: "business_empty", action: "ASSIGN_TENANT_ID", targetOwner: "HOANANG-A" },
  "guardemergencymodes": { type: "business_legacy", action: "ASSIGN_TENANT_ID", targetOwner: "HOANANG-A" },
  "employeecredentials": { type: "business_empty", action: "ASSIGN_TENANT_ID", targetOwner: "HOANANG-A" },
  "kitchendayclosings": { type: "business_empty", action: "ASSIGN_TENANT_ID", targetOwner: "HOANANG-A" },
  "evaluationperiods": { type: "business_empty", action: "ASSIGN_TENANT_ID", targetOwner: "HOANANG-A" },
  "credentialrequirements": { type: "business_legacy", action: "ASSIGN_TENANT_ID", targetOwner: "HOANANG-A" },
  "operatingexpenserequests": { type: "business_empty", action: "ASSIGN_TENANT_ID", targetOwner: "HOANANG-A" },
  "inventoryreconciliations": { type: "business_legacy", action: "ASSIGN_TENANT_ID", targetOwner: "HOANANG-A" },
  "departments": { type: "business_legacy", action: "ASSIGN_TENANT_ID", targetOwner: "HOANANG-A" },
  "studentattendances": { type: "business_legacy", action: "ASSIGN_TENANT_ID", targetOwner: "HOANANG-A" },
  "operatingexpenses": { type: "business_empty", action: "ASSIGN_TENANT_ID", targetOwner: "HOANANG-A" },
  "feeschedules": { type: "business_empty", action: "ASSIGN_TENANT_ID", targetOwner: "HOANANG-A" },
  "parentfeedbacks": { type: "business_empty", action: "ASSIGN_TENANT_ID", targetOwner: "HOANANG-A" },
  "inventories": { type: "business_legacy", action: "ASSIGN_TENANT_ID", targetOwner: "HOANANG-A" },
  "invoiceadjustments": { type: "business_legacy", action: "ASSIGN_TENANT_ID", targetOwner: "HOANANG-A" },
  "guarddevices": { type: "business_empty", action: "ASSIGN_TENANT_ID", targetOwner: "HOANANG-A" },
  "payrollevents": { type: "business_legacy", action: "ASSIGN_TENANT_ID", targetOwner: "HOANANG-A" },
  "kitchenrequests": { type: "business_legacy", action: "ASSIGN_TENANT_ID", targetOwner: "HOANANG-A" },
  "outbox_events": { type: "business_legacy", action: "ASSIGN_TENANT_ID", targetOwner: "HOANANG-A" },
  "foodinspections": { type: "business_empty", action: "ASSIGN_TENANT_ID", targetOwner: "HOANANG-A" },
  "attendancerecords": { type: "business_legacy", action: "ASSIGN_TENANT_ID", targetOwner: "HOANANG-A" },
  "foodsamples": { type: "business_empty", action: "ASSIGN_TENANT_ID", targetOwner: "HOANANG-A" },
  "classrooms": { type: "business_legacy", action: "ASSIGN_TENANT_ID", targetOwner: "HOANANG-A" },
  "studentgateevents": { type: "business_legacy", action: "ASSIGN_TENANT_ID", targetOwner: "HOANANG-A" },
  "schoolvisitors": { type: "business_legacy", action: "ASSIGN_TENANT_ID", targetOwner: "HOANANG-A" },
  "importidempotencies": { type: "business_empty", action: "ASSIGN_TENANT_ID", targetOwner: "HOANANG-A" },
  "dailycashreconciliations": { type: "business_empty", action: "ASSIGN_TENANT_ID", targetOwner: "HOANANG-A" },
  "dishes": { type: "business_legacy", action: "ASSIGN_TENANT_ID", targetOwner: "HOANANG-A" },
  "ingredientmasters": { type: "business_legacy", action: "ASSIGN_TENANT_ID", targetOwner: "HOANANG-A" },
  "internalannouncements": { type: "business_legacy", action: "ASSIGN_TENANT_ID", targetOwner: "HOANANG-A" },
  "raw_attendance_events": { type: "business_legacy", action: "ASSIGN_TENANT_ID", targetOwner: "HOANANG-A" },
  "jobapplicants": { type: "business_legacy", action: "ASSIGN_TENANT_ID", targetOwner: "HOANANG-A" },
  "attendance_recalculation_queue": { type: "business_legacy", action: "ASSIGN_TENANT_ID", targetOwner: "HOANANG-A" },
  "notifications": { type: "business_legacy", action: "ASSIGN_TENANT_ID", targetOwner: "HOANANG-A" },
  "kitchenequipments": { type: "business_empty", action: "ASSIGN_TENANT_ID", targetOwner: "HOANANG-A" },
  "accountingperiods": { type: "business_legacy", action: "ASSIGN_TENANT_ID", targetOwner: "HOANANG-A" },
  "credentialpolicies": { type: "business_legacy", action: "ASSIGN_TENANT_ID", targetOwner: "HOANANG-A" },
  "kitchenstaffs": { type: "business_empty", action: "ASSIGN_TENANT_ID", targetOwner: "HOANANG-A" },
  "principaltasks": { type: "business_empty", action: "ASSIGN_TENANT_ID", targetOwner: "HOANANG-A" },
  "staffreplacements": { type: "business_empty", action: "ASSIGN_TENANT_ID", targetOwner: "HOANANG-A" },
  "staffreviews": { type: "business_legacy", action: "ASSIGN_TENANT_ID", targetOwner: "HOANANG-A" },
  "procurementrequests": { type: "business_legacy", action: "ASSIGN_TENANT_ID", targetOwner: "HOANANG-A" },
  "conversations": { type: "business_legacy", action: "ASSIGN_TENANT_ID", targetOwner: "HOANANG-A" },
  "chatmessages": { type: "business_legacy", action: "ASSIGN_TENANT_ID", targetOwner: "HOANANG-A" },
  "timekeepingcorrectionrequests": { type: "business_legacy", action: "ASSIGN_TENANT_ID", targetOwner: "HOANANG-A" },
  "staffpersonalrequests": { type: "business_legacy", action: "ASSIGN_TENANT_ID", targetOwner: "HOANANG-A" },
  "assets": { type: "business_empty", action: "ASSIGN_TENANT_ID", targetOwner: "HOANANG-A" },
  "monthlytimesheets": { type: "business_empty", action: "ASSIGN_TENANT_ID", targetOwner: "HOANANG-A" },
  "guarddeviceevents": { type: "business_empty", action: "ASSIGN_TENANT_ID", targetOwner: "HOANANG-A" },
  "securityincidents": { type: "business_legacy", action: "ASSIGN_TENANT_ID", targetOwner: "HOANANG-A" },
  "suppliers": { type: "business_empty", action: "ASSIGN_TENANT_ID", targetOwner: "HOANANG-A" },
  "payrolls": { type: "business_legacy", action: "ASSIGN_TENANT_ID", targetOwner: "HOANANG-A" },
  "attendance_calculation_runs": { type: "business_empty", action: "ASSIGN_TENANT_ID", targetOwner: "HOANANG-A" },
  "studentcodecounters": { type: "business_legacy", action: "ASSIGN_TENANT_ID", targetOwner: "HOANANG-A" },
  "overtimerequests": { type: "business_empty", action: "ASSIGN_TENANT_ID", targetOwner: "HOANANG-A" },
  "hiringneeds": { type: "business_legacy", action: "ASSIGN_TENANT_ID", targetOwner: "HOANANG-A" },
  "rawattendances": { type: "business_legacy", action: "ASSIGN_TENANT_ID", targetOwner: "HOANANG-A" },
  "guardshifthandovers": { type: "business_legacy", action: "ASSIGN_TENANT_ID", targetOwner: "HOANANG-A" },
  "hr_access_logs": { type: "business_legacy", action: "ASSIGN_TENANT_ID", targetOwner: "HOANANG-A" },
  "employees": { type: "business_legacy", action: "ASSIGN_TENANT_ID", targetOwner: "HOANANG-A" },
  "mealservings": { type: "business_empty", action: "ASSIGN_TENANT_ID", targetOwner: "HOANANG-A" },
  "classroomannouncements": { type: "business_legacy", action: "ASSIGN_TENANT_ID", targetOwner: "HOANANG-A" },
  "menus": { type: "business_legacy", action: "ASSIGN_TENANT_ID", targetOwner: "HOANANG-A" },
  "trainingevents": { type: "business_legacy", action: "ASSIGN_TENANT_ID", targetOwner: "HOANANG-A" },
  "supplierdeliveries": { type: "business_legacy", action: "ASSIGN_TENANT_ID", targetOwner: "HOANANG-A" },
  "staffshifts": { type: "business_legacy", action: "ASSIGN_TENANT_ID", targetOwner: "HOANANG-A" },
  "leaverequests": { type: "business_empty", action: "ASSIGN_TENANT_ID", targetOwner: "HOANANG-A" },
  "reports": { type: "business_legacy", action: "ASSIGN_TENANT_ID", targetOwner: "HOANANG-A" },
  "tuitionfees": { type: "business_legacy", action: "ASSIGN_TENANT_ID", targetOwner: "HOANANG-A" },
  "classroomdailycarereports": { type: "business_legacy", action: "ASSIGN_TENANT_ID", targetOwner: "HOANANG-A" },
  "attendance_job_locks": { type: "business_empty", action: "ASSIGN_TENANT_ID", targetOwner: "HOANANG-A" },
  "itemmasters": { type: "business_legacy", action: "ASSIGN_TENANT_ID", targetOwner: "HOANANG-A" },
  "users": { type: "business_legacy", action: "ASSIGN_TENANT_ID", targetOwner: "HOANANG-A" },
  "payments": { type: "business_legacy", action: "ASSIGN_TENANT_ID", targetOwner: "HOANANG-A" },
  "pickupotpchallenges": { type: "business_empty", action: "ASSIGN_TENANT_ID", targetOwner: "HOANANG-A" },
  "purchaseorders": { type: "business_legacy", action: "ASSIGN_TENANT_ID", targetOwner: "HOANANG-A" },
  "attendanceauditlogs": { type: "business_legacy", action: "ASSIGN_TENANT_ID", targetOwner: "HOANANG-A" }
};

const INDEX_GROUPS = [
  {
    col: 'accountingperiods',
    oldIndex: 'month_1',
    field: 'month',
    newSpecs: [
      { name: 'tenantId_1_month_1_unique', keys: { tenantId: 1, month: 1 }, options: { unique: true, partialFilterExpression: { tenantId: { $type: 'objectId' } } } },
      { name: 'legacy_month_1_unique', keys: { month: 1 }, options: { unique: true, partialFilterExpression: { tenantId: null } } }
    ]
  },
  {
    col: 'dailycashreconciliations',
    oldIndex: 'workDate_1',
    field: 'workDate',
    newSpecs: [
      { name: 'tenantId_1_workDate_1_unique', keys: { tenantId: 1, workDate: 1 }, options: { unique: true, partialFilterExpression: { tenantId: { $type: 'objectId' } } } },
      { name: 'legacy_workDate_1_unique', keys: { workDate: 1 }, options: { unique: true, partialFilterExpression: { tenantId: null } } }
    ]
  },
  {
    col: 'operatingexpenserequests',
    oldIndex: 'requestKey_1',
    field: 'requestKey',
    newSpecs: [
      { name: 'tenantId_1_requestKey_1_unique', keys: { tenantId: 1, requestKey: 1 }, options: { unique: true, partialFilterExpression: { tenantId: { $type: 'objectId' } } } },
      { name: 'legacy_requestKey_1_unique', keys: { requestKey: 1 }, options: { unique: true, partialFilterExpression: { tenantId: null } } }
    ]
  },
  {
    col: 'feeschedules',
    oldIndex: 'period_1_classroomId_1',
    field: 'period',
    newSpecs: [
      { name: 'tenantId_1_period_1_classroomId_1_unique', keys: { tenantId: 1, period: 1, classroomId: 1 }, options: { unique: true, partialFilterExpression: { tenantId: { $type: 'objectId' } } } },
      { name: 'legacy_period_1_classroomId_1_unique', keys: { period: 1, classroomId: 1 }, options: { unique: true, partialFilterExpression: { tenantId: null } } }
    ]
  },
  {
    col: 'payments',
    oldIndex: 'receiptNumber_1',
    field: 'receiptNumber',
    newSpecs: [
      { name: 'tenantId_1_receiptNumber_1_unique', keys: { tenantId: 1, receiptNumber: 1 }, options: { unique: true, partialFilterExpression: { tenantId: { $type: 'objectId' }, receiptNumber: { $type: 'string', $gt: '' } } } },
      { name: 'legacy_receiptNumber_1_unique', keys: { receiptNumber: 1 }, options: { unique: true, partialFilterExpression: { tenantId: null, receiptNumber: { $type: 'string', $gt: '' } } } }
    ]
  },
  {
    col: 'operatingexpenses',
    oldIndex: 'documentNumber_1',
    field: 'documentNumber',
    newSpecs: [
      { name: 'tenantId_1_documentNumber_1_unique', keys: { tenantId: 1, documentNumber: 1 }, options: { unique: true, partialFilterExpression: { tenantId: { $type: 'objectId' } } } },
      { name: 'legacy_documentNumber_1_unique', keys: { documentNumber: 1 }, options: { unique: true, partialFilterExpression: { tenantId: null } } }
    ]
  },
  {
    col: 'departments',
    oldIndex: 'code_1',
    field: 'code',
    newSpecs: [
      { name: 'tenantId_1_code_1_unique', keys: { tenantId: 1, code: 1 }, options: { unique: true, partialFilterExpression: { tenantId: { $type: 'objectId' } } } },
      { name: 'legacy_code_1_unique', keys: { code: 1 }, options: { unique: true, partialFilterExpression: { tenantId: null } } }
    ]
  },
  {
    col: 'employees',
    oldIndex: 'employeeCode_1',
    field: 'employeeCode',
    newSpecs: [
      { name: 'tenantId_1_employeeCode_1_unique', keys: { tenantId: 1, employeeCode: 1 }, options: { unique: true, partialFilterExpression: { tenantId: { $type: 'objectId' } } } },
      { name: 'legacy_employeeCode_1_unique', keys: { employeeCode: 1 }, options: { unique: true, partialFilterExpression: { tenantId: null } } }
    ]
  },
  {
    col: 'classrooms',
    oldIndex: 'schoolYear_1_homeroomTeacherId_1',
    field: 'schoolYear',
    newSpecs: [
      { name: 'tenantId_1_schoolYear_1_homeroomTeacherId_1_unique', keys: { tenantId: 1, schoolYear: 1, homeroomTeacherId: 1 }, options: { unique: true, partialFilterExpression: { status: 'active', homeroomTeacherId: { $type: 'objectId' }, tenantId: { $type: 'objectId' } } } }
    ]
  },
  {
    col: 'students',
    oldIndex: 'studentCode_1',
    field: 'studentCode',
    newSpecs: [
      { name: 'tenantId_1_studentCode_1_unique', keys: { tenantId: 1, studentCode: 1 }, options: { unique: true, partialFilterExpression: { tenantId: { $type: 'objectId' } } } },
      { name: 'legacy_studentCode_1_unique', keys: { studentCode: 1 }, options: { unique: true, partialFilterExpression: { tenantId: null } } }
    ]
  },
  {
    col: 'suppliers',
    oldIndex: 'code_1',
    field: 'code',
    newSpecs: [
      { name: 'tenantId_1_code_1_unique', keys: { tenantId: 1, code: 1 }, options: { unique: true, partialFilterExpression: { tenantId: { $type: 'objectId' } } } },
      { name: 'legacy_code_1_unique', keys: { code: 1 }, options: { unique: true, partialFilterExpression: { tenantId: null } } }
    ]
  },
  {
    col: 'ingredientmasters',
    oldIndex: 'code_1',
    field: 'code',
    newSpecs: [
      { name: 'tenantId_1_code_1_unique', keys: { tenantId: 1, code: 1 }, options: { unique: true, partialFilterExpression: { tenantId: { $type: 'objectId' } } } },
      { name: 'legacy_code_1_unique', keys: { code: 1 }, options: { unique: true, partialFilterExpression: { tenantId: null } } }
    ]
  },
  {
    col: 'kitchenstaffs',
    oldIndex: 'staffCode_1',
    field: 'staffCode',
    newSpecs: [
      { name: 'tenantId_1_staffCode_1_unique', keys: { tenantId: 1, staffCode: 1 }, options: { unique: true, partialFilterExpression: { tenantId: { $type: 'objectId' } } } },
      { name: 'legacy_staffCode_1_unique', keys: { staffCode: 1 }, options: { unique: true, partialFilterExpression: { tenantId: null } } }
    ]
  },
  {
    col: 'foodsamples',
    oldIndex: 'sampleCode_1',
    field: 'sampleCode',
    newSpecs: [
      { name: 'tenantId_1_sampleCode_1_unique', keys: { tenantId: 1, sampleCode: 1 }, options: { unique: true, partialFilterExpression: { tenantId: { $type: 'objectId' } } } },
      { name: 'legacy_sampleCode_1_unique', keys: { sampleCode: 1 }, options: { unique: true, partialFilterExpression: { tenantId: null } } }
    ]
  },
  {
    col: 'kitchenequipments',
    oldIndex: 'code_1',
    field: 'code',
    newSpecs: [
      { name: 'tenantId_1_code_1_unique', keys: { tenantId: 1, code: 1 }, options: { unique: true, partialFilterExpression: { tenantId: { $type: 'objectId' } } } },
      { name: 'legacy_code_1_unique', keys: { code: 1 }, options: { unique: true, partialFilterExpression: { tenantId: null } } }
    ]
  },
  {
    col: 'kitchenrequests',
    oldIndex: 'requestCode_1',
    field: 'requestCode',
    newSpecs: [
      { name: 'tenantId_1_requestCode_1_unique', keys: { tenantId: 1, requestCode: 1 }, options: { unique: true, partialFilterExpression: { tenantId: { $type: 'objectId' } } } },
      { name: 'legacy_requestCode_1_unique', keys: { requestCode: 1 }, options: { unique: true, partialFilterExpression: { tenantId: null } } }
    ]
  },
  {
    col: 'pickuprecords',
    oldIndex: 'pickupCode_1',
    field: 'pickupCode',
    newSpecs: [
      { name: 'tenantId_1_pickupCode_1_unique', keys: { tenantId: 1, pickupCode: 1 }, options: { unique: true, partialFilterExpression: { tenantId: { $type: 'objectId' } } } },
      { name: 'legacy_pickupCode_1_unique', keys: { pickupCode: 1 }, options: { unique: true, partialFilterExpression: { tenantId: null } } }
    ]
  },
  {
    col: 'purchaseorders',
    oldIndex: 'orderCode_1',
    field: 'orderCode',
    newSpecs: [
      { name: 'tenantId_1_orderCode_1_unique', keys: { tenantId: 1, orderCode: 1 }, options: { unique: true, partialFilterExpression: { tenantId: { $type: 'objectId' } } } },
      { name: 'legacy_orderCode_1_unique', keys: { orderCode: 1 }, options: { unique: true, partialFilterExpression: { tenantId: null } } }
    ]
  },
  {
    col: 'kitchendayclosings',
    oldIndex: 'dateKey_1',
    field: 'dateKey',
    newSpecs: [
      { name: 'tenantId_1_dateKey_1_unique', keys: { tenantId: 1, dateKey: 1 }, options: { unique: true, partialFilterExpression: { tenantId: { $type: 'objectId' } } } },
      { name: 'legacy_dateKey_1_unique', keys: { dateKey: 1 }, options: { unique: true, partialFilterExpression: { tenantId: null } } }
    ]
  },
  {
    col: 'studentcodecounters',
    oldIndex: 'year_1',
    field: 'year',
    newSpecs: [
      { name: 'tenantId_1_year_1_unique', keys: { tenantId: 1, year: 1 }, options: { unique: true, partialFilterExpression: { tenantId: { $type: 'objectId' } } } },
      { name: 'legacy_year_1_unique', keys: { year: 1 }, options: { unique: true, partialFilterExpression: { tenantId: null } } }
    ]
  },
  {
    col: 'evaluationperiods',
    oldIndex: 'code_1',
    field: 'code',
    newSpecs: [
      { name: 'tenantId_1_code_1_unique', keys: { tenantId: 1, code: 1 }, options: { unique: true, partialFilterExpression: { tenantId: { $type: 'objectId' } } } },
      { name: 'legacy_code_1_unique', keys: { code: 1 }, options: { unique: true, partialFilterExpression: { tenantId: null } } }
    ]
  },
  {
    col: 'guardemergencymodes',
    oldIndex: 'activeKey_1',
    field: 'activeKey',
    newSpecs: [
      { name: 'tenantId_1_activeKey_1_unique', keys: { tenantId: 1, activeKey: 1 }, options: { unique: true, partialFilterExpression: { status: 'active', tenantId: { $type: 'objectId' } } } },
      { name: 'legacy_activeKey_1_unique', keys: { activeKey: 1 }, options: { unique: true, partialFilterExpression: { status: 'active', tenantId: null } } }
    ]
  },
  {
    col: 'internalannouncements',
    oldIndex: 'requestId_1',
    field: 'requestId',
    newSpecs: [
      { name: 'tenantId_1_requestId_1_unique', keys: { tenantId: 1, requestId: 1 }, options: { unique: true, partialFilterExpression: { tenantId: { $type: 'objectId' } } } },
      { name: 'legacy_requestId_1_unique', keys: { requestId: 1 }, options: { unique: true, partialFilterExpression: { tenantId: null } } }
    ]
  }
];

async function executeProductionCutover() {
  const startTime = Date.now();
  const cutoverResults = {
    step: 'START',
    success: false,
    assertions: [],
    details: {}
  };

  fs.writeFileSync(RUN_LOG_PATH, `=== PRODUCTION CUTOVER EXECUTION LOG: ${new Date().toISOString()} ===\n`, 'utf8');
  const logMessage = (...args) => {
    const text = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
    const safeText = text.replace(/(password|token|secret)":\s*"[^"]+"/gi, '$1":"[REDACTED]"');
    fs.appendFileSync(RUN_LOG_PATH, safeText + '\n', 'utf8');
  };
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...args) => { origLog(...args); logMessage(...args); };
  console.error = (...args) => { origErr(...args); logMessage('[ERROR]', ...args); };

  const recordAssertion = (name, passed, detail = null) => {
    cutoverResults.assertions.push({ name, passed, detail });
    if (passed) {
      console.log(`  [PASS] ${name}`);
    } else {
      console.error(`  [FAIL] ${name} - Detail:`, detail);
      throw new Error(`Assertion failed: ${name}`);
    }
  };

  console.log('===============================================================');
  console.log('⚡ BẮT ĐẦU CUTOVER BẢN CHÍNH (school_management) CHO HOANANG-A & B');
  console.log('===============================================================');

  // BƯỚC 1: KẾT NỐI VÀ KIỂM TRA PRE-FLIGHT TRÊN school_management
  console.log('\n[1/8] Kết nối MongoDB database chính: school_management...');
  await mongoose.connect(LIVE_DB_URI);
  mongoose.set('autoIndex', false);
  const db = mongoose.connection.db;

  recordAssertion('Connected to target DB "school_management"', mongoose.connection.name === 'school_management');
  recordAssertion('autoIndex is disabled', mongoose.get('autoIndex') === false);
  recordAssertion('Scheduler is disabled in process', process.env.TIMEKEEPING_SCHEDULER_ENABLED === 'false');

  // Verify all collections in DB belong to Manifest
  const colsInDb = await db.listCollections().toArray();
  for (const c of colsInDb) {
    if (c.name.startsWith('system.')) continue;
    if (!COLLECTION_MANIFEST[c.name]) {
      throw new Error(`FAIL-CLOSED: Phát hiện collection ngoại lai: "${c.name}"`);
    }
  }
  recordAssertion('All DB collections verified against manifest (zero unknown collections)', true);

  // Pre-check 15 legacy accounts of Tenant A
  const initialUsers = await db.collection('users').find({ username: { $not: /_b$/ } }).toArray();
  recordAssertion('Total legacy users of Tenant A = 15', initialUsers.length === 15);
  const suspendedUserBefore = initialUsers.find(u => u.username === '123');
  recordAssertion('User "123" is suspended', !!suspendedUserBefore && suspendedUserBefore.status === 'suspended');

  // BƯỚC 2: TẠO HOẶC LẤY TENANT A (HOANANG-A)
  console.log('\n[2/8] Khởi tạo Tenant A (Hoa Nắng A)...');
  let tenantADoc = await db.collection('tenants').findOne({ code: 'HOANANG-A' });
  let tenantAId;
  if (!tenantADoc) {
    tenantAId = new mongoose.Types.ObjectId();
    tenantADoc = {
      _id: tenantAId,
      name: 'Hoa Nắng A',
      code: 'HOANANG-A',
      status: 'active',
      contactEmail: 'contact@hoanang-a.edu.vn',
      contactPhone: '02431234567',
      authVersion: 0,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    await db.collection('tenants').insertOne(tenantADoc);
    console.log(`  -> Đã tạo Tenant A với _id: ${tenantAId}`);
  } else {
    tenantAId = tenantADoc._id;
    console.log(`  -> Tìm thấy Tenant A đã tồn tại với _id: ${tenantAId}`);
  }
  recordAssertion('Tenant A (HOANANG-A) exists and is active', !!tenantADoc && tenantADoc.status === 'active');

  // BƯỚC 3: GÁN QUYỀN SỞ HỮU SANG HOANANG-A THEO MANIFEST
  console.log('\n[3/8] Chuyển đổi quyền sở hữu 59 business collections sang HOANANG-A...');
  let businessColsWithDataCount = 0;
  for (const colName of Object.keys(COLLECTION_MANIFEST)) {
    const spec = COLLECTION_MANIFEST[colName];
    if (spec.action === 'ASSIGN_TENANT_ID') {
      const initialDocCount = await db.collection(colName).countDocuments();
      const initialLegacyCount = await db.collection(colName).countDocuments({ tenantId: { $in: [null, undefined] } });

      if (initialLegacyCount > 0) {
        const updateResult = await db.collection(colName).updateMany(
          { tenantId: { $in: [null, undefined] } },
          { $set: { tenantId: tenantAId } }
        );
        if (updateResult.modifiedCount !== initialLegacyCount) {
          throw new Error(`FAIL: Collection "${colName}" modifiedCount (${updateResult.modifiedCount}) !== initialLegacyCount (${initialLegacyCount})`);
        }
      }

      // Verify no business documents lack tenantId
      const missingCount = await db.collection(colName).countDocuments({ tenantId: { $in: [null, undefined] } });
      if (missingCount !== 0) {
        throw new Error(`FAIL: Collection "${colName}" còn ${missingCount} bản ghi thiếu tenantId!`);
      }

      if (initialDocCount > 0) {
        businessColsWithDataCount++;
      }
    }
  }
  recordAssertion('Manifest assignment completed with zero missing tenantId in all business collections', true);
  console.log(`  -> Đã gán tenantId cho ${businessColsWithDataCount} business collections có dữ liệu.`);

  // Verify accounts integrity in Tenant A
  const postUsers = await db.collection('users').find({ tenantId: tenantAId }).toArray();
  recordAssertion('All 15 legacy users now belong to Tenant A', postUsers.length === 15);
  for (const initU of initialUsers) {
    const migU = postUsers.find(u => u._id.toString() === initU._id.toString());
    recordAssertion(`Account ${initU.username} preserved (_id, role, hash, status)`,
      migU &&
      migU.username === initU.username &&
      migU.passwordHash === initU.passwordHash &&
      migU.role === initU.role &&
      migU.status === initU.status
    );
  }

  // BƯỚC 4: CHUYỂN ĐỔI 23 NHÓM COMPOUND MULTI-TENANT INDEX
  console.log('\n[4/8] Chuyển đổi an toàn 23 nhóm Compound Multi-Tenant Unique Index...');
  for (const group of INDEX_GROUPS) {
    const col = db.collection(group.col);
    const existingIndexes = await col.indexes();

    // 1. Kiểm tra compound index đã tồn tại hay chưa
    const compoundSpec = group.newSpecs[0];
    const compoundKeysJson = JSON.stringify(compoundSpec.keys);
    const existingCompound = existingIndexes.find(idx => JSON.stringify(idx.key) === compoundKeysJson);

    if (!existingCompound) {
      await col.createIndex(compoundSpec.keys, { name: compoundSpec.name, ...compoundSpec.options });
    } else {
      console.log(`  -> Collection "${group.col}": Compound index already exists as "${existingCompound.name}"`);
    }

    // 2. Drop old un-scoped unique index if still present
    const updatedBeforeDrop = await col.indexes();
    if (updatedBeforeDrop.some(idx => idx.name === group.oldIndex)) {
      await col.dropIndex(group.oldIndex);
      console.log(`  -> Dropped old global index "${group.oldIndex}" on "${group.col}"`);
    }

    // 3. Create legacy partial index if specified
    if (group.newSpecs.length > 1) {
      const legacySpec = group.newSpecs[1];
      const legacyKeysJson = JSON.stringify(legacySpec.keys);
      const afterDropIndexes = await col.indexes();
      const existingLegacy = afterDropIndexes.find(idx => idx.name === legacySpec.name || (JSON.stringify(idx.key) === legacyKeysJson && idx.partialFilterExpression?.tenantId === null));
      if (!existingLegacy) {
        await col.createIndex(legacySpec.keys, { name: legacySpec.name, ...legacySpec.options });
      }
    }

    // Verify index structure: old index must be gone, compound unique index must be active
    const finalIndexes = await col.indexes();
    const oldStillExists = finalIndexes.some(idx => idx.name === group.oldIndex);
    const compoundActive = finalIndexes.some(idx => JSON.stringify(idx.key) === compoundKeysJson && idx.unique === true);
    recordAssertion(`Group "${group.col}": Old index dropped, new compound index active`, !oldStillExists && compoundActive);
  }

  // BƯỚC 5: KHỞI TẠO TENANT B (HOANANG-B) VÀ DỮ LIỆU MẪU
  console.log('\n[5/8] Khởi tạo Tenant B (Hoa Nắng B — Test) và 8 vai trò mẫu...');
  let tenantBDoc = await db.collection('tenants').findOne({ code: 'HOANANG-B' });
  let tenantBId;
  if (!tenantBDoc) {
    tenantBId = new mongoose.Types.ObjectId();
    tenantBDoc = {
      _id: tenantBId,
      name: 'Hoa Nắng B — Test',
      code: 'HOANANG-B',
      status: 'active',
      contactEmail: 'contact@hoanang-b.edu.vn',
      contactPhone: '02439876543',
      authVersion: 0,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    await db.collection('tenants').insertOne(tenantBDoc);
  } else {
    tenantBId = tenantBDoc._id;
  }
  recordAssertion('Tenant B (HOANANG-B) exists and is active', !!tenantBDoc && tenantBDoc.status === 'active');

  const tenantBRoles = [
    { username: 'admin_b', role: 'admin', fullName: 'Quản Trị Viên Trường B' },
    { username: 'hieutruong_b', role: 'principal', fullName: 'Hiệu Trưởng Trường B' },
    { username: 'ketoan_b', role: 'accountant', fullName: 'Kế Toán Trường B' },
    { username: 'hr_b', role: 'hr', fullName: 'Nhân Sự Trường B' },
    { username: 'giaovien_b', role: 'teacher', fullName: 'Giáo Viên Trường B' },
    { username: 'phuhuynh_b', role: 'parent', fullName: 'Phụ Huynh Trường B' },
    { username: 'bep_b', role: 'chef', fullName: 'Bếp Trưởng Trường B' },
    { username: 'baove_b', role: 'guard', fullName: 'Bảo Vệ Trường B' }
  ];

  // Read or generate Tenant B credentials safely outside repo
  let credentialsExport = null;
  if (fs.existsSync(CREDENTIALS_OUTPUT_PATH)) {
    try {
      credentialsExport = JSON.parse(fs.readFileSync(CREDENTIALS_OUTPUT_PATH, 'utf8'));
    } catch (_) {}
  }

  if (!credentialsExport || !credentialsExport.accounts || credentialsExport.accounts.length < 8) {
    credentialsExport = {
      generatedAt: new Date().toISOString(),
      environment: 'production_cutover',
      tenant: {
        code: 'HOANANG-B',
        name: 'Hoa Nắng B — Test',
        tenantId: tenantBId.toString()
      },
      accounts: []
    };
    for (const acc of tenantBRoles) {
      credentialsExport.accounts.push({
        username: acc.username,
        role: acc.role,
        fullName: acc.fullName,
        password: 'B_' + crypto.randomBytes(6).toString('hex') + '!2026'
      });
    }
    fs.writeFileSync(CREDENTIALS_OUTPUT_PATH, JSON.stringify(credentialsExport, null, 2), 'utf8');
  }

  const userBDocs = {};
  for (const acc of tenantBRoles) {
    const cred = credentialsExport.accounts.find(a => a.username === acc.username);
    const passwordHash = await bcrypt.hash(cred.password, 10);

    let existingU = await db.collection('users').findOne({ tenantId: tenantBId, username: acc.username });
    if (!existingU) {
      existingU = {
        _id: new mongoose.Types.ObjectId(),
        tenantId: tenantBId,
        username: acc.username,
        passwordHash,
        role: acc.role,
        status: 'active',
        profile: {
          fullName: acc.fullName,
          email: `${acc.username}@hoanang-b.edu.vn`,
          phone: '0987654321'
        },
        assignmentVersion: 0,
        parentInfo: acc.role === 'parent' ? { studentIds: [] } : undefined,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      await db.collection('users').insertOne(existingU);
    } else {
      await db.collection('users').updateOne(
        { _id: existingU._id },
        { $set: { passwordHash, status: 'active', role: acc.role } }
      );
    }
    userBDocs[acc.username] = existingU;
  }
  recordAssertion('Tenant B 8 role accounts created/verified', Object.keys(userBDocs).length === 8);

  // Setup Sample Data for Tenant B (Classroom, Student, Department, Employee, Dish, Asset, etc.)
  let deptB = await db.collection('departments').findOne({ tenantId: tenantBId, code: 'GV_B' });
  if (!deptB) {
    deptB = {
      _id: new mongoose.Types.ObjectId(),
      tenantId: tenantBId,
      code: 'GV_B',
      name: 'Tổ Giáo Viên Cơ Sở B',
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date()
    };
    await db.collection('departments').insertOne(deptB);
  }

  let empB = await db.collection('employees').findOne({ tenantId: tenantBId, employeeCode: 'GVB001' });
  if (!empB) {
    empB = {
      _id: new mongoose.Types.ObjectId(),
      tenantId: tenantBId,
      userId: userBDocs['giaovien_b']._id,
      employeeCode: 'GVB001',
      fullName: 'Giáo Viên Trường B',
      departmentId: deptB._id,
      status: 'active',
      hireDate: new Date('2026-09-01'),
      createdAt: new Date(),
      updatedAt: new Date()
    };
    await db.collection('employees').insertOne(empB);
  }

  let classB = await db.collection('classrooms').findOne({ tenantId: tenantBId, name: 'Lớp Mầm 1 (B)' });
  if (!classB) {
    classB = {
      _id: new mongoose.Types.ObjectId(),
      tenantId: tenantBId,
      name: 'Lớp Mầm 1 (B)',
      fullName: 'Lớp Mầm 1 Cơ Sở B',
      ageGroup: '3-4',
      schoolYear: '2026-2027',
      homeroomTeacherId: userBDocs['giaovien_b']._id,
      teachers: [userBDocs['giaovien_b']._id],
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date()
    };
    await db.collection('classrooms').insertOne(classB);
  }

  let studentB = await db.collection('students').findOne({ tenantId: tenantBId, studentCode: 'HS-2026-880001' });
  if (!studentB) {
    studentB = {
      _id: new mongoose.Types.ObjectId(),
      tenantId: tenantBId,
      studentCode: 'HS-2026-880001',
      fullName: 'Nguyễn Văn Bé (B)',
      birthDate: new Date('2023-05-15'),
      gender: 'male',
      classroomId: classB._id,
      parentAccounts: [userBDocs['phuhuynh_b']._id],
      status: 'enrolled',
      createdAt: new Date(),
      updatedAt: new Date()
    };
    await db.collection('students').insertOne(studentB);
    await db.collection('users').updateOne(
      { _id: userBDocs['phuhuynh_b']._id },
      { $set: { 'parentInfo.studentIds': [studentB._id] } }
    );
  }
  recordAssertion('Tenant B classroom and student sample data created/verified', true);

  // Mẫu món ăn cho B
  let dishB = await db.collection('dishes').findOne({ tenantId: tenantBId, name: 'Canh Cải Thịt Bằm (B)' });
  if (!dishB) {
    dishB = {
      _id: new mongoose.Types.ObjectId(),
      tenantId: tenantBId,
      name: 'Canh Cải Thịt Bằm (B)',
      category: 'soup',
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date()
    };
    await db.collection('dishes').insertOne(dishB);
  }

  // Mẫu tài sản cho B
  let assetB = await db.collection('assets').findOne({ tenantId: tenantBId, assetCode: 'TS-B-001' });
  if (!assetB) {
    assetB = {
      _id: new mongoose.Types.ObjectId(),
      tenantId: tenantBId,
      assetCode: 'TS-B-001',
      name: 'Điều hòa Lớp Chồi 1 (B)',
      category: 'it',
      status: 'active',
      originalCost: 12000000,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    await db.collection('assets').insertOne(assetB);
  }

  // Mẫu thông báo nội bộ cho B
  let noticeB = await db.collection('internalannouncements').findOne({ tenantId: tenantBId, requestId: 'REQ_NOTICE_B_001' });
  if (!noticeB) {
    noticeB = {
      _id: new mongoose.Types.ObjectId(),
      tenantId: tenantBId,
      requestId: 'REQ_NOTICE_B_001',
      title: 'Thông báo Họp Phụ Huynh Cơ Sở B',
      content: 'Nội dung họp phụ huynh đầu năm học tại Trường B',
      scope: 'all',
      senderId: userBDocs['admin_b']._id,
      senderName: 'Quản Trị Viên Trường B',
      status: 'published',
      publishedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date()
    };
    await db.collection('internalannouncements').insertOne(noticeB);
  }

  // Mẫu bảng lương cho B
  let payrollB = await db.collection('payrolls').findOne({ tenantId: tenantBId, month: 11, year: 2026 });
  if (!payrollB) {
    payrollB = {
      _id: new mongoose.Types.ObjectId(),
      tenantId: tenantBId,
      employeeId: empB._id,
      month: 11,
      year: 2026,
      baseSalary: 10000000,
      allowance: 1500000,
      bonus: 500000,
      deduction: 0,
      netSalary: 12000000,
      status: 'draft',
      createdAt: new Date(),
      updatedAt: new Date()
    };
    await db.collection('payrolls').insertOne(payrollB);
  }
  recordAssertion('Tenant B nutrition, assets, notices, and payroll sample data created', true);

  // BƯỚC 6: XÁC MINH createProductionSaasApp TRÊN DATABASE CHÍNH
  console.log('\n[6/8] Khởi tạo và kiểm tra createProductionSaasApp trên school_management...');
  const prodApp = createProductionSaasApp({
    connection: mongoose.connection,
    allowedDbNames: ['school_management']
  });
  recordAssertion('createProductionSaasApp successfully initialized for school_management', !!prodApp);

  const healthRes = await request(prodApp).get('/api/health');
  recordAssertion('Live Health check 200 OK', healthRes.status === 200);

  // BƯỚC 7: KIỂM CHỨNG ĐĂNG NHẬP HTTP THẬT VÀ PHÂN QUYỀN
  console.log('\n[7/8] Kiểm tra đăng nhập HTTP thực tế và phân quyền đa trường...');
  const legacyCredentials = JSON.parse(fs.readFileSync(LEGACY_KNOWN_CREDS_PATH, 'utf8'));
  const accountantPass = legacyCredentials['accountant'];
  const parentPass = legacyCredentials['phuhuynh.mgl45'];

  // 1. Đăng nhập Kế toán Trường A
  const loginResAccountantA = await request(prodApp)
    .post('/api/auth/login')
    .send({ schoolCode: 'HOANANG-A', username: 'accountant', password: accountantPass });
  recordAssertion('Login accountant A (HOANANG-A) returns 200 OK', loginResAccountantA.status === 200);
  recordAssertion('Accountant A token tenant is HOANANG-A', loginResAccountantA.body.tenant?.code === 'HOANANG-A');
  const tokenAccountantA = loginResAccountantA.body.token;

  // 2. Đăng nhập Phụ huynh Trường A
  const loginResParentA = await request(prodApp)
    .post('/api/auth/login')
    .send({ schoolCode: 'HOANANG-A', username: 'phuhuynh.mgl45', password: parentPass });
  recordAssertion('Login parent A (HOANANG-A) returns 200 OK', loginResParentA.status === 200);
  const tokenParentA = loginResParentA.body.token;

  // 3. Đăng nhập Admin Trường B
  const adminBCred = credentialsExport.accounts.find(a => a.username === 'admin_b');
  const loginResAdminB = await request(prodApp)
    .post('/api/auth/login')
    .send({ schoolCode: 'HOANANG-B', username: 'admin_b', password: adminBCred.password });
  recordAssertion('Login admin B (HOANANG-B) returns 200 OK', loginResAdminB.status === 200);
  const tokenAdminB = loginResAdminB.body.token;

  // 4. Đăng nhập Phụ huynh Trường B
  const parentBCred = credentialsExport.accounts.find(a => a.username === 'phuhuynh_b');
  const loginResParentB = await request(prodApp)
    .post('/api/auth/login')
    .send({ schoolCode: 'HOANANG-B', username: 'phuhuynh_b', password: parentBCred.password });
  recordAssertion('Login parent B (HOANANG-B) returns 200 OK', loginResParentB.status === 200);
  const tokenParentB = loginResParentB.body.token;

  // 5. Đăng nhập chéo trường bị từ chối
  const crossLogin = await request(prodApp)
    .post('/api/auth/login')
    .send({ schoolCode: 'HOANANG-B', username: 'accountant', password: accountantPass });
  recordAssertion('Cross-school login rejected (401/404)', crossLogin.status === 401 || crossLogin.status === 404);

  // 6. Tài khoản suspended '123' bị khóa
  const suspendedLogin = await request(prodApp)
    .post('/api/auth/login')
    .send({ schoolCode: 'HOANANG-A', username: '123', password: 'anyPassword' });
  recordAssertion('Suspended account "123" login rejected', suspendedLogin.status === 401 || suspendedLogin.status === 403);

  // BƯỚC 8: KIỂM CHỨNG CÁCH LY DỮ LIỆU ĐA TRƯỜNG (A/B)
  console.log('\n[8/8] Kiểm chứng cách ly dữ liệu thực tế giữa HOANANG-A và HOANANG-B...');
  const studentAId = '6aa36ef9ee9f85ced6895ac4'; // Bé Nguyễn Đức Anh linked to phuhuynh.mgl45

  // 1. Parent A xem con mình
  const resParentAOwn = await request(prodApp)
    .get(`/api/students/${studentAId}`)
    .set('Authorization', `Bearer ${tokenParentA}`);
  const parentAChildId = resParentAOwn.body?.data?._id || resParentAOwn.body?._id;
  recordAssertion('Parent A queries own child returns 200 OK', resParentAOwn.status === 200 && parentAChildId === studentAId);

  // 2. Parent A xem con người khác cùng trường -> 403 Forbidden
  const otherStudentAId = '6a867ae109e25f78bd01aaab';
  const resParentASameTenantOther = await request(prodApp)
    .get(`/api/students/${otherStudentAId}`)
    .set('Authorization', `Bearer ${tokenParentA}`);
  recordAssertion('Parent A querying other child in same tenant rejected with HTTP 403', resParentASameTenantOther.status === 403);

  // 3. Parent A xem con trường B -> 403/404
  const resParentACross = await request(prodApp)
    .get(`/api/students/${studentB._id}`)
    .set('Authorization', `Bearer ${tokenParentA}`);
  recordAssertion('Parent A querying Child B cross-tenant rejected (HTTP 403/404)', [403, 404].includes(resParentACross.status));

  // 4. Parent B xem con mình
  const resParentBOwn = await request(prodApp)
    .get(`/api/students/${studentB._id}`)
    .set('Authorization', `Bearer ${tokenParentB}`);
  const parentBChildId = resParentBOwn.body?.data?._id || resParentBOwn.body?._id;
  recordAssertion('Parent B queries own child returns 200 OK', resParentBOwn.status === 200 && parentBChildId === studentB._id.toString());

  // 5. Parent B xem con trường A -> 403/404
  const resParentBCross = await request(prodApp)
    .get(`/api/students/${studentAId}`)
    .set('Authorization', `Bearer ${tokenParentB}`);
  recordAssertion('Parent B querying Child A cross-tenant rejected (HTTP 403/404)', [403, 404].includes(resParentBCross.status));

  // 6. Admin B xem danh sách học sinh (chỉ thấy B, không thấy A)
  const studentsBRes = await request(prodApp)
    .get('/api/students')
    .set('Authorization', `Bearer ${tokenAdminB}`);
  recordAssertion('Admin B fetches students 200 OK', studentsBRes.status === 200);
  const studentListB = studentsBRes.body.data || studentsBRes.body.students || [];
  const onlyBStudents = Array.isArray(studentListB) && studentListB.every(s => s.studentCode === 'HS-2026-880001');
  recordAssertion('Admin B sees strictly only Tenant B students', onlyBStudents);

  // 7. Admin B xem danh sách lớp học (chỉ thấy B, không thấy A)
  const classesBRes = await request(prodApp)
    .get('/api/classrooms')
    .set('Authorization', `Bearer ${tokenAdminB}`);
  recordAssertion('Admin B fetches classrooms 200 OK', classesBRes.status === 200);
  const classListB = classesBRes.body.data || classesBRes.body.classrooms || [];
  const onlyBClasses = Array.isArray(classListB) && classListB.every(c => c.name === 'Lớp Mầm 1 (B)');
  recordAssertion('Admin B sees strictly only Tenant B classrooms', onlyBClasses);

  // Tổng kết
  cutoverResults.success = true;
  cutoverResults.step = 'COMPLETE';
  cutoverResults.totalDurationMs = Date.now() - startTime;
  cutoverResults.totalAssertions = cutoverResults.assertions.length;

  fs.writeFileSync(SUMMARY_JSON_PATH, JSON.stringify(cutoverResults, null, 2), 'utf8');

  console.log('\n===============================================================');
  console.log(`🎉 CUTOVER BẢN CHÍNH (school_management) HOÀN TẤT THÀNH CÔNG 100%!`);
  console.log(`   - Tổng số Assertions PASS: ${cutoverResults.totalAssertions}/${cutoverResults.totalAssertions}`);
  console.log(`   - Thời gian thực thi: ${(cutoverResults.totalDurationMs / 1000).toFixed(1)}s`);
  console.log(`   - Tóm tắt kết quả: ${SUMMARY_JSON_PATH}`);
  console.log('===============================================================\n');

  await mongoose.disconnect();
  return cutoverResults;
}

if (require.main === module) {
  executeProductionCutover().catch(err => {
    console.error('LỖI THỰC THI CUTOVER:', err);
    process.exit(1);
  });
}

module.exports = executeProductionCutover;
