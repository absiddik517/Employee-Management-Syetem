import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds
} from '@firebase/rules-unit-testing';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  Timestamp,
  where,
  writeBatch
} from 'firebase/firestore';
import { ref, uploadBytes, getBytes, deleteObject } from 'firebase/storage';

const PROJECT_ID = 'iron-ivy-jvc14';
const FIRESTORE_RULES = fs.readFileSync('firestore.rules', 'utf8');
const STORAGE_RULES = fs.readFileSync('storage.rules', 'utf8');
const EXAMPLE_ROLES = JSON.parse(fs.readFileSync('docs/examples/roles.example.json', 'utf8'));

let testEnv;

function tsNow() {
  return Timestamp.now();
}

function makeUser(uid, role, officeId, overrides = {}) {
  return {
    uid,
    name: `Test ${uid}`,
    designation: role || 'Staff',
    address: 'Dhaka',
    mobile: '01700000000',
    email: `${uid}@ems.gov.bd`,
    officeId,
    districtOfficeId: overrides.districtOfficeId ?? officeId,
    additionalOfficeIds: overrides.additionalOfficeIds ?? [],
    attachedOfficeId: overrides.attachedOfficeId ?? null,
    actingOfficeId: overrides.actingOfficeId ?? null,
    actingRoleKey: overrides.actingRoleKey ?? null,
    joiningDate: '2026-01-01',
    status: 'active',
    resignationDate: null,
    profilePhotoPath: '',
    ...(role ? { role } : {}),
    approvalStatus: 'approved',
    boundDeviceId: 'dev-12345',
    createdAt: tsNow(),
    updatedAt: tsNow(),
    ...overrides
  };
}

function bootstrapDb() {
  return testEnv
    .authenticatedContext('boot1', {
      email: 'absiddik5177@gmail.com',
      email_verified: true
    })
    .firestore();
}

function validPunch(deviceId = 'dev-12345', photoPath = 'attendance/emp1/2026-11-20_in.jpg') {
  return {
    time: tsNow(),
    lat: 23.85,
    lng: 90.26,
    accuracy: 12,
    distanceMeters: 4,
    deviceId,
    photoPath,
    photoDeleted: false
  };
}

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: FIRESTORE_RULES,
      host: process.env.FIRESTORE_EMULATOR_HOST?.split(':')[0] || '127.0.0.1',
      port: Number(process.env.FIRESTORE_EMULATOR_HOST?.split(':')[1] || 8080)
    },
    storage: {
      rules: STORAGE_RULES,
      host: process.env.FIREBASE_STORAGE_EMULATOR_HOST?.split(':')[0] || '127.0.0.1',
      port: Number(process.env.FIREBASE_STORAGE_EMULATOR_HOST?.split(':')[1] || 9199)
    }
  });
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.clearStorage();

  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();

    for (const r of EXAMPLE_ROLES) {
      await setDoc(doc(db, 'roles', r.key), {
        ...r,
        createdAt: tsNow(),
        updatedAt: tsNow(),
        updatedBy: 'boot1'
      });
    }

    await setDoc(doc(db, 'settings', 'app'), {
      registrationOpen: true,
      defaultRole: 'employee',
      updatedAt: tsNow(),
      updatedBy: 'boot1'
    });

    const baseOffice = {
      address: 'Dhaka',
      lat: 23.76,
      lng: 90.39,
      geofenceRadiusMeters: 150,
      startTime: '09:00',
      graceMinutes: 15,
      endTime: '17:00',
      createdAt: tsNow(),
      updatedAt: tsNow()
    };

    await setDoc(doc(db, 'offices', 'head'), {
      ...baseOffice,
      name: 'Head Office',
      level: 'head',
      parentOfficeId: null
    });
    await setDoc(doc(db, 'offices', 'dist1'), {
      ...baseOffice,
      name: 'District 1',
      level: 'district',
      parentOfficeId: 'head'
    });
    await setDoc(doc(db, 'offices', 'dist2'), {
      ...baseOffice,
      name: 'District 2',
      address: 'Gazipur',
      level: 'district',
      parentOfficeId: 'head'
    });
    await setDoc(doc(db, 'offices', 'dist_other'), {
      ...baseOffice,
      name: 'District Other',
      address: 'Sylhet',
      level: 'district',
      parentOfficeId: 'head'
    });
    await setDoc(doc(db, 'offices', 'upz1'), {
      ...baseOffice,
      name: 'Upazila 1',
      address: 'Savar',
      level: 'upazila',
      parentOfficeId: 'dist1'
    });
    await setDoc(doc(db, 'offices', 'upz2'), {
      ...baseOffice,
      name: 'Upazila 2',
      address: 'Dhamrai',
      level: 'upazila',
      parentOfficeId: 'dist1'
    });
    await setDoc(doc(db, 'offices', 'upz_d2'), {
      ...baseOffice,
      name: 'Upazila D2',
      address: 'Kaliakair',
      level: 'upazila',
      parentOfficeId: 'dist2'
    });
    await setDoc(doc(db, 'offices', 'upz_other'), {
      ...baseOffice,
      name: 'Upazila Other',
      address: 'Beanibazar',
      level: 'upazila',
      parentOfficeId: 'dist_other'
    });

    await setDoc(doc(db, 'users', 'admin1'), makeUser('admin1', 'administrator', 'head', { districtOfficeId: '' }));
    await setDoc(doc(db, 'users', 'dg1'), makeUser('dg1', 'director_general', 'head', { districtOfficeId: '' }));
    await setDoc(doc(db, 'users', 'ho1'), makeUser('ho1', 'head_office_officer', 'head', { districtOfficeId: '' }));
    await setDoc(
      doc(db, 'users', 'ad1'),
      makeUser('ad1', 'assistant_director', 'dist1', {
        districtOfficeId: 'dist1',
        additionalOfficeIds: ['dist2']
      })
    );
    await setDoc(doc(db, 'users', 'ad_other'), makeUser('ad_other', 'assistant_director', 'dist_other', { districtOfficeId: 'dist_other' }));
    await setDoc(doc(db, 'users', 'unfeo1'), makeUser('unfeo1', 'unfeo', 'upz1', { districtOfficeId: 'dist1' }));
    await setDoc(doc(db, 'users', 'unfeo2'), makeUser('unfeo2', 'unfeo', 'upz1', { districtOfficeId: 'dist1' }));
    await setDoc(doc(db, 'users', 'unfeo_u2'), makeUser('unfeo_u2', 'unfeo', 'upz2', { districtOfficeId: 'dist1' }));
    await setDoc(doc(db, 'users', 'emp1'), makeUser('emp1', 'employee', 'upz1', { districtOfficeId: 'dist1' }));
    await setDoc(doc(db, 'users', 'emp2'), makeUser('emp2', 'employee', 'upz2', { districtOfficeId: 'dist1' }));
    await setDoc(doc(db, 'users', 'emp_dist1'), makeUser('emp_dist1', 'employee', 'dist1', { districtOfficeId: 'dist1' }));
    await setDoc(doc(db, 'users', 'emp_d2'), makeUser('emp_d2', 'employee', 'upz_d2', { districtOfficeId: 'dist2' }));
    await setDoc(doc(db, 'users', 'emp_other'), makeUser('emp_other', 'employee', 'upz_other', { districtOfficeId: 'dist_other' }));
    await setDoc(doc(db, 'users', 'emp_head'), makeUser('emp_head', 'employee', 'head', { districtOfficeId: '' }));

    // Leave applications
    const baseLeave = {
      startDate: '2026-11-20',
      endDate: '2026-11-21',
      leaveType: 'Casual Leave',
      reason: 'Personal',
      status: 'pending',
      reviewedBy: null,
      reviewedByName: null,
      reviewComment: null,
      reviewedAt: null,
      createdAt: tsNow()
    };
    await setDoc(doc(db, 'leaves', 'l_emp1'), { ...baseLeave, uid: 'emp1', employeeName: 'Emp 1', officeId: 'upz1', districtOfficeId: 'dist1', homeOfficeId: 'upz1', homeDistrictOfficeId: 'dist1' });
    await setDoc(doc(db, 'leaves', 'l_emp2'), { ...baseLeave, uid: 'emp2', employeeName: 'Emp 2', officeId: 'upz2', districtOfficeId: 'dist1', homeOfficeId: 'upz2', homeDistrictOfficeId: 'dist1' });
    await setDoc(doc(db, 'leaves', 'l_emp_dist1'), { ...baseLeave, uid: 'emp_dist1', employeeName: 'Emp Dist 1', officeId: 'dist1', districtOfficeId: 'dist1', homeOfficeId: 'dist1', homeDistrictOfficeId: 'dist1' });
    await setDoc(doc(db, 'leaves', 'l_unfeo1'), { ...baseLeave, uid: 'unfeo1', employeeName: 'UNFEO 1', officeId: 'upz1', districtOfficeId: 'dist1', homeOfficeId: 'upz1', homeDistrictOfficeId: 'dist1' });
    await setDoc(doc(db, 'leaves', 'l_unfeo2'), { ...baseLeave, uid: 'unfeo2', employeeName: 'UNFEO 2', officeId: 'upz1', districtOfficeId: 'dist1', homeOfficeId: 'upz1', homeDistrictOfficeId: 'dist1' });
    await setDoc(doc(db, 'leaves', 'l_ad1'), { ...baseLeave, uid: 'ad1', employeeName: 'AD 1', officeId: 'dist1', districtOfficeId: 'dist1', homeOfficeId: 'dist1', homeDistrictOfficeId: 'dist1' });
    await setDoc(doc(db, 'leaves', 'l_emp_d2'), { ...baseLeave, uid: 'emp_d2', employeeName: 'Emp D2', officeId: 'upz_d2', districtOfficeId: 'dist2', homeOfficeId: 'upz_d2', homeDistrictOfficeId: 'dist2' });
    await setDoc(doc(db, 'leaves', 'l_emp_other'), { ...baseLeave, uid: 'emp_other', employeeName: 'Emp Other', officeId: 'upz_other', districtOfficeId: 'dist_other', homeOfficeId: 'upz_other', homeDistrictOfficeId: 'dist_other' });

    // Field duties
    const baseFd = {
      startDate: '2026-11-20',
      endDate: '2026-11-20',
      location: 'Inspection',
      reason: 'Official visit',
      status: 'pending',
      reviewedBy: null,
      reviewedByName: null,
      reviewComment: null,
      reviewedAt: null,
      createdAt: tsNow()
    };
    await setDoc(doc(db, 'fieldDuties', 'fd_emp1'), { ...baseFd, uid: 'emp1', employeeName: 'Emp 1', officeId: 'upz1', districtOfficeId: 'dist1', homeOfficeId: 'upz1', homeDistrictOfficeId: 'dist1' });
    await setDoc(doc(db, 'fieldDuties', 'fd_ad1'), { ...baseFd, uid: 'ad1', employeeName: 'AD 1', officeId: 'dist1', districtOfficeId: 'dist1', homeOfficeId: 'dist1', homeDistrictOfficeId: 'dist1' });

    // Attendance
    await setDoc(doc(db, 'attendance', 'emp1_2026-11-18'), {
      uid: 'emp1',
      employeeName: 'Emp 1',
      designation: 'employee',
      officeId: 'upz1',
      districtOfficeId: 'dist1',
      homeOfficeId: 'upz1',
      homeDistrictOfficeId: 'dist1',
      date: '2026-11-18',
      isFieldDuty: false,
      checkIn: validPunch('dev-12345', 'attendance/emp1/in.jpg'),
      checkOut: null,
      initialStatus: 'সময়মতো',
      finalStatus: null,
      settled: false,
      settledBy: null,
      settledByName: null,
      settledAt: null,
      districtComment: null,
      photoDeleted: false,
      photoDeletedAt: null,
      createdAt: tsNow(),
      updatedAt: tsNow()
    });

    await setDoc(doc(db, 'attendance', 'emp2_2026-11-18'), {
      uid: 'emp2',
      employeeName: 'Emp 2',
      designation: 'employee',
      officeId: 'upz2',
      districtOfficeId: 'dist1',
      homeOfficeId: 'upz2',
      homeDistrictOfficeId: 'dist1',
      date: '2026-11-18',
      isFieldDuty: false,
      checkIn: validPunch('dev-12345', 'attendance/emp2/in.jpg'),
      checkOut: null,
      initialStatus: 'সময়মতো',
      finalStatus: null,
      settled: false,
      settledBy: null,
      settledByName: null,
      settledAt: null,
      districtComment: null,
      photoDeleted: false,
      photoDeletedAt: null,
      createdAt: tsNow(),
      updatedAt: tsNow()
    });

    await setDoc(doc(db, 'auditLogs', 'log_1'), {
      actorUid: 'ad1',
      actorName: 'AD 1',
      actorRole: 'assistant_director',
      officeId: 'upz1',
      districtOfficeId: 'dist1',
      action: 'TEST_EVENT',
      targetCollection: 'attendance',
      targetId: 'emp1_2026-11-18',
      reason: 'Fixture',
      timestamp: tsNow()
    });
  });
});

after(async () => {
  if (testEnv) await testEnv.cleanup();
});

test('Roles & permissions: dynamic roles CRUD, isSuper protection, catalog validation, and non-super rank check', async () => {
  const bootDb = bootstrapDb();
  const adminDb = testEnv.authenticatedContext('admin1').firestore();
  const dgDb = testEnv.authenticatedContext('dg1').firestore();

  const customRole = {
    key: 'zonal_reviewer',
    label: 'Zonal Reviewer',
    description: 'Custom test role',
    rank: 55,
    isSuper: false,
    chargeEligible: true,
    actingEligible: false,
    homeRoute: 'employee',
    permissions: {
      'user.edit': 'all',
      'user.role.assign': 'all'
    },
    review: {
      leave: {},
      fieldduty: {},
      settle: {}
    },
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    updatedBy: 'admin1'
  };

  // Non-super cannot write roles
  await assertFails(setDoc(doc(dgDb, 'roles', 'zonal_reviewer'), { ...customRole, updatedBy: 'dg1' }));

  // Super role (administrator) can create lower/equal-rank non-super role
  await assertSucceeds(setDoc(doc(adminDb, 'roles', 'zonal_reviewer'), customRole));

  // Unknown permission key rejected
  await assertFails(
    setDoc(doc(adminDb, 'roles', 'bad_perm_role'), {
      ...customRole,
      key: 'bad_perm_role',
      permissions: { 'unknown.perm': 'all' }
    })
  );

  // Unsupported scope for a permission key rejected (attendance.checkin cannot be 'office'; assignment.manage cannot be 'office')
  await assertFails(
    setDoc(doc(adminDb, 'roles', 'bad_scope_role'), {
      ...customRole,
      key: 'bad_scope_role',
      permissions: { 'attendance.checkin': 'office' }
    })
  );
  await assertFails(
    setDoc(doc(adminDb, 'roles', 'bad_assign_scope'), {
      ...customRole,
      key: 'bad_assign_scope',
      permissions: { 'assignment.manage': 'office' }
    })
  );

  // Super role cannot lose settings.manage == 'all'
  await assertFails(
    updateDoc(doc(bootDb, 'roles', 'administrator'), {
      permissions: { 'user.view': 'all' },
      updatedAt: serverTimestamp(),
      updatedBy: 'boot1'
    })
  );

  // Non-bootstrap super cannot delete an isSuper role or un-flag isSuper
  await assertFails(deleteDoc(doc(adminDb, 'roles', 'administrator')));
  await assertFails(
    updateDoc(doc(adminDb, 'roles', 'administrator'), {
      isSuper: false,
      updatedAt: serverTimestamp(),
      updatedBy: 'admin1'
    })
  );

  // Non-super user with user.edit = 'all' and user.role.assign = 'all' is STILL blocked by rank check
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'users', 'zr1'), makeUser('zr1', 'zonal_reviewer', 'head', { districtOfficeId: '' }));
  });
  const zrDb = testEnv.authenticatedContext('zr1').firestore();

  // zr1 (rank 55, user.edit = 'all') cannot edit ad1 (rank 60) or assign rank >= 55 role
  await assertFails(
    updateDoc(doc(zrDb, 'users', 'ad1'), {
      name: 'Edited AD',
      updatedAt: serverTimestamp()
    })
  );
  await assertFails(
    updateDoc(doc(zrDb, 'users', 'emp1'), {
      role: 'assistant_director',
      updatedAt: serverTimestamp()
    })
  );
  // Can edit lower-rank user (emp1, rank 10)
  await assertSucceeds(
    updateDoc(doc(zrDb, 'users', 'emp1'), {
      name: 'Edited By ZR',
      updatedAt: serverTimestamp()
    })
  );

  // Writing a non-existent role key on a user document is rejected
  await assertFails(
    updateDoc(doc(adminDb, 'users', 'emp1'), {
      role: 'ghost_role',
      updatedAt: serverTimestamp()
    })
  );

  // Bootstrap super user CAN un-flag/delete non-assigned super role
  await assertSucceeds(deleteDoc(doc(bootDb, 'roles', 'administrator')));
});

test('Visibility (R1): employee sees own-office roster/attendance/leaves only; head-office directory hole removed; charge/attached staff visible', async () => {
  const empUpzDb = testEnv.authenticatedContext('emp1').firestore();
  const empHeadDb = testEnv.authenticatedContext('emp_head').firestore();

  // Upazila employee reads own office users, attendance, leaves
  await assertSucceeds(getDoc(doc(empUpzDb, 'users', 'unfeo1')));
  await assertSucceeds(getDoc(doc(empUpzDb, 'attendance', 'emp1_2026-11-18')));
  await assertSucceeds(getDoc(doc(empUpzDb, 'leaves', 'l_emp1')));

  // Upazila employee denied sibling upazila users, attendance, leaves
  await assertFails(getDoc(doc(empUpzDb, 'users', 'emp2')));
  await assertFails(getDoc(doc(empUpzDb, 'attendance', 'emp2_2026-11-18')));
  await assertFails(getDoc(doc(empUpzDb, 'leaves', 'l_emp2')));

  // Head-office employee CANNOT read other offices' users (removed hole regression)
  await assertFails(getDoc(doc(empHeadDb, 'users', 'emp1')));
  await assertFails(getDoc(doc(empHeadDb, 'users', 'emp_dist1')));
  await assertSucceeds(getDoc(doc(empHeadDb, 'users', 'dg1'))); // same head office

  // Charge holder (additionalOfficeIds) & attached staff appear in the target office's roster
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(
      doc(db, 'users', 'attached_emp'),
      makeUser('attached_emp', 'employee', 'upz2', {
        districtOfficeId: 'dist1',
        attachedOfficeId: 'upz1'
      })
    );
    await setDoc(
      doc(db, 'users', 'charge_unfeo'),
      makeUser('charge_unfeo', 'unfeo', 'upz2', {
        districtOfficeId: 'dist1',
        additionalOfficeIds: ['upz1']
      })
    );
  });

  await assertSucceeds(getDoc(doc(empUpzDb, 'users', 'attached_emp')));
  await assertSucceeds(getDoc(doc(empUpzDb, 'users', 'charge_unfeo')));
});

test('Review chain (R2, R3, R11): UNFEO, AD, DG review maps; attached office routing; acting charge at Z only', async () => {
  const unfeoDb = testEnv.authenticatedContext('unfeo1').firestore();
  const unfeo2Db = testEnv.authenticatedContext('unfeo_u2').firestore();
  const adDb = testEnv.authenticatedContext('ad1').firestore();
  const dgDb = testEnv.authenticatedContext('dg1').firestore();

  // R3: UNFEO approves own-upazila employee leave; denied for other upazila, self, peer UNFEO
  await assertSucceeds(
    updateDoc(doc(unfeoDb, 'leaves', 'l_emp1'), {
      status: 'approved',
      reviewedBy: 'unfeo1',
      reviewedByName: 'UNFEO 1',
      reviewComment: 'OK',
      reviewedAt: serverTimestamp()
    })
  );
  await assertFails(
    updateDoc(doc(unfeoDb, 'leaves', 'l_emp2'), {
      status: 'approved',
      reviewedBy: 'unfeo1',
      reviewedByName: 'UNFEO 1',
      reviewComment: 'Other upazila',
      reviewedAt: serverTimestamp()
    })
  );
  await assertFails(
    updateDoc(doc(unfeoDb, 'leaves', 'l_unfeo1'), {
      status: 'approved',
      reviewedBy: 'unfeo1',
      reviewedByName: 'UNFEO 1',
      reviewComment: 'Self',
      reviewedAt: serverTimestamp()
    })
  );
  await assertFails(
    updateDoc(doc(unfeoDb, 'leaves', 'l_unfeo2'), {
      status: 'approved',
      reviewedBy: 'unfeo1',
      reviewedByName: 'UNFEO 1',
      reviewComment: 'Peer UNFEO',
      reviewedAt: serverTimestamp()
    })
  );

  // R2: AD approves district-office employee leave and subtree UNFEO leave; DENIED upazila employee leave!
  await assertSucceeds(
    updateDoc(doc(adDb, 'leaves', 'l_emp_dist1'), {
      status: 'approved',
      reviewedBy: 'ad1',
      reviewedByName: 'AD 1',
      reviewComment: 'District staff',
      reviewedAt: serverTimestamp()
    })
  );
  await assertSucceeds(
    updateDoc(doc(adDb, 'leaves', 'l_unfeo1'), {
      status: 'approved',
      reviewedBy: 'ad1',
      reviewedByName: 'AD 1',
      reviewComment: 'UNFEO leave',
      reviewedAt: serverTimestamp()
    })
  );
  await assertFails(
    updateDoc(doc(adDb, 'leaves', 'l_emp2'), {
      status: 'approved',
      reviewedBy: 'ad1',
      reviewedByName: 'AD 1',
      reviewComment: 'R2 blocked: upazila employee approved by UNFEO only',
      reviewedAt: serverTimestamp()
    })
  );
  await assertFails(
    updateDoc(doc(adDb, 'leaves', 'l_ad1'), {
      status: 'approved',
      reviewedBy: 'ad1',
      reviewedByName: 'AD 1',
      reviewComment: 'Self',
      reviewedAt: serverTimestamp()
    })
  );
  await assertFails(
    updateDoc(doc(adDb, 'leaves', 'l_emp_other'), {
      status: 'approved',
      reviewedBy: 'ad1',
      reviewedByName: 'AD 1',
      reviewComment: 'Other district',
      reviewedAt: serverTimestamp()
    })
  );

  // AD field duty review in subtree + additional charge district (note AD has fieldduty.review employee: subtree)
  await assertSucceeds(
    updateDoc(doc(adDb, 'fieldDuties', 'fd_emp1'), {
      status: 'approved',
      reviewedBy: 'ad1',
      reviewedByName: 'AD 1',
      reviewComment: 'OK',
      reviewedAt: serverTimestamp()
    })
  );
  await assertFails(
    updateDoc(doc(adDb, 'fieldDuties', 'fd_ad1'), {
      status: 'approved',
      reviewedBy: 'ad1',
      reviewedByName: 'AD 1',
      reviewComment: 'Self',
      reviewedAt: serverTimestamp()
    })
  );

  // DG approves AD leave only
  await assertSucceeds(
    updateDoc(doc(dgDb, 'leaves', 'l_ad1'), {
      status: 'approved',
      reviewedBy: 'dg1',
      reviewedByName: 'DG 1',
      reviewComment: 'Approved',
      reviewedAt: serverTimestamp()
    })
  );
  await assertFails(
    updateDoc(doc(dgDb, 'leaves', 'l_emp2'), {
      status: 'approved',
      reviewedBy: 'dg1',
      reviewedByName: 'DG 1',
      reviewComment: 'Skip chain',
      reviewedAt: serverTimestamp()
    })
  );

  // R11: Attached employee routes leave to W(U) = attachedOfficeId ('upz2')
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(
      doc(ctx.firestore(), 'users', 'emp_att'),
      makeUser('emp_att', 'employee', 'upz1', {
        districtOfficeId: 'dist1',
        attachedOfficeId: 'upz2'
      })
    );
  });
  const empAttDb = testEnv.authenticatedContext('emp_att').firestore();

  // Submitting leave to home office instead of attached office denied
  await assertFails(
    setDoc(doc(empAttDb, 'leaves', 'l_att_bad'), {
      ...{
        uid: 'emp_att',
        employeeName: 'Emp Att',
        officeId: 'upz1',
        districtOfficeId: 'dist1',
        homeOfficeId: 'upz1',
        homeDistrictOfficeId: 'dist1',
        startDate: '2026-11-22',
        endDate: '2026-11-23',
        leaveType: 'Casual Leave',
        reason: 'Personal',
        status: 'pending',
        reviewedBy: null,
        reviewedByName: null,
        reviewComment: null,
        reviewedAt: null,
        createdAt: serverTimestamp()
      }
    })
  );

  // Submitting leave to attached office succeeds
  await assertSucceeds(
    setDoc(doc(empAttDb, 'leaves', 'l_att_ok'), {
      uid: 'emp_att',
      employeeName: 'Emp Att',
      officeId: 'upz2',
      districtOfficeId: 'dist1',
      homeOfficeId: 'upz1',
      homeDistrictOfficeId: 'dist1',
      startDate: '2026-11-22',
      endDate: '2026-11-23',
      leaveType: 'Casual Leave',
      reason: 'Personal',
      status: 'pending',
      reviewedBy: null,
      reviewedByName: null,
      reviewComment: null,
      reviewedAt: null,
      createdAt: serverTimestamp()
    })
  );

  // Home office UNFEO can view via homeOfficeId, CANNOT approve; attached office UNFEO CAN approve
  await assertSucceeds(getDoc(doc(unfeoDb, 'leaves', 'l_att_ok')));
  await assertFails(
    updateDoc(doc(unfeoDb, 'leaves', 'l_att_ok'), {
      status: 'approved',
      reviewedBy: 'unfeo1',
      reviewedByName: 'UNFEO 1',
      reviewComment: 'Not attached office',
      reviewedAt: serverTimestamp()
    })
  );
  await assertSucceeds(
    updateDoc(doc(unfeo2Db, 'leaves', 'l_att_ok'), {
      status: 'approved',
      reviewedBy: 'unfeo_u2',
      reviewedByName: 'UNFEO U2',
      reviewComment: 'Attached office OK',
      reviewedAt: serverTimestamp()
    })
  );

  // Acting charge: employee at upz1 with actingRoleKey = 'unfeo' at upz2
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(
      doc(ctx.firestore(), 'users', 'emp_acting'),
      makeUser('emp_acting', 'employee', 'upz1', {
        districtOfficeId: 'dist1',
        actingOfficeId: 'upz2',
        actingRoleKey: 'unfeo'
      })
    );
  });
  const empActingDb = testEnv.authenticatedContext('emp_acting').firestore();

  // Can approve employee leave at acting office (upz2)
  await assertSucceeds(
    updateDoc(doc(empActingDb, 'leaves', 'l_emp2'), {
      status: 'approved',
      reviewedBy: 'emp_acting',
      reviewedByName: 'Acting UNFEO',
      reviewComment: 'Acting approval at Z',
      reviewedAt: serverTimestamp()
    })
  );
  // Cannot approve employee leave at own home office (upz1)
  await assertFails(
    updateDoc(doc(empActingDb, 'leaves', 'l_emp1'), {
      status: 'approved',
      reviewedBy: 'emp_acting',
      reviewedByName: 'Acting UNFEO',
      reviewComment: 'Home office denied',
      reviewedAt: serverTimestamp()
    })
  );
  // Cannot use acting role for user.edit / user.delete even if acting role had them
  await assertFails(
    updateDoc(doc(empActingDb, 'users', 'emp2'), {
      name: 'Tampered',
      updatedAt: serverTimestamp()
    })
  );
  await assertFails(deleteDoc(doc(empActingDb, 'users', 'emp2')));
});

test('Offices & users (R4): AD creates child upazila, creates subtree user, and manages assignments/charges safely', async () => {
  const adDb = testEnv.authenticatedContext('ad1').firestore();

  const newOfficeBase = {
    address: 'Keraniganj, Dhaka',
    lat: 23.67,
    lng: 90.33,
    geofenceRadiusMeters: 120,
    startTime: '09:00',
    graceMinutes: 15,
    endTime: '17:00',
    createdBy: 'ad1',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };

  // AD creates upazila under own district: allowed
  await assertSucceeds(
    setDoc(doc(adDb, 'offices', 'upz_new'), {
      ...newOfficeBase,
      name: 'Keraniganj Upazila',
      level: 'upazila',
      parentOfficeId: 'dist1'
    })
  );

  // Update created child upazila preserving level & parentOfficeId: allowed; delete: denied
  await assertSucceeds(
    updateDoc(doc(adDb, 'offices', 'upz_new'), {
      name: 'Keraniganj Updated',
      updatedAt: serverTimestamp()
    })
  );
  await assertFails(deleteDoc(doc(adDb, 'offices', 'upz_new')));

  // Creating under unrelated district or as district level denied
  await assertFails(
    setDoc(doc(adDb, 'offices', 'upz_bad_parent'), {
      ...newOfficeBase,
      name: 'Bad Upazila',
      level: 'upazila',
      parentOfficeId: 'dist_other'
    })
  );
  await assertFails(
    setDoc(doc(adDb, 'offices', 'dist_bad'), {
      ...newOfficeBase,
      name: 'Bad District',
      level: 'district',
      parentOfficeId: 'head'
    })
  );

  // AD user.create in own subtree: allowed; other district or equal/higher role: denied
  const newUserPayload = (uid, officeId, districtOfficeId, role = 'employee') => ({
    uid,
    name: 'New Subtree Staff',
    designation: 'Office Assistant',
    address: 'Dhaka',
    mobile: '01712345678',
    email: `${uid}@ems.gov.bd`,
    officeId,
    districtOfficeId,
    joiningDate: '2026-11-20',
    status: 'active',
    resignationDate: null,
    profilePhotoPath: '',
    role,
    approvalStatus: 'approved',
    boundDeviceId: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  await assertSucceeds(setDoc(doc(adDb, 'users', 'u_sub1'), newUserPayload('u_sub1', 'upz_new', 'dist1', 'employee')));
  await assertFails(setDoc(doc(adDb, 'users', 'u_bad_dist'), newUserPayload('u_bad_dist', 'upz_other', 'dist_other', 'employee')));
  await assertFails(setDoc(doc(adDb, 'users', 'u_bad_role'), newUserPayload('u_bad_role', 'upz_new', 'dist1', 'assistant_director')));

  // assignment.manage (subtree): additionalOfficeIds append-one vs append-two / out-of-scope / removal
  await assertSucceeds(
    updateDoc(doc(adDb, 'users', 'unfeo1'), {
      additionalOfficeIds: ['upz2'],
      updatedAt: serverTimestamp()
    })
  );
  await assertFails(
    updateDoc(doc(adDb, 'users', 'unfeo2'), {
      additionalOfficeIds: ['upz2', 'upz_d2'],
      updatedAt: serverTimestamp()
    })
  );
  await assertFails(
    updateDoc(doc(adDb, 'users', 'unfeo2'), {
      additionalOfficeIds: ['upz_other'],
      updatedAt: serverTimestamp()
    })
  );
  // Removal allowed
  await assertSucceeds(
    updateDoc(doc(adDb, 'users', 'unfeo1'), {
      additionalOfficeIds: [],
      updatedAt: serverTimestamp()
    })
  );

  // Attachment: same as primary office or out of scope denied; in-scope office allowed
  await assertFails(
    updateDoc(doc(adDb, 'users', 'emp1'), {
      attachedOfficeId: 'upz1',
      updatedAt: serverTimestamp()
    })
  );
  await assertFails(
    updateDoc(doc(adDb, 'users', 'emp1'), {
      attachedOfficeId: 'upz_other',
      updatedAt: serverTimestamp()
    })
  );
  await assertSucceeds(
    updateDoc(doc(adDb, 'users', 'emp1'), {
      attachedOfficeId: 'upz2',
      updatedAt: serverTimestamp()
    })
  );

  // Acting role: non-actingEligible or rank >= caller denied; eligible lower-rank allowed
  await assertFails(
    updateDoc(doc(adDb, 'users', 'emp1'), {
      actingOfficeId: 'upz2',
      actingRoleKey: 'employee',
      updatedAt: serverTimestamp()
    })
  );
  await assertFails(
    updateDoc(doc(adDb, 'users', 'emp1'), {
      actingOfficeId: 'dist1',
      actingRoleKey: 'assistant_director',
      updatedAt: serverTimestamp()
    })
  );
  await assertSucceeds(
    updateDoc(doc(adDb, 'users', 'emp1'), {
      actingOfficeId: 'upz2',
      actingRoleKey: 'unfeo',
      updatedAt: serverTimestamp()
    })
  );

  // Cross-district attachment denied for subtree AD, allowed for admin1 (scope = all)
  const adminDb = testEnv.authenticatedContext('admin1').firestore();
  await assertFails(
    updateDoc(doc(adDb, 'users', 'emp1'), {
      attachedOfficeId: 'dist_other',
      updatedAt: serverTimestamp()
    })
  );
  await assertSucceeds(
    updateDoc(doc(adminDb, 'users', 'emp1'), {
      attachedOfficeId: 'dist_other',
      updatedAt: serverTimestamp()
    })
  );
  // Restore attachedOfficeId to null for downstream tests
  await assertSucceeds(
    updateDoc(doc(adminDb, 'users', 'emp1'), {
      attachedOfficeId: null,
      actingOfficeId: null,
      actingRoleKey: null,
      updatedAt: serverTimestamp()
    })
  );

  // Target with chargeEligible: false (administrator) denied even by bootstrap
  const bootDb = bootstrapDb();
  await assertFails(
    updateDoc(doc(bootDb, 'users', 'admin1'), {
      attachedOfficeId: 'dist1',
      updatedAt: serverTimestamp()
    })
  );
});

test('Attendance (R10): multi-office V(U) check-in & check-out, derived district, and pinned punch data on settle', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(
      doc(ctx.firestore(), 'users', 'emp_multi'),
      makeUser('emp_multi', 'employee', 'upz1', {
        districtOfficeId: 'dist1',
        additionalOfficeIds: ['upz2'],
        attachedOfficeId: 'dist1'
      })
    );
  });

  const empDb = testEnv.authenticatedContext('emp_multi').firestore();
  const adDb = testEnv.authenticatedContext('ad1').firestore();

  const makeCheckInDoc = (officeId, districtOfficeId, homeOfficeId = 'upz1') => ({
    uid: 'emp_multi',
    employeeName: 'Emp Multi',
    designation: 'employee',
    officeId,
    districtOfficeId,
    homeOfficeId,
    homeDistrictOfficeId: 'dist1',
    date: '2026-11-20',
    isFieldDuty: false,
    checkIn: validPunch('dev-12345', 'attendance/emp_multi/2026-11-20_in.jpg'),
    checkOut: null,
    initialStatus: 'সময়মতো',
    finalStatus: null,
    settled: false,
    settledBy: null,
    settledByName: null,
    settledAt: null,
    districtComment: null,
    photoDeleted: false,
    photoDeletedAt: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  // Unrelated office denied
  await assertFails(setDoc(doc(empDb, 'attendance', 'emp_multi_2026-11-20'), makeCheckInDoc('upz_other', 'dist_other')));

  // Wrong districtOfficeId for office denied
  await assertFails(setDoc(doc(empDb, 'attendance', 'emp_multi_2026-11-20'), makeCheckInDoc('upz2', 'dist2')));

  // Wrong homeOfficeId denied
  await assertFails(setDoc(doc(empDb, 'attendance', 'emp_multi_2026-11-20'), makeCheckInDoc('upz2', 'dist1', 'upz2')));

  // Check-in at additional office (upz2) succeeds
  await assertSucceeds(setDoc(doc(empDb, 'attendance', 'emp_multi_2026-11-20'), makeCheckInDoc('upz2', 'dist1')));

  // Check-out at unrelated office denied
  await assertFails(
    updateDoc(doc(empDb, 'attendance', 'emp_multi_2026-11-20'), {
      checkOut: validPunch('dev-12345', 'attendance/emp_multi/2026-11-20_out.jpg'),
      checkOutOfficeId: 'upz_other',
      checkOutDistrictOfficeId: 'dist_other',
      updatedAt: serverTimestamp()
    })
  );

  // Check-out at attached office (dist1, different from check-in office upz2!) succeeds
  await assertSucceeds(
    updateDoc(doc(empDb, 'attendance', 'emp_multi_2026-11-20'), {
      checkOut: validPunch('dev-12345', 'attendance/emp_multi/2026-11-20_out.jpg'),
      checkOutOfficeId: 'dist1',
      checkOutDistrictOfficeId: 'dist1',
      updatedAt: serverTimestamp()
    })
  );

  // Settler tampering punch coordinates/time is DENIED
  const snap = await getDoc(doc(adDb, 'attendance', 'emp_multi_2026-11-20'));
  const existingData = snap.data();
  await assertFails(
    updateDoc(doc(adDb, 'attendance', 'emp_multi_2026-11-20'), {
      finalStatus: 'On Time',
      settled: true,
      settledBy: 'ad1',
      settledByName: 'AD 1',
      settledAt: serverTimestamp(),
      districtComment: 'Tamper check',
      photoDeleted: true,
      photoDeletedAt: serverTimestamp(),
      checkIn: { ...existingData.checkIn, distanceMeters: 9999, photoDeleted: true, photoDeletedAt: serverTimestamp() },
      updatedAt: serverTimestamp()
    })
  );

  // Settler changing only photoDeleted/photoDeletedAt inside punch succeeds
  await assertSucceeds(
    updateDoc(doc(adDb, 'attendance', 'emp_multi_2026-11-20'), {
      finalStatus: 'On Time',
      settled: true,
      settledBy: 'ad1',
      settledByName: 'AD 1',
      settledAt: serverTimestamp(),
      districtComment: 'Verified',
      photoDeleted: true,
      photoDeletedAt: serverTimestamp(),
      checkIn: { ...existingData.checkIn, photoDeleted: true, photoDeletedAt: serverTimestamp() },
      checkOut: { ...existingData.checkOut, photoDeleted: true, photoDeletedAt: serverTimestamp() },
      updatedAt: serverTimestamp()
    })
  );

  // Acting office check-in & homeOfficeId visibility for home-office report/settlement checks
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(
      doc(ctx.firestore(), 'users', 'emp_act_att'),
      makeUser('emp_act_att', 'employee', 'upz1', {
        districtOfficeId: 'dist1',
        actingOfficeId: 'upz_other',
        actingRoleKey: 'unfeo'
      })
    );
  });
  const empActAttDb = testEnv.authenticatedContext('emp_act_att').firestore();
  const unfeo1Db = testEnv.authenticatedContext('unfeo1').firestore();

  await assertSucceeds(
    setDoc(doc(empActAttDb, 'attendance', 'emp_act_att_2026-11-21'), {
      uid: 'emp_act_att',
      employeeName: 'Emp Acting Att',
      designation: 'employee',
      officeId: 'upz_other',
      districtOfficeId: 'dist_other',
      homeOfficeId: 'upz1',
      homeDistrictOfficeId: 'dist1',
      date: '2026-11-21',
      isFieldDuty: false,
      checkIn: validPunch('dev-12345', 'attendance/emp_act_att/2026-11-21_in.jpg'),
      checkOut: null,
      initialStatus: 'সময়মতো',
      finalStatus: null,
      settled: false,
      settledBy: null,
      settledByName: null,
      settledAt: null,
      districtComment: null,
      photoDeleted: false,
      photoDeletedAt: null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    })
  );
  // Home office UNFEO & AD can read via homeOfficeId/homeDistrictOfficeId, CANNOT settle out-of-subtree attendance
  await assertSucceeds(getDoc(doc(unfeo1Db, 'attendance', 'emp_act_att_2026-11-21')));
  await assertSucceeds(getDoc(doc(adDb, 'attendance', 'emp_act_att_2026-11-21')));
  await assertFails(
    updateDoc(doc(adDb, 'attendance', 'emp_act_att_2026-11-21'), {
      finalStatus: 'On Time',
      settled: true,
      settledBy: 'ad1',
      settledByName: 'AD 1',
      settledAt: serverTimestamp(),
      districtComment: 'Wrong district',
      photoDeleted: true,
      photoDeletedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    })
  );
});

test('History (R5) & Audit Logs: append-only assignments and pinned actorRole', async () => {
  const adDb = testEnv.authenticatedContext('ad1').firestore();
  const empDb = testEnv.authenticatedContext('emp1').firestore();
  const emp2Db = testEnv.authenticatedContext('emp2').firestore();
  const bootDb = bootstrapDb();

  const assignPayload = {
    kind: 'primary',
    officeId: 'upz1',
    districtOfficeId: 'dist1',
    officeName: 'Upazila 1',
    designation: 'Office Assistant',
    roleKey: 'employee',
    roleLabel: 'Employee',
    startDate: '2026-01-01',
    endDate: null,
    type: 'joined',
    orderNo: 'ORD-01',
    orderDate: '2026-01-01',
    reason: 'Initial joining',
    createdBy: 'ad1',
    createdByName: 'AD 1',
    createdAt: serverTimestamp()
  };

  // Non-privileged user cannot write assignments
  await assertFails(setDoc(doc(empDb, 'users', 'emp1', 'assignments', 'a1'), { ...assignPayload, createdBy: 'emp1' }));

  // AD creates assignment record for subtree employee
  await assertSucceeds(setDoc(doc(adDb, 'users', 'emp1', 'assignments', 'a1'), assignPayload));

  // Owner reads own history; unrelated employee denied
  await assertSucceeds(getDoc(doc(empDb, 'users', 'emp1', 'assignments', 'a1')));
  await assertFails(getDoc(doc(emp2Db, 'users', 'emp1', 'assignments', 'a1')));

  // Close open record allowed; deleting denied
  await assertSucceeds(
    updateDoc(doc(adDb, 'users', 'emp1', 'assignments', 'a1'), {
      endDate: '2026-11-19',
      closedBy: 'ad1',
      closedAt: serverTimestamp()
    })
  );
  await assertFails(deleteDoc(doc(adDb, 'users', 'emp1', 'assignments', 'a1')));

  // Planned endDate assignment (expired-open) can be closed once, then locked against re-closing
  await assertSucceeds(
    setDoc(doc(adDb, 'users', 'emp1', 'assignments', 'a_planned'), {
      ...assignPayload,
      kind: 'additional_charge',
      officeId: 'upz2',
      officeName: 'Upazila 2',
      type: 'charge_started',
      startDate: '2026-11-01',
      endDate: '2026-11-15'
    })
  );
  await assertSucceeds(
    updateDoc(doc(adDb, 'users', 'emp1', 'assignments', 'a_planned'), {
      endDate: '2026-11-15',
      closedBy: 'ad1',
      closedAt: serverTimestamp()
    })
  );
  await assertFails(
    updateDoc(doc(adDb, 'users', 'emp1', 'assignments', 'a_planned'), {
      endDate: '2026-11-16',
      closedBy: 'ad1',
      closedAt: serverTimestamp()
    })
  );

  // Create attendance at old office upz1 before transfer
  await assertSucceeds(
    setDoc(doc(empDb, 'attendance', 'emp1_2026-11-18'), {
      uid: 'emp1',
      employeeName: 'Test emp1',
      designation: 'employee',
      officeId: 'upz1',
      districtOfficeId: 'dist1',
      homeOfficeId: 'upz1',
      homeDistrictOfficeId: 'dist1',
      date: '2026-11-18',
      isFieldDuty: false,
      checkIn: validPunch('dev-12345', 'attendance/emp1/2026-11-18_in.jpg'),
      checkOut: null,
      initialStatus: 'সময়মতো',
      finalStatus: null,
      settled: false,
      settledBy: null,
      settledByName: null,
      settledAt: null,
      districtComment: null,
      photoDeleted: false,
      photoDeletedAt: null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    })
  );

  // Batched transfer inside AD's subtree: open record -> close old + open new + update user
  await assertSucceeds(
    setDoc(doc(adDb, 'users', 'emp1', 'assignments', 'a_open'), {
      ...assignPayload,
      startDate: '2026-11-20',
      endDate: null
    })
  );
  const transferBatch = writeBatch(adDb);
  transferBatch.update(doc(adDb, 'users', 'emp1'), {
    officeId: 'upz2',
    districtOfficeId: 'dist1',
    designation: 'Senior Assistant',
    updatedAt: serverTimestamp()
  });
  transferBatch.update(doc(adDb, 'users', 'emp1', 'assignments', 'a_open'), {
    endDate: '2026-11-24',
    closedBy: 'ad1',
    closedAt: serverTimestamp()
  });
  transferBatch.set(doc(adDb, 'users', 'emp1', 'assignments', 'a_transfer'), {
    kind: 'primary',
    officeId: 'upz2',
    districtOfficeId: 'dist1',
    officeName: 'Upazila 2',
    designation: 'Senior Assistant',
    roleKey: 'employee',
    roleLabel: 'Employee',
    startDate: '2026-11-25',
    endDate: null,
    type: 'transfer',
    orderNo: 'ORD-02',
    orderDate: '2026-11-20',
    reason: 'Intra-district transfer',
    createdBy: 'ad1',
    createdByName: 'AD 1',
    createdAt: serverTimestamp()
  });
  await assertSucceeds(transferBatch.commit());

  // Old attendance and leave records remain attributed to upz1 (old office) after transfer
  const unfeo1Db = testEnv.authenticatedContext('unfeo1').firestore();
  const unfeoU2Db = testEnv.authenticatedContext('unfeo_u2').firestore();
  const oldAttSnap = await assertSucceeds(getDoc(doc(unfeo1Db, 'attendance', 'emp1_2026-11-18')));
  assert.equal(oldAttSnap.data().officeId, 'upz1');
  assert.equal(oldAttSnap.data().homeOfficeId, 'upz1');
  await assertFails(getDoc(doc(unfeoU2Db, 'attendance', 'emp1_2026-11-18')));

  const oldLeaveSnap = await assertSucceeds(getDoc(doc(unfeo1Db, 'leaves', 'l_emp1')));
  assert.equal(oldLeaveSnap.data().officeId, 'upz1');
  await assertFails(getDoc(doc(unfeoU2Db, 'leaves', 'l_emp1')));

  // Cross-district transfer by subtree AD is DENIED
  const badTransferBatch = writeBatch(adDb);
  badTransferBatch.update(doc(adDb, 'users', 'emp1'), {
    officeId: 'upz_other',
    districtOfficeId: 'dist_other',
    updatedAt: serverTimestamp()
  });
  badTransferBatch.update(doc(adDb, 'users', 'emp1', 'assignments', 'a_transfer'), {
    endDate: '2026-11-29',
    closedBy: 'ad1',
    closedAt: serverTimestamp()
  });
  await assertFails(badTransferBatch.commit());

  // Bootstrap super user can create & close assignment even before profile doc exists
  await assertSucceeds(
    setDoc(doc(bootDb, 'users', 'emp1', 'assignments', 'a_boot'), {
      ...assignPayload,
      createdBy: 'boot1',
      createdByName: 'Bootstrap Admin'
    })
  );
  await assertSucceeds(
    updateDoc(doc(bootDb, 'users', 'emp1', 'assignments', 'a_boot'), {
      endDate: '2026-11-28',
      closedBy: 'boot1',
      closedAt: serverTimestamp()
    })
  );

  // Restore emp1 to upz1 for downstream tests (using bootDb)
  await assertSucceeds(
    updateDoc(doc(bootDb, 'users', 'emp1'), {
      officeId: 'upz1',
      districtOfficeId: 'dist1',
      designation: 'employee',
      updatedAt: serverTimestamp()
    })
  );

  // Audit log actorRole pinning
  await assertFails(
    setDoc(doc(adDb, 'auditLogs', 'log_bad_role'), {
      actorUid: 'ad1',
      actorName: 'AD 1',
      actorRole: 'administrator',
      officeId: 'dist1',
      districtOfficeId: 'dist1',
      action: 'SPOOF',
      targetCollection: 'users',
      targetId: 'emp1',
      reason: 'Spoof attempt',
      timestamp: serverTimestamp()
    })
  );
  await assertSucceeds(
    setDoc(doc(adDb, 'auditLogs', 'log_good_role'), {
      actorUid: 'ad1',
      actorName: 'AD 1',
      actorRole: 'assistant_director',
      officeId: 'dist1',
      districtOfficeId: 'dist1',
      action: 'APPROVE',
      targetCollection: 'users',
      targetId: 'emp1',
      reason: 'Valid log',
      timestamp: serverTimestamp()
    })
  );
  await assertSucceeds(
    setDoc(doc(bootDb, 'auditLogs', 'log_boot'), {
      actorUid: 'boot1',
      actorName: 'Bootstrap',
      actorRole: 'bootstrap',
      action: 'ROLE_CREATED',
      targetCollection: 'roles',
      targetId: 'employee',
      reason: 'Seed',
      timestamp: serverTimestamp()
    })
  );
});

test('Bootstrap super user & registration defaultRole protections', async () => {
  const bootDb = bootstrapDb();
  const adminDb = testEnv.authenticatedContext('admin1').firestore();

  // Bootstrap super user cannot check in or review leave without an assigned role
  await assertFails(
    setDoc(doc(bootDb, 'attendance', 'boot1_2026-11-20'), {
      uid: 'boot1',
      employeeName: 'Boot',
      officeId: 'head',
      districtOfficeId: '',
      homeOfficeId: 'head',
      date: '2026-11-20',
      checkIn: validPunch('dev-12345', 'attendance/boot1/in.jpg'),
      initialStatus: 'সময়মতো',
      settled: false,
      photoDeleted: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    })
  );
  await assertFails(
    updateDoc(doc(bootDb, 'leaves', 'l_emp1'), {
      status: 'approved',
      reviewedBy: 'boot1',
      reviewedByName: 'Boot',
      reviewedAt: serverTimestamp()
    })
  );

  // Bootstrap user can create own approved profile without role field
  await assertSucceeds(
    setDoc(doc(bootDb, 'users', 'boot1'), {
      uid: 'boot1',
      name: 'Bootstrap Admin',
      designation: 'System Owner',
      address: 'Dhaka',
      mobile: '01700000001',
      email: 'absiddik5177@gmail.com',
      officeId: 'head',
      districtOfficeId: '',
      joiningDate: '2026-01-01',
      status: 'active',
      resignationDate: null,
      profilePhotoPath: '',
      approvalStatus: 'approved',
      boundDeviceId: null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    })
  );

  // settings/permissions is removed/denied
  await assertFails(getDoc(doc(adminDb, 'settings', 'permissions')));

  // Self-registration uses settings/app.defaultRole; rejects elevated role
  const newRegDb = testEnv.authenticatedContext('new_reg1').firestore();
  const regPayload = (role) => ({
    uid: 'new_reg1',
    name: 'New Registrant',
    designation: 'Clerk',
    address: 'Savar',
    mobile: '01799999999',
    email: 'new_reg1@ems.gov.bd',
    officeId: 'upz1',
    districtOfficeId: 'dist1',
    joiningDate: '2026-11-20',
    status: 'active',
    resignationDate: null,
    profilePhotoPath: '',
    role,
    approvalStatus: 'pending',
    boundDeviceId: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  await assertFails(setDoc(doc(newRegDb, 'users', 'new_reg1'), regPayload('administrator')));
  await assertSucceeds(setDoc(doc(newRegDb, 'users', 'new_reg1'), regPayload('employee')));
});

test('Storage rules: dynamic attendance photos & orders/{uid}/{file} authorization', async () => {
  const empStorage = testEnv.authenticatedContext('emp1').storage();
  const emp2Storage = testEnv.authenticatedContext('emp2').storage();
  const unfeoStorage = testEnv.authenticatedContext('unfeo1').storage();
  const adStorage = testEnv.authenticatedContext('ad1').storage();
  const otherAdStorage = testEnv.authenticatedContext('ad_other').storage();

  const validJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  const validPdf = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

  await assertSucceeds(uploadBytes(ref(empStorage, 'attendance/emp1/in.jpg'), validJpeg, { contentType: 'image/jpeg' }));
  await assertFails(getBytes(ref(empStorage, 'attendance/emp1/in.jpg')));
  await assertSucceeds(getBytes(ref(unfeoStorage, 'attendance/emp1/in.jpg')));
  await assertSucceeds(getBytes(ref(adStorage, 'attendance/emp1/in.jpg')));
  await assertFails(getBytes(ref(otherAdStorage, 'attendance/emp1/in.jpg')));

  await assertFails(deleteObject(ref(unfeoStorage, 'attendance/emp1/in.jpg')));
  await assertSucceeds(deleteObject(ref(adStorage, 'attendance/emp1/in.jpg')));

  // Orders path: AD uploads PDF <= 5MB for emp1; emp1 and unfeo1 can read; emp2 cannot read; delete denied
  await assertSucceeds(uploadBytes(ref(adStorage, 'orders/emp1/order1.pdf'), validPdf, { contentType: 'application/pdf' }));
  await assertSucceeds(getBytes(ref(empStorage, 'orders/emp1/order1.pdf')));
  await assertSucceeds(getBytes(ref(unfeoStorage, 'orders/emp1/order1.pdf')));
  await assertFails(getBytes(ref(emp2Storage, 'orders/emp1/order1.pdf')));
  await assertFails(deleteObject(ref(adStorage, 'orders/emp1/order1.pdf')));
});

test('Scoped allow list queries pass static constraint checks across all collections', async () => {
  const emp1Db = testEnv.authenticatedContext('emp1').firestore();
  const unfeo1Db = testEnv.authenticatedContext('unfeo1').firestore();
  const ad1Db = testEnv.authenticatedContext('ad1').firestore();
  const hoDb = testEnv.authenticatedContext('ho1').firestore();

  // Users: unscoped list fails for emp1/unfeo1/ad1, succeeds for ho1; scoped list succeeds
  await assertFails(getDocs(collection(emp1Db, 'users')));
  await assertFails(getDocs(collection(unfeo1Db, 'users')));
  await assertFails(getDocs(collection(ad1Db, 'users')));
  await assertSucceeds(getDocs(collection(hoDb, 'users')));

  await assertSucceeds(getDocs(query(collection(emp1Db, 'users'), where('officeId', '==', 'upz1'))));
  await assertSucceeds(getDocs(query(collection(emp1Db, 'users'), where('additionalOfficeIds', 'array-contains', 'upz1'))));
  await assertSucceeds(getDocs(query(collection(emp1Db, 'users'), where('attachedOfficeId', '==', 'upz1'))));
  await assertSucceeds(getDocs(query(collection(emp1Db, 'users'), where('actingOfficeId', '==', 'upz1'))));
  await assertFails(getDocs(query(collection(emp1Db, 'users'), where('districtOfficeId', '==', 'dist1'))));
  await assertSucceeds(getDocs(query(collection(unfeo1Db, 'users'), where('districtOfficeId', '==', 'dist1'))));
  await assertSucceeds(getDocs(query(collection(ad1Db, 'users'), where('districtOfficeId', '==', 'dist1'))));
  await assertFails(getDocs(query(collection(emp1Db, 'users'), where('officeId', '==', 'upz2'))));

  // Subcollection assignments list
  await assertSucceeds(getDocs(collection(emp1Db, 'users', 'emp1', 'assignments')));
  await assertSucceeds(getDocs(collection(unfeo1Db, 'users', 'emp1', 'assignments')));

  // Attendance list
  await assertSucceeds(getDocs(query(collection(emp1Db, 'attendance'), where('uid', '==', 'emp1'))));
  await assertFails(getDocs(query(collection(emp1Db, 'attendance'), where('officeId', '==', 'upz1'))));
  await assertSucceeds(getDocs(query(collection(unfeo1Db, 'attendance'), where('officeId', '==', 'upz1'))));
  await assertSucceeds(getDocs(query(collection(ad1Db, 'attendance'), where('districtOfficeId', '==', 'dist1'))));
  await assertSucceeds(getDocs(query(collection(ad1Db, 'attendance'), where('homeDistrictOfficeId', '==', 'dist1'))));
  await assertSucceeds(getDocs(query(collection(ad1Db, 'attendance'), where('checkOutDistrictOfficeId', '==', 'dist1'))));

  // Leaves & fieldDuties list
  await assertSucceeds(getDocs(query(collection(emp1Db, 'leaves'), where('uid', '==', 'emp1'))));
  await assertFails(getDocs(query(collection(emp1Db, 'leaves'), where('officeId', '==', 'upz1'))));
  await assertSucceeds(getDocs(query(collection(unfeo1Db, 'leaves'), where('officeId', '==', 'upz1'))));
  await assertSucceeds(getDocs(query(collection(ad1Db, 'leaves'), where('districtOfficeId', '==', 'dist1'))));
  await assertSucceeds(getDocs(query(collection(ad1Db, 'fieldDuties'), where('districtOfficeId', '==', 'dist1'))));

  // Reports & auditLogs list
  await assertFails(getDocs(query(collection(emp1Db, 'reports'), where('officeId', '==', 'upz1'))));
  await assertSucceeds(getDocs(query(collection(unfeo1Db, 'reports'), where('districtOfficeId', '==', 'dist1'))));
  await assertSucceeds(getDocs(query(collection(ad1Db, 'reports'), where('districtOfficeId', '==', 'dist1'))));
  await assertSucceeds(getDocs(query(collection(ad1Db, 'auditLogs'), where('districtOfficeId', '==', 'dist1'))));
});

test('Informational devices subcollection & existing boundDeviceId/resetDevice flows', async () => {
  const emp1Db = testEnv.authenticatedContext('emp1').firestore();
  const emp2Db = testEnv.authenticatedContext('emp2').firestore();
  const unfeo1Db = testEnv.authenticatedContext('unfeo1').firestore();
  const ad1Db = testEnv.authenticatedContext('ad1').firestore();
  const adOtherDb = testEnv.authenticatedContext('ad_other').firestore();
  const adminDb = testEnv.authenticatedContext('admin1').firestore();
  const bootDb = bootstrapDb();

  // Existing boundDeviceId reset + re-bind flow stays intact
  await assertSucceeds(
    updateDoc(doc(unfeo1Db, 'users', 'emp1'), {
      boundDeviceId: null,
      updatedAt: serverTimestamp()
    })
  );
  await assertSucceeds(
    updateDoc(doc(emp1Db, 'users', 'emp1'), {
      boundDeviceId: 'dev_aabbccddeeff001122334455',
      updatedAt: serverTimestamp()
    })
  );
  await assertFails(
    updateDoc(doc(emp1Db, 'users', 'emp1'), {
      boundDeviceId: 'dev_999999999999999999999999',
      updatedAt: serverTimestamp()
    })
  );

  const validDeviceDoc = {
    deviceId: 'dev_aabbccddeeff001122334455',
    name: 'Pixel 8 · Chrome',
    model: 'Pixel 8',
    manufacturer: 'Google',
    platform: 'Android',
    osVersion: 'Android 14',
    appVersion: 'web',
    engine: 'Blink (Chrome 128)',
    screen: '412x915',
    timezone: 'Asia/Dhaka',
    language: 'en-US',
    ip: '103.10.20.30',
    firstSeenAt: serverTimestamp(),
    lastSeenAt: serverTimestamp(),
    loginCount: 1,
    status: 'seen'
  };

  // Owner create succeeds (with ip and blocked without ip)
  await assertSucceeds(
    setDoc(doc(emp1Db, 'users', 'emp1', 'devices', 'dev_aabbccddeeff001122334455'), validDeviceDoc)
  );
  const blockedWithoutIp = {
    ...validDeviceDoc,
    deviceId: 'dev_blocked_device_12345',
    status: 'blocked'
  };
  delete blockedWithoutIp.ip;
  await assertSucceeds(
    setDoc(doc(emp1Db, 'users', 'emp1', 'devices', 'dev_blocked_device_12345'), blockedWithoutIp)
  );

  // Create rejects mismatched doc ID or other user writing
  await assertFails(
    setDoc(doc(emp1Db, 'users', 'emp1', 'devices', 'dev_other_id_123456'), validDeviceDoc)
  );
  await assertFails(
    setDoc(doc(emp2Db, 'users', 'emp1', 'devices', 'dev_aabbccddeeff001122334455'), validDeviceDoc)
  );

  // Owner update succeeds with loginCount + 1 and immutable deviceId/firstSeenAt
  await assertSucceeds(
    updateDoc(doc(emp1Db, 'users', 'emp1', 'devices', 'dev_aabbccddeeff001122334455'), {
      name: 'Pixel 8 Pro · Chrome',
      model: 'Pixel 8 Pro',
      ip: '103.10.20.31',
      lastSeenAt: serverTimestamp(),
      loginCount: 2,
      status: 'seen'
    })
  );

  // Reject loginCount jump > 1, firstSeenAt overwrite, or status typo
  await assertFails(
    updateDoc(doc(emp1Db, 'users', 'emp1', 'devices', 'dev_aabbccddeeff001122334455'), {
      lastSeenAt: serverTimestamp(),
      loginCount: 4
    })
  );
  await assertFails(
    updateDoc(doc(emp1Db, 'users', 'emp1', 'devices', 'dev_aabbccddeeff001122334455'), {
      firstSeenAt: serverTimestamp(),
      lastSeenAt: serverTimestamp(),
      loginCount: 3
    })
  );
  await assertFails(
    updateDoc(doc(emp1Db, 'users', 'emp1', 'devices', 'dev_aabbccddeeff001122334455'), {
      lastSeenAt: serverTimestamp(),
      loginCount: 3,
      status: 'bound'
    })
  );

  // In-scope admins & owner can read/list; out-of-scope admin & sibling employee denied
  await assertSucceeds(getDoc(doc(emp1Db, 'users', 'emp1', 'devices', 'dev_aabbccddeeff001122334455')));
  await assertSucceeds(getDocs(collection(emp1Db, 'users', 'emp1', 'devices')));
  await assertSucceeds(getDoc(doc(unfeo1Db, 'users', 'emp1', 'devices', 'dev_aabbccddeeff001122334455')));
  await assertSucceeds(getDocs(collection(unfeo1Db, 'users', 'emp1', 'devices')));
  await assertSucceeds(getDoc(doc(ad1Db, 'users', 'emp1', 'devices', 'dev_aabbccddeeff001122334455')));
  await assertSucceeds(getDocs(collection(ad1Db, 'users', 'emp1', 'devices')));
  await assertSucceeds(getDocs(collection(adminDb, 'users', 'emp1', 'devices')));

  await assertFails(getDoc(doc(emp2Db, 'users', 'emp1', 'devices', 'dev_aabbccddeeff001122334455')));
  await assertFails(getDocs(collection(emp2Db, 'users', 'emp1', 'devices')));
  await assertFails(getDoc(doc(adOtherDb, 'users', 'emp1', 'devices', 'dev_aabbccddeeff001122334455')));
  await assertFails(getDocs(collection(adOtherDb, 'users', 'emp1', 'devices')));

  // Delete denied for everyone
  await assertFails(deleteDoc(doc(emp1Db, 'users', 'emp1', 'devices', 'dev_aabbccddeeff001122334455')));
  await assertFails(deleteDoc(doc(adminDb, 'users', 'emp1', 'devices', 'dev_aabbccddeeff001122334455')));
  await assertFails(deleteDoc(doc(bootDb, 'users', 'emp1', 'devices', 'dev_aabbccddeeff001122334455')));
});
