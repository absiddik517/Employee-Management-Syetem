import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  VALID_SCOPE_VALUES,
  REVIEW_KINDS,
  REVIEW_SCOPES,
  HOME_ROUTES,
  BOOTSTRAP_SUPER_EMAILS,
  SUPER_IMPLICIT_PERMISSIONS,
  ACTING_ALLOWED_PERMISSIONS,
  PERMISSION_DEFINITIONS,
  PERMISSION_KEYS,
  validateRoleDefinition,
  parseRolesImport,
  exportRoles,
  setRoleRegistry,
  getRoleRegistry,
  getRoleList,
  getDefaultRoleKey,
  isBootstrapSuperUser,
  normalizeRole,
  getRoleMeta,
  getRoleLabel,
  rankOf,
  getAuthorityOfficeIds,
  getValidAttendanceOfficeIds,
  getWorkingOfficeId,
  getActingGrant,
  getPermissionGrant,
  getPermissionScope,
  can,
  canReview,
  assignableRoles,
  getHomePathForUser,
  canSelectMultipleOffices,
  getReviewerRoles,
  getApproverHint
} from '../src/lib/permissions.js';

const EXAMPLE_ROLES_PATH = path.resolve(process.cwd(), 'docs/examples/roles.example.json');
const EXAMPLE_ROLES_RAW = fs.readFileSync(EXAMPLE_ROLES_PATH, 'utf8');
const EXAMPLE_PARSE = parseRolesImport(EXAMPLE_ROLES_RAW);
assert.equal(EXAMPLE_PARSE.valid, true, `roles.example.json invalid: ${EXAMPLE_PARSE.errors.join('; ')}`);

const SEEDED_ROLES = EXAMPLE_PARSE.roles;

const actors = {
  bootstrapOnly: {
    uid: 'bs1',
    email: BOOTSTRAP_SUPER_EMAILS[0],
    emailVerified: true,
    approvalStatus: 'approved',
    status: 'active'
  },
  administrator: {
    uid: 'adm1',
    email: 'admin@ems.gov.bd',
    role: 'administrator',
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
  empDistrictOffice: { uid: 'emp_dist', officeId: 'dist1', districtOfficeId: 'dist1', role: 'employee' },
  empOtherDistrict: { uid: 'emp5', officeId: 'upz_other', districtOfficeId: 'dist99', role: 'employee' },
  unfeoInSubtree: { uid: 'unfeo1', officeId: 'upz1', districtOfficeId: 'dist1', role: 'unfeo' },
  otherUnfeoSameOffice: { uid: 'unfeo2', officeId: 'upz1', districtOfficeId: 'dist1', role: 'unfeo' },
  adInDist1: { uid: 'ad1', officeId: 'dist1', districtOfficeId: 'dist1', role: 'assistant_director' },
  otherAd: { uid: 'ad2', officeId: 'dist99', districtOfficeId: 'dist99', role: 'assistant_director' },
  adminTarget: { uid: 'adm2', officeId: 'head', role: 'administrator' }
};

test('Empty registry denies role-based permissions while bootstrap super user retains SUPER_IMPLICIT_PERMISSIONS', () => {
  setRoleRegistry([], { defaultRoleKey: '' });
  assert.deepEqual(getRoleList(), []);
  assert.deepEqual(getRoleRegistry(), {});
  assert.equal(getDefaultRoleKey(), '');
  assert.equal(normalizeRole('employee'), null);
  assert.equal(rankOf('employee'), 0);

  // Regular user or unknown role has zero permissions when registry is empty
  assert.equal(can(actors.employee, 'attendance.checkin'), false);
  assert.equal(can(actors.administrator, 'office.manage'), false);

  // Bootstrap super user retains all SUPER_IMPLICIT_PERMISSIONS without any roles
  assert.equal(isBootstrapSuperUser(actors.bootstrapOnly), true);
  assert.equal(isBootstrapSuperUser({ email: BOOTSTRAP_SUPER_EMAILS[0], emailVerified: false }), false);
  for (const perm of SUPER_IMPLICIT_PERMISSIONS) {
    assert.equal(can(actors.bootstrapOnly, perm), true, `Bootstrap should hold ${perm}`);
  }
  // Bootstrap super user has NO business workflow permissions without a role
  assert.equal(can(actors.bootstrapOnly, 'attendance.checkin'), false);
  assert.equal(can(actors.bootstrapOnly, 'leave.apply'), false);
  assert.equal(can(actors.bootstrapOnly, 'fieldduty.apply'), false);
  assert.equal(can(actors.bootstrapOnly, 'report.create'), false);
  assert.equal(canReview(actors.bootstrapOnly, targets.otherEmpSameUpazila, 'leave'), false);
  assert.equal(canReview(actors.bootstrapOnly, targets.otherEmpSameUpazila, 'fieldduty'), false);
  assert.equal(canReview(actors.bootstrapOnly, targets.otherEmpSameUpazila, 'settle'), false);
  assert.equal(getHomePathForUser(actors.bootstrapOnly), '/admin');
});

test('Seeded dynamic registry loads all example roles, ranks, labels, and R1 permissions', () => {
  setRoleRegistry(SEEDED_ROLES, { defaultRoleKey: 'employee' });
  try {
    assert.equal(getDefaultRoleKey(), 'employee');
    assert.deepEqual(
      getRoleList().map((r) => r.key),
      ['administrator', 'director_general', 'head_office_officer', 'assistant_director', 'unfeo', 'employee']
    );
    assert.equal(rankOf('administrator'), 100);
    assert.equal(rankOf('director_general'), 90);
    assert.equal(rankOf('head_office_officer'), 80);
    assert.equal(rankOf('assistant_director'), 60);
    assert.equal(rankOf('unfeo'), 40);
    assert.equal(rankOf('employee'), 10);
    assert.equal(getRoleLabel('unfeo'), 'UNFEO');
    assert.equal(normalizeRole('legacy_unknown'), null);

    // R1: employee reads own-office roster, attendance, and leaves, NOT another office
    assert.equal(can(actors.employee, 'user.view', targets.otherEmpSameUpazila), true);
    assert.equal(can(actors.employee, 'attendance.view', targets.otherEmpSameUpazila), true);
    assert.equal(can(actors.employee, 'leave.view', targets.otherEmpSameUpazila), true);
    assert.equal(can(actors.employee, 'user.view', targets.empSameDistOtherUpazila), false);
    assert.equal(can(actors.employee, 'attendance.view', targets.empSameDistOtherUpazila), false);
    assert.equal(can(actors.employee, 'leave.view', targets.empSameDistOtherUpazila), false);

    // AD manages child offices and creates staff in subtree
    assert.equal(can(actors.assistant_director, 'office.child.manage', { parentOfficeId: 'dist1' }), true);
    assert.equal(can(actors.assistant_director, 'office.child.manage', { parentOfficeId: 'dist99' }), false);
    assert.equal(can(actors.assistant_director, 'office.manage'), false);
    assert.equal(
      can(actors.assistant_director, 'user.create', {
        officeId: 'upz1',
        districtOfficeId: 'dist1',
        newRole: 'unfeo'
      }),
      true
    );
    assert.equal(
      can(actors.assistant_director, 'user.create', {
        officeId: 'upz_other',
        districtOfficeId: 'dist99',
        newRole: 'employee'
      }),
      false
    );
  } finally {
    setRoleRegistry([], { defaultRoleKey: '' });
  }
});

test('Review chain uses explicit review maps without rank check, and always blocks self-review', () => {
  setRoleRegistry(SEEDED_ROLES, { defaultRoleKey: 'employee' });
  try {
    // Employee reviews nobody
    assert.equal(canReview(actors.employee, targets.otherEmpSameUpazila, 'leave'), false);

    // UNFEO: employee in A(U) leave YES; peer UNFEO NO; other upazila NO; fieldduty/settle NO
    assert.equal(canReview(actors.unfeo, targets.otherEmpSameUpazila, 'leave'), true);
    assert.equal(canReview(actors.unfeo, targets.empAdditionalUpazila, 'leave'), true);
    assert.equal(canReview(actors.unfeo, actors.unfeo, 'leave'), false);
    assert.equal(canReview(actors.unfeo, targets.otherUnfeoSameOffice, 'leave'), false);
    assert.equal(canReview(actors.unfeo, targets.empSameDistOtherUpazila, 'leave'), false);
    assert.equal(canReview(actors.unfeo, targets.otherEmpSameUpazila, 'fieldduty'), false);
    assert.equal(canReview(actors.unfeo, targets.otherEmpSameUpazila, 'settle'), false);

    // AD: R2 boundary -> AD approves district-office employee leave (office scope), NOT upazila employee leave!
    assert.equal(canReview(actors.assistant_director, targets.empDistrictOffice, 'leave'), true);
    assert.equal(canReview(actors.assistant_director, targets.empSameDistOtherUpazila, 'leave'), false);
    // AD approves UNFEO leave across subtree (primary + additional district)
    assert.equal(canReview(actors.assistant_director, targets.unfeoInSubtree, 'leave'), true);
    assert.equal(
      canReview(actors.assistant_director, { uid: 'unfeo_d2', officeId: 'upz_d2', districtOfficeId: 'dist2', role: 'unfeo' }, 'leave'),
      true
    );
    // AD reviews field duty and settles attendance for both employee and unfeo across subtree
    assert.equal(canReview(actors.assistant_director, targets.empSameDistOtherUpazila, 'fieldduty'), true);
    assert.equal(canReview(actors.assistant_director, targets.empAdditionalDistUpazila, 'settle'), true);
    assert.equal(canReview(actors.assistant_director, targets.unfeoInSubtree, 'attendance'), true);
    assert.equal(canReview(actors.assistant_director, actors.assistant_director, 'leave'), false);
    assert.equal(canReview(actors.assistant_director, targets.otherAd, 'leave'), false);
    assert.equal(canReview(actors.assistant_director, targets.empOtherDistrict, 'settle'), false);

    // DG: AD leave only
    assert.equal(canReview(actors.director_general, targets.adInDist1, 'leave'), true);
    assert.equal(canReview(actors.director_general, targets.unfeoInSubtree, 'leave'), false);
    assert.equal(canReview(actors.director_general, targets.otherEmpSameUpazila, 'leave'), false);
    assert.equal(canReview(actors.director_general, actors.director_general, 'leave'), false);

    // Explicit review map works independently of numeric rank (even lower-rank reviewer -> higher-rank applicant)
    const customRegistry = [
      {
        key: 'leave_coordinator',
        label: 'Leave Coordinator',
        rank: 15,
        isSuper: false,
        permissions: { 'leave.view': 'office' },
        review: { leave: { senior_specialist: 'office' }, fieldduty: {}, settle: {} }
      },
      {
        key: 'senior_specialist',
        label: 'Senior Specialist',
        rank: 75,
        isSuper: false,
        permissions: { 'leave.apply': 'self' },
        review: { leave: {}, fieldduty: {}, settle: {} }
      }
    ];
    const coordinator = { uid: 'c1', role: 'leave_coordinator', officeId: 'o1', approvalStatus: 'approved', status: 'active' };
    const specialist = { uid: 's1', role: 'senior_specialist', officeId: 'o1', approvalStatus: 'approved', status: 'active' };
    assert.equal(canReview(coordinator, specialist, 'leave', customRegistry), true);
    assert.equal(canReview(specialist, coordinator, 'leave', customRegistry), false);

    // Unapproved/resigned reviewer blocked
    assert.equal(canReview({ ...actors.unfeo, approvalStatus: 'pending' }, targets.otherEmpSameUpazila, 'leave'), false);
    assert.equal(canReview({ ...actors.unfeo, status: 'resigned' }, targets.otherEmpSameUpazila, 'leave'), false);
  } finally {
    setRoleRegistry([], { defaultRoleKey: '' });
  }
});

test('Non-super user administration enforces rank even with scope = all, protects isSuper deletion, and prevents self-demotion', () => {
  const customRegistry = [
    ...SEEDED_ROLES,
    {
      key: 'hr_clerk',
      label: 'HR Clerk',
      rank: 30,
      isSuper: false,
      permissions: {
        'user.view': 'all',
        'user.create': 'all',
        'user.edit': 'all',
        'user.role.assign': 'all',
        'user.delete': 'all'
      },
      review: { leave: {}, fieldduty: {}, settle: {} }
    }
  ];
  setRoleRegistry(customRegistry, { defaultRoleKey: 'employee' });
  try {
    const clerk = { uid: 'hr1', role: 'hr_clerk', officeId: 'head', approvalStatus: 'approved', status: 'active' };
    // Lower rank (employee = 10 < 30): allowed
    assert.equal(can(clerk, 'user.edit', targets.otherEmpSameUpazila), true);
    assert.equal(
      can(clerk, 'user.role.assign', { uid: 'emp2', currentRole: 'employee', newRole: 'employee', officeId: 'upz1' }),
      true
    );
    // Equal or higher rank (unfeo = 40 > 30, clerk = 30): DENIED even though scope is 'all'
    assert.equal(can(clerk, 'user.edit', targets.unfeoInSubtree), false);
    assert.equal(can(clerk, 'user.create', { officeId: 'upz1', newRole: 'unfeo' }), false);
    assert.equal(
      can(clerk, 'user.role.assign', { uid: 'emp2', currentRole: 'employee', newRole: 'unfeo', officeId: 'upz1' }),
      false
    );
    assert.equal(can(clerk, 'user.edit', { ...clerk, uid: 'hr2' }), false);
    assert.equal(can(clerk, 'user.edit', clerk), false);
    assert.deepEqual(
      assignableRoles(clerk).map((r) => r.key),
      ['employee']
    );
    assert.equal(getPermissionGrant(clerk, 'user.role.assign').lowerRankOnly, true);

    // Super role ignores rank on user.edit/user.role.assign, protects isSuper deletion & self-demotion
    assert.equal(getPermissionGrant(actors.administrator, 'user.role.assign').lowerRankOnly, false);
    assert.equal(assignableRoles(actors.administrator).length, customRegistry.length);
    assert.equal(can(actors.administrator, 'user.delete', targets.otherEmpSameUpazila), true);
    assert.equal(can(actors.administrator, 'user.delete', targets.adminTarget), false);
    assert.equal(can(actors.administrator, 'user.delete', actors.bootstrapOnly), false);
    assert.equal(can(actors.administrator, 'user.delete', actors.administrator), false);
    assert.equal(
      can(actors.administrator, 'user.role.assign', { uid: actors.administrator.uid, newRole: 'employee' }),
      false
    );
    assert.equal(
      can(actors.administrator, 'user.role.assign', { uid: actors.administrator.uid, newRole: 'administrator' }),
      true
    );

    // AD assignableRoles (all ranks strictly lower than 60)
    assert.deepEqual(
      assignableRoles(actors.assistant_director).map((r) => r.key),
      ['unfeo', 'hr_clerk', 'employee']
    );
  } finally {
    setRoleRegistry([], { defaultRoleKey: '' });
  }
});

test('Acting-role union restricts permissions to ACTING_ALLOWED_PERMISSIONS over actingOfficeId only', () => {
  const registryWithDangerousActing = [
    ...SEEDED_ROLES,
    {
      key: 'rogue_acting',
      label: 'Rogue Acting',
      rank: 95,
      isSuper: false,
      actingEligible: true,
      permissions: {
        'attendance.checkin': 'self', // forbidden in acting
        'attendance.view': 'all', // stored 'all' must be ignored for acting!
        'attendance.photo.view': 'office',
        'leave.view': 'office',
        'report.create': 'office',
        'user.view': 'office',
        'user.approve': 'office',
        'user.resetDevice': 'office',
        'user.edit': 'subtree', // forbidden in acting!
        'user.create': 'subtree', // forbidden in acting!
        'user.role.assign': 'subtree', // forbidden in acting!
        'office.manage': 'all', // forbidden in acting!
        'audit.view': 'office'
      },
      review: {
        leave: { employee: 'office', unfeo: 'all' }, // 'all' ignored in acting
        fieldduty: {},
        settle: {}
      }
    }
  ];

  setRoleRegistry(registryWithDangerousActing, { defaultRoleKey: 'employee' });
  try {
    const actingEmp = {
      uid: 'emp_act',
      role: 'employee',
      officeId: 'upz1',
      districtOfficeId: 'dist1',
      actingOfficeId: 'upzZ',
      actingRoleKey: 'unfeo',
      approvalStatus: 'approved',
      status: 'active'
    };
    const targetInZ = { uid: 'empZ', officeId: 'upzZ', districtOfficeId: 'distZ', role: 'employee' };
    const targetInHome = { uid: 'empH', officeId: 'upz1', districtOfficeId: 'dist1', role: 'employee' };

    assert.equal(getActingGrant(actingEmp)?.officeId, 'upzZ');
    // Allowed acting permissions work ONLY at upzZ
    assert.equal(canReview(actingEmp, targetInZ, 'leave'), true);
    assert.equal(canReview(actingEmp, targetInHome, 'leave'), false);
    assert.equal(can(actingEmp, 'user.approve', targetInZ), true);
    assert.equal(can(actingEmp, 'user.approve', targetInHome), false);
    assert.equal(can(actingEmp, 'user.resetDevice', targetInZ), true);
    assert.equal(can(actingEmp, 'report.create', { officeId: 'upzZ' }), true);
    assert.equal(can(actingEmp, 'report.create', { officeId: 'upz1' }), false);

    // Non-actingEligible actingRoleKey is ignored
    const nonEligibleActing = { ...actingEmp, actingRoleKey: 'employee' };
    assert.equal(getActingGrant(nonEligibleActing), null);
    assert.equal(can(nonEligibleActing, 'user.approve', targetInZ), false);

    // Rogue acting role with 'all' / forbidden admin perms cannot escalate beyond ACTING_ALLOWED_PERMISSIONS & office/subtree
    const rogueEmp = { ...actingEmp, actingRoleKey: 'rogue_acting' };
    assert.equal(can(rogueEmp, 'user.edit', targetInZ), false);
    assert.equal(can(rogueEmp, 'user.create', targetInZ), false);
    assert.equal(can(rogueEmp, 'user.role.assign', targetInZ), false);
    assert.equal(can(rogueEmp, 'office.manage'), false);
    assert.equal(can(rogueEmp, 'attendance.view', { uid: 'x', officeId: 'other_office' }), false);
    assert.equal(canReview(rogueEmp, { uid: 'uZ', officeId: 'upzZ', role: 'unfeo' }, 'leave'), false);
    assert.equal(canReview(rogueEmp, targetInZ, 'leave'), true);

    assert.equal(ACTING_ALLOWED_PERMISSIONS.includes('user.edit'), false);
    assert.equal(ACTING_ALLOWED_PERMISSIONS.includes('office.manage'), false);
  } finally {
    setRoleRegistry([], { defaultRoleKey: '' });
  }
});

test('A(U), V(U), W(U) office sets resolve accurately for primary, additional, attached, and acting offices', () => {
  const user = {
    uid: 'u1',
    officeId: 'upz1',
    additionalOfficeIds: ['upz2', 'upz1', '  upz3  '],
    attachedOfficeId: 'upz_att',
    actingOfficeId: 'upz_act'
  };
  assert.deepEqual(getAuthorityOfficeIds(user), ['upz1', 'upz2', 'upz3']);
  assert.deepEqual(getValidAttendanceOfficeIds(user), ['upz1', 'upz2', 'upz3', 'upz_att', 'upz_act']);
  assert.equal(getWorkingOfficeId(user), 'upz_att');
  assert.equal(getWorkingOfficeId({ officeId: 'upz1' }), 'upz1');
  assert.equal(getWorkingOfficeId(null), '');
});

test('getHomePathForUser supports explicit homeRoute, permission-derived fallback, and multi-office selector', () => {
  const customNoHomeRouteRoles = [
    {
      key: 'custom_admin',
      label: 'Custom Admin',
      rank: 100,
      isSuper: true,
      permissions: { 'settings.manage': 'all' },
      review: { leave: {}, fieldduty: {}, settle: {} }
    },
    {
      key: 'custom_settler',
      label: 'Custom Settler',
      rank: 60,
      isSuper: false,
      permissions: { 'report.create': 'subtree' },
      review: { leave: {}, fieldduty: {}, settle: { custom_staff: 'subtree' } }
    },
    {
      key: 'custom_reporter',
      label: 'Custom Reporter',
      rank: 40,
      isSuper: false,
      permissions: { 'report.create': 'office' },
      review: { leave: {}, fieldduty: {}, settle: {} }
    },
    {
      key: 'custom_viewer',
      label: 'Custom Viewer',
      rank: 80,
      isSuper: false,
      permissions: { 'report.view': 'all' },
      review: { leave: {}, fieldduty: {}, settle: {} }
    },
    {
      key: 'custom_staff',
      label: 'Custom Staff',
      rank: 10,
      isSuper: false,
      permissions: { 'attendance.checkin': 'self' },
      review: { leave: {}, fieldduty: {}, settle: {} }
    }
  ];

  setRoleRegistry(customNoHomeRouteRoles, { defaultRoleKey: 'custom_staff' });
  try {
    assert.equal(getHomePathForUser({ role: 'custom_admin', approvalStatus: 'approved', status: 'active' }), '/admin');
    assert.equal(
      getHomePathForUser({ role: 'custom_settler', approvalStatus: 'approved', status: 'active' }, true),
      '/district'
    );
    assert.equal(
      getHomePathForUser({ role: 'custom_settler', approvalStatus: 'approved', status: 'active' }, false),
      '/select-office'
    );
    assert.equal(
      getHomePathForUser({ role: 'custom_reporter', approvalStatus: 'approved', status: 'active' }, true),
      '/office-head'
    );
    assert.equal(
      getHomePathForUser({ role: 'custom_reporter', approvalStatus: 'approved', status: 'active' }, false),
      '/select-office'
    );
    assert.equal(
      getHomePathForUser({ role: 'custom_viewer', approvalStatus: 'approved', status: 'active' }),
      '/head-office'
    );
    assert.equal(
      getHomePathForUser({ role: 'custom_staff', approvalStatus: 'approved', status: 'active' }),
      '/employee'
    );
    assert.equal(
      getHomePathForUser({ role: 'custom_staff', approvalStatus: 'pending', status: 'active' }),
      '/pending'
    );
    assert.equal(canSelectMultipleOffices({ role: 'custom_reporter', approvalStatus: 'approved', status: 'active' }, 2), true);
    assert.equal(canSelectMultipleOffices({ role: 'custom_viewer', approvalStatus: 'approved', status: 'active' }, 2), false);

    // Acting charge with report.create enables multi-office selection & /select-office route
    const actingStaff = {
      uid: 'act_staff',
      role: 'custom_staff',
      officeId: 'upz1',
      actingOfficeId: 'upz2',
      actingRoleKey: 'custom_reporter',
      approvalStatus: 'approved',
      status: 'active'
    };
    const customWithActing = customNoHomeRouteRoles.map((r) =>
      r.key === 'custom_reporter' ? { ...r, actingEligible: true } : r
    );
    setRoleRegistry(customWithActing, { defaultRoleKey: 'custom_staff' });
    assert.equal(canSelectMultipleOffices(actingStaff, 2), true);
    assert.equal(getHomePathForUser(actingStaff, false), '/select-office');

    // assignment.manage fallback resolves to /assignments
    setRoleRegistry(
      [
        {
          key: 'assign_mgr',
          label: 'Assignment Manager',
          rank: 50,
          isSuper: false,
          permissions: { 'assignment.manage': 'subtree' },
          review: { leave: {}, fieldduty: {}, settle: {} }
        }
      ],
      { defaultRoleKey: '' }
    );
    assert.equal(getHomePathForUser({ role: 'assign_mgr', approvalStatus: 'approved', status: 'active' }), '/assignments');
  } finally {
    setRoleRegistry([], { defaultRoleKey: '' });
  }
});

test('validateRoleDefinition, parseRolesImport, exportRoles, and approver hint helpers enforce schema invariants', () => {
  assert.deepEqual(VALID_SCOPE_VALUES, ['none', 'self', 'office', 'subtree', 'all']);
  assert.deepEqual(REVIEW_KINDS, ['leave', 'fieldduty', 'settle']);
  assert.deepEqual(REVIEW_SCOPES, ['office', 'subtree', 'all']);
  assert.ok(HOME_ROUTES.includes('district'));
  assert.equal(PERMISSION_DEFINITIONS.length, PERMISSION_KEYS.length);

  // Super role missing settings.manage = 'all' must fail
  const missingLock = validateRoleDefinition({
    key: 'bad_super',
    label: 'Bad Super',
    rank: 100,
    isSuper: true,
    permissions: { 'office.manage': 'all' },
    review: { leave: {}, fieldduty: {}, settle: {} }
  });
  assert.equal(missingLock.valid, false);

  // Unknown permission key & disallowed scope must fail
  const badPerms = validateRoleDefinition({
    key: 'bad_perms',
    label: 'Bad Perms',
    rank: 20,
    permissions: {
      'unknown.perm': 'all',
      'attendance.checkin': 'all' // only none/self allowed
    },
    review: {
      leave: { employee: 'self' } // 'self' disallowed in review
    }
  });
  assert.equal(badPerms.valid, false);
  assert.ok(badPerms.errors.length >= 3);

  // Duplicate keys in parseRolesImport rejected
  const dupImport = parseRolesImport([SEEDED_ROLES[0], SEEDED_ROLES[0]]);
  assert.equal(dupImport.valid, false);

  // Round-trip exportRoles -> parseRolesImport
  const roundTrip = parseRolesImport(exportRoles(SEEDED_ROLES));
  assert.equal(roundTrip.valid, true);
  assert.equal(roundTrip.roles.length, SEEDED_ROLES.length);

  // Approver hint
  assert.deepEqual(getReviewerRoles('employee', 'leave', SEEDED_ROLES), ['Assistant Director', 'UNFEO']);
  assert.equal(getApproverHint('employee', 'leave', SEEDED_ROLES), 'Assistant Director বা UNFEO');
  assert.equal(getApproverHint('assistant_director', 'leave', SEEDED_ROLES), 'Director General');
});
