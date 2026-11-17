import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut
} from 'firebase/auth';
import {
  collection,
  getDocs,
  getDoc,
  doc,
  setDoc,
  updateDoc,
  serverTimestamp
} from 'firebase/firestore';
import { UserPlus, Link2 } from 'lucide-react';
import AppShell from '../../components/AppShell.jsx';
import ConfirmSheet from '../../components/ConfirmSheet.jsx';
import { SubmissionTasksInline, SubmissionTasksFeedback } from '../../components/SubmissionTasks.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useData } from '../../context/DataContext.jsx';
import {
  db,
  getSecondaryAuthApp,
  getSecondaryAuth,
  disposeSecondaryApp,
  withTimeout,
  OperationType,
  handleFirestoreError
} from '../../firebase/config.js';
import { uploadImageSafe } from '../../utils/storageUpload.js';
import { getTodayDhaka } from '../../utils/dhakaTime.js';

const EMPTY_CREATE_FORM = () => ({
  name: '',
  designation: '',
  mobile: '',
  address: '',
  email: '',
  password: '',
  officeId: '',
  role: 'employee',
  joiningDate: getTodayDhaka()
});

const EMPTY_LINK_FORM = () => ({
  linkMethod: 'credentials', // 'credentials' | 'uid'
  uid: '',
  email: '',
  password: '',
  name: '',
  designation: '',
  mobile: '',
  address: '',
  officeId: '',
  role: 'employee',
  approvalStatus: 'approved',
  status: 'active',
  joiningDate: getTodayDhaka()
});

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

export default function AdminUsersPage() {
  const { profile, offices, computeDistrictOfficeId } = useAuth();
  const { logAudit } = useData();

  const [loading, setLoading] = useState(true);
  const [activePanel, setActivePanel] = useState(null); // null | 'create' | 'link'
  const [creatingUser, setCreatingUser] = useState(false);
  const [linkingUser, setLinkingUser] = useState(false);
  const [newPhotoFile, setNewPhotoFile] = useState(null);
  const [linkPhotoFile, setLinkPhotoFile] = useState(null);
  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState('');
  const [resetDeviceTarget, setResetDeviceTarget] = useState(null);
  const [feedbackMsg, setFeedbackMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [createTasks, setCreateTasks] = useState([]);
  const [linkTasks, setLinkTasks] = useState([]);
  const [feedbackTasks, setFeedbackTasks] = useState([]);
  const [feedbackVariant, setFeedbackVariant] = useState('info');
  const [feedbackSummary, setFeedbackSummary] = useState('');
  const [newUser, setNewUser] = useState(EMPTY_CREATE_FORM);
  const [linkForm, setLinkForm] = useState(EMPTY_LINK_FORM);

  const officeName = useCallback(
    (id) => (id ? offices.find((o) => o.id === id)?.name || id : ''),
    [offices]
  );

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const snap = await withTimeout(
        getDocs(collection(db, 'users')),
        15000,
        'ব্যবহারকারী তালিকা লোড করতে সময় বেশি লাগছে।'
      );
      setUsers(
        snap.docs
          .map((d) => ({ uid: d.id, id: d.id, ...d.data() }))
          .sort((a, b) => (a.name || a.email || a.id || '').localeCompare(b.name || b.email || b.id || ''))
      );
    } catch (err) {
      setErrorMsg('ব্যবহারকারী তালিকা লোড করা যায়নি।');
      handleFirestoreError(err, OperationType.LIST, 'users');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) =>
        (u.name || '').toLowerCase().includes(q) ||
        (u.email || '').toLowerCase().includes(q) ||
        (u.uid || u.id || '').toLowerCase().includes(q)
    );
  }, [users, search]);

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

  const createUserDirectly = async (e) => {
    e.preventDefault();
    if (creatingUser) return;

    let tasks = buildCreateTaskList();
    const updateTask = (id, status, detail = '') => {
      tasks = tasks.map((t) => (t.id === id ? { ...t, status, detail } : t));
      setCreateTasks(tasks);
      setFeedbackTasks(tasks);
    };

    setCreatingUser(true);
    setErrorMsg('');
    setFeedbackMsg('');
    setCreateTasks(tasks);
    setFeedbackTasks(tasks);
    setFeedbackVariant('info');
    setFeedbackSummary('Creating user account and Firestore profile...');

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
              'এই ইমেইল দিয়ে ইতোমধ্যে Firebase Auth অ্যাকাউন্ট তৈরি আছে (অথবা পাসওয়ার্ড মিলছে না)। "Create Profile for Existing Auth User" অপশন ব্যবহার করে UID দিয়ে প্রোফাইল তৈরি করুন।';
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
              : 'Direct user creation by Super Admin'
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
      setFeedbackSummary(summary);
      setFeedbackVariant(tasks.some((t) => t.status === 'skipped' && t.detail.includes('Storage')) ? 'warning' : 'success');
      setFeedbackMsg(summary);
      setActivePanel(null);
      setNewPhotoFile(null);
      setNewUser(EMPTY_CREATE_FORM());
    } catch (err) {
      const msg = err.message || 'নতুন ব্যবহারকারী তৈরি করা যায়নি।';
      setFeedbackSummary(msg);
      setFeedbackVariant('error');
      setErrorMsg(msg);
    } finally {
      await disposeSecondaryApp(secondaryApp);
      setCreatingUser(false);
    }
  };

  const createProfileForExistingAuth = async (e) => {
    e.preventDefault();
    if (linkingUser) return;

    let tasks = buildLinkTaskList(linkForm.linkMethod);
    const updateTask = (id, status, detail = '') => {
      tasks = tasks.map((t) => (t.id === id ? { ...t, status, detail } : t));
      setLinkTasks(tasks);
      setFeedbackTasks(tasks);
    };

    setLinkingUser(true);
    setErrorMsg('');
    setFeedbackMsg('');
    setLinkTasks(tasks);
    setFeedbackTasks(tasks);
    setFeedbackVariant('info');
    setFeedbackSummary('Processing missing user profile creation...');

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
              'এই ইমেইল বা পাসওয়ার্ড দিয়ে Auth অ্যাকাউন্ট যাচাই করা যায়নি। পাসওয়ার্ড না জানলে "Enter Auth UID Directly" মোড ব্যবহার করুন।';
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
        const dupMsg = `UID (${targetUid})-এর জন্য users ডকুমেন্ট ইতোমধ্যে তৈরি আছে। নিচের তালিকা থেকে পরিবর্তন করুন।`;
        updateTask('check', 'error', dupMsg);
        throw new Error(dupMsg);
      }
      updateTask('check', 'done', 'No duplicate found — ready to create');

      updateTask('write', 'running', `Writing users/${targetUid}...`);
      const districtOfficeId = computeDistrictOfficeId(linkForm.officeId);
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
            reason: `Created Firestore profile for existing Auth user via ${linkForm.linkMethod}`
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
      setFeedbackSummary(summary);
      setFeedbackVariant(tasks.some((t) => t.status === 'skipped' && t.detail.includes('Storage')) ? 'warning' : 'success');
      setFeedbackMsg(summary);
      setActivePanel(null);
      setLinkPhotoFile(null);
      setLinkForm(EMPTY_LINK_FORM());
    } catch (err) {
      const msg = err.message || 'বিদ্যমান Auth ব্যবহারকারীর প্রোফাইল তৈরি করা যায়নি।';
      setFeedbackSummary(msg);
      setFeedbackVariant('error');
      setErrorMsg(msg);
    } finally {
      await disposeSecondaryApp(secondaryApp);
      setLinkingUser(false);
    }
  };

  const updateUserField = async (u, patch) => {
    setErrorMsg('');
    setFeedbackMsg('');
    setFeedbackTasks([]);
    const targetUid = u.uid || u.id;
    if (!targetUid) {
      setErrorMsg('ব্যবহারকারীর আইডি পাওয়া যায়নি।');
      return;
    }
    try {
      const payload = {
        ...(u.status ? {} : { status: 'active' }),
        ...(u.role ? {} : { role: 'employee' }),
        ...(u.approvalStatus ? {} : { approvalStatus: 'approved' }),
        ...patch,
        updatedAt: serverTimestamp()
      };
      await updateDoc(doc(db, 'users', targetUid), payload);
      await logAudit({
        actor: profile,
        action: 'USER_UPDATED',
        targetCollection: 'users',
        targetId: targetUid,
        newValue: JSON.stringify(patch),
        reason: 'Super admin user update'
      });
      setFeedbackMsg(`${u.name || u.email || targetUid}-এর তথ্য আপডেট হয়েছে।`);
      await loadUsers();
    } catch (err) {
      setErrorMsg('আপডেট ব্যর্থ হয়েছে।');
      handleFirestoreError(err, OperationType.UPDATE, `users/${targetUid}`);
    }
  };

  const onStatusChange = async (u, nextStatus) => {
    await updateUserField(u, {
      status: nextStatus,
      resignationDate: nextStatus === 'resigned' ? u.resignationDate || getTodayDhaka() : null
    });
  };

  const confirmResetDevice = async () => {
    if (!resetDeviceTarget) return;
    const u = resetDeviceTarget;
    setResetDeviceTarget(null);
    await updateUserField(u, { boundDeviceId: null });
  };

  return (
    <AppShell>
      <div className="space-y-5">
        <section className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-slate-900 font-display">User Provisioning &amp; Profile Recovery</h2>
              <p className="text-xs text-slate-500">
                Create a new Auth + Firestore account, or generate a missing users profile for an existing Firebase Auth account.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setActivePanel((p) => (p === 'create' ? null : 'create'))}
                className={`inline-flex items-center gap-1.5 min-h-[40px] px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors ${
                  activePanel === 'create'
                    ? 'bg-emerald-700 text-white'
                    : 'border border-slate-300 text-slate-700 hover:bg-slate-50'
                }`}
              >
                <UserPlus className="w-3.5 h-3.5" />
                {activePanel === 'create' ? 'Hide New User' : 'New User'}
              </button>
              <button
                type="button"
                onClick={() => setActivePanel((p) => (p === 'link' ? null : 'link'))}
                className={`inline-flex items-center gap-1.5 min-h-[40px] px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors ${
                  activePanel === 'link'
                    ? 'bg-slate-900 text-white'
                    : 'border border-slate-300 text-slate-700 hover:bg-slate-50'
                }`}
              >
                <Link2 className="w-3.5 h-3.5" />
                {activePanel === 'link' ? 'Hide Auth Recovery' : 'Create Profile for Existing Auth User'}
              </button>
            </div>
          </div>

          {activePanel === 'create' && (
            <form
              onSubmit={createUserDirectly}
              className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 pt-3 border-t border-slate-100"
            >
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Full Name</label>
                <input
                  value={newUser.name}
                  onChange={(e) => setNewUser((n) => ({ ...n, name: e.target.value }))}
                  type="text"
                  required
                  minLength={2}
                  className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Designation</label>
                <input
                  value={newUser.designation}
                  onChange={(e) => setNewUser((n) => ({ ...n, designation: e.target.value }))}
                  type="text"
                  required
                  minLength={2}
                  className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Mobile</label>
                <input
                  value={newUser.mobile}
                  onChange={(e) => setNewUser((n) => ({ ...n, mobile: e.target.value }))}
                  type="tel"
                  required
                  minLength={6}
                  className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 text-sm font-mono-tabular"
                />
              </div>
              <div className="sm:col-span-2 lg:col-span-3">
                <label className="block text-xs font-semibold text-slate-700 mb-1">Address</label>
                <input
                  value={newUser.address}
                  onChange={(e) => setNewUser((n) => ({ ...n, address: e.target.value }))}
                  type="text"
                  required
                  minLength={2}
                  className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Email</label>
                <input
                  value={newUser.email}
                  onChange={(e) => setNewUser((n) => ({ ...n, email: e.target.value }))}
                  type="email"
                  required
                  className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Initial Password</label>
                <input
                  value={newUser.password}
                  onChange={(e) => setNewUser((n) => ({ ...n, password: e.target.value }))}
                  type="password"
                  required
                  minLength={6}
                  className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Office (Optional)</label>
                <select
                  value={newUser.officeId}
                  onChange={(e) => setNewUser((n) => ({ ...n, officeId: e.target.value }))}
                  className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 text-sm bg-white"
                >
                  <option value="">Assign office later / None</option>
                  {offices.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Role</label>
                <select
                  value={newUser.role}
                  onChange={(e) => setNewUser((n) => ({ ...n, role: e.target.value }))}
                  required
                  className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 text-sm bg-white"
                >
                  <option value="employee">Employee</option>
                  <option value="office_head">Office Head</option>
                  <option value="district_officer">District Officer</option>
                  <option value="head_office">Head Office (DG)</option>
                  <option value="super_admin">Super Admin</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Joining Date</label>
                <input
                  value={newUser.joiningDate}
                  onChange={(e) => setNewUser((n) => ({ ...n, joiningDate: e.target.value }))}
                  type="date"
                  required
                  className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 text-sm font-mono-tabular"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Profile Photo (Optional)</label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => setNewPhotoFile(e.target.files?.[0] || null)}
                  className="block w-full text-xs text-slate-600 file:py-2 file:px-3 file:rounded-lg file:border-0 file:bg-slate-100"
                />
              </div>
              <div className="sm:col-span-2 lg:col-span-3 flex flex-wrap items-start gap-3 pt-1">
                <button
                  type="submit"
                  disabled={creatingUser}
                  className="min-h-[44px] px-5 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold disabled:opacity-60 shrink-0"
                >
                  {creatingUser ? 'তৈরি হচ্ছে...' : 'Create Approved User'}
                </button>
                <SubmissionTasksInline tasks={createTasks} />
              </div>
            </form>
          )}

          {activePanel === 'link' && (
            <form
              onSubmit={createProfileForExistingAuth}
              className="space-y-4 pt-3 border-t border-slate-100"
            >
              <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600 leading-relaxed">
                For users who exist in Firebase Authentication (e.g. created directly in Firebase Console or via an earlier failed attempt) but have no document in Firestore <span className="font-mono-tabular font-semibold">users/{'{uid}'}</span>.
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setLinkForm((f) => ({ ...f, linkMethod: 'credentials' }))}
                  className={`min-h-[38px] px-3 py-1.5 rounded-xl text-xs font-semibold border ${
                    linkForm.linkMethod === 'credentials'
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-700 border-slate-300'
                  }`}
                >
                  Lookup UID by Email + Password
                </button>
                <button
                  type="button"
                  onClick={() => setLinkForm((f) => ({ ...f, linkMethod: 'uid' }))}
                  className={`min-h-[38px] px-3 py-1.5 rounded-xl text-xs font-semibold border ${
                    linkForm.linkMethod === 'uid'
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-700 border-slate-300'
                  }`}
                >
                  Enter Auth UID Directly
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {linkForm.linkMethod === 'credentials' ? (
                  <>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Auth Email</label>
                      <input
                        value={linkForm.email}
                        onChange={(e) => setLinkForm((f) => ({ ...f, email: e.target.value }))}
                        type="email"
                        required
                        placeholder="existing@office.gov.bd"
                        className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Auth Password</label>
                      <input
                        value={linkForm.password}
                        onChange={(e) => setLinkForm((f) => ({ ...f, password: e.target.value }))}
                        type="password"
                        required
                        placeholder="User's Auth password"
                        className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 text-sm"
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Firebase Auth UID</label>
                      <input
                        value={linkForm.uid}
                        onChange={(e) => setLinkForm((f) => ({ ...f, uid: e.target.value }))}
                        type="text"
                        required
                        placeholder="Paste Auth UID from Console"
                        className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 text-sm font-mono-tabular"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-700 mb-1">Email</label>
                      <input
                        value={linkForm.email}
                        onChange={(e) => setLinkForm((f) => ({ ...f, email: e.target.value }))}
                        type="email"
                        required
                        placeholder="existing@office.gov.bd"
                        className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 text-sm"
                      />
                    </div>
                  </>
                )}

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Full Name</label>
                  <input
                    value={linkForm.name}
                    onChange={(e) => setLinkForm((f) => ({ ...f, name: e.target.value }))}
                    type="text"
                    required
                    minLength={2}
                    className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Designation</label>
                  <input
                    value={linkForm.designation}
                    onChange={(e) => setLinkForm((f) => ({ ...f, designation: e.target.value }))}
                    type="text"
                    required
                    minLength={2}
                    className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Mobile</label>
                  <input
                    value={linkForm.mobile}
                    onChange={(e) => setLinkForm((f) => ({ ...f, mobile: e.target.value }))}
                    type="tel"
                    required
                    minLength={6}
                    className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 text-sm font-mono-tabular"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Office (Optional)</label>
                  <select
                    value={linkForm.officeId}
                    onChange={(e) => setLinkForm((f) => ({ ...f, officeId: e.target.value }))}
                    className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 text-sm bg-white"
                  >
                    <option value="">Assign office later / None</option>
                    {offices.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="sm:col-span-2 lg:col-span-3">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Address</label>
                  <input
                    value={linkForm.address}
                    onChange={(e) => setLinkForm((f) => ({ ...f, address: e.target.value }))}
                    type="text"
                    required
                    minLength={2}
                    className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 text-sm"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Role</label>
                  <select
                    value={linkForm.role}
                    onChange={(e) => setLinkForm((f) => ({ ...f, role: e.target.value }))}
                    required
                    className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 text-sm bg-white"
                  >
                    <option value="employee">Employee</option>
                    <option value="office_head">Office Head</option>
                    <option value="district_officer">District Officer</option>
                    <option value="head_office">Head Office (DG)</option>
                    <option value="super_admin">Super Admin</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Approval Status</label>
                  <select
                    value={linkForm.approvalStatus}
                    onChange={(e) => setLinkForm((f) => ({ ...f, approvalStatus: e.target.value }))}
                    required
                    className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 text-sm bg-white"
                  >
                    <option value="approved">Approved</option>
                    <option value="pending">Pending</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Joining Date</label>
                  <input
                    value={linkForm.joiningDate}
                    onChange={(e) => setLinkForm((f) => ({ ...f, joiningDate: e.target.value }))}
                    type="date"
                    required
                    className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 text-sm font-mono-tabular"
                  />
                </div>
                <div className="sm:col-span-2 lg:col-span-3">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Profile Photo (Optional)</label>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => setLinkPhotoFile(e.target.files?.[0] || null)}
                    className="block w-full text-xs text-slate-600 file:py-2 file:px-3 file:rounded-lg file:border-0 file:bg-slate-100"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-start gap-3 pt-1">
                <button
                  type="submit"
                  disabled={linkingUser}
                  className="min-h-[44px] px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold disabled:opacity-60 shrink-0"
                >
                  {linkingUser ? 'সংরক্ষণ হচ্ছে...' : 'Create Missing Firestore Profile'}
                </button>
                <SubmissionTasksInline tasks={linkTasks} />
              </div>
            </form>
          )}
        </section>

        {feedbackTasks.length > 0 ? (
          <SubmissionTasksFeedback
            tasks={feedbackTasks}
            summary={feedbackSummary}
            variant={feedbackVariant}
          />
        ) : (
          <>
            {feedbackMsg && (
              <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800">
                {feedbackMsg}
              </div>
            )}
            {errorMsg && (
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800">{errorMsg}</div>
            )}
          </>
        )}

        <section className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100">
          <div className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <h3 className="text-sm font-bold text-slate-900 font-display">
              All Staff Accounts ({filteredUsers.length})
            </h3>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              type="search"
              placeholder="Search by name, email, or UID..."
              className="w-full sm:w-64 min-h-[40px] px-3 py-1.5 rounded-xl border border-slate-300 text-xs"
            />
          </div>

          {loading ? (
            <div className="p-8 text-center text-sm text-slate-600">লোড হচ্ছে...</div>
          ) : (
            filteredUsers.map((u) => {
              const key = u.uid || u.id;
              return (
                <div key={key} className="p-4 space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="text-sm font-bold text-slate-900">{u.name || u.email || u.id}</div>
                      <div className="text-xs text-slate-600">
                        {u.designation || 'No designation'} · {officeName(u.officeId) || 'No office'} ·{' '}
                        {u.email || '—'}
                      </div>
                      <div className="text-[11px] font-mono-tabular text-slate-500 mt-0.5">
                        UID: {key} · Role: {u.role} · Approval: {u.approvalStatus} · Status: {u.status} · Device:{' '}
                        {u.boundDeviceId ? `${u.boundDeviceId.slice(0, 12)}...` : 'Unbound'}
                      </div>
                    </div>

                    {u.boundDeviceId && (
                      <button
                        type="button"
                        onClick={() => setResetDeviceTarget(u)}
                        className="min-h-[40px] px-3 py-1.5 rounded-xl border border-amber-300 text-amber-800 hover:bg-amber-50 text-xs font-semibold shrink-0"
                      >
                        Reset Bound Device
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                    <select
                      value={u.officeId || ''}
                      onChange={(e) =>
                        updateUserField(u, {
                          officeId: e.target.value,
                          districtOfficeId: computeDistrictOfficeId(e.target.value)
                        })
                      }
                      className="min-h-[40px] px-2.5 py-1.5 rounded-xl border border-slate-200 text-xs bg-white"
                    >
                      <option value="">No office assigned</option>
                      {offices.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name}
                        </option>
                      ))}
                    </select>

                    <select
                      value={u.role || 'employee'}
                      onChange={(e) => updateUserField(u, { role: e.target.value })}
                      className="min-h-[40px] px-2.5 py-1.5 rounded-xl border border-slate-200 text-xs bg-white"
                    >
                      <option value="employee">Employee</option>
                      <option value="office_head">Office Head</option>
                      <option value="district_officer">District Officer</option>
                      <option value="head_office">Head Office</option>
                      <option value="super_admin">Super Admin</option>
                    </select>

                    <select
                      value={u.status || 'active'}
                      onChange={(e) => onStatusChange(u, e.target.value)}
                      className="min-h-[40px] px-2.5 py-1.5 rounded-xl border border-slate-200 text-xs bg-white"
                    >
                      <option value="active">Active</option>
                      <option value="resigned">Resigned</option>
                    </select>

                    <select
                      value={u.approvalStatus || 'pending'}
                      onChange={(e) => updateUserField(u, { approvalStatus: e.target.value })}
                      className="min-h-[40px] px-2.5 py-1.5 rounded-xl border border-slate-200 text-xs bg-white"
                    >
                      <option value="approved">Approved</option>
                      <option value="pending">Pending</option>
                      <option value="rejected">Rejected</option>
                    </select>
                  </div>
                </div>
              );
            })
          )}
        </section>

        <ConfirmSheet
          open={!!resetDeviceTarget}
          title="Reset Bound Device"
          message={`Clear the bound device ID for ${
            resetDeviceTarget?.name || resetDeviceTarget?.email || resetDeviceTarget?.id
          }? They will bind a new device on their next login.`}
          confirmLabel="Reset Device"
          onConfirm={confirmResetDevice}
          onCancel={() => setResetDeviceTarget(null)}
        />
      </div>
    </AppShell>
  );
}
