/**
 * Single source of truth for dynamic EMS roles, permissions, scope enforcement,
 * acting-role grants, approval chains, and A/V/W office set derivation.
 *
 * Pure JavaScript with zero framework or Firebase SDK dependencies so it can be
 * imported in React UI, router guards, Node unit tests, and migration scripts.
 *
 * Zero roles are hard-coded here. Roles exist strictly as data documents in
 * Firestore `roles/{roleKey}` and are injected via `setRoleRegistry(...)` or
 * passed explicitly to helper functions for isolated unit testing.
 */

export const VALID_SCOPE_VALUES = Object.freeze(['none', 'self', 'office', 'subtree', 'all']);
export const REVIEW_KINDS = Object.freeze(['leave', 'fieldduty', 'settle']);
export const REVIEW_SCOPES = Object.freeze(['office', 'subtree', 'all']);
export const HOME_ROUTES = Object.freeze(['admin', 'district', 'office-head', 'head-office', 'employee']);
export const ROLE_KEY_REGEX = /^[a-z][a-z0-9_]{1,39}$/;

export const BOOTSTRAP_SUPER_EMAILS = Object.freeze([
  'absiddik5177@gmail.com',
  'absiddik517@gmail.com'
]);

/**
 * Implicit capability set (all with scope 'all') for the bootstrap super user identity.
 * Contains no business workflow permissions (check-in, apply, review, settle, report.create)
 * unless the bootstrap user assigns themselves a role in the Role Manager.
 */
export const SUPER_IMPLICIT_PERMISSIONS = Object.freeze([
  'settings.manage',
  'office.manage',
  'holiday.manage',
  'user.view',
  'user.create',
  'user.edit',
  'user.approve',
  'user.resetDevice',
  'user.role.assign',
  'user.delete',
  'assignment.manage',
  'audit.view',
  'attendance.photo.purge'
]);

const SUPER_IMPLICIT_SET = new Set(SUPER_IMPLICIT_PERMISSIONS);

/**
 * Permissions an acting role may contribute (strictly evaluated over actingOfficeId
 * with scope 'office' or 'subtree' only; stored 'all'/'self' is ignored).
 */
export const ACTING_ALLOWED_PERMISSIONS = Object.freeze([
  'attendance.view',
  'attendance.photo.view',
  'leave.view',
  'report.create',
  'report.view',
  'user.view',
  'user.approve',
  'user.resetDevice',
  'audit.view'
]);

const ACTING_ALLOWED_SET = new Set(ACTING_ALLOWED_PERMISSIONS);

export const DERIVED_REVIEW_PERMISSION_KEYS = Object.freeze([
  'leave.review',
  'fieldduty.review',
  'attendance.settle'
]);

export const PERMISSION_DEFINITIONS = Object.freeze([
  // Attendance
  {
    key: 'attendance.checkin',
    category: 'Attendance',
    label: 'Daily Check-In / Check-Out',
    description: 'Punch daily attendance with selfie and GPS location at valid offices.',
    allowedScopes: ['none', 'self'],
    actingAllowed: false
  },
  {
    key: 'attendance.view',
    category: 'Attendance',
    label: 'View Attendance Records',
    description: 'View attendance logs within the assigned scope.',
    allowedScopes: ['none', 'self', 'office', 'subtree', 'all'],
    actingAllowed: true
  },
  {
    key: 'attendance.photo.view',
    category: 'Attendance',
    label: 'View Attendance Selfies',
    description: 'Inspect check-in and check-out selfies in Storage.',
    allowedScopes: ['none', 'office', 'subtree', 'all'],
    actingAllowed: true
  },
  {
    key: 'attendance.photo.purge',
    category: 'Attendance',
    label: 'Purge Old Selfies',
    description: 'Delete unsettled attendance photos older than 15 days.',
    allowedScopes: ['none', 'all'],
    actingAllowed: false
  },
  // Leave & Field Duty
  {
    key: 'leave.apply',
    category: 'Leave & Field Duty',
    label: 'Apply for Leave',
    description: 'Submit personal leave applications.',
    allowedScopes: ['none', 'self'],
    actingAllowed: false
  },
  {
    key: 'leave.view',
    category: 'Leave & Field Duty',
    label: 'View Leave Applications',
    description: 'View leave applications and approval statuses within scope.',
    allowedScopes: ['none', 'self', 'office', 'subtree', 'all'],
    actingAllowed: true
  },
  {
    key: 'fieldduty.apply',
    category: 'Leave & Field Duty',
    label: 'Request Field Duty',
    description: 'Submit personal field duty requests for geofence bypass.',
    allowedScopes: ['none', 'self'],
    actingAllowed: false
  },
  // Reports
  {
    key: 'report.create',
    category: 'Reports',
    label: 'Generate & Submit Reports',
    description: 'Generate monthly attendance summaries and submit reports.',
    allowedScopes: ['none', 'office', 'subtree', 'all'],
    actingAllowed: true
  },
  {
    key: 'report.view',
    category: 'Reports',
    label: 'View Submitted Reports',
    description: 'Read submitted monthly office reports and export CSV.',
    allowedScopes: ['none', 'office', 'subtree', 'all'],
    actingAllowed: true
  },
  // Users & Devices
  {
    key: 'user.view',
    category: 'Users & Devices',
    label: 'View Staff Directory',
    description: 'View user profiles and directory details in scope.',
    allowedScopes: ['none', 'self', 'office', 'subtree', 'all'],
    actingAllowed: true
  },
  {
    key: 'user.create',
    category: 'Users & Devices',
    label: 'Create Staff Accounts',
    description: 'Create approved staff accounts within assigned office scope.',
    allowedScopes: ['none', 'office', 'subtree', 'all'],
    actingAllowed: false
  },
  {
    key: 'user.approve',
    category: 'Users & Devices',
    label: 'Approve / Reject Registrations',
    description: 'Approve or reject pending staff account registrations.',
    allowedScopes: ['none', 'office', 'subtree', 'all'],
    actingAllowed: true
  },
  {
    key: 'user.resetDevice',
    category: 'Users & Devices',
    label: 'Reset Bound Device',
    description: 'Clear bound device lock so staff can re-bind a new device.',
    allowedScopes: ['none', 'office', 'subtree', 'all'],
    actingAllowed: true
  },
  {
    key: 'user.edit',
    category: 'Users & Devices',
    label: 'Edit User Profiles',
    description: 'Edit staff profile details, transfer posting, and status.',
    allowedScopes: ['none', 'office', 'subtree', 'all'],
    actingAllowed: false
  },
  {
    key: 'user.role.assign',
    category: 'Users & Devices',
    label: 'Assign User Roles',
    description: 'Change user roles (strictly lower rank for non-super roles).',
    allowedScopes: ['none', 'office', 'subtree', 'all'],
    actingAllowed: false
  },
  {
    key: 'user.delete',
    category: 'Users & Devices',
    label: 'Delete User Profiles',
    description: 'Delete non-super user profile documents.',
    allowedScopes: ['none', 'all'],
    actingAllowed: false
  },
  // Offices, Charges & System
  {
    key: 'office.manage',
    category: 'System & Audit',
    label: 'Manage All Offices',
    description: 'Create, update, and delete offices across all levels.',
    allowedScopes: ['none', 'all'],
    actingAllowed: false
  },
  {
    key: 'office.child.manage',
    category: 'System & Audit',
    label: 'Manage Child Upazila Offices',
    description: 'Create and update upazila offices under own district offices.',
    allowedScopes: ['none', 'subtree'],
    actingAllowed: false
  },
  {
    key: 'assignment.manage',
    category: 'System & Audit',
    label: 'Manage Charges & Attachments',
    description: 'Assign or close additional charge, acting charge, and attachments.',
    allowedScopes: ['none', 'subtree', 'all'],
    actingAllowed: false
  },
  {
    key: 'holiday.manage',
    category: 'System & Audit',
    label: 'Manage Holidays',
    description: 'Add or remove official government holidays.',
    allowedScopes: ['none', 'all'],
    actingAllowed: false
  },
  {
    key: 'settings.manage',
    category: 'System & Audit',
    label: 'Manage System & Roles',
    description: 'Manage public registration, default role, and dynamic roles.',
    allowedScopes: ['none', 'all'],
    actingAllowed: false,
    lockedForSuperRole: true
  },
  {
    key: 'audit.view',
    category: 'System & Audit',
    label: 'View Audit Trail',
    description: 'Inspect immutable administrative and settlement audit logs.',
    allowedScopes: ['none', 'office', 'subtree', 'all'],
    actingAllowed: true
  }
]);

export const PERMISSION_KEYS = Object.freeze(PERMISSION_DEFINITIONS.map((def) => def.key));

const PERMISSION_META_MAP = Object.freeze(
  Object.fromEntries(PERMISSION_DEFINITIONS.map((def) => [def.key, def]))
);

const NON_SELF_ADMIN_PERMISSIONS = new Set([
  'user.approve',
  'user.resetDevice',
  'user.edit',
  'user.role.assign',
  'assignment.manage'
]);

const SCOPE_RANK = {
  '': 0,
  none: 0,
  self: 1,
  office: 2,
  subtree: 3,
  all: 4
};

let activeRoleRegistry = {};
let activeRoleList = [];
let activeDefaultRoleKey = '';

function cloneNormalizedRole(def) {
  const permissions = {};
  if (def.permissions && typeof def.permissions === 'object') {
    for (const [k, v] of Object.entries(def.permissions)) {
      if (v && v !== 'none') {
        permissions[k] = v;
      }
    }
  }
  const review = {
    leave: { ...(def.review?.leave || {}) },
    fieldduty: { ...(def.review?.fieldduty || {}) },
    settle: { ...(def.review?.settle || {}) }
  };
  return {
    key: def.key,
    label: def.label,
    description: def.description || '',
    rank: def.rank,
    isSuper: Boolean(def.isSuper),
    chargeEligible: Boolean(def.chargeEligible),
    actingEligible: Boolean(def.actingEligible),
    ...(def.homeRoute ? { homeRoute: def.homeRoute } : {}),
    permissions,
    review
  };
}

/**
 * Validate and normalize a single role definition per Sections 3.1, 3.3, 4.7.
 * Returns { valid, errors, normalized }.
 */
export function validateRoleDefinition(def) {
  const errors = [];
  if (!def || typeof def !== 'object' || Array.isArray(def)) {
    return { valid: false, errors: ['Role definition must be an object.'], normalized: null };
  }

  const key = typeof def.key === 'string' ? def.key.trim() : '';
  if (!ROLE_KEY_REGEX.test(key)) {
    errors.push('Role key must match ^[a-z][a-z0-9_]{1,39}$.');
  }

  const label = typeof def.label === 'string' ? def.label.trim() : '';
  if (label.length < 2 || label.length > 80) {
    errors.push('Role label must be 2 to 80 characters.');
  }

  let description = '';
  if (def.description !== undefined && def.description !== null) {
    if (typeof def.description !== 'string') {
      errors.push('Role description must be a string.');
    } else {
      description = def.description.trim();
      if (description.length > 300) {
        errors.push('Role description must be at most 300 characters.');
      }
    }
  }

  const rank = def.rank;
  if (!Number.isInteger(rank) || rank < 1 || rank > 100) {
    errors.push('Role rank must be an integer between 1 and 100.');
  }

  const isSuper = Boolean(def.isSuper);
  const chargeEligible = Boolean(def.chargeEligible);
  const actingEligible = Boolean(def.actingEligible);

  let homeRoute = '';
  if (def.homeRoute !== undefined && def.homeRoute !== null && def.homeRoute !== '') {
    if (typeof def.homeRoute !== 'string' || !HOME_ROUTES.includes(def.homeRoute.trim())) {
      errors.push(`homeRoute must be one of: ${HOME_ROUTES.join(', ')}.`);
    } else {
      homeRoute = def.homeRoute.trim();
    }
  }

  const permissions = {};
  if (def.permissions !== undefined && def.permissions !== null) {
    if (typeof def.permissions !== 'object' || Array.isArray(def.permissions)) {
      errors.push('permissions must be a map of permissionKey -> scope.');
    } else {
      for (const [permKey, scopeVal] of Object.entries(def.permissions)) {
        const meta = PERMISSION_META_MAP[permKey];
        if (!meta) {
          errors.push(`Unknown permission key: ${permKey}.`);
          continue;
        }
        if (typeof scopeVal !== 'string' || !meta.allowedScopes.includes(scopeVal)) {
          errors.push(`Invalid scope "${scopeVal}" for permission "${permKey}".`);
          continue;
        }
        if (scopeVal !== 'none') {
          permissions[permKey] = scopeVal;
        }
      }
    }
  }

  if (isSuper && permissions['settings.manage'] !== 'all') {
    errors.push('Super roles must retain settings.manage = "all".');
  }

  const review = { leave: {}, fieldduty: {}, settle: {} };
  if (def.review !== undefined && def.review !== null) {
    if (typeof def.review !== 'object' || Array.isArray(def.review)) {
      errors.push('review must be an object with leave, fieldduty, settle maps.');
    } else {
      for (const [kind, mapVal] of Object.entries(def.review)) {
        if (!REVIEW_KINDS.includes(kind)) {
          errors.push(`Unknown review kind: ${kind}.`);
          continue;
        }
        if (mapVal === null || mapVal === undefined) continue;
        if (typeof mapVal !== 'object' || Array.isArray(mapVal)) {
          errors.push(`review.${kind} must be a map of applicantRoleKey -> scope.`);
          continue;
        }
        for (const [applicantKey, scopeVal] of Object.entries(mapVal)) {
          if (!ROLE_KEY_REGEX.test(applicantKey)) {
            errors.push(`Invalid applicant role key "${applicantKey}" in review.${kind}.`);
            continue;
          }
          if (typeof scopeVal !== 'string' || !REVIEW_SCOPES.includes(scopeVal)) {
            errors.push(`Invalid review scope "${scopeVal}" in review.${kind}.${applicantKey}.`);
            continue;
          }
          review[kind][applicantKey] = scopeVal;
        }
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors, normalized: null };
  }

  return {
    valid: true,
    errors: [],
    normalized: {
      key,
      label,
      description,
      rank,
      isSuper,
      chargeEligible,
      actingEligible,
      ...(homeRoute ? { homeRoute } : {}),
      permissions,
      review
    }
  };
}

/**
 * Parse and validate an imported JSON array (or raw JSON text) of role definitions.
 * Rejects invalid JSON, non-arrays, duplicate keys, unknown permissions, and invalid scopes.
 */
export function parseRolesImport(input) {
  let parsed = input;
  if (typeof input === 'string') {
    try {
      parsed = JSON.parse(input);
    } catch (err) {
      return {
        valid: false,
        errors: [`Invalid JSON: ${err.message}`],
        roles: []
      };
    }
  }

  if (!Array.isArray(parsed)) {
    return {
      valid: false,
      errors: ['Roles import must be a JSON array of role definitions.'],
      roles: []
    };
  }

  const errors = [];
  const seenKeys = new Set();
  const roles = [];

  parsed.forEach((item, index) => {
    const res = validateRoleDefinition(item);
    if (!res.valid) {
      for (const msg of res.errors) {
        errors.push(`Item #${index + 1}${item?.key ? ` (${item.key})` : ''}: ${msg}`);
      }
      return;
    }
    if (seenKeys.has(res.normalized.key)) {
      errors.push(`Duplicate role key "${res.normalized.key}" at item #${index + 1}.`);
      return;
    }
    seenKeys.add(res.normalized.key);
    roles.push(res.normalized);
  });

  return {
    valid: errors.length === 0,
    errors,
    roles
  };
}

/**
 * Convert an array or map registry into a normalized role dictionary { [key]: roleDef }.
 */
export function normalizeRegistryInput(registryInput) {
  if (!registryInput) return activeRoleRegistry;
  if (Array.isArray(registryInput)) {
    const map = {};
    for (const item of registryInput) {
      const res = validateRoleDefinition(item);
      if (res.valid) {
        map[res.normalized.key] = res.normalized;
      } else if (item && typeof item.key === 'string' && item.key.trim()) {
        map[item.key.trim()] = cloneNormalizedRole({
          rank: 0,
          isSuper: false,
          chargeEligible: false,
          actingEligible: false,
          label: item.label || item.key,
          ...item,
          key: item.key.trim()
        });
      }
    }
    return map;
  }
  if (typeof registryInput === 'object') {
    return registryInput;
  }
  return {};
}

export function setRoleRegistry(rolesArray = [], { defaultRoleKey = '' } = {}) {
  const nextMap = {};
  if (Array.isArray(rolesArray)) {
    for (const item of rolesArray) {
      const key = typeof item?.key === 'string' ? item.key.trim() : typeof item?.id === 'string' ? item.id.trim() : '';
      if (!key) continue;
      const res = validateRoleDefinition({ ...item, key });
      if (res.valid) {
        nextMap[key] = res.normalized;
      } else {
        // Keep safe normalized view if doc has partial fields so UI never crashes
        nextMap[key] = cloneNormalizedRole({
          rank: Number.isInteger(item.rank) ? item.rank : 0,
          isSuper: Boolean(item.isSuper),
          chargeEligible: Boolean(item.chargeEligible),
          actingEligible: Boolean(item.actingEligible),
          label: typeof item.label === 'string' && item.label.trim() ? item.label.trim() : key,
          description: typeof item.description === 'string' ? item.description : '',
          homeRoute: typeof item.homeRoute === 'string' ? item.homeRoute : '',
          permissions: item.permissions || {},
          review: item.review || {},
          key
        });
      }
    }
  } else if (rolesArray && typeof rolesArray === 'object') {
    for (const [k, item] of Object.entries(rolesArray)) {
      if (!item || typeof item !== 'object') continue;
      const key = (item.key || k).trim();
      if (!key) continue;
      nextMap[key] = cloneNormalizedRole({ ...item, key });
    }
  }

  activeRoleRegistry = Object.freeze(nextMap);
  activeRoleList = Object.freeze(
    Object.values(activeRoleRegistry).sort((a, b) => b.rank - a.rank || a.label.localeCompare(b.label))
  );
  activeDefaultRoleKey = typeof defaultRoleKey === 'string' ? defaultRoleKey.trim() : '';
  return activeRoleRegistry;
}

export function getRoleRegistry() {
  return activeRoleRegistry;
}

export function getRoleList(registry) {
  if (!registry) return activeRoleList;
  const map = normalizeRegistryInput(registry);
  return Object.values(map).sort((a, b) => b.rank - a.rank || (a.label || '').localeCompare(b.label || ''));
}

export function getDefaultRoleKey() {
  return activeDefaultRoleKey;
}

export function exportRoles(registry) {
  return getRoleList(registry).map((r) => cloneNormalizedRole(r));
}

export function isBootstrapSuperUser(user) {
  if (!user) return false;
  if (user.isBootstrapSuper === true) return true;
  const email = typeof user.email === 'string' ? user.email.trim().toLowerCase() : '';
  if (!email || !BOOTSTRAP_SUPER_EMAILS.includes(email)) return false;
  return user.emailVerified === true || user.email_verified === true;
}

export function normalizeRole(role, registry) {
  if (typeof role !== 'string') return null;
  const trimmed = role.trim();
  if (!trimmed) return null;
  const map = normalizeRegistryInput(registry);
  return Object.prototype.hasOwnProperty.call(map, trimmed) ? trimmed : null;
}

export function getRoleMeta(role, registry) {
  const key = normalizeRole(role, registry);
  if (!key) return null;
  const map = normalizeRegistryInput(registry);
  return map[key] || null;
}

export function getRoleLabel(role, registry) {
  const meta = getRoleMeta(role, registry);
  if (meta?.label) return meta.label;
  if (typeof role === 'string' && role.trim()) return role.trim();
  return 'Unassigned';
}

export function rankOf(role, registry) {
  return getRoleMeta(role, registry)?.rank ?? 0;
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

function uniqueIds(list) {
  const out = [];
  for (const val of list) {
    if (typeof val === 'string') {
      const trimmed = val.trim();
      if (trimmed && !out.includes(trimmed)) {
        out.push(trimmed);
      }
    }
  }
  return out;
}

/**
 * A(U) — authority offices: primary officeId union additionalOfficeIds.
 */
export function getAuthorityOfficeIds(user) {
  if (!user) return [];
  return uniqueIds([
    user.officeId,
    ...(Array.isArray(user.additionalOfficeIds) ? user.additionalOfficeIds : [])
  ]);
}

/**
 * V(U) — valid attendance offices: A(U) union {attachedOfficeId, actingOfficeId}.
 */
export function getValidAttendanceOfficeIds(user) {
  if (!user) return [];
  return uniqueIds([
    ...getAuthorityOfficeIds(user),
    user.attachedOfficeId,
    user.actingOfficeId
  ]);
}

/**
 * W(U) — working office for leave / field duty routing: attachedOfficeId if set, else officeId.
 */
export function getWorkingOfficeId(user) {
  if (!user) return '';
  if (typeof user.attachedOfficeId === 'string' && user.attachedOfficeId.trim()) {
    return user.attachedOfficeId.trim();
  }
  if (typeof user.officeId === 'string' && user.officeId.trim()) {
    return user.officeId.trim();
  }
  return '';
}

export function getUserOfficeScopeIds(user) {
  return getAuthorityOfficeIds(user);
}

/**
 * Resolve active acting charge grant `{ officeId, role }` when valid and actingEligible.
 */
export function getActingGrant(user, registry) {
  if (!user || !isApprovedAndActive(user)) return null;
  const actingOfficeId = typeof user.actingOfficeId === 'string' ? user.actingOfficeId.trim() : '';
  const actingRoleKey = typeof user.actingRoleKey === 'string' ? user.actingRoleKey.trim() : '';
  if (!actingOfficeId || !actingRoleKey) return null;
  const roleMeta = getRoleMeta(actingRoleKey, registry);
  if (!roleMeta || !roleMeta.actingEligible) return null;
  return { officeId: actingOfficeId, role: roleMeta };
}

function getOwnRoleIfEligible(user, registry) {
  if (!user) return null;
  if (!isBootstrapSuperUser(user) && !isApprovedAndActive(user)) return null;
  return getRoleMeta(user.role, registry);
}

function isSuperCaller(user, registry) {
  if (isBootstrapSuperUser(user)) return true;
  const ownRole = getOwnRoleIfEligible(user, registry);
  return Boolean(ownRole?.isSuper);
}

function resolveKindKey(kind) {
  if (kind === 'attendance' || kind === 'settle') return 'settle';
  if (kind === 'fieldduty') return 'fieldduty';
  return 'leave';
}

function resolveReviewPermKey(kind) {
  const k = resolveKindKey(kind);
  if (k === 'settle') return 'attendance.settle';
  if (k === 'fieldduty') return 'fieldduty.review';
  return 'leave.review';
}

function isReviewPermKey(permission) {
  return DERIVED_REVIEW_PERMISSION_KEYS.includes(permission);
}

function permToReviewKind(permission) {
  if (permission === 'attendance.settle') return 'settle';
  if (permission === 'fieldduty.review') return 'fieldduty';
  return 'leave';
}

function getOwnPermissionScope(user, permission, registry) {
  const isBootstrap = isBootstrapSuperUser(user);
  const bootstrapScope = isBootstrap && SUPER_IMPLICIT_SET.has(permission) ? 'all' : '';
  const ownRole = getOwnRoleIfEligible(user, registry);

  let roleScope = '';
  if (ownRole) {
    if (isReviewPermKey(permission)) {
      const kind = permToReviewKind(permission);
      const map = ownRole.review?.[kind] || {};
      let best = '';
      for (const s of Object.values(map)) {
        if ((SCOPE_RANK[s] || 0) > (SCOPE_RANK[best] || 0)) best = s;
      }
      roleScope = best;
    } else {
      const raw = ownRole.permissions?.[permission];
      const meta = PERMISSION_META_MAP[permission];
      if (raw && raw !== 'none' && meta?.allowedScopes.includes(raw)) {
        roleScope = raw;
      }
    }
  }

  return (SCOPE_RANK[bootstrapScope] || 0) >= (SCOPE_RANK[roleScope] || 0) ? bootstrapScope : roleScope;
}

function getActingPermissionScope(user, permission, registry) {
  const acting = getActingGrant(user, registry);
  if (!acting) return '';
  if (isReviewPermKey(permission)) {
    const kind = permToReviewKind(permission);
    const map = acting.role.review?.[kind] || {};
    let best = '';
    for (const s of Object.values(map)) {
      if ((s === 'office' || s === 'subtree') && (SCOPE_RANK[s] || 0) > (SCOPE_RANK[best] || 0)) {
        best = s;
      }
    }
    return best;
  }
  if (!ACTING_ALLOWED_SET.has(permission)) return '';
  const raw = acting.role.permissions?.[permission];
  if (raw === 'office' || raw === 'subtree') return raw;
  return '';
}

export function getPermissionGrant(user, permission, registry) {
  const scope = getPermissionScope(user, permission, registry);
  if (!scope) return null;
  const superUser = isSuperCaller(user, registry);
  return {
    scope,
    lowerRankOnly: permission === 'user.role.assign' && !superUser
  };
}

export function getPermissionScope(user, permission, registry) {
  const ownScope = getOwnPermissionScope(user, permission, registry);
  const actScope = getActingPermissionScope(user, permission, registry);
  const best = (SCOPE_RANK[ownScope] || 0) >= (SCOPE_RANK[actScope] || 0) ? ownScope : actScope;
  return best || null;
}

function targetMatchesOfficeSet(scope, authorityIds, target, permission) {
  if (!target) return true;
  if (scope === 'all') return true;
  if (!scope || scope === 'none') return false;

  const userUid = target._callerUid || '';
  const targetUid = target.uid ?? target.id ?? target.employeeUid ?? '';

  if (scope === 'self') {
    if (!targetUid) return true;
    return Boolean(userUid) && targetUid === userUid;
  }

  const authSet = authorityIds instanceof Set ? authorityIds : new Set(authorityIds);
  if (authSet.size === 0) return false;

  const targetOfficeIds = uniqueIds([
    target.officeId,
    ...(permission === 'attendance.view' || permission === 'attendance.photo.view'
      ? [target.homeOfficeId, target.checkOutOfficeId]
      : []),
    ...(permission === 'leave.view' ? [target.homeOfficeId] : []),
    ...(permission === 'user.view'
      ? [
          ...(Array.isArray(target.additionalOfficeIds) ? target.additionalOfficeIds : []),
          target.attachedOfficeId,
          target.actingOfficeId
        ]
      : [])
  ]);

  if (scope === 'office') {
    return targetOfficeIds.some((id) => authSet.has(id));
  }

  if (scope === 'subtree') {
    if (targetOfficeIds.some((id) => authSet.has(id))) return true;
    const districtIds = uniqueIds([
      target.districtOfficeId,
      target.parentOfficeId,
      ...(permission === 'attendance.view' || permission === 'attendance.photo.view'
        ? [target.homeDistrictOfficeId, target.checkOutDistrictOfficeId]
        : []),
      ...(permission === 'leave.view' ? [target.homeDistrictOfficeId] : [])
    ]);
    return districtIds.some((id) => authSet.has(id));
  }

  return false;
}

/**
 * Evaluate whether `user` holds `permission`, optionally scoped against `target`.
 */
export function can(user, permission, target, registry) {
  if (!user) return false;

  if (isReviewPermKey(permission)) {
    const kind = permToReviewKind(permission);
    if (!target) {
      return Boolean(getOwnPermissionScope(user, permission, registry) || getActingPermissionScope(user, permission, registry));
    }
    return canReview(user, target, kind, registry);
  }

  const userUid = user.uid || user.id || '';
  const targetUid = target ? target.uid ?? target.id ?? target.employeeUid ?? '' : '';
  const isSelfTarget = Boolean(userUid && targetUid && userUid === targetUid);
  const superUser = isSuperCaller(user, registry);
  const ownRole = getOwnRoleIfEligible(user, registry);
  const actingGrant = getActingGrant(user, registry);

  const ownScope = getOwnPermissionScope(user, permission, registry);
  const actScope = getActingPermissionScope(user, permission, registry);

  if (!ownScope && !actScope) return false;

  const targetWithCaller = target ? { ...target, _callerUid: userUid } : null;
  const authorityIds = getAuthorityOfficeIds(user);

  const ownMatchesScope = ownScope
    ? targetMatchesOfficeSet(ownScope, authorityIds, targetWithCaller, permission)
    : false;
  const actMatchesScope = actScope && actingGrant
    ? targetMatchesOfficeSet(actScope, [actingGrant.officeId], targetWithCaller, permission)
    : false;

  if (!ownMatchesScope && !actMatchesScope) {
    return false;
  }

  if (!target) {
    return true;
  }

  // Hierarchy checks for user administration (Section 4.3: non-super always strictly higher rank, never self)
  if (NON_SELF_ADMIN_PERMISSIONS.has(permission) && !superUser) {
    if (isSelfTarget) return false;
    const rawTargetRole = target.currentRole ?? target.role;
    if (rawTargetRole != null) {
      const targetRank = rankOf(rawTargetRole, registry);
      const effectiveCallerRank = ownMatchesScope
        ? ownRole?.rank ?? 0
        : actingGrant?.role?.rank ?? 0;
      if (!normalizeRole(rawTargetRole, registry) || effectiveCallerRank <= targetRank) {
        return false;
      }
    }
  }

  if (permission === 'user.create' && !superUser) {
    const rawIncomingRole = target.newRole ?? target.targetRole ?? target.role;
    if (rawIncomingRole != null) {
      const incomingNorm = normalizeRole(rawIncomingRole, registry);
      const callerRank = ownRole?.rank ?? 0;
      if (!incomingNorm || callerRank <= rankOf(incomingNorm, registry)) {
        return false;
      }
    }
  }

  if (permission === 'user.role.assign') {
    const rawNewRole = target.newRole ?? target.targetRole ?? target.role;
    if (!superUser) {
      if (isSelfTarget) return false;
      if (rawNewRole != null) {
        const newNorm = normalizeRole(rawNewRole, registry);
        const callerRank = ownRole?.rank ?? 0;
        if (!newNorm || callerRank <= rankOf(newNorm, registry)) {
          return false;
        }
      }
    } else if (isSelfTarget && ownRole?.isSuper && rawNewRole != null) {
      const nextMeta = getRoleMeta(rawNewRole, registry);
      if (!nextMeta || !nextMeta.isSuper) {
        return false;
      }
    }
  }

  if (permission === 'user.delete') {
    if (isSelfTarget) return false;
    const targetMeta = getRoleMeta(target.role, registry);
    if (targetMeta?.isSuper) return false;
    if (isBootstrapSuperUser(target)) return false;
  }

  return true;
}

/**
 * Evaluate whether `reviewer` can approve/reject/settle `applicant`'s item.
 * Driven strictly by the role's `review.<kind>` map (own role over A(U) union
 * acting role over {actingOfficeId}), never self. Rank is NOT used for review.
 */
export function canReview(reviewer, applicant, kind = 'leave', registry) {
  if (!reviewer || !applicant) return false;

  const reviewerUid = reviewer.uid || reviewer.id || '';
  const applicantUid = applicant.uid ?? applicant.employeeUid ?? applicant.id ?? '';
  if (reviewerUid && applicantUid && reviewerUid === applicantUid) {
    return false;
  }

  const applicantRoleKey = applicant.applicantRole ?? applicant.role ?? '';
  if (typeof applicantRoleKey !== 'string' || !applicantRoleKey.trim()) {
    return false;
  }
  const normalizedApplicantRole = normalizeRole(applicantRoleKey, registry);
  if (!normalizedApplicantRole) {
    return false;
  }

  const reviewKind = resolveKindKey(kind);
  const reviewPermKey = resolveReviewPermKey(reviewKind);
  const target = {
    uid: applicantUid,
    officeId: applicant.officeId ?? '',
    districtOfficeId: applicant.districtOfficeId ?? '',
    parentOfficeId: applicant.parentOfficeId ?? ''
  };

  // Own role check
  const ownRole = getOwnRoleIfEligible(reviewer, registry);
  if (ownRole) {
    const ownReviewScope = ownRole.review?.[reviewKind]?.[normalizedApplicantRole];
    if (ownReviewScope && REVIEW_SCOPES.includes(ownReviewScope)) {
      if (targetMatchesOfficeSet(ownReviewScope, getAuthorityOfficeIds(reviewer), target, reviewPermKey)) {
        return true;
      }
    }
  }

  // Acting role check (strictly office or subtree relative to actingOfficeId)
  const actingGrant = getActingGrant(reviewer, registry);
  if (actingGrant) {
    const actReviewScope = actingGrant.role.review?.[reviewKind]?.[normalizedApplicantRole];
    if (actReviewScope === 'office' || actReviewScope === 'subtree') {
      if (targetMatchesOfficeSet(actReviewScope, [actingGrant.officeId], target, reviewPermKey)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * List role definitions that `user` is permitted to assign.
 */
export function assignableRoles(user, registry, { permission = 'user.role.assign' } = {}) {
  if (!user) return [];
  const allRoles = getRoleList(registry);

  if (isSuperCaller(user, registry)) {
    return allRoles;
  }

  const ownScope = getOwnPermissionScope(user, permission, registry);
  if (!ownScope) return [];

  const ownRole = getOwnRoleIfEligible(user, registry);
  if (!ownRole) return [];
  return allRoles.filter((r) => r.rank < ownRole.rank);
}

/**
 * Resolve home route path for a user profile using their role metadata/permissions.
 */
export function getHomePathForUser(user, hasSelectedOffice = true, registry) {
  if (!user) return '/login';
  if (isBootstrapSuperUser(user) && !user.role) return '/admin';
  if (user.approvalStatus && user.approvalStatus !== 'approved') return '/pending';

  const meta = getRoleMeta(user.role, registry);
  if (!meta) {
    return isBootstrapSuperUser(user) ? '/admin' : '/login';
  }

  const reportScope = getPermissionScope(user, 'report.create', registry);
  if (!hasSelectedOffice && (reportScope === 'subtree' || reportScope === 'office')) {
    return '/select-office';
  }

  const routeKey = meta.homeRoute;
  if (routeKey === 'admin') return '/admin';
  if (routeKey === 'district') return '/district';
  if (routeKey === 'office-head') return '/office-head';
  if (routeKey === 'head-office') return '/head-office';
  if (routeKey === 'employee') return '/employee';

  // Derive from permissions when homeRoute is not explicitly set
  if (meta.permissions?.['settings.manage']) return '/admin';
  if (Object.keys(meta.review?.settle || {}).length > 0) {
    return hasSelectedOffice ? '/district' : '/select-office';
  }
  if (meta.permissions?.['report.create']) {
    return hasSelectedOffice ? '/office-head' : '/select-office';
  }
  const rv = meta.permissions?.['report.view'];
  if ((rv === 'all' || rv === 'subtree') && !meta.permissions?.['report.create']) {
    return '/head-office';
  }
  if (meta.permissions?.['attendance.checkin']) return '/employee';
  if (
    Object.keys(meta.review?.leave || {}).length > 0 ||
    Object.keys(meta.review?.fieldduty || {}).length > 0
  ) {
    return '/district/approvals';
  }
  if (meta.permissions?.['assignment.manage']) return '/assignments';
  if (meta.permissions?.['office.manage']) return '/admin/offices';
  if (meta.permissions?.['holiday.manage']) return '/admin/holidays';
  if (meta.permissions?.['audit.view']) return '/audit';
  if (meta.permissions?.['user.view']) return '/employees';
  return '/employees';
}

export function canSelectMultipleOffices(user, assignedCount, registry) {
  if (!user || assignedCount <= 1) return false;
  const scope = getPermissionScope(user, 'report.create', registry);
  return scope === 'subtree' || scope === 'office';
}

export function getReviewerRoles(applicantRoleKey, kind = 'leave', registry) {
  const normalizedApplicant = normalizeRole(applicantRoleKey, registry);
  if (!normalizedApplicant) return [];
  const reviewKind = resolveKindKey(kind);
  return getRoleList(registry)
    .filter((r) => {
      const scope = r.review?.[reviewKind]?.[normalizedApplicant];
      return Boolean(scope && REVIEW_SCOPES.includes(scope));
    })
    .map((r) => r.label);
}

export function getApproverHint(applicantRoleKey, kind = 'leave', registry) {
  const labels = getReviewerRoles(applicantRoleKey, kind, registry);
  if (labels.length === 0) return 'অনুমোদনকারী কর্তৃপক্ষ';
  return labels.join(' বা ');
}
