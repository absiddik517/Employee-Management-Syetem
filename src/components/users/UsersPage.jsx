import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where
} from 'firebase/firestore';
import {
  CheckCircle2,
  LayoutGrid,
  Link2,
  Search,
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
import { getTodayDhaka } from '../../utils/dhakaTime.js';
import {
  ROLES,
  getPermissionScope,
  getUserOfficeScopeIds
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
  const scope = getPermissionScope({ role, approvalStatus: 'approved', status: 'active' }, 'report.create');
  return scope === 'subtree' || scope === 'office';
}

export default function UsersPage() {
  const { profile, effectiveAuthUser, offices, computeDistrictOfficeId, can, permissionScope } = useAuth();
  const { logAudit } = useData();

  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all'); // 'all' | 'active' | 'inactive' | 'pending'
  const [viewMode, setViewMode] = useState('table'); // 'cards' | 'table' (applies >= 720px)

  const [selectedUserId, setSelectedUserId] = useState(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const [formSheetOpen, setFormSheetOpen] = useState(false);
  const [formMode, setFormMode] = useState('create'); // 'create' | 'link' | 'edit'
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
  const editScope = permissionScope('user.edit');
  const canCreateOrLinkUsers = editScope === 'all';

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
      } else {
        const scopeIds = getUserOfficeScopeIds(effectiveAuthUser);
        if (scopeIds.length > 0) {
          const queries = [];
          for (const oid of scopeIds) {
            queries.push(getDocs(query(collection(db, 'users'), where('officeId', '==', oid))));
            if (userViewScope === 'subtree') {
              queries.push(getDocs(query(collection(db, 'users'), where('districtOfficeId', '==', oid))));
            }
          }
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
  }, [userViewScope, effectiveAuthUser]);

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
    if (submitting || !canCreateOrLinkUsers) return { ok: false };

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
      const additionalOfficeIds =
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
          additionalOfficeIds,
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
              : 'Direct user creation by Super Admin',
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
    if (submitting || !canCreateOrLinkUsers) return { ok: false };

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
      const additionalOfficeIds =
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
          additionalOfficeIds,
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
    if (!can('user.edit', { uid: u.uid || u.id, role: u.role, officeId: u.officeId, districtOfficeId: u.districtOfficeId })) {
      return;
    }
    await updateUserField(
      u,
      {
        status: nextStatus,
        resignationDate: nextStatus === 'resigned' ? u.resignationDate || getTodayDhaka() : null
      },
      nextStatus === 'active' ? 'User activated' : 'User deactivated',
      nextStatus === 'active' ? 'USER_ACTIVATED' : 'USER_DEACTIVATED'
    );
  };

  const resetBoundDevice = async (u) => {
    if (!can('user.resetDevice', { uid: u.uid || u.id, role: u.role, officeId: u.officeId, districtOfficeId: u.districtOfficeId })) {
      return;
    }
    await updateUserField(u, { boundDeviceId: null }, 'Bound device reset', 'DEVICE_RESET');
  };

  const approveUser = async (u) => {
    if (!can('user.approve', { uid: u.uid || u.id, role: u.role, officeId: u.officeId, districtOfficeId: u.districtOfficeId })) {
      return;
    }
    await updateUserField(u, { approvalStatus: 'approved' }, 'User approved', 'USER_APPROVED');
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
    const targetScopeObj = {
      uid: u.uid || u.id,
      role: u.role,
      officeId: u.officeId || '',
      districtOfficeId: u.districtOfficeId || ''
    };
    if (!can('user.edit', targetScopeObj)) {
      return { ok: false, error: 'You do not have permission to edit this user.' };
    }
    if (formValues.role !== u.role) {
      const canAssign = can('user.role.assign', {
        uid: u.uid || u.id,
        currentRole: u.role,
        newRole: formValues.role,
        officeId: formValues.officeId || u.officeId || '',
        districtOfficeId: computeDistrictOfficeId(formValues.officeId || u.officeId || '')
      });
      if (!canAssign) {
        return { ok: false, error: 'You do not have permission to assign this role.' };
      }
    }

    setSubmitting(true);
    try {
      const officeId = formValues.officeId || '';
      const districtOfficeId = computeDistrictOfficeId(officeId);
      const patch = {
        name: formValues.name.trim(),
        designation: formValues.designation.trim(),
        mobile: formValues.mobile.trim(),
        officeId,
        districtOfficeId,
        address: formValues.address.trim(),
        joiningDate: formValues.joiningDate,
        role: formValues.role || ROLES.employee.key,
        status: formValues.status,
        resignationDate:
          formValues.status === 'resigned'
            ? formValues.resignationDate || getTodayDhaka()
            : null,
        approvalStatus: formValues.approvalStatus
      };
      if (canCreateOrLinkUsers) {
        patch.additionalOfficeIds =
          supportsAdditionalCharge(formValues.role) && Array.isArray(formValues.additionalOfficeIds)
            ? Array.from(new Set(formValues.additionalOfficeIds.filter((id) => id && id !== officeId))).slice(0, 20)
            : [];
      }
      const ok = await updateUserField(u, patch, 'Changes saved', 'USER_EDITED');
      if (ok) {
        setFormSheetOpen(false);
        return { ok: true };
      }
      return { ok: false, error: 'Failed to save changes. Please verify inputs and permissions.' };
    } catch (err) {
      return { ok: false, error: err?.message || 'Failed to save changes.' };
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

  const openUserDetail = (u) => {
    setSelectedUserId(u.uid || u.id);
    setDetailOpen(true);
  };

  const filterChips = [
    { key: 'all', label: 'All', count: filterCounts.all },
    { key: 'active', label: 'Active', count: filterCounts.active },
    { key: 'inactive', label: 'Inactive', count: filterCounts.inactive },
    { key: 'pending', label: 'Pending approval', count: filterCounts.pending }
  ];

  return (
    <AppShell title="Users & Devices" showThemeToggle>
      <div className="space-y-5">
        {/* Header & Primary Actions */}
        <section className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100 font-display">
              Users &amp; Devices
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
              {users.length} staff accounts
              {userViewScope !== 'all' && ' (Scoped)'}
            </p>
          </div>

          {canCreateOrLinkUsers && (
            <div className="flex flex-wrap items-center gap-2.5 shrink-0">
              <button
                type="button"
                onClick={openLinkSheet}
                className="min-h-[44px] px-4 py-2.5 rounded-[14px] border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 text-sm font-semibold inline-flex items-center gap-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b6b4f] dark:focus-visible:ring-[#4fd1a1]"
              >
                <Link2 className="w-4 h-4 shrink-0" />
                <span>Link Auth user</span>
              </button>
              <button
                type="button"
                onClick={openCreateSheet}
                className="min-h-[44px] px-4 py-2.5 rounded-[14px] bg-[#0b6b4f] hover:bg-[#095941] dark:bg-[#4fd1a1] dark:hover:bg-[#3fc090] text-white dark:text-slate-950 text-sm font-semibold inline-flex items-center gap-2 shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#0b6b4f] dark:focus-visible:ring-[#4fd1a1]"
              >
                <UserPlus className="w-4 h-4 shrink-0" />
                <span>New user</span>
              </button>
            </div>
          )}
        </section>

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
      </div>

      {/* Detail Bottom Sheet */}
      <UserDetailSheet
        open={detailOpen && Boolean(selectedUser)}
        user={selectedUser}
        officeName={officeName}
        busy={actionBusy || submitting}
        onClose={() => setDetailOpen(false)}
        onEdit={openEditSheet}
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
