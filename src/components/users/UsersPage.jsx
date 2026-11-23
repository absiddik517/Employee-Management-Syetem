import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut
} from 'firebase/auth';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch
} from 'firebase/firestore';
import {
  CheckCircle2,
  Info,
  LayoutGrid,
  Link2,
  Search,
  Smartphone,
  Table2,
  UserPlus,
  Users,
  X
} from 'lucide-react';
import AppShell from '../AppShell.jsx';
import ConfirmSheet from '../ConfirmSheet.jsx';
import UserCard from './UserCard.jsx';
import UserTable from './UserTable.jsx';
import UserDetailSheet from './UserDetailSheet.jsx';
import UserFormSheet from './UserFormSheet.jsx';
import TransferUserSheet from './TransferUserSheet.jsx';
import DeviceCard from './DeviceCard.jsx';
import DevicesTable from './DevicesTable.jsx';
import DeviceDetailSheet from './DeviceDetailSheet.jsx';
import { DEVICE_INSIGHTS_ENABLED } from '../../config/deviceInsights.js';
import { deriveDeviceStatus, toDeviceEpochMs } from '../../utils/deviceInfo.js';
import { useAuth } from '../../context/AuthContext.jsx';
import {
  db,
  getSecondaryAuthApp,
  getSecondaryAuth,
  disposeSecondaryApp,
  withTimeout,
  OperationType,
  handleFirestoreError
} from '../../firebase/config.js';
import { useData } from '../../context/DataContext.jsx';
import { uploadImageSafe } from '../../utils/storageUpload.js';
import { addDaysDhaka, getTodayDhaka } from '../../utils/dhakaTime.js';
import {
  assignableRoles as getAssignableRoles,
  getActingGrant,
  getAuthorityOfficeIds,
  getPermissionScope,
  getRoleLabel,
  getRoleMeta,
  normalizeRole
} from '../../lib/permissions.js';

function buildCreateTaskList() {
  return [
    { id: 'auth', label: 'Create / verify Auth user', status: 'pending', detail: '' },
    { id: 'write', label: 'Create Firestore profile', status: 'pending', detail: '' },
    { id: 'photo', label: 'Upload profile photo', status: 'pending', detail: '' },
    { id: 'audit', label: 'Log audit & refresh list', status: 'pending', detail: '' }
  ];
}

function buildLinkTaskList(linkMethod) {
  return [
    {
      id: 'resolve',
      label: linkMethod === 'credentials' ? 'Verify Auth credentials & UID' : 'Validate Auth UID & email',
      status: 'pending',
      detail: ''
    },
    { id: 'check', label: 'Check existing profile', status: 'pending', detail: '' },
    { id: 'write', label: 'Create Firestore profile', status: 'pending', detail: '' },
    { id: 'photo', label: 'Upload profile photo', status: 'pending', detail: '' },
    { id: 'audit', label: 'Log audit & refresh list', status: 'pending', detail: '' }
  ];
}

function supportsAdditionalCharge(role) {
  const meta = getRoleMeta(role);
  if (meta && !meta.chargeEligible) return false;
  const scope = getPermissionScope({ role, approvalStatus: 'approved', status: 'active' }, 'report.create');
  return scope === 'subtree' || scope === 'office';
}

export default function UsersPage() {
  const { profile, effectiveAuthUser, roleRegistry, offices, computeDistrictOfficeId, can, permissionScope } = useAuth();
  const { logAudit } = useData();

  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all'); // 'all' | 'active' | 'inactive' | 'pending'
  const [viewMode, setViewMode] = useState('table'); // 'cards' | 'table' (applies >= 720px)

  const [activeTab, setActiveTab] = useState('people'); // 'people' | 'devices'
  const [deviceSearch, setDeviceSearch] = useState('');
  const [deviceStatusFilter, setDeviceStatusFilter] = useState('all'); // 'all' | 'bound' | 'released' | 'blocked' | 'shared'
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [devicesByUid, setDevicesByUid] = useState({});
  const deviceCacheRef = useRef(new Map());
  const [selectedDeviceKey, setSelectedDeviceKey] = useState(null);
  const [deviceDetailOpen, setDeviceDetailOpen] = useState(false);

  const [selectedUserId, setSelectedUserId] = useState(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const [formSheetOpen, setFormSheetOpen] = useState(false);
  const [formMode, setFormMode] = useState('create'); // 'create' | 'link' | 'edit'
  const [transferSheetOpen, setTransferSheetOpen] = useState(false);
  const [assignmentsRefreshKey, setAssignmentsRefreshKey] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [confirmDeleteUser, setConfirmDeleteUser] = useState(null);

  const [sheetTasks, setSheetTasks] = useState([]);
  const [sheetFeedbackSummary, setSheetFeedbackSummary] = useState('');
  const [sheetFeedbackVariant, setSheetFeedbackVariant] = useState('info');

  const [errorMsg, setErrorMsg] = useState('');
  const [toastMsg, setToastMsg] = useState('');
  const toastTimerRef = useRef(null);

  const userViewScope = permissionScope('user.view');
  const createScope = permissionScope('user.create');
  const editScope = permissionScope('user.edit');
  const assignableRolesForCreate = useMemo(
    () => getAssignableRoles(effectiveAuthUser, roleRegistry, { permission: 'user.create' }),
    [effectiveAuthUser, roleRegistry]
  );
  const canCreateUsers =
    ['office', 'subtree', 'all'].includes(createScope) && assignableRolesForCreate.length > 0;
  const canLinkUsers = createScope === 'all' || editScope === 'all';
  const showDevicesTab = DEVICE_INSIGHTS_ENABLED && can('user.view');

  const showToast = useCallback((msg) => {
    setToastMsg(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => {
      setToastMsg('');
    }, 3200);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  const officeName = useCallback(
    (id) => (id ? offices.find((o) => o.id === id)?.name || id : ''),
    [offices]
  );

  const loadUsers = useCallback(async () => {
    if (!userViewScope || !effectiveAuthUser) {
      setUsers([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setErrorMsg('');
    try {
      let list = [];
      if (userViewScope === 'all') {
        const snap = await withTimeout(
          getDocs(collection(db, 'users')),
          15000,
          'ব্যবহারকারী তালিকা লোড করতে সময় বেশি লাগছে।'
        );
        list = snap.docs.map((d) => ({ uid: d.id, id: d.id, ...d.data() }));
      } else if (userViewScope === 'self') {
        const uid = profile?.uid || effectiveAuthUser.uid;
        if (uid) {
          const selfSnap = await getDoc(doc(db, 'users', uid));
          if (selfSnap.exists()) {
            list = [{ uid: selfSnap.id, id: selfSnap.id, ...selfSnap.data() }];
          }
        }
      } else {
        const ownUserViewScope = getPermissionScope(
          { ...effectiveAuthUser, actingOfficeId: '', actingRoleKey: '' },
          'user.view',
          roleRegistry
        );
        const actingGrant = getActingGrant(effectiveAuthUser, roleRegistry);
        const actingUserViewScope = actingGrant?.role?.permissions?.['user.view'] || '';
        const queries = [];
        const addScopedUserQueries = (oid, scope) => {
          queries.push(getDocs(query(collection(db, 'users'), where('officeId', '==', oid))));
          if (scope === 'subtree') {
            queries.push(getDocs(query(collection(db, 'users'), where('districtOfficeId', '==', oid))));
          }
        };

        if (ownUserViewScope === 'office' || ownUserViewScope === 'subtree') {
          for (const oid of getAuthorityOfficeIds(effectiveAuthUser)) {
            addScopedUserQueries(oid, ownUserViewScope);
          }
        }
        if (actingGrant && (actingUserViewScope === 'office' || actingUserViewScope === 'subtree')) {
          addScopedUserQueries(actingGrant.officeId, actingUserViewScope);
        }

        if (queries.length > 0) {
          const snaps = await withTimeout(
            Promise.all(queries),
            15000,
            'ব্যবহারকারী তালিকা লোড করতে সময় বেশি লাগছে।'
          );
          const map = new Map();
          for (const snap of snaps) {
            for (const d of snap.docs) {
              map.set(d.id, { uid: d.id, id: d.id, ...d.data() });
            }
          }
          list = Array.from(map.values());
        }
      }
      setUsers(
        list.sort((a, b) => (a.name || a.email || a.id || '').localeCompare(b.name || b.email || b.id || ''))
      );
    } catch (err) {
      setErrorMsg('ব্যবহারকারী তালিকা লোড করা যায়নি।');
      handleFirestoreError(err, OperationType.LIST, 'users');
    } finally {
      setLoading(false);
    }
  }, [userViewScope, effectiveAuthUser, profile?.uid, roleRegistry]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const filterCounts = useMemo(() => {
    let active = 0;
    let inactive = 0;
    let pending = 0;
    users.forEach((u) => {
      if ((u.status || 'active') === 'active') active += 1;
      else inactive += 1;
      if (u.approvalStatus === 'pending') pending += 1;
    });
    return {
      all: users.length,
      active,
      inactive,
      pending
    };
  }, [users]);

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((u) => {
      if (statusFilter === 'active' && (u.status || 'active') !== 'active') return false;
      if (statusFilter === 'inactive' && u.status !== 'resigned') return false;
      if (statusFilter === 'pending' && u.approvalStatus !== 'pending') return false;

      if (!q) return true;
      return (
        (u.name || '').toLowerCase().includes(q) ||
        (u.email || '').toLowerCase().includes(q) ||
        (u.uid || u.id || '').toLowerCase().includes(q)
      );
    });
  }, [users, search, statusFilter]);

  const selectedUser = useMemo(
    () => users.find((u) => (u.uid || u.id) === selectedUserId) || null,
    [users, selectedUserId]
  );

  useEffect(() => {
    if (!showDevicesTab && activeTab !== 'people') {
      setActiveTab('people');
    }
  }, [showDevicesTab, activeTab]);

  useEffect(() => {
    if (!showDevicesTab || activeTab !== 'devices' || loading) return;

    const permittedUsers = users.filter((u) =>
      can('user.view', {
        uid: u.uid || u.id,
        role: u.role,
        officeId: u.officeId || '',
        districtOfficeId: u.districtOfficeId || ''
      })
    );
    const missingUids = permittedUsers
      .map((u) => u.uid || u.id)
      .filter((uid) => uid && !deviceCacheRef.current.has(uid));

    if (missingUids.length === 0) {
      setDevicesLoading(false);
      return;
    }

    let cancelled = false;
    setDevicesLoading(true);

    const fetchBatches = async () => {
      const BATCH_SIZE = 8;
      try {
        for (let i = 0; i < missingUids.length; i += BATCH_SIZE) {
          if (cancelled) return;
          const chunk = missingUids.slice(i, i + BATCH_SIZE);
          await Promise.all(
            chunk.map(async (uid) => {
              try {
                const snap = await withTimeout(
                  getDocs(collection(db, 'users', uid, 'devices')),
                  10000,
                  'Device query timed out'
                );
                const recs = snap.docs.map((d) => ({ deviceId: d.id, ...d.data() }));
                deviceCacheRef.current.set(uid, recs);
              } catch (err) {
                console.warn(`Devices fetch skipped for ${uid}:`, err?.code || err?.message || err);
                deviceCacheRef.current.set(uid, []);
              }
            })
          );
          if (!cancelled) {
            setDevicesByUid(Object.fromEntries(deviceCacheRef.current.entries()));
          }
        }
      } finally {
        if (!cancelled) setDevicesLoading(false);
      }
    };

    void fetchBatches();

    return () => {
      cancelled = true;
    };
  }, [showDevicesTab, activeTab, loading, users, can]);

  const deviceEntries = useMemo(() => {
    if (!showDevicesTab) return [];

    const boundUsersByDeviceId = new Map();
    for (const u of users) {
      if (u.boundDeviceId) {
        const list = boundUsersByDeviceId.get(u.boundDeviceId) || [];
        list.push(u);
        boundUsersByDeviceId.set(u.boundDeviceId, list);
      }
    }

    const entries = [];
    for (const u of users) {
      const uid = u.uid || u.id;
      if (
        !uid ||
        !can('user.view', {
          uid,
          role: u.role,
          officeId: u.officeId || '',
          districtOfficeId: u.districtOfficeId || ''
        })
      ) {
        continue;
      }

      const cachedList = Array.isArray(devicesByUid[uid]) ? devicesByUid[uid] : [];
      const seenDeviceIds = new Set(cachedList.map((d) => d.deviceId));
      const combinedDevices = [...cachedList];

      if (u.boundDeviceId && !seenDeviceIds.has(u.boundDeviceId)) {
        combinedDevices.push({
          deviceId: u.boundDeviceId,
          name: 'Unknown device',
          model: 'Unknown',
          manufacturer: 'Unknown',
          platform: 'Unknown',
          osVersion: 'Unknown',
          appVersion: 'Unknown',
          engine: 'Unknown',
          screen: 'Unknown',
          timezone: 'Unknown',
          language: 'Unknown',
          ip: null,
          firstSeenAt: null,
          lastSeenAt: null,
          loginCount: null,
          status: 'seen'
        });
      }

      for (const dev of combinedDevices) {
        const derivedStatus = deriveDeviceStatus(u.boundDeviceId, dev.deviceId, dev.status);
        const isBound = derivedStatus === 'bound';
        const sharedUsers = isBound ? boundUsersByDeviceId.get(dev.deviceId) || [u] : [];
        const isShared = isBound && sharedUsers.length > 1;
        entries.push({
          user: u,
          device: dev,
          derivedStatus,
          isShared,
          sharedUsers,
          sharedCount: sharedUsers.length
        });
      }
    }

    entries.sort((a, b) => {
      const diff = toDeviceEpochMs(b.device?.lastSeenAt) - toDeviceEpochMs(a.device?.lastSeenAt);
      if (diff !== 0) return diff;
      const rank = (s) => (s === 'bound' ? 0 : s === 'blocked' ? 1 : 2);
      const rDiff = rank(a.derivedStatus) - rank(b.derivedStatus);
      if (rDiff !== 0) return rDiff;
      return (a.user?.name || a.user?.email || '').localeCompare(b.user?.name || b.user?.email || '');
    });

    return entries;
  }, [showDevicesTab, users, devicesByUid, can]);

  const deviceFilterCounts = useMemo(() => {
    let bound = 0;
    let released = 0;
    let blocked = 0;
    let shared = 0;
    deviceEntries.forEach((entry) => {
      if (entry.derivedStatus === 'bound') bound += 1;
      else if (entry.derivedStatus === 'blocked') blocked += 1;
      else released += 1;
      if (entry.isShared) shared += 1;
    });
    return {
      all: deviceEntries.length,
      bound,
      released,
      blocked,
      shared
    };
  }, [deviceEntries]);

  const filteredDevices = useMemo(() => {
    const q = deviceSearch.trim().toLowerCase();
    return deviceEntries.filter((entry) => {
      if (deviceStatusFilter === 'bound' && entry.derivedStatus !== 'bound') return false;
      if (deviceStatusFilter === 'released' && entry.derivedStatus !== 'released') return false;
      if (deviceStatusFilter === 'blocked' && entry.derivedStatus !== 'blocked') return false;
      if (deviceStatusFilter === 'shared' && !entry.isShared) return false;

      if (!q) return true;
      const u = entry.user || {};
      const d = entry.device || {};
      return (
        (u.name || '').toLowerCase().includes(q) ||
        (u.email || '').toLowerCase().includes(q) ||
        (u.uid || u.id || '').toLowerCase().includes(q) ||
        (d.name || '').toLowerCase().includes(q) ||
        (d.model || '').toLowerCase().includes(q) ||
        (d.manufacturer || '').toLowerCase().includes(q) ||
        (d.platform || '').toLowerCase().includes(q) ||
        (d.osVersion || '').toLowerCase().includes(q) ||
        (d.ip || '').toLowerCase().includes(q) ||
        (d.deviceId || '').toLowerCase().includes(q)
      );
    });
  }, [deviceEntries, deviceSearch, deviceStatusFilter]);

  const selectedDeviceEntry = useMemo(() => {
    if (!selectedDeviceKey) return null;
    return (
      deviceEntries.find(
        (e) =>
          (e.user?.uid || e.user?.id) === selectedDeviceKey.uid &&
          e.device?.deviceId === selectedDeviceKey.deviceId
      ) || null
    );
  }, [deviceEntries, selectedDeviceKey]);

  const tryUploadOptionalPhoto = async (targetUid, file) => {
    if (!file) return { uploaded: false, warning: '', reason: 'No photo selected' };
    const path = `profiles/${targetUid}.jpg`;
    const uploadRes = await uploadImageSafe(path, file, file.type || 'image/jpeg');
    if (!uploadRes.ok) {
      return {
        uploaded: false,
        warning: ` (${uploadRes.reason})`,
        reason: uploadRes.reason
      };
    }
    try {
      await withTimeout(
        updateDoc(doc(db, 'users', targetUid), {
          profilePhotoPath: path,
          updatedAt: serverTimestamp()
        }),
        10000,
        'Profile photo path update timed out'
      );
      return { uploaded: true, warning: '', reason: 'Photo uploaded to Storage' };
    } catch (err) {
      console.warn('Profile photo path update failed:', err?.code || err?.message);
      return {
        uploaded: false,
        warning: ' (প্রোফাইল তৈরি হয়েছে, তবে ছবির পাথ আপডেট করা যায়নি।)',
        reason: err?.message || 'Profile photo path update failed'
      };
    }
  };

  const writeUserDocument = async (targetUid, payload) => {
    try {
      await withTimeout(
        setDoc(doc(db, 'users', targetUid), payload),
        15000,
        'Firestore-এ প্রোফাইল সংরক্ষণ করতে সময়সীমা অতিক্রম হয়েছে।'
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `users/${targetUid}`);
    }
  };

  const createUserDirectly = async (newUser, newPhotoFile) => {
    if (submitting || !canCreateUsers) return { ok: false };

    const targetDistrictOfficeId = computeDistrictOfficeId(newUser.officeId);
    if (!newUser.officeId) {
      return { ok: false, error: 'একটি অফিস নির্বাচন করুন।' };
    }
    if (
      !can('user.create', {
        officeId: newUser.officeId,
        districtOfficeId: targetDistrictOfficeId,
        newRole: newUser.role
      })
    ) {
      return { ok: false, error: 'নির্বাচিত অফিস বা রোলের জন্য আপনার ব্যবহারকারী তৈরির অনুমতি নেই।' };
    }

    let tasks = buildCreateTaskList();
    const updateTask = (id, status, detail = '') => {
      tasks = tasks.map((t) => (t.id === id ? { ...t, status, detail } : t));
      setSheetTasks(tasks);
    };

    setSubmitting(true);
    setErrorMsg('');
    setSheetTasks(tasks);
    setSheetFeedbackVariant('info');
    setSheetFeedbackSummary('Creating user account and Firestore profile...');

    let secondaryApp = null;
    try {
      const trimmedName = newUser.name.trim();
      const trimmedDesignation = newUser.designation.trim();
      const trimmedAddress = newUser.address.trim();
      const trimmedMobile = newUser.mobile.trim();
      const normalizedEmail = newUser.email.trim().toLowerCase();

      if (trimmedName.length < 2 || trimmedDesignation.length < 2 || trimmedAddress.length < 2) {
        throw new Error('নাম, পদবি এবং ঠিকানা কমপক্ষে ২ অক্ষরের হতে হবে।');
      }
      if (trimmedMobile.length < 6) {
        throw new Error('মোবাইল নম্বর কমপক্ষে ৬ সংখ্যার হতে হবে।');
      }

      updateTask('auth', 'running', 'Connecting to Firebase Auth...');
      secondaryApp = getSecondaryAuthApp();
      const secondaryAuth = getSecondaryAuth(secondaryApp);

      let targetUid = '';
      let recoveredFromAuth = false;

      try {
        const cred = await withTimeout(
          createUserWithEmailAndPassword(secondaryAuth, normalizedEmail, newUser.password),
          20000,
          'Firebase Auth অ্যাকাউন্ট তৈরি করতে সময়সীমা অতিক্রম হয়েছে।'
        );
        targetUid = cred.user.uid;
        updateTask('auth', 'done', `New Auth UID: ${targetUid}`);
      } catch (authErr) {
        if (authErr.code === 'auth/email-already-in-use') {
          try {
            const existingCred = await withTimeout(
              signInWithEmailAndPassword(secondaryAuth, normalizedEmail, newUser.password),
              15000,
              'বিদ্যমান Auth অ্যাকাউন্ট যাচাই করতে সময়সীমা অতিক্রম হয়েছে।'
            );
            targetUid = existingCred.user.uid;
            recoveredFromAuth = true;
            updateTask('auth', 'done', `Existing Auth UID recovered: ${targetUid}`);
          } catch {
            const msg =
              'এই ইমেইল দিয়ে ইতোমধ্যে Firebase Auth অ্যাকাউন্ট তৈরি আছে (অথবা পাসওয়ার্ড মিলছে না)। "Link Auth user" অপশন ব্যবহার করে UID দিয়ে প্রোফাইল তৈরি করুন।';
            updateTask('auth', 'error', msg);
            throw new Error(msg);
          }
        } else {
          updateTask('auth', 'error', authErr.message || 'Auth creation failed');
          throw authErr;
        }
      } finally {
        await signOut(secondaryAuth).catch(() => {});
      }

      if (recoveredFromAuth) {
        const existingSnap = await withTimeout(
          getDoc(doc(db, 'users', targetUid)),
          12000,
          'বিদ্যমান প্রোফাইল যাচাই করতে সময়সীমা অতিক্রম হয়েছে।'
        );
        if (existingSnap.exists()) {
          const dupMsg = `এই ইমেইলের (${normalizedEmail}, UID: ${targetUid}) প্রোফাইল ইতোমধ্যে users ডকুমেন্টে আছে।`;
          updateTask('write', 'error', dupMsg);
          throw new Error(dupMsg);
        }
      }

      updateTask('write', 'running', `Saving users/${targetUid}...`);
      const districtOfficeId = computeDistrictOfficeId(newUser.officeId);
      const requestedAdditionalOfficeIds =
        supportsAdditionalCharge(newUser.role) && Array.isArray(newUser.additionalOfficeIds)
          ? Array.from(new Set(newUser.additionalOfficeIds.filter((id) => id && id !== newUser.officeId))).slice(0, 20)
          : [];
      try {
        await writeUserDocument(targetUid, {
          uid: targetUid,
          name: trimmedName,
          designation: trimmedDesignation,
          address: trimmedAddress,
          mobile: trimmedMobile,
          email: normalizedEmail,
          officeId: newUser.officeId || '',
          districtOfficeId,
          additionalOfficeIds: [],
          joiningDate: newUser.joiningDate,
          status: 'active',
          resignationDate: null,
          profilePhotoPath: '',
          role: newUser.role,
          approvalStatus: 'approved',
          boundDeviceId: null,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
        if (requestedAdditionalOfficeIds.length > 0 && permissionScope('assignment.manage') === 'all') {
          await updateDoc(doc(db, 'users', targetUid), {
            additionalOfficeIds: requestedAdditionalOfficeIds,
            updatedAt: serverTimestamp()
          });
        }
        try {
          await withTimeout(
            addDoc(collection(db, 'users', targetUid, 'assignments'), {
              kind: 'primary',
              officeId: newUser.officeId,
              districtOfficeId: districtOfficeId || '',
              officeName: officeName(newUser.officeId) || newUser.officeId,
              designation: trimmedDesignation,
              roleKey: newUser.role,
              roleLabel: getRoleLabel(newUser.role, roleRegistry),
              startDate: newUser.joiningDate,
              endDate: null,
              type: 'joined',
              createdBy: profile.uid,
              createdByName: profile.name || profile.email || 'Admin',
              createdAt: serverTimestamp()
            }),
            10000,
            'Initial assignment write timed out'
          );
        } catch (assignErr) {
          console.warn('Initial assignment record write failed:', assignErr);
        }
        updateTask('write', 'done', `Saved users/${targetUid}`);
      } catch (fsErr) {
        updateTask('write', 'error', fsErr.message || 'Firestore write failed');
        throw fsErr;
      }

      if (newPhotoFile) {
        updateTask('photo', 'running', 'Uploading to Storage...');
        const photoResult = await tryUploadOptionalPhoto(targetUid, newPhotoFile);
        updateTask('photo', photoResult.uploaded ? 'done' : 'skipped', photoResult.reason);
      } else {
        updateTask('photo', 'skipped', 'No photo selected');
      }

      updateTask('audit', 'running', 'Recording audit log & reloading list...');
      let auditWarning = false;
      try {
        await withTimeout(
          logAudit({
            actor: profile,
            action: recoveredFromAuth ? 'ADMIN_RECOVERED_USER_PROFILE' : 'ADMIN_CREATED_USER',
            targetCollection: 'users',
            targetId: targetUid,
            newValue: `${trimmedName} (${newUser.role})`,
            reason: recoveredFromAuth
              ? 'Created missing Firestore profile for existing Auth email'
              : 'Direct user creation by authorized manager',
            officeId: newUser.officeId || '',
            districtOfficeId
          }),
          10000,
          'Audit log timed out'
        );
      } catch (auditErr) {
        auditWarning = true;
        console.warn('Audit log failed after user creation:', auditErr);
      }

      await loadUsers().catch(() => {
        auditWarning = true;
      });
      updateTask(
        'audit',
        auditWarning ? 'skipped' : 'done',
        auditWarning ? 'Profile saved; audit or list refresh timed out' : 'Audit saved & list refreshed'
      );

      const summary = `${trimmedName} সফলভাবে তৈরি ও অনুমোদিত হয়েছে (UID: ${targetUid})।`;
      setSheetFeedbackSummary(summary);
      setSheetFeedbackVariant(
        tasks.some((t) => t.status === 'skipped' && t.detail.includes('Storage')) ? 'warning' : 'success'
      );
      setFormSheetOpen(false);
      showToast(summary);
      return { ok: true };
    } catch (err) {
      const msg = err.message || 'নতুন ব্যবহারকারী তৈরি করা যায়নি।';
      setSheetFeedbackSummary(msg);
      setSheetFeedbackVariant('error');
      return { ok: false, error: msg };
    } finally {
      await disposeSecondaryApp(secondaryApp);
      setSubmitting(false);
    }
  };

  const createProfileForExistingAuth = async (linkForm, linkPhotoFile) => {
    if (submitting || !canLinkUsers) return { ok: false };

    let tasks = buildLinkTaskList(linkForm.linkMethod);
    const updateTask = (id, status, detail = '') => {
      tasks = tasks.map((t) => (t.id === id ? { ...t, status, detail } : t));
      setSheetTasks(tasks);
    };

    setSubmitting(true);
    setErrorMsg('');
    setSheetTasks(tasks);
    setSheetFeedbackVariant('info');
    setSheetFeedbackSummary('Processing missing user profile creation...');

    let secondaryApp = null;
    try {
      const trimmedName = linkForm.name.trim();
      const trimmedDesignation = linkForm.designation.trim();
      const trimmedAddress = linkForm.address.trim();
      const trimmedMobile = linkForm.mobile.trim();

      if (trimmedName.length < 2 || trimmedDesignation.length < 2 || trimmedAddress.length < 2) {
        throw new Error('নাম, পদবি এবং ঠিকানা কমপক্ষে ২ অক্ষরের হতে হবে।');
      }
      if (trimmedMobile.length < 6) {
        throw new Error('মোবাইল নম্বর কমপক্ষে ৬ সংখ্যার হতে হবে।');
      }

      updateTask(
        'resolve',
        'running',
        linkForm.linkMethod === 'credentials'
          ? 'Signing into secondary Auth to read UID...'
          : 'Validating Auth UID format...'
      );

      let targetUid = '';
      let targetEmail = linkForm.email.trim().toLowerCase();

      if (linkForm.linkMethod === 'credentials') {
        if (!targetEmail || !linkForm.password) {
          const msg = 'ইমেইল এবং পাসওয়ার্ড দিন।';
          updateTask('resolve', 'error', msg);
          throw new Error(msg);
        }
        secondaryApp = getSecondaryAuthApp();
        const secondaryAuth = getSecondaryAuth(secondaryApp);
        try {
          const cred = await withTimeout(
            signInWithEmailAndPassword(secondaryAuth, targetEmail, linkForm.password),
            15000,
            'Firebase Auth যাচাই করতে সময়সীমা অতিক্রম হয়েছে।'
          );
          targetUid = cred.user.uid;
          targetEmail = (cred.user.email || targetEmail).toLowerCase();
          updateTask('resolve', 'done', `Verified UID: ${targetUid}`);
        } catch (authErr) {
          let errText = authErr.message || 'Auth verification failed';
          if (
            authErr.code === 'auth/user-not-found' ||
            authErr.code === 'auth/invalid-credential' ||
            authErr.code === 'auth/wrong-password'
          ) {
            errText =
              'এই ইমেইল বা পাসওয়ার্ড দিয়ে Auth অ্যাকাউন্ট যাচাই করা যায়নি। পাসওয়ার্ড না জানলে "Enter Auth UID directly" মোড ব্যবহার করুন।';
          }
          updateTask('resolve', 'error', errText);
          throw new Error(errText);
        } finally {
          await signOut(secondaryAuth).catch(() => {});
        }
      } else {
        targetUid = linkForm.uid.trim();
        if (!/^[a-zA-Z0-9_-]{1,128}$/.test(targetUid)) {
          const msg = 'সঠিক Firebase Auth UID দিন (অক্ষর, সংখ্যা, _ অথবা -)।';
          updateTask('resolve', 'error', msg);
          throw new Error(msg);
        }
        if (!targetEmail || targetEmail.length < 5) {
          const msg = 'সঠিক ইমেইল দিন।';
          updateTask('resolve', 'error', msg);
          throw new Error(msg);
        }
        updateTask('resolve', 'done', `Using UID: ${targetUid}`);
      }

      updateTask('check', 'running', `Checking users/${targetUid}...`);
      let existingSnap;
      try {
        existingSnap = await withTimeout(
          getDoc(doc(db, 'users', targetUid)),
          12000,
          'Firestore প্রোফাইল যাচাই করতে সময়সীমা অতিক্রম হয়েছে।'
        );
      } catch (err) {
        updateTask('check', 'error', err.message || 'Check failed');
        handleFirestoreError(err, OperationType.GET, `users/${targetUid}`);
      }

      if (existingSnap && existingSnap.exists()) {
        const dupMsg = `UID (${targetUid})-এর জন্য users ডকুমেন্ট ইতোমধ্যে তৈরি আছে। তালিকা থেকে পরিবর্তন করুন।`;
        updateTask('check', 'error', dupMsg);
        throw new Error(dupMsg);
      }
      updateTask('check', 'done', 'No duplicate found — ready to create');

      updateTask('write', 'running', `Writing users/${targetUid}...`);
      const districtOfficeId = computeDistrictOfficeId(linkForm.officeId);
      const requestedAdditionalOfficeIds =
        supportsAdditionalCharge(linkForm.role) && Array.isArray(linkForm.additionalOfficeIds)
          ? Array.from(new Set(linkForm.additionalOfficeIds.filter((id) => id && id !== linkForm.officeId))).slice(0, 20)
          : [];
      try {
        await writeUserDocument(targetUid, {
          uid: targetUid,
          name: trimmedName,
          designation: trimmedDesignation,
          address: trimmedAddress,
          mobile: trimmedMobile,
          email: targetEmail,
          officeId: linkForm.officeId || '',
          districtOfficeId,
          additionalOfficeIds: [],
          joiningDate: linkForm.joiningDate,
          status: linkForm.status,
          resignationDate: linkForm.status === 'resigned' ? getTodayDhaka() : null,
          profilePhotoPath: '',
          role: linkForm.role,
          approvalStatus: linkForm.approvalStatus,
          boundDeviceId: null,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
        if (requestedAdditionalOfficeIds.length > 0 && permissionScope('assignment.manage') === 'all') {
          await updateDoc(doc(db, 'users', targetUid), {
            additionalOfficeIds: requestedAdditionalOfficeIds,
            updatedAt: serverTimestamp()
          });
        }
        if (linkForm.officeId && linkForm.role && targetUid !== profile?.uid) {
          try {
            await withTimeout(
              addDoc(collection(db, 'users', targetUid, 'assignments'), {
                kind: 'primary',
                officeId: linkForm.officeId,
                districtOfficeId: districtOfficeId || '',
                officeName: String(officeName(linkForm.officeId) || linkForm.officeId).slice(0, 160),
                designation: trimmedDesignation.slice(0, 120),
                roleKey: linkForm.role,
                roleLabel: String(getRoleLabel(linkForm.role, roleRegistry) || linkForm.role).slice(0, 80),
                startDate: /^\d{4}-\d{2}-\d{2}$/.test(String(linkForm.joiningDate || ''))
                  ? linkForm.joiningDate
                  : getTodayDhaka(),
                endDate: linkForm.status === 'resigned' ? getTodayDhaka() : null,
                type: 'joined',
                createdBy: profile.uid,
                createdByName: String(profile.name || profile.email || 'Admin').slice(0, 120),
                createdAt: serverTimestamp()
              }),
              10000,
              'Initial assignment write timed out'
            );
          } catch (assignErr) {
            console.warn('Initial assignment record write failed:', assignErr);
          }
        }
        updateTask('write', 'done', `Saved users/${targetUid}`);
      } catch (fsErr) {
        updateTask('write', 'error', fsErr.message || 'Firestore write failed');
        throw fsErr;
      }

      if (linkPhotoFile) {
        updateTask('photo', 'running', 'Uploading to Storage...');
        const photoResult = await tryUploadOptionalPhoto(targetUid, linkPhotoFile);
        updateTask('photo', photoResult.uploaded ? 'done' : 'skipped', photoResult.reason);
      } else {
        updateTask('photo', 'skipped', 'No photo selected');
      }

      updateTask('audit', 'running', 'Recording audit log & refreshing list...');
      let auditWarning = false;
      try {
        await withTimeout(
          logAudit({
            actor: profile,
            action: 'ADMIN_CREATED_MISSING_PROFILE',
            targetCollection: 'users',
            targetId: targetUid,
            newValue: `${trimmedName} (${linkForm.role}, ${linkForm.approvalStatus})`,
            reason: `Created Firestore profile for existing Auth user via ${linkForm.linkMethod}`,
            officeId: linkForm.officeId || '',
            districtOfficeId
          }),
          10000,
          'Audit log timed out'
        );
      } catch (auditErr) {
        auditWarning = true;
        console.warn('Audit log failed after profile link:', auditErr);
      }

      await loadUsers().catch(() => {
        auditWarning = true;
      });
      updateTask(
        'audit',
        auditWarning ? 'skipped' : 'done',
        auditWarning ? 'Profile created; audit or list refresh timed out' : 'Audit saved & list refreshed'
      );

      const summary = `${targetEmail} (UID: ${targetUid})-এর জন্য users প্রোফাইল সফলভাবে তৈরি হয়েছে।`;
      setSheetFeedbackSummary(summary);
      setSheetFeedbackVariant(
        tasks.some((t) => t.status === 'skipped' && t.detail.includes('Storage')) ? 'warning' : 'success'
      );
      setFormSheetOpen(false);
      showToast(summary);
      return { ok: true };
    } catch (err) {
      const msg = err.message || 'বিদ্যমান Auth ব্যবহারকারীর প্রোফাইল তৈরি করা যায়নি।';
      setSheetFeedbackSummary(msg);
      setSheetFeedbackVariant('error');
      return { ok: false, error: msg };
    } finally {
      await disposeSecondaryApp(secondaryApp);
      setSubmitting(false);
    }
  };

  const updateUserField = async (u, patch, toastText, actionName = 'USER_UPDATED') => {
    setErrorMsg('');
    const targetUid = u.uid || u.id;
    if (!targetUid) {
      setErrorMsg('ব্যবহারকারীর আইডি পাওয়া যায়নি।');
      return false;
    }
    setActionBusy(true);
    try {
      const payload = {
        ...patch,
        updatedAt: serverTimestamp()
      };
      await updateDoc(doc(db, 'users', targetUid), payload);
      await logAudit({
        actor: profile,
        action: actionName,
        targetCollection: 'users',
        targetId: targetUid,
        newValue: JSON.stringify(patch),
        reason: 'Scoped administrative update',
        officeId: patch.officeId ?? u.officeId ?? '',
        districtOfficeId: patch.districtOfficeId ?? u.districtOfficeId ?? ''
      });
      await loadUsers();
      showToast(toastText || `${u.name || u.email || targetUid}-এর তথ্য আপডেট হয়েছে।`);
      return true;
    } catch (err) {
      setErrorMsg('আপডেট ব্যর্থ হয়েছে।');
      handleFirestoreError(err, OperationType.UPDATE, `users/${targetUid}`);
      return false;
    } finally {
      setActionBusy(false);
    }
  };

  const onStatusChange = async (u, nextStatus) => {
    const targetUid = u.uid || u.id;
    if (!targetUid || !can('user.edit', { uid: targetUid, role: u.role, officeId: u.officeId, districtOfficeId: u.districtOfficeId })) {
      return;
    }
    const nextResignationDate = nextStatus === 'resigned' ? u.resignationDate || getTodayDhaka() : null;
    if (targetUid === profile?.uid) {
      await updateUserField(
        u,
        {
          status: nextStatus,
          resignationDate: nextResignationDate
        },
        nextStatus === 'active' ? 'User activated' : 'User deactivated',
        nextStatus === 'active' ? 'USER_ACTIVATED' : 'USER_DEACTIVATED'
      );
      return;
    }

    setErrorMsg('');
    setActionBusy(true);
    try {
      const openPrimarySnap = await getDocs(
        query(
          collection(db, 'users', targetUid, 'assignments'),
          where('kind', '==', 'primary'),
          where('endDate', '==', null)
        )
      );
      const batch = writeBatch(db);
      batch.update(doc(db, 'users', targetUid), {
        status: nextStatus,
        resignationDate: nextResignationDate,
        updatedAt: serverTimestamp()
      });

      if (nextStatus === 'resigned') {
        openPrimarySnap.docs.forEach((d) => {
          batch.update(d.ref, {
            endDate: nextResignationDate,
            closedBy: profile.uid,
            closedAt: serverTimestamp()
          });
        });
      } else if (nextStatus === 'active' && openPrimarySnap.empty && u.officeId && u.role) {
        const newRef = doc(collection(db, 'users', targetUid, 'assignments'));
        batch.set(newRef, {
          kind: 'primary',
          officeId: u.officeId,
          districtOfficeId: u.districtOfficeId || computeDistrictOfficeId(u.officeId) || '',
          officeName: String(officeName(u.officeId) || u.officeId).slice(0, 160),
          designation: String(u.designation || '').slice(0, 120),
          roleKey: u.role,
          roleLabel: String(getRoleLabel(u.role, roleRegistry) || u.role).slice(0, 80),
          startDate: getTodayDhaka(),
          endDate: null,
          type: 'transfer',
          reason: 'পুনরায় সক্রিয়করণ',
          createdBy: profile.uid,
          createdByName: String(profile.name || profile.email || 'Admin').slice(0, 120),
          createdAt: serverTimestamp()
        });
      }

      await batch.commit();
      await logAudit({
        actor: profile,
        action: nextStatus === 'active' ? 'USER_ACTIVATED' : 'USER_DEACTIVATED',
        targetCollection: 'users',
        targetId: targetUid,
        newValue: JSON.stringify({ status: nextStatus, resignationDate: nextResignationDate }),
        reason: 'Scoped administrative update',
        officeId: u.officeId || '',
        districtOfficeId: u.districtOfficeId || ''
      });
      setAssignmentsRefreshKey((k) => k + 1);
      await loadUsers();
      showToast(nextStatus === 'active' ? 'User activated' : 'User deactivated');
    } catch (err) {
      setErrorMsg('স্ট্যাটাস আপডেট ব্যর্থ হয়েছে।');
      handleFirestoreError(err, OperationType.UPDATE, `users/${targetUid}`);
    } finally {
      setActionBusy(false);
    }
  };

  const resetBoundDevice = async (u) => {
    if (!can('user.resetDevice', { uid: u.uid || u.id, role: u.role, officeId: u.officeId, districtOfficeId: u.districtOfficeId })) {
      return;
    }
    await updateUserField(u, { boundDeviceId: null }, 'Bound device reset', 'DEVICE_RESET');
  };

  const approveUser = async (u) => {
    const targetUid = u.uid || u.id;
    if (!can('user.approve', { uid: targetUid, role: u.role, officeId: u.officeId, districtOfficeId: u.districtOfficeId })) {
      return;
    }
    const ok = await updateUserField(u, { approvalStatus: 'approved' }, 'User approved', 'USER_APPROVED');
    if (ok && targetUid && targetUid !== profile?.uid && u.officeId && u.role) {
      try {
        const existingAssignSnap = await getDocs(
          query(collection(db, 'users', targetUid, 'assignments'), where('kind', '==', 'primary'))
        );
        if (existingAssignSnap.empty) {
          const distId = u.districtOfficeId || computeDistrictOfficeId(u.officeId) || '';
          await addDoc(collection(db, 'users', targetUid, 'assignments'), {
            kind: 'primary',
            officeId: u.officeId,
            districtOfficeId: distId,
            officeName: String(officeName(u.officeId) || u.officeId).slice(0, 160),
            designation: String(u.designation || '').slice(0, 120),
            roleKey: u.role,
            roleLabel: String(getRoleLabel(u.role, roleRegistry) || u.role).slice(0, 80),
            startDate: /^\d{4}-\d{2}-\d{2}$/.test(String(u.joiningDate || ''))
              ? u.joiningDate
              : getTodayDhaka(),
            endDate: null,
            type: 'joined',
            createdBy: profile.uid,
            createdByName: String(profile.name || profile.email || 'Admin').slice(0, 120),
            createdAt: serverTimestamp()
          });
          setAssignmentsRefreshKey((k) => k + 1);
        }
      } catch (assignErr) {
        console.warn('Initial assignment record write failed:', assignErr);
      }
    }
  };

  const executeDeleteUser = async () => {
    const target = confirmDeleteUser;
    setConfirmDeleteUser(null);
    if (!target || !can('user.delete', target)) return;

    const targetUid = target.uid || target.id;
    setActionBusy(true);
    setErrorMsg('');
    try {
      await deleteDoc(doc(db, 'users', targetUid));
      await logAudit({
        actor: profile,
        action: 'USER_DELETED',
        targetCollection: 'users',
        targetId: targetUid,
        oldValue: `${target.name || target.email} (${target.role})`,
        reason: 'Deleted user profile',
        officeId: target.officeId || '',
        districtOfficeId: target.districtOfficeId || ''
      });
      setDetailOpen(false);
      setSelectedUserId(null);
      await loadUsers();
      showToast(`${target.name || target.email || targetUid} deleted.`);
    } catch (err) {
      setErrorMsg('ব্যবহারকারী মুছে ফেলা যায়নি।');
      handleFirestoreError(err, OperationType.DELETE, `users/${targetUid}`);
    } finally {
      setActionBusy(false);
    }
  };

  const saveUserEdits = async (u, formValues) => {
    if (submitting) return { ok: false };
    const targetUid = u.uid || u.id;
    const targetScopeObj = {
      uid: targetUid,
      role: u.role,
      officeId: u.officeId || '',
      districtOfficeId: u.districtOfficeId || ''
    };
    if (!can('user.edit', targetScopeObj)) {
      return { ok: false, error: 'You do not have permission to edit this user.' };
    }
    const officeId = formValues.officeId || '';
    const districtOfficeId = computeDistrictOfficeId(officeId);
    if (
      officeId !== (u.officeId || '') &&
      !can('user.edit', {
        uid: targetUid,
        role: u.role,
        officeId,
        districtOfficeId
      })
    ) {
      return { ok: false, error: 'নির্বাচিত নতুন অফিসের জন্য আপনার ব্যবহারকারী সম্পাদনার অনুমতি নেই।' };
    }
    if (formValues.role !== u.role) {
      const canAssign = can('user.role.assign', {
        uid: targetUid,
        currentRole: u.role,
        newRole: formValues.role,
        officeId: officeId || u.officeId || '',
        districtOfficeId: computeDistrictOfficeId(officeId || u.officeId || '')
      });
      if (!canAssign) {
        return { ok: false, error: 'You do not have permission to assign this role.' };
      }
    }

    setSubmitting(true);
    try {
      if (!formValues.role && !u.role) {
        return { ok: false, error: 'একটি রোল নির্বাচন করুন।' };
      }
      const nextRole = formValues.role || u.role;
      const nextDesignation = formValues.designation.trim();
      const patch = {
        name: formValues.name.trim(),
        designation: nextDesignation,
        mobile: formValues.mobile.trim(),
        officeId,
        districtOfficeId,
        address: formValues.address.trim(),
        joiningDate: formValues.joiningDate,
        role: nextRole,
        status: formValues.status,
        resignationDate:
          formValues.status === 'resigned'
            ? formValues.resignationDate || getTodayDhaka()
            : null,
        approvalStatus: formValues.approvalStatus
      };

      const prevRoleNorm = normalizeRole(u.role, roleRegistry) || u.role || '';
      const nextRoleNorm = normalizeRole(nextRole, roleRegistry) || nextRole || '';
      const officeChanged = officeId !== (u.officeId || '');
      const roleChanged = nextRoleNorm !== prevRoleNorm;
      const designationChanged = nextDesignation !== (u.designation || '').trim();
      const postingChanged = (officeChanged || roleChanged || designationChanged) && targetUid !== profile?.uid;

      if (postingChanged && officeId && nextRole) {
        const todayStr = getTodayDhaka();
        const closeDateStr = addDaysDhaka(todayStr, -1);
        const eventType = officeChanged ? 'transfer' : roleChanged ? 'role_change' : 'designation_change';
        const openPrimarySnap = await getDocs(
          query(
            collection(db, 'users', targetUid, 'assignments'),
            where('kind', '==', 'primary'),
            where('endDate', '==', null)
          )
        );
        const batch = writeBatch(db);
        const userUpdatePayload = {
          ...patch,
          updatedAt: serverTimestamp()
        };
        if (permissionScope('assignment.manage') === 'all') {
          const nextAdditional =
            supportsAdditionalCharge(nextRole) && Array.isArray(formValues.additionalOfficeIds)
              ? Array.from(new Set(formValues.additionalOfficeIds.filter((id) => id && id !== officeId))).slice(0, 20)
              : [];
          userUpdatePayload.additionalOfficeIds = nextAdditional;
        }
        batch.update(doc(db, 'users', targetUid), userUpdatePayload);
        openPrimarySnap.docs.forEach((d) => {
          batch.update(d.ref, {
            endDate: formValues.status === 'resigned' ? patch.resignationDate : closeDateStr,
            closedBy: profile.uid,
            closedAt: serverTimestamp()
          });
        });
        const newAssignRef = doc(collection(db, 'users', targetUid, 'assignments'));
        batch.set(newAssignRef, {
          kind: 'primary',
          officeId,
          districtOfficeId: districtOfficeId || '',
          officeName: String(officeName(officeId) || officeId).slice(0, 160),
          designation: nextDesignation.slice(0, 120),
          roleKey: nextRole,
          roleLabel: String(getRoleLabel(nextRole, roleRegistry) || nextRole).slice(0, 80),
          startDate: todayStr,
          endDate: formValues.status === 'resigned' ? patch.resignationDate : null,
          type: eventType,
          createdBy: profile.uid,
          createdByName: String(profile.name || profile.email || 'Admin').slice(0, 120),
          createdAt: serverTimestamp()
        });
        await batch.commit();
        await logAudit({
          actor: profile,
          action: 'USER_EDITED',
          targetCollection: 'users',
          targetId: targetUid,
          newValue: JSON.stringify(patch),
          reason: `Updated user & recorded ${eventType}`,
          officeId,
          districtOfficeId
        });
        setAssignmentsRefreshKey((k) => k + 1);
        await loadUsers();
        showToast('Changes saved');
      } else {
        const ok = await updateUserField(u, patch, 'Changes saved', 'USER_EDITED');
        if (!ok) {
          return { ok: false, error: 'Failed to save changes. Please verify inputs and permissions.' };
        }
        if (permissionScope('assignment.manage') === 'all') {
          const nextAdditional =
            supportsAdditionalCharge(nextRole) && Array.isArray(formValues.additionalOfficeIds)
              ? Array.from(new Set(formValues.additionalOfficeIds.filter((id) => id && id !== officeId))).slice(0, 20)
              : [];
          const prevAdditional = Array.isArray(u.additionalOfficeIds) ? u.additionalOfficeIds : [];
          const changedAdditional =
            nextAdditional.length !== prevAdditional.length ||
            nextAdditional.some((id, idx) => prevAdditional[idx] !== id);
          if (changedAdditional && targetUid) {
            await updateDoc(doc(db, 'users', targetUid), {
              additionalOfficeIds: nextAdditional,
              updatedAt: serverTimestamp()
            });
            await loadUsers();
          }
        }
      }
      setFormSheetOpen(false);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err?.message || 'Failed to save changes.' };
    } finally {
      setSubmitting(false);
    }
  };

  const executeTransfer = async (u, formValues) => {
    if (submitting) return { ok: false };
    const targetUid = u.uid || u.id;
    if (!targetUid) return { ok: false, error: 'ব্যবহারকারীর আইডি পাওয়া যায়নি।' };
    if (targetUid === profile?.uid) {
      return { ok: false, error: 'নিজের বদলি বা পদায়ন নিজে সম্পন্ন করা যায় না।' };
    }

    const oldScopeObj = {
      uid: targetUid,
      role: u.role,
      officeId: u.officeId || '',
      districtOfficeId: u.districtOfficeId || ''
    };
    const nextOfficeId = formValues.officeId || '';
    const nextDistrictOfficeId = computeDistrictOfficeId(nextOfficeId);
    const newScopeObj = {
      uid: targetUid,
      role: u.role,
      officeId: nextOfficeId,
      districtOfficeId: nextDistrictOfficeId
    };

    if (!can('user.edit', oldScopeObj) || !can('user.edit', newScopeObj)) {
      return { ok: false, error: 'পুরোনো অথবা নতুন অফিসের জন্য আপনার বদলি/সম্পাদনার অনুমতি নেই।' };
    }

    const prevRoleNorm = normalizeRole(u.role, roleRegistry) || u.role || '';
    const nextRole = formValues.role || u.role || '';
    const nextRoleNorm = normalizeRole(nextRole, roleRegistry) || nextRole || '';
    const isOfficeChanging = nextOfficeId !== (u.officeId || '');
    const isRoleChanging = nextRoleNorm !== prevRoleNorm;

    if (isRoleChanging) {
      const canAssign = can('user.role.assign', {
        uid: targetUid,
        currentRole: u.role,
        newRole: nextRole,
        officeId: nextOfficeId || u.officeId || '',
        districtOfficeId: nextDistrictOfficeId || u.districtOfficeId || ''
      });
      if (!canAssign) {
        return { ok: false, error: 'নির্বাচিত রোল পরিবর্তনের জন্য আপনার অনুমতি নেই।' };
      }
    }

    setSubmitting(true);
    setErrorMsg('');
    try {
      const nextDesignation = formValues.designation.trim().slice(0, 120);
      const effectiveDate = formValues.effectiveDate;
      const closeDate = addDaysDhaka(effectiveDate, -1);
      const eventType = isOfficeChanging
        ? 'transfer'
        : isRoleChanging
        ? 'role_change'
        : 'designation_change';

      const openPrimarySnap = await withTimeout(
        getDocs(
          query(
            collection(db, 'users', targetUid, 'assignments'),
            where('kind', '==', 'primary'),
            where('endDate', '==', null)
          )
        ),
        12000,
        'চলমান পদায়ন রেকর্ড যাচাই করতে সময় বেশি লাগছে।'
      );

      const batch = writeBatch(db);
      batch.update(doc(db, 'users', targetUid), {
        officeId: nextOfficeId,
        districtOfficeId: nextDistrictOfficeId,
        designation: nextDesignation,
        role: nextRole,
        updatedAt: serverTimestamp()
      });

      openPrimarySnap.docs.forEach((d) => {
        batch.update(d.ref, {
          endDate: closeDate,
          closedBy: profile.uid,
          closedAt: serverTimestamp()
        });
      });

      const orderNo = (formValues.orderNo || '').trim().slice(0, 120);
      const orderDate = (formValues.orderDate || '').trim();
      const reason = (formValues.reason || '').trim().slice(0, 500);
      const newAssignRef = doc(collection(db, 'users', targetUid, 'assignments'));
      batch.set(newAssignRef, {
        kind: 'primary',
        officeId: nextOfficeId,
        districtOfficeId: nextDistrictOfficeId || '',
        officeName: String(officeName(nextOfficeId) || nextOfficeId).slice(0, 160),
        designation: nextDesignation,
        roleKey: nextRole,
        roleLabel: String(getRoleLabel(nextRole, roleRegistry) || nextRole).slice(0, 80),
        startDate: effectiveDate,
        endDate: null,
        type: eventType,
        ...(orderNo ? { orderNo } : {}),
        ...(orderDate ? { orderDate } : {}),
        ...(reason ? { reason } : {}),
        createdBy: profile.uid,
        createdByName: String(profile.name || profile.email || 'Admin').slice(0, 120),
        createdAt: serverTimestamp()
      });

      await withTimeout(batch.commit(), 15000, 'বদলি ও পদায়ন সংরক্ষণ করতে সময় বেশি লাগছে।');

      try {
        await withTimeout(
          logAudit({
            actor: profile,
            action: isOfficeChanging ? 'USER_TRANSFERRED' : 'USER_POSTING_CHANGED',
            targetCollection: 'users',
            targetId: targetUid,
            oldValue: `${officeName(u.officeId) || u.officeId} · ${u.designation || ''} (${u.role})`,
            newValue: `${officeName(nextOfficeId) || nextOfficeId} · ${nextDesignation} (${nextRole})`,
            reason: reason || `Effective ${effectiveDate}${orderNo ? ` (Order: ${orderNo})` : ''}`,
            officeId: nextOfficeId,
            districtOfficeId: nextDistrictOfficeId
          }),
          10000,
          'Audit log timed out'
        );
      } catch (auditErr) {
        console.warn('Audit log failed after transfer:', auditErr);
      }

      setAssignmentsRefreshKey((k) => k + 1);
      setTransferSheetOpen(false);
      await loadUsers();
      showToast(`${u.name || u.email || targetUid}-এর বদলি / পদায়ন সংরক্ষিত হয়েছে।`);
      return { ok: true };
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${targetUid}`);
      return { ok: false, error: err?.message || 'বদলি / পদায়ন সংরক্ষণ করা যায়নি।' };
    } finally {
      setSubmitting(false);
    }
  };

  const openCreateSheet = () => {
    setFormMode('create');
    setSheetTasks([]);
    setSheetFeedbackSummary('');
    setFormSheetOpen(true);
  };

  const openLinkSheet = () => {
    setFormMode('link');
    setSheetTasks([]);
    setSheetFeedbackSummary('');
    setFormSheetOpen(true);
  };

  const openEditSheet = () => {
    setFormMode('edit');
    setSheetTasks([]);
    setSheetFeedbackSummary('');
    setFormSheetOpen(true);
  };

  const openTransferSheet = () => {
    setTransferSheetOpen(true);
  };

  const openUserDetail = (u) => {
    setSelectedUserId(u.uid || u.id);
    setDetailOpen(true);
  };

  const openDeviceDetail = (entry) => {
    const uid = entry?.user?.uid || entry?.user?.id;
    const deviceId = entry?.device?.deviceId;
    if (!uid || !deviceId) return;
    setSelectedDeviceKey({ uid, deviceId });
    setDeviceDetailOpen(true);
  };

  const filterChips = [
    { key: 'all', label: 'All', count: filterCounts.all },
    { key: 'active', label: 'Active', count: filterCounts.active },
    { key: 'inactive', label: 'Inactive', count: filterCounts.inactive },
    { key: 'pending', label: 'Pending approval', count: filterCounts.pending }
  ];

  const deviceFilterChips = [
    { key: 'all', label: 'All', count: deviceFilterCounts.all },
    { key: 'bound', label: 'Bound', count: deviceFilterCounts.bound },
    { key: 'released', label: 'Released', count: deviceFilterCounts.released },
    { key: 'blocked', label: 'Blocked attempts', count: deviceFilterCounts.blocked },
    { key: 'shared', label: 'Shared', count: deviceFilterCounts.shared }
  ];

  return (
    <AppShell title="Users & Devices" showThemeToggle>
      <div className="space-y-5">
        {/* Header & Primary Actions */}
        <section className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div className="space-y-3">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100 font-display">
                Users &amp; Devices
              </h1>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
                {activeTab === 'devices'
                  ? `${deviceEntries.length} device records across ${users.length} accounts`
                  : `${users.length} staff accounts`}
                {userViewScope !== 'all' && ' (Scoped)'}
              </p>
            </div>

            {showDevicesTab && (
              <div
                role="tablist"
                aria-label="Users and devices sections"
                className="inline-flex items-center p-1 rounded-[16px] bg-slate-200/70 dark:bg-slate-800/80 border border-slate-200/80 dark:border-slate-700/80"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'people'}
                  onClick={() => setActiveTab('people')}
                  className={`min-h-[44px] px-4 py-2 rounded-[12px] text-xs font-semibold inline-flex items-center gap-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b6b4f] dark:focus-visible:ring-[#4fd1a1] ${
                    activeTab === 'people'
                      ? 'bg-white dark:bg-slate-900 text-[#0b6b4f] dark:text-[#4fd1a1] shadow-xs'
                      : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <Users className="w-4 h-4" />
                  <span>People</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'devices'}
                  onClick={() => setActiveTab('devices')}
                  className={`min-h-[44px] px-4 py-2 rounded-[12px] text-xs font-semibold inline-flex items-center gap-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b6b4f] dark:focus-visible:ring-[#4fd1a1] ${
                    activeTab === 'devices'
                      ? 'bg-white dark:bg-slate-900 text-[#0b6b4f] dark:text-[#4fd1a1] shadow-xs'
                      : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <Smartphone className="w-4 h-4" />
                  <span>Devices</span>
                </button>
              </div>
            )}
          </div>

          {activeTab === 'people' && (canCreateUsers || canLinkUsers) && (
            <div className="flex flex-wrap items-center gap-2.5 shrink-0">
              {canLinkUsers && (
                <button
                  type="button"
                  onClick={openLinkSheet}
                  className="min-h-[44px] px-4 py-2.5 rounded-[14px] border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 text-sm font-semibold inline-flex items-center gap-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b6b4f] dark:focus-visible:ring-[#4fd1a1]"
                >
                  <Link2 className="w-4 h-4 shrink-0" />
                  <span>Link Auth user</span>
                </button>
              )}
              {canCreateUsers && (
                <button
                  type="button"
                  onClick={openCreateSheet}
                  className="min-h-[44px] px-4 py-2.5 rounded-[14px] bg-[#0b6b4f] hover:bg-[#095941] dark:bg-[#4fd1a1] dark:hover:bg-[#3fc090] text-white dark:text-slate-950 text-sm font-semibold inline-flex items-center gap-2 shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#0b6b4f] dark:focus-visible:ring-[#4fd1a1]"
                >
                  <UserPlus className="w-4 h-4 shrink-0" />
                  <span>New user</span>
                </button>
              )}
            </div>
          )}
        </section>

        {activeTab === 'devices' && showDevicesTab ? (
          <>
            <div className="rounded-[16px] border border-slate-200/90 dark:border-slate-800 bg-slate-50/90 dark:bg-slate-900/60 px-4 py-2.5 flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
              <Info className="w-4 h-4 text-[#0b6b4f] dark:text-[#4fd1a1] shrink-0" aria-hidden="true" />
              <span>Binding uses the device ID only</span>
            </div>

            <section className="space-y-3">
              <div className="flex flex-col min-[720px]:flex-row min-[720px]:items-center justify-between gap-3">
                <div className="relative flex-1 min-[720px]:max-w-md">
                  <Search
                    aria-hidden="true"
                    className="w-4 h-4 text-slate-400 dark:text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                  />
                  <input
                    value={deviceSearch}
                    onChange={(e) => setDeviceSearch(e.target.value)}
                    type="search"
                    aria-label="Search devices by user, device name, model, IP, or device ID"
                    placeholder="Search user, device, model, IP, or ID..."
                    className="w-full min-h-[44px] pl-10 pr-10 py-2 rounded-[16px] border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-base text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-[#0b6b4f] dark:focus:ring-[#4fd1a1] focus:border-transparent transition-colors"
                  />
                  {deviceSearch && (
                    <button
                      type="button"
                      onClick={() => setDeviceSearch('')}
                      aria-label="Clear device search"
                      className="min-h-[44px] min-w-[44px] absolute right-0 top-1/2 -translate-y-1/2 inline-flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-r-[16px]"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>

                <div
                  role="group"
                  aria-label="Devices list view switch"
                  className="hidden min-[720px]:inline-flex items-center p-1 rounded-[16px] bg-slate-200/70 dark:bg-slate-800/80 border border-slate-200/80 dark:border-slate-700/80 self-start"
                >
                  <button
                    type="button"
                    aria-pressed={viewMode === 'cards'}
                    onClick={() => setViewMode('cards')}
                    className={`min-h-[44px] px-3.5 py-2 rounded-[12px] text-xs font-semibold inline-flex items-center gap-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b6b4f] dark:focus-visible:ring-[#4fd1a1] ${
                      viewMode === 'cards'
                        ? 'bg-white dark:bg-slate-900 text-[#0b6b4f] dark:text-[#4fd1a1] shadow-xs'
                        : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    <LayoutGrid className="w-4 h-4" />
                    <span>Cards</span>
                  </button>
                  <button
                    type="button"
                    aria-pressed={viewMode === 'table'}
                    onClick={() => setViewMode('table')}
                    className={`min-h-[44px] px-3.5 py-2 rounded-[12px] text-xs font-semibold inline-flex items-center gap-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b6b4f] dark:focus-visible:ring-[#4fd1a1] ${
                      viewMode === 'table'
                        ? 'bg-white dark:bg-slate-900 text-[#0b6b4f] dark:text-[#4fd1a1] shadow-xs'
                        : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    <Table2 className="w-4 h-4" />
                    <span>Table</span>
                  </button>
                </div>
              </div>

              <div
                role="group"
                aria-label="Filter devices by status"
                className="flex flex-wrap items-center gap-2"
              >
                {deviceFilterChips.map((chip) => {
                  const selected = deviceStatusFilter === chip.key;
                  return (
                    <button
                      key={chip.key}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setDeviceStatusFilter(chip.key)}
                      className={`min-h-[44px] px-3.5 py-2 rounded-[14px] border text-xs font-semibold inline-flex items-center gap-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b6b4f] dark:focus-visible:ring-[#4fd1a1] ${
                        selected
                          ? 'bg-[#0b6b4f] dark:bg-[#4fd1a1] text-white dark:text-slate-950 border-[#0b6b4f] dark:border-[#4fd1a1]'
                          : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-800 hover:bg-slate-100/70 dark:hover:bg-slate-800'
                      }`}
                    >
                      <span>{chip.label}</span>
                      <span
                        className={`px-1.5 py-0.5 rounded-[10px] text-[11px] font-mono-tabular ${
                          selected
                            ? 'bg-white/20 dark:bg-slate-950/20 text-white dark:text-slate-950'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                        }`}
                      >
                        {chip.count}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>

            {devicesLoading && deviceEntries.length === 0 ? (
              <div className="rounded-[22px] border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-10 text-center text-sm text-slate-500 dark:text-slate-400">
                Loading device records...
              </div>
            ) : filteredDevices.length === 0 ? (
              <div className="rounded-[22px] border border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900/60 p-10 text-center space-y-3">
                <div className="w-12 h-12 rounded-[16px] bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 mx-auto flex items-center justify-center">
                  <Smartphone className="w-6 h-6" />
                </div>
                <div className="space-y-1">
                  <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                    {deviceEntries.length === 0 ? 'No details yet' : 'No matching devices'}
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto">
                    {deviceEntries.length === 0
                      ? 'No device records have been captured for the visible staff accounts yet.'
                      : 'No devices match your current search or filter.'}
                  </p>
                </div>
                {(deviceSearch || deviceStatusFilter !== 'all') && (
                  <button
                    type="button"
                    onClick={() => {
                      setDeviceSearch('');
                      setDeviceStatusFilter('all');
                    }}
                    className="min-h-[44px] px-4 py-2 rounded-[14px] border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b6b4f] dark:focus-visible:ring-[#4fd1a1]"
                  >
                    Clear search and filters
                  </button>
                )}
              </div>
            ) : (
              <>
                {devicesLoading && (
                  <p className="text-xs text-slate-500 dark:text-slate-400 px-1" role="status">
                    Loading remaining device details...
                  </p>
                )}

                <div
                  className={
                    viewMode === 'cards'
                      ? 'grid grid-cols-1 min-[720px]:grid-cols-2 gap-3'
                      : 'grid grid-cols-1 gap-3 min-[720px]:hidden'
                  }
                >
                  {filteredDevices.map((entry) => (
                    <DeviceCard
                      key={`${entry.user?.uid || entry.user?.id}_${entry.device.deviceId}`}
                      entry={entry}
                      officeName={officeName}
                      onSelect={openDeviceDetail}
                    />
                  ))}
                </div>

                {viewMode === 'table' && (
                  <div className="hidden min-[720px]:block">
                    <DevicesTable
                      entries={filteredDevices}
                      officeName={officeName}
                      onSelect={openDeviceDetail}
                    />
                  </div>
                )}
              </>
            )}
          </>
        ) : (
          <>
            {/* Search, Filter Chips & 720px+ Cards/Table Switch */}
            <section className="space-y-3">
              <div className="flex flex-col min-[720px]:flex-row min-[720px]:items-center justify-between gap-3">
                <div className="relative flex-1 min-[720px]:max-w-md">
                  <Search
                    aria-hidden="true"
                    className="w-4 h-4 text-slate-400 dark:text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                  />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    type="search"
                    aria-label="Search staff accounts by name, email, or UID"
                    placeholder="Search by name, email, or UID..."
                    className="w-full min-h-[44px] pl-10 pr-10 py-2 rounded-[16px] border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-base text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-[#0b6b4f] dark:focus:ring-[#4fd1a1] focus:border-transparent transition-colors"
                  />
                  {search && (
                    <button
                      type="button"
                      onClick={() => setSearch('')}
                      aria-label="Clear search"
                      className="min-h-[44px] min-w-[44px] absolute right-0 top-1/2 -translate-y-1/2 inline-flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-r-[16px]"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>

                <div
                  role="group"
                  aria-label="List view switch"
                  className="hidden min-[720px]:inline-flex items-center p-1 rounded-[16px] bg-slate-200/70 dark:bg-slate-800/80 border border-slate-200/80 dark:border-slate-700/80 self-start"
                >
                  <button
                    type="button"
                    aria-pressed={viewMode === 'cards'}
                    onClick={() => setViewMode('cards')}
                    className={`min-h-[44px] px-3.5 py-2 rounded-[12px] text-xs font-semibold inline-flex items-center gap-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b6b4f] dark:focus-visible:ring-[#4fd1a1] ${
                      viewMode === 'cards'
                        ? 'bg-white dark:bg-slate-900 text-[#0b6b4f] dark:text-[#4fd1a1] shadow-xs'
                        : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    <LayoutGrid className="w-4 h-4" />
                    <span>Cards</span>
                  </button>
                  <button
                    type="button"
                    aria-pressed={viewMode === 'table'}
                    onClick={() => setViewMode('table')}
                    className={`min-h-[44px] px-3.5 py-2 rounded-[12px] text-xs font-semibold inline-flex items-center gap-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b6b4f] dark:focus-visible:ring-[#4fd1a1] ${
                      viewMode === 'table'
                        ? 'bg-white dark:bg-slate-900 text-[#0b6b4f] dark:text-[#4fd1a1] shadow-xs'
                        : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    <Table2 className="w-4 h-4" />
                    <span>Table</span>
                  </button>
                </div>
              </div>

              {/* Filter Chips */}
              <div
                role="group"
                aria-label="Filter accounts by status"
                className="flex flex-wrap items-center gap-2"
              >
                {filterChips.map((chip) => {
                  const selected = statusFilter === chip.key;
                  return (
                    <button
                      key={chip.key}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setStatusFilter(chip.key)}
                      className={`min-h-[44px] px-3.5 py-2 rounded-[14px] border text-xs font-semibold inline-flex items-center gap-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b6b4f] dark:focus-visible:ring-[#4fd1a1] ${
                        selected
                          ? 'bg-[#0b6b4f] dark:bg-[#4fd1a1] text-white dark:text-slate-950 border-[#0b6b4f] dark:border-[#4fd1a1]'
                          : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-800 hover:bg-slate-100/70 dark:hover:bg-slate-800'
                      }`}
                    >
                      <span>{chip.label}</span>
                      <span
                        className={`px-1.5 py-0.5 rounded-[10px] text-[11px] font-mono-tabular ${
                          selected
                            ? 'bg-white/20 dark:bg-slate-950/20 text-white dark:text-slate-950'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                        }`}
                      >
                        {chip.count}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>

            {errorMsg && (
              <div
                role="alert"
                className="p-3.5 rounded-[16px] bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/70 text-xs text-rose-800 dark:text-rose-200"
              >
                {errorMsg}
              </div>
            )}

            {/* List Content */}
            {loading ? (
              <div className="rounded-[22px] border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-10 text-center text-sm text-slate-500 dark:text-slate-400">
                Loading staff accounts...
              </div>
            ) : filteredUsers.length === 0 ? (
              <div className="rounded-[22px] border border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900/60 p-10 text-center space-y-3">
                <div className="w-12 h-12 rounded-[16px] bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 mx-auto flex items-center justify-center">
                  <Users className="w-6 h-6" />
                </div>
                <div className="space-y-1">
                  <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                    No matching accounts
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto">
                    No staff accounts match your current search or status filter.
                  </p>
                </div>
                {(search || statusFilter !== 'all') && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearch('');
                      setStatusFilter('all');
                    }}
                    className="min-h-[44px] px-4 py-2 rounded-[14px] border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b6b4f] dark:focus-visible:ring-[#4fd1a1]"
                  >
                    Clear search and filters
                  </button>
                )}
              </div>
            ) : (
              <>
                {/* Cards View: Always on <720px; optional on >=720px */}
                <div
                  className={
                    viewMode === 'cards'
                      ? 'grid grid-cols-1 min-[720px]:grid-cols-2 gap-3'
                      : 'grid grid-cols-1 gap-3 min-[720px]:hidden'
                  }
                >
                  {filteredUsers.map((u) => (
                    <UserCard
                      key={u.uid || u.id}
                      user={u}
                      officeName={officeName}
                      onSelect={openUserDetail}
                    />
                  ))}
                </div>

                {/* Table View: Only >=720px when viewMode === 'table' */}
                {viewMode === 'table' && (
                  <div className="hidden min-[720px]:block">
                    <UserTable
                      users={filteredUsers}
                      officeName={officeName}
                      onSelect={openUserDetail}
                    />
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>

      {/* Device Detail Bottom Sheet */}
      {showDevicesTab && (
        <DeviceDetailSheet
          open={deviceDetailOpen && Boolean(selectedDeviceEntry)}
          entry={selectedDeviceEntry}
          officeName={officeName}
          busy={actionBusy || submitting}
          onClose={() => setDeviceDetailOpen(false)}
          onResetDevice={resetBoundDevice}
        />
      )}

      {/* Detail Bottom Sheet */}
      <UserDetailSheet
        open={detailOpen && Boolean(selectedUser)}
        user={selectedUser}
        officeName={officeName}
        busy={actionBusy || submitting}
        assignmentsRefreshKey={assignmentsRefreshKey}
        onClose={() => setDetailOpen(false)}
        onEdit={openEditSheet}
        onTransfer={openTransferSheet}
        onResetDevice={resetBoundDevice}
        onToggleStatus={onStatusChange}
        onApprove={approveUser}
        onDelete={can('user.delete') ? (u) => setConfirmDeleteUser(u) : undefined}
      />

      {/* Create / Link / Stacked Edit Bottom Sheet */}
      <UserFormSheet
        open={formSheetOpen}
        mode={formMode}
        offices={offices}
        user={formMode === 'edit' ? selectedUser : null}
        submitting={submitting}
        tasks={sheetTasks}
        feedbackSummary={sheetFeedbackSummary}
        feedbackVariant={sheetFeedbackVariant}
        onClose={() => setFormSheetOpen(false)}
        onCreateSubmit={createUserDirectly}
        onLinkSubmit={createProfileForExistingAuth}
        onEditSubmit={saveUserEdits}
      />

      {/* Stacked Transfer / Posting Bottom Sheet */}
      <TransferUserSheet
        open={transferSheetOpen && Boolean(selectedUser)}
        user={selectedUser}
        offices={offices}
        submitting={submitting}
        onClose={() => setTransferSheetOpen(false)}
        onSubmit={executeTransfer}
      />

      <ConfirmSheet
        open={Boolean(confirmDeleteUser)}
        title="Delete User Profile"
        message={`Are you sure you want to delete ${confirmDeleteUser?.name || confirmDeleteUser?.email || 'this user'}? This removes their Firestore users document.`}
        confirmLabel="Delete User"
        danger={true}
        onConfirm={executeDeleteUser}
        onCancel={() => setConfirmDeleteUser(null)}
      />

      {/* Toast Notification */}
      {toastMsg && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-20 lg:bottom-6 left-1/2 -translate-x-1/2 z-[120] max-w-[calc(100vw-2rem)] px-4 py-3 rounded-[16px] bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-950 shadow-xl flex items-center gap-2.5 text-sm font-medium"
        >
          <CheckCircle2 className="w-4 h-4 text-[#4fd1a1] dark:text-[#0b6b4f] shrink-0" />
          <span className="truncate">{toastMsg}</span>
        </div>
      )}
    </AppShell>
  );
}
