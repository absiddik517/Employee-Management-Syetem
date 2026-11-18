/**
 * Single source of truth for EMS roles, permissions, and scope enforcement.
 * Mirrors the exact logic enforced on the server in `firestore.rules` and `storage.rules`.
 *
 * Pure JavaScript with zero framework or Firebase SDK dependencies so it can be
 * imported in React UI, router guards, Node unit tests, and migration scripts.
 *
 * Supports dynamic role-permission overrides loaded from Firestore `settings/permissions`
 * via `setPermissionOverrides(overrides)` or explicit override arguments.
 */

export const ROLES = Object.freeze({
  super_admin: Object.freeze({
    key: 'super_admin',
    label: 'Super Admin',
    rank: 100,
    defaultScope: 'all'
  }),
  director_general: Object.freeze({
    key: 'director_general',
    label: 'Director General',
    rank: 90,
    defaultScope: 'all'
  }),
  head_office_officer: Object.freeze({
    key: 'head_office_officer',
    label: 'Head Office Officer',
    rank: 80,
    defaultScope: 'all'
  }),
  assistant_director: Object.freeze({
    key: 'assistant_director',
    label: 'Assistant Director',
    rank: 60,
    defaultScope: 'subtree'
  }),
  unfeo: Object.freeze({
    key: 'unfeo',
    label: 'UNFEO',
    rank: 40,
    defaultScope: 'office'
  }),
  employee: Object.freeze({
    key: 'employee',
    label: 'Employee',
    rank: 10,
    defaultScope: 'self'
  })
});

export const ROLE_KEYS = Object.freeze(Object.keys(ROLES));

export const ROLE_LIST = Object.freeze(
  Object.values(ROLES).sort((a, b) => b.rank - a.rank)
);

/**
 * Legacy role names preserved during migration.
 * Remove legacy values only after running `scripts/migrate-roles.mjs --apply`.
 */
export const LEGACY_ROLE_MAP = Object.freeze({
  head_office: 'director_general',
  district_officer: 'assistant_director',
  office_head: 'unfeo'
});

export const VALID_SCOPE_VALUES = Object.freeze(['none', 'self', 'office', 'subtree', 'all']);

/**
 * Default permission matrix object.
 * Runtime overrides from Firestore `settings/permissions` overlay on top of this object.
 */
export const DEFAULT_PERMISSIONS = Object.freeze({
  'attendance.checkin': {
    employee: 'self',
    unfeo: 'self',
    assistant_director: 'self',
    director_general: 'self',
    head_office_officer: 'self'
  },
  'attendance.view': {
    employee: 'self',
    unfeo: 'office',
    assistant_director: 'subtree',
    super_admin: 'all',
    director_general: 'all',
    head_office_officer: 'all'
  },
  'attendance.settle': {
    assistant_director: 'subtree'
  },
  'attendance.photo.view': {
    unfeo: 'office',
    assistant_director: 'subtree',
    super_admin: 'all'
  },
  'attendance.photo.purge': {
    super_admin: 'all'
  },
  'leave.apply': {
    employee: 'self',
    unfeo: 'self',
    assistant_director: 'self',
    director_general: 'self',
    head_office_officer: 'self'
  },
  'fieldduty.apply': {
    employee: 'self',
    unfeo: 'self',
    assistant_director: 'self',
    director_general: 'self',
    head_office_officer: 'self'
  },
  'leave.review': {
    unfeo: { scope: 'office', applicantRoles: ['employee'] },
    assistant_director: 'subtree',
    director_general: { scope: 'all', applicantRoles: ['assistant_director'] }
  },
  'fieldduty.review': {
    assistant_director: { scope: 'subtree', applicantRoles: ['employee', 'unfeo'] }
  },
  'report.create': {
    unfeo: 'office',
    assistant_director: 'subtree'
  },
  'report.view': {
    unfeo: 'office',
    assistant_director: 'subtree',
    super_admin: 'all',
    director_general: 'all',
    head_office_officer: 'all'
  },
  'user.view': {
    unfeo: 'office',
    assistant_director: 'subtree',
    super_admin: 'all',
    director_general: 'all',
    head_office_officer: 'all'
  },
  'user.approve': {
    unfeo: 'office',
    assistant_director: 'subtree',
    super_admin: 'all'
  },
  'user.resetDevice': {
    unfeo: 'office',
    assistant_director: 'subtree',
    super_admin: 'all'
  },
  'user.edit': {
    assistant_director: 'subtree',
    super_admin: 'all'
  },
  'user.role.assign': {
    assistant_director: { scope: 'subtree', lowerRankOnly: true },
    super_admin: 'all'
  },
  'user.delete': {
    super_admin: 'all'
  },
  'office.manage': {
    super_admin: 'all'
  },
  'holiday.manage': {
    super_admin: 'all'
  },
  'settings.manage': {
    super_admin: 'all'
  },
  'audit.view': {
    assistant_director: 'subtree',
    super_admin: 'all',
    director_general: 'all'
  }
});

// Alias kept for backward compatibility with existing callers & tests
export const PERMISSIONS = DEFAULT_PERMISSIONS;

export const PERMISSION_KEYS = Object.freeze(Object.keys(DEFAULT_PERMISSIONS));

export const PERMISSION_DEFINITIONS = Object.freeze([
  // Attendance
  {
    key: 'attendance.checkin',
    category: 'Attendance',
    label: 'Daily Check-In / Check-Out',
    description: 'Punch daily attendance with selfie and GPS location.',
    allowedScopes: ['none', 'self']
  },
  {
    key: 'attendance.view',
    category: 'Attendance',
    label: 'View Attendance Records',
    description: 'View attendance logs within the assigned scope.',
    allowedScopes: ['none', 'self', 'office', 'subtree', 'all']
  },
  {
    key: 'attendance.settle',
    category: 'Attendance',
    label: 'Settle Attendance',
    description: 'Finalize attendance statuses and clear daily selfies.',
    allowedScopes: ['none', 'office', 'subtree', 'all']
  },
  {
    key: 'attendance.photo.view',
    category: 'Attendance',
    label: 'View Attendance Selfies',
    description: 'Inspect check-in and check-out selfies in Storage.',
    allowedScopes: ['none', 'office', 'subtree', 'all']
  },
  {
    key: 'attendance.photo.purge',
    category: 'Attendance',
    label: 'Purge Old Selfies',
    description: 'Delete unsettled attendance photos older than 15 days.',
    allowedScopes: ['none', 'all']
  },
  // Leave & Field Duty
  {
    key: 'leave.apply',
    category: 'Leave & Field Duty',
    label: 'Apply for Leave',
    description: 'Submit personal leave applications.',
    allowedScopes: ['none', 'self']
  },
  {
    key: 'leave.review',
    category: 'Leave & Field Duty',
    label: 'Review Leave Requests',
    description: 'Approve or reject leave applications from lower-rank staff.',
    allowedScopes: ['none', 'office', 'subtree', 'all']
  },
  {
    key: 'fieldduty.apply',
    category: 'Leave & Field Duty',
    label: 'Request Field Duty',
    description: 'Submit personal field duty requests for geofence bypass.',
    allowedScopes: ['none', 'self']
  },
  {
    key: 'fieldduty.review',
    category: 'Leave & Field Duty',
    label: 'Review Field Duty Requests',
    description: 'Approve or reject field duty requests from lower-rank staff.',
    allowedScopes: ['none', 'office', 'subtree', 'all']
  },
  // Reports
  {
    key: 'report.create',
    category: 'Reports',
    label: 'Generate & Submit Reports',
    description: 'Generate monthly attendance summaries and submit reports.',
    allowedScopes: ['none', 'office', 'subtree', 'all']
  },
  {
    key: 'report.view',
    category: 'Reports',
    label: 'View Submitted Reports',
    description: 'Read submitted monthly office reports and export CSV.',
    allowedScopes: ['none', 'office', 'subtree', 'all']
  },
  // Users & Devices
  {
    key: 'user.view',
    category: 'Users & Devices',
    label: 'View Staff Directory',
    description: 'View user profiles and bound device details in scope.',
    allowedScopes: ['none', 'office', 'subtree', 'all']
  },
  {
    key: 'user.approve',
    category: 'Users & Devices',
    label: 'Approve / Reject Registrations',
    description: 'Approve or reject pending staff account registrations.',
    allowedScopes: ['none', 'office', 'subtree', 'all']
  },
  {
    key: 'user.resetDevice',
    category: 'Users & Devices',
    label: 'Reset Bound Device',
    description: 'Clear bound device lock so staff can re-bind a new device.',
    allowedScopes: ['none', 'office', 'subtree', 'all']
  },
  {
    key: 'user.edit',
    category: 'Users & Devices',
    label: 'Edit User Profiles',
    description: 'Create/link users (All scope) or edit user details and status.',
    allowedScopes: ['none', 'office', 'subtree', 'all']
  },
  {
    key: 'user.role.assign',
    category: 'Users & Devices',
    label: 'Assign User Roles',
    description: 'Change user roles (strictly lower rank for non-Super Admin).',
    allowedScopes: ['none', 'office', 'subtree', 'all']
  },
  {
    key: 'user.delete',
    category: 'Users & Devices',
    label: 'Delete User Profiles',
    description: 'Delete non-Super Admin user profile documents.',
    allowedScopes: ['none', 'all']
  },
  // System & Audit
  {
    key: 'office.manage',
    category: 'System & Audit',
    label: 'Manage Offices',
    description: 'Create, update, and delete Head/District/Upazila offices.',
    allowedScopes: ['none', 'all']
  },
  {
    key: 'holiday.manage',
    category: 'System & Audit',
    label: 'Manage Holidays',
    description: 'Add or remove official government holidays.',
    allowedScopes: ['none', 'all']
  },
  {
    key: 'settings.manage',
    category: 'System & Audit',
    label: 'Manage System & Role Permissions',
    description: 'Toggle public registration and customize role permissions.',
    allowedScopes: ['none', 'all'],
    lockedForSuperAdmin: true
  },
  {
    key: 'audit.view',
    category: 'System & Audit',
    label: 'View Audit Trail',
    description: 'Inspect immutable administrative and settlement audit logs.',
    allowedScopes: ['none', 'office', 'subtree', 'all']
  }
]);

const PERMISSION_META_MAP = Object.freeze(
  Object.fromEntries(PERMISSION_DEFINITIONS.map((def) => [def.key, def]))
);

const STRICT_HIERARCHY_PERMISSIONS = new Set([
  'leave.review',
  'fieldduty.review',
  'attendance.settle'
]);

const NON_SELF_ADMIN_PERMISSIONS = new Set([
  'user.approve',
  'user.resetDevice',
  'user.edit',
  'user.role.assign'
]);

let runtimePermissionOverrides = {};

export function sanitizePermissionOverrides(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const cleaned = {};
  for (const roleKey of ROLE_KEYS) {
    const roleMap = raw[roleKey];
    if (!roleMap || typeof roleMap !== 'object') continue;
    const cleanedRole = {};
    for (const permKey of PERMISSION_KEYS) {
      const val = roleMap[permKey];
      if (typeof val !== 'string') continue;
      const meta = PERMISSION_META_MAP[permKey];
      if (!meta || !meta.allowedScopes.includes(val)) continue;
      if (roleKey === ROLES.super_admin.key && meta.lockedForSuperAdmin && val !== 'all') {
        continue;
      }
      const defaultScope = getDefaultPermissionScope(roleKey, permKey) || 'none';
      if (val !== defaultScope) {
        cleanedRole[permKey] = val;
      }
    }
    if (Object.keys(cleanedRole).length > 0) {
      cleaned[roleKey] = cleanedRole;
    }
  }
  return cleaned;
}

export function setPermissionOverrides(overrides) {
  runtimePermissionOverrides = sanitizePermissionOverrides(overrides);
  return runtimePermissionOverrides;
}

export function getPermissionOverrides() {
  return runtimePermissionOverrides;
}

export function normalizeRole(role) {
  if (typeof role !== 'string') return null;
  const trimmed = role.trim();
  if (!trimmed) return null;
  const mapped = LEGACY_ROLE_MAP[trimmed] || trimmed;
  return Object.prototype.hasOwnProperty.call(ROLES, mapped) ? mapped : null;
}

export function getRoleMeta(role) {
  const normalized = normalizeRole(role);
  return normalized ? ROLES[normalized] : null;
}

export function getRoleLabel(role) {
  return getRoleMeta(role)?.label || (typeof role === 'string' && role.trim() ? role : 'Employee');
}

export function rankOf(role) {
  return getRoleMeta(role)?.rank ?? 0;
}

export function getUserOfficeScopeIds(user) {
  if (!user) return [];
  const ids = [];
  if (typeof user.officeId === 'string' && user.officeId.trim()) {
    ids.push(user.officeId.trim());
  }
  if (Array.isArray(user.additionalOfficeIds)) {
    for (const id of user.additionalOfficeIds) {
      if (typeof id === 'string' && id.trim() && !ids.includes(id.trim())) {
        ids.push(id.trim());
      }
    }
  }
  return ids;
}

function isApprovedAndActive(user) {
  if (!user) return false;
  if ('approvalStatus' in user && user.approvalStatus != null && user.approvalStatus !== 'approved') {
    return false;
  }
  if ('status' in user && user.status != null && user.status !== 'active') {
    return false;
  }
  return true;
}

function parseGrant(grant) {
  if (!grant) return null;
  if (typeof grant === 'string') {
    if (grant === 'none') return null;
    return { scope: grant, applicantRoles: null, lowerRankOnly: false };
  }
  return {
    scope: grant.scope,
    applicantRoles: Array.isArray(grant.applicantRoles) ? grant.applicantRoles : null,
    lowerRankOnly: Boolean(grant.lowerRankOnly)
  };
}

export function getDefaultPermissionScope(role, permission) {
  const normalized = normalizeRole(role);
  if (!normalized) return '';
  const map = DEFAULT_PERMISSIONS[permission];
  if (!map) return '';
  return parseGrant(map[normalized])?.scope || '';
}

export function getEffectiveRoleScope(role, permission, overrides = runtimePermissionOverrides) {
  const normalized = normalizeRole(role);
  if (!normalized) return '';
  const overrideVal = overrides?.[normalized]?.[permission];
  if (typeof overrideVal === 'string') {
    return overrideVal === 'none' ? '' : overrideVal;
  }
  return getDefaultPermissionScope(normalized, permission);
}

export function getPermissionGrant(user, permission, overrides = runtimePermissionOverrides) {
  const role = normalizeRole(user?.role);
  if (!role || !isApprovedAndActive(user)) return null;
  const map = DEFAULT_PERMISSIONS[permission];
  if (!map) return null;

  const overrideVal = overrides?.[role]?.[permission];
  if (typeof overrideVal === 'string') {
    if (overrideVal === 'none') return null;
    if (PERMISSION_META_MAP[permission]?.allowedScopes.includes(overrideVal)) {
      return {
        scope: overrideVal,
        applicantRoles: null,
        lowerRankOnly: permission === 'user.role.assign' && role !== ROLES.super_admin.key
      };
    }
  }

  return parseGrant(map[role]);
}

export function getPermissionScope(user, permission, overrides = runtimePermissionOverrides) {
  return getPermissionGrant(user, permission, overrides)?.scope || null;
}

function matchesScope(user, scope, target) {
  if (!target) return true;
  if (scope === 'all') return true;

  const userUid = user.uid || user.id || '';
  const targetUid = target.uid ?? target.id ?? target.employeeUid ?? '';

  if (scope === 'self') {
    if (!targetUid) return true;
    return Boolean(userUid) && targetUid === userUid;
  }

  const officeIds = new Set(getUserOfficeScopeIds(user));
  if (officeIds.size === 0) return false;

  const targetOfficeId = target.officeId || '';
  if (scope === 'office') {
    return Boolean(targetOfficeId) && officeIds.has(targetOfficeId);
  }

  if (scope === 'subtree') {
    if (targetOfficeId && officeIds.has(targetOfficeId)) return true;
    if (target.districtOfficeId && officeIds.has(target.districtOfficeId)) return true;
    if (target.parentOfficeId && officeIds.has(target.parentOfficeId)) return true;
    return false;
  }

  return false;
}

/**
 * Evaluate whether `user` holds `permission`, optionally scoped against `target`.
 */
export function can(user, permission, target, overrides = runtimePermissionOverrides) {
  const role = normalizeRole(user?.role);
  const grant = getPermissionGrant(user, permission, overrides);
  if (!role || !grant) return false;

  if (!matchesScope(user, grant.scope, target)) {
    return false;
  }

  if (!target) {
    return true;
  }

  const userUid = user.uid || user.id || '';
  const targetUid = target.uid ?? target.id ?? target.employeeUid ?? '';
  const isSelfTarget = Boolean(userUid && targetUid && userUid === targetUid);

  if (STRICT_HIERARCHY_PERMISSIONS.has(permission)) {
    if (isSelfTarget) return false;
    const rawApplicantRole = target.applicantRole ?? target.role;
    if (rawApplicantRole != null) {
      const applicantRole = normalizeRole(rawApplicantRole);
      if (!applicantRole) return false;
      if (rankOf(role) <= rankOf(applicantRole)) return false;
      if (grant.applicantRoles && !grant.applicantRoles.includes(applicantRole)) {
        return false;
      }
    }
  }

  if (NON_SELF_ADMIN_PERMISSIONS.has(permission) && role !== ROLES.super_admin.key) {
    if (isSelfTarget) return false;
    const rawTargetRole = target.currentRole ?? target.role;
    if (rawTargetRole != null) {
      const targetRole = normalizeRole(rawTargetRole);
      if (!targetRole || rankOf(role) <= rankOf(targetRole)) {
        return false;
      }
    }
  }

  if (permission === 'user.role.assign') {
    const rawNewRole = target.newRole ?? target.targetRole ?? target.role;
    if (grant.lowerRankOnly && rawNewRole != null) {
      const newRole = normalizeRole(rawNewRole);
      if (!newRole || rankOf(role) <= rankOf(newRole)) {
        return false;
      }
    }
    if (
      role === ROLES.super_admin.key &&
      isSelfTarget &&
      rawNewRole != null &&
      normalizeRole(rawNewRole) !== ROLES.super_admin.key
    ) {
      return false;
    }
  }

  if (permission === 'user.delete') {
    if (isSelfTarget) return false;
    if (normalizeRole(target.role) === ROLES.super_admin.key) return false;
  }

  return true;
}

/**
 * Evaluate whether `reviewer` can approve/reject/settle `applicant`'s item.
 * Enforces permission, scope, never-self, and strictly-higher-rank chain.
 */
export function canReview(reviewer, applicant, kind = 'leave', overrides = runtimePermissionOverrides) {
  const perm =
    kind === 'fieldduty'
      ? 'fieldduty.review'
      : kind === 'attendance'
      ? 'attendance.settle'
      : 'leave.review';

  if (!reviewer || !applicant) return false;

  const target = {
    uid: applicant.uid ?? applicant.employeeUid ?? applicant.id ?? '',
    officeId: applicant.officeId ?? '',
    districtOfficeId: applicant.districtOfficeId ?? '',
    applicantRole: applicant.applicantRole ?? applicant.role ?? null
  };

  if (!target.applicantRole) {
    return false;
  }

  return can(reviewer, perm, target, overrides);
}

/**
 * List role definitions that `user` is permitted to assign.
 */
export function assignableRoles(user, overrides = runtimePermissionOverrides) {
  const role = normalizeRole(user?.role);
  const grant = getPermissionGrant(user, 'user.role.assign', overrides);
  if (!role || !grant) return [];

  const callerRank = rankOf(role);
  return ROLE_LIST.filter((r) => !grant.lowerRankOnly || r.rank < callerRank);
}

/**
 * Resolve home route path for a user profile using their role metadata/permissions.
 */
export function getHomePathForUser(user, hasSelectedOffice = true) {
  if (!user) return '/login';
  if (user.approvalStatus && user.approvalStatus !== 'approved') return '/pending';

  const meta = getRoleMeta(user.role);
  if (!meta) return '/login';

  if (meta.key === ROLES.super_admin.key) return '/admin';
  if (meta.key === ROLES.director_general.key || meta.key === ROLES.head_office_officer.key) {
    return '/head-office';
  }
  if (meta.key === ROLES.assistant_director.key) {
    return hasSelectedOffice ? '/district' : '/select-office';
  }
  if (meta.key === ROLES.unfeo.key) {
    return hasSelectedOffice ? '/office-head' : '/select-office';
  }
  return '/employee';
}

export function canSelectMultipleOffices(user, assignedCount, overrides = runtimePermissionOverrides) {
  const scope = getPermissionScope(user, 'report.create', overrides);
  return (scope === 'subtree' || scope === 'office') && assignedCount > 1;
}

export function getApproverHint(applicantRole, kind = 'leave') {
  const normalized = normalizeRole(applicantRole);
  if (kind === 'fieldduty' || kind === 'attendance') {
    if (normalized === ROLES.assistant_director.key) return 'প্রধান কার্যালয় (প্রযোজ্য ক্ষেত্রে)';
    return 'সহকারী পরিচালক (Assistant Director)';
  }
  if (normalized === ROLES.employee.key) {
    return 'UNFEO বা সহকারী পরিচালক (Assistant Director)';
  }
  if (normalized === ROLES.unfeo.key) {
    return 'সহকারী পরিচালক (Assistant Director)';
  }
  if (normalized === ROLES.assistant_director.key) {
    return 'মহাপরিচালক (Director General)';
  }
  return 'অনুমোদনকারী কর্তৃপক্ষ';
}
