import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds
} from '@firebase/rules-unit-testing';
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  Timestamp
} from 'firebase/firestore';
import { ref, uploadBytes, getBytes, deleteObject } from 'firebase/storage';

const PROJECT_ID = 'iron-ivy-jvc14';
const FIRESTORE_RULES = fs.readFileSync('firestore.rules', 'utf8');
const STORAGE_RULES = fs.readFileSync('storage.rules', 'utf8');

let testEnv;

function tsNow() {
  return Timestamp.now();
}

function makeUser(uid, role, officeId, overrides = {}) {
  return {
    uid,
    name: `Test ${uid}`,
    designation: role,
    address: 'Dhaka',
    mobile: '01700000000',
    email: `${uid}@ems.gov.bd`,
    officeId,
    districtOfficeId: overrides.districtOfficeId ?? officeId,
    additionalOfficeIds: overrides.additionalOfficeIds ?? [],
    joiningDate: '2026-01-01',
    status: 'active',
    resignationDate: null,
    profilePhotoPath: '',
    role,
    approvalStatus: 'approved',
    boundDeviceId: 'dev-12345',
    createdAt: tsNow(),
    updatedAt: tsNow(),
    ...overrides
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
    await setDoc(doc(db, 'settings', 'app'), {
      registrationOpen: true,
      updatedAt: tsNow(),
      updatedBy: 'sa1'
    });

    await setDoc(doc(db, 'offices', 'head'), {
      name: 'Head Office',
      address: 'Dhaka',
      level: 'head',
      parentOfficeId: null,
      lat: 23.76,
      lng: 90.39,
      geofenceRadiusMeters: 150,
      startTime: '09:00',
      graceMinutes: 15,
      endTime: '17:00',
      createdAt: tsNow(),
      updatedAt: tsNow()
    });

    await setDoc(doc(db, 'offices', 'dist1'), {
      name: 'District 1',
      address: 'Dhaka',
      level: 'district',
      parentOfficeId: 'head',
      lat: 23.73,
      lng: 90.40,
      geofenceRadiusMeters: 100,
      startTime: '09:00',
      graceMinutes: 15,
      endTime: '17:00',
      createdAt: tsNow(),
      updatedAt: tsNow()
    });

    await setDoc(doc(db, 'offices', 'dist2'), {
      name: 'District 2',
      address: 'Gazipur',
      level: 'district',
      parentOfficeId: 'head',
      lat: 23.99,
      lng: 90.42,
      geofenceRadiusMeters: 100,
      startTime: '09:00',
      graceMinutes: 15,
      endTime: '17:00',
      createdAt: tsNow(),
      updatedAt: tsNow()
    });

    await setDoc(doc(db, 'offices', 'upz1'), {
      name: 'Upazila 1',
      address: 'Savar',
      level: 'upazila',
      parentOfficeId: 'dist1',
      lat: 23.85,
      lng: 90.26,
      geofenceRadiusMeters: 100,
      startTime: '09:00',
      graceMinutes: 15,
      endTime: '17:00',
      createdAt: tsNow(),
      updatedAt: tsNow()
    });

    await setDoc(doc(db, 'offices', 'upz2'), {
      name: 'Upazila 2',
      address: 'Dhamrai',
      level: 'upazila',
      parentOfficeId: 'dist1',
      lat: 23.91,
      lng: 90.21,
      geofenceRadiusMeters: 100,
      startTime: '09:00',
      graceMinutes: 15,
      endTime: '17:00',
      createdAt: tsNow(),
      updatedAt: tsNow()
    });

    await setDoc(doc(db, 'offices', 'upz_d2'), {
      name: 'Upazila D2',
      address: 'Kaliakair',
      level: 'upazila',
      parentOfficeId: 'dist2',
      lat: 24.07,
      lng: 90.21,
      geofenceRadiusMeters: 100,
      startTime: '09:00',
      graceMinutes: 15,
      endTime: '17:00',
      createdAt: tsNow(),
      updatedAt: tsNow()
    });

    await setDoc(doc(db, 'users', 'sa1'), makeUser('sa1', 'super_admin', 'head', { districtOfficeId: '' }));
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
    await setDoc(doc(db, 'users', 'emp1'), makeUser('emp1', 'employee', 'upz1', { districtOfficeId: 'dist1' }));
    await setDoc(doc(db, 'users', 'emp2'), makeUser('emp2', 'employee', 'upz2', { districtOfficeId: 'dist1' }));
    await setDoc(doc(db, 'users', 'emp_d2'), makeUser('emp_d2', 'employee', 'upz_d2', { districtOfficeId: 'dist2' }));
    await setDoc(doc(db, 'users', 'emp_other'), makeUser('emp_other', 'employee', 'upz_other', { districtOfficeId: 'dist_other' }));

    // Legacy user alias test fixtures
    await setDoc(doc(db, 'users', 'leg_oh'), makeUser('leg_oh', 'office_head', 'upz1', { districtOfficeId: 'dist1' }));
    await setDoc(doc(db, 'users', 'leg_do'), makeUser('leg_do', 'district_officer', 'dist1', { districtOfficeId: 'dist1' }));

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
    await setDoc(doc(db, 'leaves', 'l_emp1'), { ...baseLeave, uid: 'emp1', employeeName: 'Emp 1', officeId: 'upz1', districtOfficeId: 'dist1' });
    await setDoc(doc(db, 'leaves', 'l_emp2'), { ...baseLeave, uid: 'emp2', employeeName: 'Emp 2', officeId: 'upz2', districtOfficeId: 'dist1' });
    await setDoc(doc(db, 'leaves', 'l_unfeo1'), { ...baseLeave, uid: 'unfeo1', employeeName: 'UNFEO 1', officeId: 'upz1', districtOfficeId: 'dist1' });
    await setDoc(doc(db, 'leaves', 'l_unfeo2'), { ...baseLeave, uid: 'unfeo2', employeeName: 'UNFEO 2', officeId: 'upz1', districtOfficeId: 'dist1' });
    await setDoc(doc(db, 'leaves', 'l_ad1'), { ...baseLeave, uid: 'ad1', employeeName: 'AD 1', officeId: 'dist1', districtOfficeId: 'dist1' });
    await setDoc(doc(db, 'leaves', 'l_emp_d2'), { ...baseLeave, uid: 'emp_d2', employeeName: 'Emp D2', officeId: 'upz_d2', districtOfficeId: 'dist2' });
    await setDoc(doc(db, 'leaves', 'l_emp_other'), { ...baseLeave, uid: 'emp_other', employeeName: 'Emp Other', officeId: 'upz_other', districtOfficeId: 'dist_other' });

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
    await setDoc(doc(db, 'fieldDuties', 'fd_emp1'), { ...baseFd, uid: 'emp1', employeeName: 'Emp 1', officeId: 'upz1', districtOfficeId: 'dist1' });
    await setDoc(doc(db, 'fieldDuties', 'fd_ad1'), { ...baseFd, uid: 'ad1', employeeName: 'AD 1', officeId: 'dist1', districtOfficeId: 'dist1' });

    // Attendance
    await setDoc(doc(db, 'attendance', 'emp1_2026-11-18'), {
      uid: 'emp1',
      employeeName: 'Emp 1',
      designation: 'employee',
      officeId: 'upz1',
      districtOfficeId: 'dist1',
      date: '2026-11-18',
      isFieldDuty: false,
      checkIn: {
        time: tsNow(),
        lat: 23.85,
        lng: 90.26,
        accuracy: 10,
        distanceMeters: 5,
        deviceId: 'dev-12345',
        photoPath: 'attendance/emp1/in.jpg',
        photoDeleted: false
      },
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

test('UNFEO leave review rules: own-office employee allowed; own/peer UNFEO/other-office denied', async () => {
  const unfeoDb = testEnv.authenticatedContext('unfeo1').firestore();

  await assertSucceeds(
    updateDoc(doc(unfeoDb, 'leaves', 'l_emp1'), {
      status: 'approved',
      reviewedBy: 'unfeo1',
      reviewedByName: 'UNFEO 1',
      reviewComment: 'OK',
      reviewedAt: serverTimestamp()
    })
  );

  // Own leave denied
  await assertFails(
    updateDoc(doc(unfeoDb, 'leaves', 'l_unfeo1'), {
      status: 'approved',
      reviewedBy: 'unfeo1',
      reviewedByName: 'UNFEO 1',
      reviewComment: 'Self',
      reviewedAt: serverTimestamp()
    })
  );

  // Another UNFEO leave denied
  await assertFails(
    updateDoc(doc(unfeoDb, 'leaves', 'l_unfeo2'), {
      status: 'approved',
      reviewedBy: 'unfeo1',
      reviewedByName: 'UNFEO 1',
      reviewComment: 'Peer',
      reviewedAt: serverTimestamp()
    })
  );

  // Employee in another upazila denied
  await assertFails(
    updateDoc(doc(unfeoDb, 'leaves', 'l_emp2'), {
      status: 'approved',
      reviewedBy: 'unfeo1',
      reviewedByName: 'UNFEO 1',
      reviewComment: 'Out of office',
      reviewedAt: serverTimestamp()
    })
  );
});

test('UNFEO is denied attendance settlement and field duty review', async () => {
  const unfeoDb = testEnv.authenticatedContext('unfeo1').firestore();

  await assertFails(
    updateDoc(doc(unfeoDb, 'attendance', 'emp1_2026-11-18'), {
      finalStatus: 'On Time',
      settled: true,
      settledBy: 'unfeo1',
      settledByName: 'UNFEO 1',
      settledAt: serverTimestamp(),
      districtComment: 'Attempted settle',
      photoDeleted: true,
      photoDeletedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    })
  );

  await assertFails(
    updateDoc(doc(unfeoDb, 'fieldDuties', 'fd_emp1'), {
      status: 'approved',
      reviewedBy: 'unfeo1',
      reviewedByName: 'UNFEO 1',
      reviewComment: 'Attempted FD review',
      reviewedAt: serverTimestamp()
    })
  );
});

test('Assistant Director: subtree + additionalOfficeIds work; self-approval and other-district denied', async () => {
  const adDb = testEnv.authenticatedContext('ad1').firestore();

  // Subtree UNFEO leave approved
  await assertSucceeds(
    updateDoc(doc(adDb, 'leaves', 'l_unfeo1'), {
      status: 'approved',
      reviewedBy: 'ad1',
      reviewedByName: 'AD 1',
      reviewComment: 'Approved',
      reviewedAt: serverTimestamp()
    })
  );

  // Additional charge district employee leave approved
  await assertSucceeds(
    updateDoc(doc(adDb, 'leaves', 'l_emp_d2'), {
      status: 'approved',
      reviewedBy: 'ad1',
      reviewedByName: 'AD 1',
      reviewComment: 'Additional charge',
      reviewedAt: serverTimestamp()
    })
  );

  // Own leave denied
  await assertFails(
    updateDoc(doc(adDb, 'leaves', 'l_ad1'), {
      status: 'approved',
      reviewedBy: 'ad1',
      reviewedByName: 'AD 1',
      reviewComment: 'Self',
      reviewedAt: serverTimestamp()
    })
  );

  // Unrelated district denied
  await assertFails(
    updateDoc(doc(adDb, 'leaves', 'l_emp_other'), {
      status: 'approved',
      reviewedBy: 'ad1',
      reviewedByName: 'AD 1',
      reviewComment: 'Other district',
      reviewedAt: serverTimestamp()
    })
  );

  // Subtree field duty approved
  await assertSucceeds(
    updateDoc(doc(adDb, 'fieldDuties', 'fd_emp1'), {
      status: 'approved',
      reviewedBy: 'ad1',
      reviewedByName: 'AD 1',
      reviewComment: 'OK',
      reviewedAt: serverTimestamp()
    })
  );

  // Own field duty denied
  await assertFails(
    updateDoc(doc(adDb, 'fieldDuties', 'fd_ad1'), {
      status: 'approved',
      reviewedBy: 'ad1',
      reviewedByName: 'AD 1',
      reviewComment: 'Self FD',
      reviewedAt: serverTimestamp()
    })
  );
});

test('Director General approves Assistant Director leave, cannot approve employee/UNFEO leave or settle', async () => {
  const dgDb = testEnv.authenticatedContext('dg1').firestore();

  await assertSucceeds(
    updateDoc(doc(dgDb, 'leaves', 'l_ad1'), {
      status: 'approved',
      reviewedBy: 'dg1',
      reviewedByName: 'DG',
      reviewComment: 'Granted',
      reviewedAt: serverTimestamp()
    })
  );

  await assertFails(
    updateDoc(doc(dgDb, 'leaves', 'l_emp1'), {
      status: 'approved',
      reviewedBy: 'dg1',
      reviewedByName: 'DG',
      reviewComment: 'Skip chain',
      reviewedAt: serverTimestamp()
    })
  );
});

test('Super Admin is read-only on business workflows and protected against deletion/self-demotion', async () => {
  const saDb = testEnv.authenticatedContext('sa1').firestore();

  // Super Admin cannot settle attendance or review leave
  await assertFails(
    updateDoc(doc(saDb, 'leaves', 'l_emp1'), {
      status: 'approved',
      reviewedBy: 'sa1',
      reviewedByName: 'SA',
      reviewComment: 'Bypass',
      reviewedAt: serverTimestamp()
    })
  );

  await assertFails(
    updateDoc(doc(saDb, 'attendance', 'emp1_2026-11-18'), {
      finalStatus: 'On Time',
      settled: true,
      settledBy: 'sa1',
      settledByName: 'SA',
      settledAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    })
  );

  // Super Admin cannot self-demote or delete another super_admin
  await assertFails(
    updateDoc(doc(saDb, 'users', 'sa1'), {
      role: 'employee',
      updatedAt: serverTimestamp()
    })
  );
  await assertFails(deleteDoc(doc(saDb, 'users', 'sa1')));

  // Can delete normal employee
  await assertSucceeds(deleteDoc(doc(saDb, 'users', 'emp_other')));
});

test('Privilege escalation blocked for employee, UNFEO, and Assistant Director', async () => {
  const empDb = testEnv.authenticatedContext('emp1').firestore();
  const unfeoDb = testEnv.authenticatedContext('unfeo1').firestore();
  const adDb = testEnv.authenticatedContext('ad1').firestore();

  await assertFails(
    updateDoc(doc(empDb, 'users', 'emp1'), {
      role: 'super_admin',
      updatedAt: serverTimestamp()
    })
  );

  await assertFails(
    updateDoc(doc(unfeoDb, 'users', 'emp1'), {
      role: 'assistant_director',
      updatedAt: serverTimestamp()
    })
  );

  await assertFails(
    updateDoc(doc(adDb, 'users', 'emp1'), {
      role: 'assistant_director',
      updatedAt: serverTimestamp()
    })
  );

  await assertSucceeds(
    updateDoc(doc(adDb, 'users', 'emp1'), {
      role: 'unfeo',
      updatedAt: serverTimestamp()
    })
  );
});

test('Legacy role names continue working via MIGRATION_COMPAT aliases', async () => {
  const legOhDb = testEnv.authenticatedContext('leg_oh').firestore();
  const legDoDb = testEnv.authenticatedContext('leg_do').firestore();

  await assertSucceeds(
    updateDoc(doc(legOhDb, 'leaves', 'l_emp1'), {
      status: 'approved',
      reviewedBy: 'leg_oh',
      reviewedByName: 'Legacy OH',
      reviewComment: 'OK',
      reviewedAt: serverTimestamp()
    })
  );

  await assertSucceeds(
    updateDoc(doc(legDoDb, 'fieldDuties', 'fd_emp1'), {
      status: 'approved',
      reviewedBy: 'leg_do',
      reviewedByName: 'Legacy DO',
      reviewComment: 'OK',
      reviewedAt: serverTimestamp()
    })
  );
});

test('Storage rules enforce attendance photo scope and upload limits', async () => {
  const empStorage = testEnv.authenticatedContext('emp1').storage();
  const unfeoStorage = testEnv.authenticatedContext('unfeo1').storage();
  const adStorage = testEnv.authenticatedContext('ad1').storage();
  const otherAdStorage = testEnv.authenticatedContext('ad_other').storage();

  const validJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  const oversized = new Uint8Array(2 * 1024 * 1024 + 10);

  // Employee can upload JPEG <= 2MB to own path
  await assertSucceeds(uploadBytes(ref(empStorage, 'attendance/emp1/in.jpg'), validJpeg, { contentType: 'image/jpeg' }));
  // Oversized denied
  await assertFails(uploadBytes(ref(empStorage, 'attendance/emp1/big.jpg'), oversized, { contentType: 'image/jpeg' }));
  // Upload to another UID denied
  await assertFails(uploadBytes(ref(empStorage, 'attendance/emp2/in.jpg'), validJpeg, { contentType: 'image/jpeg' }));

  // Employee cannot read own/others attendance photo; UNFEO (own office) and AD (subtree) can read; other AD denied
  await assertFails(getBytes(ref(empStorage, 'attendance/emp1/in.jpg')));
  await assertSucceeds(getBytes(ref(unfeoStorage, 'attendance/emp1/in.jpg')));
  await assertSucceeds(getBytes(ref(adStorage, 'attendance/emp1/in.jpg')));
  await assertFails(getBytes(ref(otherAdStorage, 'attendance/emp1/in.jpg')));

  // UNFEO cannot delete attendance photo; AD can delete
  await assertFails(deleteObject(ref(unfeoStorage, 'attendance/emp1/in.jpg')));
  await assertSucceeds(deleteObject(ref(adStorage, 'attendance/emp1/in.jpg')));
});

test('settings/permissions: only super_admin can write; signed-in users can get; schema & anti-lockout enforced', async () => {
  const saDb = testEnv.authenticatedContext('sa1').firestore();
  const dgDb = testEnv.authenticatedContext('dg1').firestore();
  const adDb = testEnv.authenticatedContext('ad1').firestore();
  const unfeoDb = testEnv.authenticatedContext('unfeo1').firestore();
  const empDb = testEnv.authenticatedContext('emp1').firestore();
  const anonDb = testEnv.unauthenticatedContext().firestore();

  const validPayload = {
    overrides: {
      head_office_officer: {
        'audit.view': 'all'
      }
    },
    updatedAt: serverTimestamp(),
    updatedBy: 'sa1',
    updatedByName: 'Super Admin'
  };

  // Non-super-admins cannot write settings/permissions
  await assertFails(setDoc(doc(dgDb, 'settings', 'permissions'), { ...validPayload, updatedBy: 'dg1' }));
  await assertFails(setDoc(doc(adDb, 'settings', 'permissions'), { ...validPayload, updatedBy: 'ad1' }));
  await assertFails(setDoc(doc(unfeoDb, 'settings', 'permissions'), { ...validPayload, updatedBy: 'unfeo1' }));
  await assertFails(setDoc(doc(empDb, 'settings', 'permissions'), { ...validPayload, updatedBy: 'emp1' }));

  // Validation rejects invalid role key, invalid permission key, invalid scope, ghost fields, and super_admin settings.manage revocation
  await assertFails(
    setDoc(doc(saDb, 'settings', 'permissions'), {
      overrides: { ghost_role: { 'user.view': 'all' } },
      updatedAt: serverTimestamp(),
      updatedBy: 'sa1'
    })
  );
  await assertFails(
    setDoc(doc(saDb, 'settings', 'permissions'), {
      overrides: { employee: { 'unknown.perm': 'all' } },
      updatedAt: serverTimestamp(),
      updatedBy: 'sa1'
    })
  );
  await assertFails(
    setDoc(doc(saDb, 'settings', 'permissions'), {
      overrides: { employee: { 'user.view': 'invalid_scope' } },
      updatedAt: serverTimestamp(),
      updatedBy: 'sa1'
    })
  );
  await assertFails(
    setDoc(doc(saDb, 'settings', 'permissions'), {
      ...validPayload,
      extraField: true
    })
  );
  await assertFails(
    setDoc(doc(saDb, 'settings', 'permissions'), {
      overrides: { super_admin: { 'settings.manage': 'none' } },
      updatedAt: serverTimestamp(),
      updatedBy: 'sa1'
    })
  );

  // Super Admin can write valid overrides
  await assertSucceeds(setDoc(doc(saDb, 'settings', 'permissions'), validPayload));

  // Signed-in users can get settings/permissions; unauthenticated users denied
  await assertSucceeds(getDoc(doc(empDb, 'settings', 'permissions')));
  await assertSucceeds(getDoc(doc(dgDb, 'settings', 'permissions')));
  await assertFails(getDoc(doc(anonDb, 'settings', 'permissions')));
});

test('Live permission overrides in settings/permissions immediately govern Firestore & Storage rules', async () => {
  const saDb = testEnv.authenticatedContext('sa1').firestore();
  const dgDb = testEnv.authenticatedContext('dg1').firestore();
  const hoDb = testEnv.authenticatedContext('ho1').firestore();
  const unfeoDb = testEnv.authenticatedContext('unfeo1').firestore();
  const empStorage = testEnv.authenticatedContext('emp1').storage();
  const hoStorage = testEnv.authenticatedContext('ho1').storage();
  const unfeoStorage = testEnv.authenticatedContext('unfeo1').storage();

  const validJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  await assertSucceeds(uploadBytes(ref(empStorage, 'attendance/emp1/in.jpg'), validJpeg, { contentType: 'image/jpeg' }));

  // Defaults before override: DG can read auditLogs, HO cannot; HO cannot view attendance photo, UNFEO can; UNFEO cannot review field duty
  await assertSucceeds(getDoc(doc(dgDb, 'auditLogs', 'log_1')));
  await assertFails(getDoc(doc(hoDb, 'auditLogs', 'log_1')));
  await assertFails(getBytes(ref(hoStorage, 'attendance/emp1/in.jpg')));
  await assertSucceeds(getBytes(ref(unfeoStorage, 'attendance/emp1/in.jpg')));

  // Apply dynamic overrides via Super Admin
  await assertSucceeds(
    setDoc(doc(saDb, 'settings', 'permissions'), {
      overrides: {
        head_office_officer: {
          'audit.view': 'all',
          'attendance.photo.view': 'all'
        },
        director_general: {
          'audit.view': 'none'
        },
        unfeo: {
          'fieldduty.review': 'office',
          'attendance.photo.view': 'none'
        }
      },
      updatedAt: serverTimestamp(),
      updatedBy: 'sa1',
      updatedByName: 'Super Admin'
    })
  );

  // Immediately enforced in Firestore rules
  await assertSucceeds(getDoc(doc(hoDb, 'auditLogs', 'log_1')));
  await assertFails(getDoc(doc(dgDb, 'auditLogs', 'log_1')));
  await assertSucceeds(
    updateDoc(doc(unfeoDb, 'fieldDuties', 'fd_emp1'), {
      status: 'approved',
      reviewedBy: 'unfeo1',
      reviewedByName: 'UNFEO 1',
      reviewComment: 'Granted via override',
      reviewedAt: serverTimestamp()
    })
  );

  // Immediately enforced in Storage rules
  await assertSucceeds(getBytes(ref(hoStorage, 'attendance/emp1/in.jpg')));
  await assertFails(getBytes(ref(unfeoStorage, 'attendance/emp1/in.jpg')));
});

test('Owner device binding tolerates legacy user fields, allows idempotent retry, and blocks device hijack or role tampering', async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'users', 'ad_unbound'), {
      uid: 'ad_unbound',
      name: 'AD Legacy',
      designation: 'Assistant Director',
      address: 'Mymensingh',
      mobile: '01711111111',
      email: 'admymen@gmail.com',
      officeId: 'dist1',
      districtOfficeId: 'dist1',
      joiningDate: '',
      resignationDate: '',
      legacyExtraField: 'preserved',
      status: 'active',
      role: 'assistant_director',
      approvalStatus: 'approved',
      boundDeviceId: null,
      createdAt: null,
      updatedAt: tsNow()
    });
  });

  const adDb = testEnv.authenticatedContext('ad_unbound').firestore();

  // First-time binding succeeds despite legacy/empty fields on existing doc
  await assertSucceeds(
    updateDoc(doc(adDb, 'users', 'ad_unbound'), {
      boundDeviceId: 'dev_abc12345',
      updatedAt: serverTimestamp()
    })
  );

  // Idempotent retry with identical boundDeviceId succeeds
  await assertSucceeds(
    updateDoc(doc(adDb, 'users', 'ad_unbound'), {
      boundDeviceId: 'dev_abc12345',
      updatedAt: serverTimestamp()
    })
  );

  // Changing to a different boundDeviceId without admin reset is denied
  await assertFails(
    updateDoc(doc(adDb, 'users', 'ad_unbound'), {
      boundDeviceId: 'dev_other999',
      updatedAt: serverTimestamp()
    })
  );

  // Tampering with role during device binding is denied
  await assertFails(
    updateDoc(doc(adDb, 'users', 'ad_unbound'), {
      boundDeviceId: 'dev_abc12345',
      role: 'super_admin',
      updatedAt: serverTimestamp()
    })
  );
});

