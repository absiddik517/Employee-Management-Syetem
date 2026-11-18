import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ROLES,
  ROLE_KEYS,
  LEGACY_ROLE_MAP,
  PERMISSIONS,
  DEFAULT_PERMISSIONS,
  PERMISSION_DEFINITIONS,
  VALID_SCOPE_VALUES,
  normalizeRole,
  getRoleMeta,
  getRoleLabel,
  rankOf,
  sanitizePermissionOverrides,
  setPermissionOverrides,
  getPermissionOverrides,
  getDefaultPermissionScope,
  getEffectiveRoleScope,
  can,
  canReview,
  assignableRoles,
  getPermissionScope,
  getHomePathForUser,
  canSelectMultipleOffices
} from '../src/lib/permissions.js';

const actors = {
  super_admin: {
    uid: 'sa1',
    role: 'super_admin',
    officeId: 'head',
    approvalStatus: 'approved',
    status: 'active'
  },
  director_general: {
    uid: 'dg1',
    role: 'director_general',
    officeId: 'head',
    approvalStatus: 'approved',
    status: 'active'
  },
  head_office_officer: {
    uid: 'ho1',
    role: 'head_office_officer',
    officeId: 'head',
    approvalStatus: 'approved',
    status: 'active'
  },
  assistant_director: {
    uid: 'ad1',
    role: 'assistant_director',
    officeId: 'dist1',
    additionalOfficeIds: ['dist2'],
    approvalStatus: 'approved',
    status: 'active'
  },
  unfeo: {
    uid: 'unfeo1',
    role: 'unfeo',
    officeId: 'upz1',
    districtOfficeId: 'dist1',
    additionalOfficeIds: ['upz3'],
    approvalStatus: 'approved',
    status: 'active'
  },
  employee: {
    uid: 'emp1',
    role: 'employee',
    officeId: 'upz1',
    districtOfficeId: 'dist1',
    approvalStatus: 'approved',
    status: 'active'
  }
};

const targets = {
  ownSelfEmp: { uid: 'emp1', officeId: 'upz1', districtOfficeId: 'dist1', role: 'employee' },
  otherEmpSameUpazila: { uid: 'emp2', officeId: 'upz1', districtOfficeId: 'dist1', role: 'employee' },
  empAdditionalUpazila: { uid: 'emp_add', officeId: 'upz3', districtOfficeId: 'dist2', role: 'employee' },
  empSameDistOtherUpazila: { uid: 'emp3', officeId: 'upz2', districtOfficeId: 'dist1', role: 'employee' },
  empAdditionalDistUpazila: { uid: 'emp4', officeId: 'upz_d2', districtOfficeId: 'dist2', role: 'employee' },
  empOtherDistrict: { uid: 'emp5', officeId: 'upz_other', districtOfficeId: 'dist99', role: 'employee' },
  unfeoInSubtree: { uid: 'unfeo1', officeId: 'upz1', districtOfficeId: 'dist1', role: 'unfeo' },
  otherUnfeoSameOffice: { uid: 'unfeo2', officeId: 'upz1', districtOfficeId: 'dist1', role: 'unfeo' },
  adInDist1: { uid: 'ad1', officeId: 'dist1', districtOfficeId: 'dist1', role: 'assistant_director' },
  otherAd: { uid: 'ad2', officeId: 'dist99', districtOfficeId: 'dist99', role: 'assistant_director' },
  superAdminTarget: { uid: 'sa2', officeId: 'head', role: 'super_admin' }
};

test('Role definitions and rank ordering match specification', () => {
  assert.deepEqual(
    ROLE_KEYS,
    ['super_admin', 'director_general', 'head_office_officer', 'assistant_director', 'unfeo', 'employee']
  );
  assert.equal(rankOf('super_admin'), 100);
  assert.equal(rankOf('director_general'), 90);
  assert.equal(rankOf('head_office_officer'), 80);
  assert.equal(rankOf('assistant_director'), 60);
  assert.equal(rankOf('unfeo'), 40);
  assert.equal(rankOf('employee'), 10);
  assert.equal(rankOf('nonexistent'), 0);

  assert.equal(ROLES.super_admin.defaultScope, 'all');
  assert.equal(ROLES.director_general.defaultScope, 'all');
  assert.equal(ROLES.head_office_officer.defaultScope, 'all');
  assert.equal(ROLES.assistant_director.defaultScope, 'subtree');
  assert.equal(ROLES.unfeo.defaultScope, 'office');
  assert.equal(ROLES.employee.defaultScope, 'self');
});

test('Legacy role mapping normalizes seamlessly', () => {
  assert.equal(LEGACY_ROLE_MAP.head_office, 'director_general');
  assert.equal(LEGACY_ROLE_MAP.district_officer, 'assistant_director');
  assert.equal(LEGACY_ROLE_MAP.office_head, 'unfeo');

  assert.equal(normalizeRole('head_office'), 'director_general');
  assert.equal(normalizeRole('district_officer'), 'assistant_director');
  assert.equal(normalizeRole('office_head'), 'unfeo');
  assert.equal(normalizeRole('super_admin'), 'super_admin');
  assert.equal(normalizeRole('unknown_role'), null);

  assert.equal(getRoleMeta('district_officer').rank, 60);
  assert.equal(getRoleLabel('office_head'), 'UNFEO');

  const legacyUnfeo = { uid: 'u_leg', role: 'office_head', officeId: 'upz1' };
  assert.equal(can(legacyUnfeo, 'leave.review', targets.otherEmpSameUpazila), true);
  assert.equal(can(legacyUnfeo, 'attendance.settle', targets.otherEmpSameUpazila), false);

  const legacyAd = { uid: 'ad_leg', role: 'district_officer', officeId: 'dist1' };
  assert.equal(can(legacyAd, 'attendance.settle', targets.empSameDistOtherUpazila), true);

  const legacyDg = { uid: 'dg_leg', role: 'head_office', officeId: 'head' };
  assert.equal(can(legacyDg, 'leave.review', targets.adInDist1), true);
  assert.equal(can(legacyDg, 'audit.view'), true);
});

test('Every permission grant for every role matches matrix (unscoped capability check)', () => {
  const expected = {
    'attendance.checkin': ['employee', 'unfeo', 'assistant_director', 'director_general', 'head_office_officer'],
    'attendance.view': ['employee', 'unfeo', 'assistant_director', 'super_admin', 'director_general', 'head_office_officer'],
    'attendance.settle': ['assistant_director'],
    'attendance.photo.view': ['unfeo', 'assistant_director', 'super_admin'],
    'attendance.photo.purge': ['super_admin'],
    'leave.apply': ['employee', 'unfeo', 'assistant_director', 'director_general', 'head_office_officer'],
    'fieldduty.apply': ['employee', 'unfeo', 'assistant_director', 'director_general', 'head_office_officer'],
    'leave.review': ['unfeo', 'assistant_director', 'director_general'],
    'fieldduty.review': ['assistant_director'],
    'report.create': ['unfeo', 'assistant_director'],
    'report.view': ['unfeo', 'assistant_director', 'super_admin', 'director_general', 'head_office_officer'],
    'user.view': ['unfeo', 'assistant_director', 'super_admin', 'director_general', 'head_office_officer'],
    'user.approve': ['unfeo', 'assistant_director', 'super_admin'],
    'user.resetDevice': ['unfeo', 'assistant_director', 'super_admin'],
    'user.edit': ['assistant_director', 'super_admin'],
    'user.role.assign': ['assistant_director', 'super_admin'],
    'user.delete': ['super_admin'],
    'office.manage': ['super_admin'],
    'holiday.manage': ['super_admin'],
    'settings.manage': ['super_admin'],
    'audit.view': ['assistant_director', 'super_admin', 'director_general']
  };

  assert.deepEqual(Object.keys(PERMISSIONS).sort(), Object.keys(expected).sort());

  for (const [perm, allowedRoles] of Object.entries(expected)) {
    for (const roleKey of ROLE_KEYS) {
      assert.equal(
        can(actors[roleKey], perm),
        allowedRoles.includes(roleKey),
        `Expected ${roleKey} ${allowedRoles.includes(roleKey) ? 'TO HAVE' : 'NOT TO HAVE'} ${perm}`
      );
    }
  }
});

test('Super Admin is read-only on business workflows and protected against self-deletion/self-demotion', () => {
  const sa = actors.super_admin;
  assert.equal(can(sa, 'attendance.checkin'), false);
  assert.equal(can(sa, 'attendance.settle', targets.otherEmpSameUpazila), false);
  assert.equal(can(sa, 'leave.apply'), false);
  assert.equal(can(sa, 'fieldduty.apply'), false);
  assert.equal(can(sa, 'leave.review', targets.otherEmpSameUpazila), false);
  assert.equal(can(sa, 'fieldduty.review', targets.otherEmpSameUpazila), false);
  assert.equal(can(sa, 'report.create'), false);

  // Can view business data & purge photos & manage infra
  assert.equal(can(sa, 'attendance.view', targets.empOtherDistrict), true);
  assert.equal(can(sa, 'attendance.photo.view', targets.empOtherDistrict), true);
  assert.equal(can(sa, 'attendance.photo.purge'), true);
  assert.equal(can(sa, 'office.manage'), true);
  assert.equal(can(sa, 'holiday.manage'), true);
  assert.equal(can(sa, 'settings.manage'), true);
  assert.equal(can(sa, 'audit.view', targets.empOtherDistrict), true);

  // Cannot delete a super_admin or self-demote
  assert.equal(can(sa, 'user.delete', targets.otherEmpSameUpazila), true);
  assert.equal(can(sa, 'user.delete', targets.superAdminTarget), false);
  assert.equal(can(sa, 'user.delete', sa), false);
  assert.equal(can(sa, 'user.role.assign', { uid: sa.uid, newRole: 'employee' }), false);
  assert.equal(can(sa, 'user.role.assign', { uid: 'emp2', newRole: 'director_general' }), true);
});

test('Scope enforcement: self, office (+ additional), subtree (+ additional), all', () => {
  // Employee: self only
  assert.equal(can(actors.employee, 'attendance.view', targets.ownSelfEmp), true);
  assert.equal(can(actors.employee, 'attendance.view', targets.otherEmpSameUpazila), false);

  // UNFEO: office scope (primary upz1 + additional upz3), NOT upz2 or dist1 directly
  assert.equal(can(actors.unfeo, 'attendance.view', targets.otherEmpSameUpazila), true);
  assert.equal(can(actors.unfeo, 'attendance.view', targets.empAdditionalUpazila), true);
  assert.equal(can(actors.unfeo, 'attendance.view', targets.empSameDistOtherUpazila), false);
  assert.equal(can(actors.unfeo, 'user.approve', targets.otherEmpSameUpazila), true);
  assert.equal(can(actors.unfeo, 'user.resetDevice', targets.otherEmpSameUpazila), true);
  assert.equal(can(actors.unfeo, 'user.edit', targets.otherEmpSameUpazila), false);
  assert.equal(can(actors.unfeo, 'user.role.assign', targets.otherEmpSameUpazila), false);
  assert.equal(can(actors.unfeo, 'report.create', { officeId: 'upz1' }), true);
  assert.equal(can(actors.unfeo, 'report.create', { officeId: 'upz2' }), false);

  // Assistant Director: subtree scope (own dist1 + child upz + additional dist2 + child upz_d2)
  assert.equal(can(actors.assistant_director, 'attendance.view', targets.empSameDistOtherUpazila), true);
  assert.equal(can(actors.assistant_director, 'attendance.view', targets.empAdditionalDistUpazila), true);
  assert.equal(can(actors.assistant_director, 'attendance.view', targets.empOtherDistrict), false);
  assert.equal(can(actors.assistant_director, 'attendance.settle', targets.empSameDistOtherUpazila), true);
  assert.equal(can(actors.assistant_director, 'attendance.settle', targets.empAdditionalDistUpazila), true);
  assert.equal(can(actors.assistant_director, 'attendance.settle', targets.empOtherDistrict), false);
  assert.equal(can(actors.assistant_director, 'audit.view', targets.empAdditionalDistUpazila), true);
  assert.equal(can(actors.assistant_director, 'audit.view', targets.empOtherDistrict), false);

  // Director General & Head Office Officer: all read-only
  assert.equal(can(actors.director_general, 'attendance.view', targets.empOtherDistrict), true);
  assert.equal(can(actors.director_general, 'user.view', targets.empOtherDistrict), true);
  assert.equal(can(actors.director_general, 'report.view', targets.empOtherDistrict), true);
  assert.equal(can(actors.director_general, 'audit.view', targets.empOtherDistrict), true);
  assert.equal(can(actors.head_office_officer, 'attendance.view', targets.empOtherDistrict), true);
  assert.equal(can(actors.head_office_officer, 'audit.view', targets.empOtherDistrict), false);
  assert.equal(can(actors.head_office_officer, 'leave.review', targets.adInDist1), false);
});

test('canReview enforces approval chain, scope, strictly higher rank, and never self', () => {
  // Employee cannot review anything
  assert.equal(canReview(actors.employee, targets.otherEmpSameUpazila, 'leave'), false);

  // UNFEO leave review: own-office employee YES, self NO, another UNFEO NO, out-of-office employee NO
  assert.equal(canReview(actors.unfeo, targets.otherEmpSameUpazila, 'leave'), true);
  assert.equal(canReview(actors.unfeo, targets.empAdditionalUpazila, 'leave'), true);
  assert.equal(canReview(actors.unfeo, actors.unfeo, 'leave'), false);
  assert.equal(canReview(actors.unfeo, targets.otherUnfeoSameOffice, 'leave'), false);
  assert.equal(canReview(actors.unfeo, targets.empSameDistOtherUpazila, 'leave'), false);

  // UNFEO field duty & settlement: DENIED even for own-office employee
  assert.equal(canReview(actors.unfeo, targets.otherEmpSameUpazila, 'fieldduty'), false);
  assert.equal(canReview(actors.unfeo, targets.otherEmpSameUpazila, 'attendance'), false);

  // Assistant Director: employee & unfeo in subtree YES; self NO; other AD NO; out-of-subtree NO
  assert.equal(canReview(actors.assistant_director, targets.empSameDistOtherUpazila, 'leave'), true);
  assert.equal(canReview(actors.assistant_director, targets.unfeoInSubtree, 'leave'), true);
  assert.equal(canReview(actors.assistant_director, targets.empAdditionalDistUpazila, 'fieldduty'), true);
  assert.equal(canReview(actors.assistant_director, targets.unfeoInSubtree, 'fieldduty'), true);
  assert.equal(canReview(actors.assistant_director, targets.unfeoInSubtree, 'attendance'), true);
  assert.equal(canReview(actors.assistant_director, actors.assistant_director, 'leave'), false);
  assert.equal(canReview(actors.assistant_director, actors.assistant_director, 'fieldduty'), false);
  assert.equal(canReview(actors.assistant_director, actors.assistant_director, 'attendance'), false);
  assert.equal(canReview(actors.assistant_director, targets.otherAd, 'leave'), false);
  assert.equal(canReview(actors.assistant_director, targets.empOtherDistrict, 'leave'), false);

  // Director General: AD leave YES; self NO; employee/unfeo NO; fieldduty/attendance NO
  assert.equal(canReview(actors.director_general, targets.adInDist1, 'leave'), true);
  assert.equal(canReview(actors.director_general, actors.director_general, 'leave'), false);
  assert.equal(canReview(actors.director_general, targets.otherEmpSameUpazila, 'leave'), false);
  assert.equal(canReview(actors.director_general, targets.unfeoInSubtree, 'leave'), false);
  assert.equal(canReview(actors.director_general, targets.adInDist1, 'fieldduty'), false);
  assert.equal(canReview(actors.director_general, targets.adInDist1, 'attendance'), false);

  // Super Admin cannot review any business workflow
  assert.equal(canReview(actors.super_admin, targets.otherEmpSameUpazila, 'leave'), false);
  assert.equal(canReview(actors.super_admin, targets.adInDist1, 'leave'), false);
  assert.equal(canReview(actors.super_admin, targets.otherEmpSameUpazila, 'fieldduty'), false);
  assert.equal(canReview(actors.super_admin, targets.otherEmpSameUpazila, 'attendance'), false);
});

test('assignableRoles and user.role.assign prevent privilege escalation', () => {
  assert.deepEqual(
    assignableRoles(actors.super_admin).map((r) => r.key),
    ['super_admin', 'director_general', 'head_office_officer', 'assistant_director', 'unfeo', 'employee']
  );

  assert.deepEqual(
    assignableRoles(actors.assistant_director).map((r) => r.key),
    ['unfeo', 'employee']
  );

  assert.deepEqual(assignableRoles(actors.unfeo), []);
  assert.deepEqual(assignableRoles(actors.director_general), []);
  assert.deepEqual(assignableRoles(actors.employee), []);

  // AD can assign unfeo/employee inside subtree, cannot assign assistant_director or higher
  assert.equal(
    can(actors.assistant_director, 'user.role.assign', {
      uid: 'emp2',
      currentRole: 'employee',
      newRole: 'unfeo',
      officeId: 'upz1',
      districtOfficeId: 'dist1'
    }),
    true
  );
  assert.equal(
    can(actors.assistant_director, 'user.role.assign', {
      uid: 'emp2',
      currentRole: 'employee',
      newRole: 'assistant_director',
      officeId: 'upz1',
      districtOfficeId: 'dist1'
    }),
    false
  );
  assert.equal(
    can(actors.assistant_director, 'user.role.assign', {
      uid: 'ad2',
      currentRole: 'assistant_director',
      newRole: 'employee',
      officeId: 'dist1',
      districtOfficeId: 'dist1'
    }),
    false
  );
  assert.equal(
    can(actors.assistant_director, 'user.role.assign', {
      uid: actors.assistant_director.uid,
      currentRole: 'assistant_director',
      newRole: 'employee',
      officeId: 'dist1',
      districtOfficeId: 'dist1'
    }),
    false
  );
});

test('Unapproved or resigned users are denied all permissions', () => {
  const pendingAdmin = { ...actors.super_admin, approvalStatus: 'pending' };
  const resignedUnfeo = { ...actors.unfeo, status: 'resigned' };

  assert.equal(can(pendingAdmin, 'office.manage'), false);
  assert.equal(can(pendingAdmin, 'user.view'), false);
  assert.equal(can(resignedUnfeo, 'attendance.view'), false);
  assert.equal(can(resignedUnfeo, 'leave.review', targets.otherEmpSameUpazila), false);
});

test('getPermissionScope and getHomePathForUser helpers work for all roles', () => {
  assert.equal(getPermissionScope(actors.unfeo, 'user.view'), 'office');
  assert.equal(getPermissionScope(actors.assistant_director, 'user.view'), 'subtree');
  assert.equal(getPermissionScope(actors.director_general, 'user.view'), 'all');
  assert.equal(getPermissionScope(actors.employee, 'user.view'), null);

  assert.equal(getHomePathForUser(actors.super_admin), '/admin');
  assert.equal(getHomePathForUser(actors.director_general), '/head-office');
  assert.equal(getHomePathForUser(actors.head_office_officer), '/head-office');
  assert.equal(getHomePathForUser(actors.assistant_director, true), '/district');
  assert.equal(getHomePathForUser(actors.assistant_director, false), '/select-office');
  assert.equal(getHomePathForUser(actors.unfeo, true), '/office-head');
  assert.equal(getHomePathForUser(actors.unfeo, false), '/select-office');
  assert.equal(getHomePathForUser(actors.employee), '/employee');
});

test('sanitizePermissionOverrides strips invalid entries, defaults, and protects super_admin settings.manage', () => {
  assert.deepEqual(VALID_SCOPE_VALUES, ['none', 'self', 'office', 'subtree', 'all']);
  assert.equal(DEFAULT_PERMISSIONS, PERMISSIONS);
  assert.equal(PERMISSION_DEFINITIONS.length, Object.keys(DEFAULT_PERMISSIONS).length);

  const sanitized = sanitizePermissionOverrides({
    super_admin: {
      'settings.manage': 'none', // Must be ignored (anti-lockout)
      'attendance.checkin': 'all', // Disallowed scope for attendance.checkin (only none/self)
      'leave.apply': 'self', // Valid override
      'office.manage': 'all', // Same as default -> stripped
      'unknown.perm': 'all' // Unknown permission -> stripped
    },
    head_office_officer: {
      'audit.view': 'all', // Valid grant
      'leave.review': 'subtree' // Valid grant
    },
    ghost_role: {
      'user.view': 'all' // Unknown role -> stripped
    },
    employee: 'not-an-object'
  });

  assert.deepEqual(sanitized, {
    super_admin: {
      'leave.apply': 'self'
    },
    head_office_officer: {
      'audit.view': 'all',
      'leave.review': 'subtree'
    }
  });
});

test('Runtime permission overrides grant/revoke permissions dynamically while preserving hierarchy & scope safety', () => {
  try {
    const overrides = setPermissionOverrides({
      super_admin: {
        'attendance.checkin': 'self',
        'settings.manage': 'none' // Attempted lockout ignored by sanitizePermissionOverrides
      },
      head_office_officer: {
        'audit.view': 'all',
        'leave.review': 'all'
      },
      director_general: {
        'audit.view': 'none'
      },
      unfeo: {
        'user.role.assign': 'office',
        'fieldduty.review': 'office'
      },
      assistant_director: {
        'user.role.assign': 'none',
        'report.create': 'none'
      }
    });

    assert.equal(getPermissionOverrides(), overrides);
    assert.equal(getDefaultPermissionScope('head_office_officer', 'audit.view'), '');
    assert.equal(getEffectiveRoleScope('head_office_officer', 'audit.view'), 'all');
    assert.equal(getEffectiveRoleScope('director_general', 'audit.view'), '');

    // Super Admin cannot lose settings.manage even if requested
    assert.equal(can(actors.super_admin, 'settings.manage'), true);
    // Super Admin granted attendance.checkin
    assert.equal(can(actors.super_admin, 'attendance.checkin'), true);

    // Head Office Officer granted audit.view + leave.review (still enforces strictly higher rank and never self)
    assert.equal(can(actors.head_office_officer, 'audit.view', targets.empOtherDistrict), true);
    assert.equal(canReview(actors.head_office_officer, targets.adInDist1, 'leave'), true);
    assert.equal(canReview(actors.head_office_officer, actors.head_office_officer, 'leave'), false);
    assert.equal(canReview(actors.head_office_officer, targets.superAdminTarget, 'leave'), false);

    // Director General audit.view revoked
    assert.equal(can(actors.director_general, 'audit.view', targets.empOtherDistrict), false);

    // UNFEO granted fieldduty.review + user.role.assign within office scope (lower rank only)
    assert.equal(canReview(actors.unfeo, targets.otherEmpSameUpazila, 'fieldduty'), true);
    assert.equal(canReview(actors.unfeo, targets.empSameDistOtherUpazila, 'fieldduty'), false);
    assert.equal(canReview(actors.unfeo, targets.otherUnfeoSameOffice, 'fieldduty'), false);
    assert.deepEqual(
      assignableRoles(actors.unfeo).map((r) => r.key),
      ['employee']
    );

    // Assistant Director revoked user.role.assign and report.create
    assert.deepEqual(assignableRoles(actors.assistant_director), []);
    assert.equal(canSelectMultipleOffices(actors.assistant_director, 2), false);
    assert.equal(canSelectMultipleOffices(actors.unfeo, 2), true);
  } finally {
    setPermissionOverrides({});
  }

  // After reset, defaults are restored
  assert.equal(can(actors.super_admin, 'attendance.checkin'), false);
  assert.equal(can(actors.director_general, 'audit.view', targets.empOtherDistrict), true);
  assert.equal(can(actors.head_office_officer, 'audit.view', targets.empOtherDistrict), false);
});

