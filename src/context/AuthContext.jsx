import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut
} from 'firebase/auth';
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  query,
  where,
  getDocs,
  serverTimestamp
} from 'firebase/firestore';
import { ref as storageRef, getDownloadURL } from 'firebase/storage';
import { auth, db, storage, OperationType, handleFirestoreError, withTimeout } from '../firebase/config.js';
import { uploadImageSafe } from '../utils/storageUpload.js';
import { getLocalDeviceId } from '../utils/device.js';

const AuthContext = createContext(null);

const BOOTSTRAP_SUPER_ADMIN_EMAILS = ['absiddik5177@gmail.com', 'absiddik517@gmail.com'];

function getActiveOfficeStorageKey(uid) {
  return `ems_active_office_${uid}`;
}

export function buildAssignedOffices(targetProfile, officeList) {
  if (!targetProfile || !Array.isArray(officeList) || officeList.length === 0) return [];
  const officeById = new Map(officeList.map((o) => [o.id, o]));
  const result = [];
  const seen = new Set();

  if (targetProfile.officeId && officeById.has(targetProfile.officeId)) {
    const primary = officeById.get(targetProfile.officeId);
    result.push({
      id: primary.id,
      office: primary,
      chargeType: 'primary',
      isPrimary: true
    });
    seen.add(primary.id);
  }

  if (Array.isArray(targetProfile.additionalOfficeIds)) {
    for (const addId of targetProfile.additionalOfficeIds) {
      if (!addId || seen.has(addId)) continue;
      const office = officeById.get(addId);
      if (!office) continue;
      result.push({
        id: office.id,
        office,
        chargeType: 'additional',
        isPrimary: false
      });
      seen.add(office.id);
    }
  }

  return result;
}

export function AuthProvider({ children }) {
  const [firebaseUser, setFirebaseUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [needsProfileSetup, setNeedsProfileSetup] = useState(false);
  const [offices, setOffices] = useState([]);
  const [activeOfficeId, setActiveOfficeId] = useState('');
  const [registrationOpen, setRegistrationOpen] = useState(true);
  const [authReady, setAuthReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [localDeviceId] = useState(() => getLocalDeviceId());
  const [deviceMismatch, setDeviceMismatch] = useState(false);

  const officesRef = useRef([]);
  officesRef.current = offices;

  const isAuthenticated = !!firebaseUser && !!profile;
  const isApproved = profile?.approvalStatus === 'approved' && profile?.status === 'active';
  const userRole = profile?.role || null;
  const isBootstrapSuperAdmin = useMemo(
    () =>
      !!firebaseUser &&
      firebaseUser.emailVerified === true &&
      BOOTSTRAP_SUPER_ADMIN_EMAILS.includes((firebaseUser.email || '').toLowerCase()),
    [firebaseUser]
  );

  const primaryOffice = useMemo(
    () => offices.find((o) => o.id === profile?.officeId) || null,
    [offices, profile?.officeId]
  );

  const assignedOffices = useMemo(
    () => buildAssignedOffices(profile, offices),
    [profile, offices]
  );

  const hasMultipleOffices = useMemo(
    () => profile?.role === 'district_officer' && assignedOffices.length > 1,
    [profile?.role, assignedOffices.length]
  );

  const activeOfficeAssignment = useMemo(() => {
    if (!assignedOffices.length) return null;
    if (activeOfficeId) {
      const found = assignedOffices.find((item) => item.id === activeOfficeId);
      if (found) return found;
    }
    if (assignedOffices.length === 1) return assignedOffices[0];
    return null;
  }, [assignedOffices, activeOfficeId]);

  const activeOffice = activeOfficeAssignment?.office || (hasMultipleOffices ? null : primaryOffice);
  const activeChargeType = activeOfficeAssignment?.chargeType || (primaryOffice ? 'primary' : null);
  const userOffice = activeOffice || primaryOffice;

  const syncActiveOfficeFromSession = useCallback((targetProfile, officeList = officesRef.current, forceFresh = false) => {
    if (!targetProfile) {
      setActiveOfficeId('');
      return '';
    }
    const assigned = buildAssignedOffices(targetProfile, officeList);
    const uid = targetProfile.uid || targetProfile.id;
    const storageKey = uid ? getActiveOfficeStorageKey(uid) : '';

    if (targetProfile.role !== 'district_officer' || assigned.length <= 1) {
      const singleId = assigned[0]?.id || targetProfile.officeId || '';
      setActiveOfficeId(singleId);
      if (storageKey && singleId) {
        try {
          sessionStorage.setItem(storageKey, singleId);
        } catch {
          // ignore sessionStorage failure
        }
      }
      return singleId;
    }

    if (forceFresh) {
      if (storageKey) {
        try {
          sessionStorage.removeItem(storageKey);
        } catch {
          // ignore
        }
      }
      setActiveOfficeId('');
      return '';
    }

    let stored = '';
    if (storageKey) {
      try {
        stored = sessionStorage.getItem(storageKey) || '';
      } catch {
        stored = '';
      }
    }

    const valid = stored && assigned.some((item) => item.id === stored);
    const nextId = valid ? stored : '';
    setActiveOfficeId(nextId);
    return nextId;
  }, []);

  const selectActiveOffice = useCallback(
    (officeId) => {
      const uid = profile?.uid || profile?.id || firebaseUser?.uid;
      if (!officeId) return false;
      const assigned = buildAssignedOffices(profile, officesRef.current);
      if (!assigned.some((item) => item.id === officeId)) return false;
      setActiveOfficeId(officeId);
      if (uid) {
        try {
          sessionStorage.setItem(getActiveOfficeStorageKey(uid), officeId);
        } catch {
          // ignore
        }
      }
      return true;
    },
    [profile, firebaseUser?.uid]
  );

  const clearActiveOffice = useCallback(() => {
    const uid = profile?.uid || profile?.id || firebaseUser?.uid;
    if (uid) {
      try {
        sessionStorage.removeItem(getActiveOfficeStorageKey(uid));
      } catch {
        // ignore
      }
    }
    setActiveOfficeId('');
  }, [profile, firebaseUser?.uid]);

  const getRoleHomePath = useCallback(
    (targetProfile = profile, selectedOfficeOverride) => {
      if (!targetProfile) return '/login';
      if (targetProfile.approvalStatus !== 'approved') return '/pending';
      switch (targetProfile.role) {
        case 'employee':
          return '/employee';
        case 'office_head':
          return '/office-head';
        case 'district_officer': {
          const assigned = buildAssignedOffices(targetProfile, officesRef.current);
          if (assigned.length > 1) {
            const effectiveId =
              selectedOfficeOverride !== undefined ? selectedOfficeOverride : activeOfficeId;
            if (!effectiveId || !assigned.some((item) => item.id === effectiveId)) {
              return '/select-office';
            }
          }
          return '/district';
        }
        case 'head_office':
          return '/head-office';
        case 'super_admin':
          return '/admin';
        default:
          return '/login';
      }
    },
    [profile, activeOfficeId]
  );

  const computeDistrictOfficeId = useCallback((officeId) => {
    if (!officeId) return '';
    const office = officesRef.current.find((o) => o.id === officeId);
    if (!office) return '';
    if (office.level === 'district') return office.id;
    if (office.level === 'upazila') return office.parentOfficeId || '';
    return '';
  }, []);

  const fetchPublicBootstrap = useCallback(async () => {
    try {
      const settingsSnap = await getDoc(doc(db, 'settings', 'app'));
      if (settingsSnap.exists()) {
        setRegistrationOpen(settingsSnap.data().registrationOpen !== false);
      } else {
        setRegistrationOpen(true);
      }
    } catch {
      setRegistrationOpen(true);
    }

    try {
      const q = query(
        collection(db, 'offices'),
        where('level', 'in', ['head', 'district', 'upazila'])
      );
      const snap = await getDocs(q);
      const list = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      officesRef.current = list;
      setOffices(list);
      return list;
    } catch (err) {
      console.error('Offices load error:', err);
      return officesRef.current;
    }
  }, []);

  const loadUserProfile = useCallback(
    async (uid, { forceFreshOfficeSelection = false, officeListOverride } = {}) => {
      const path = `users/${uid}`;
      let snap;
      try {
        snap = await getDoc(doc(db, 'users', uid));
      } catch (err) {
        handleFirestoreError(err, OperationType.GET, path);
      }

      if (!snap.exists()) {
        setProfile(null);
        setActiveOfficeId('');
        setNeedsProfileSetup(true);
        return null;
      }

      const raw = snap.data();
      const data = {
        uid: snap.id,
        id: snap.id,
        email: raw.email || auth.currentUser?.email || '',
        name: raw.name || raw.email || auth.currentUser?.email || 'User',
        ...raw
      };

      if (data.status === 'resigned') {
        await signOut(auth);
        setFirebaseUser(null);
        setProfile(null);
        setActiveOfficeId('');
        setNeedsProfileSetup(false);
        setError('পদত্যাগকৃত ব্যবহারকারীর অ্যাকাউন্ট থেকে লগইন করা অনুমোদিত নয়। (Resigned users cannot log in.)');
        return null;
      }

      setDeviceMismatch(false);

      if (data.approvalStatus === 'approved' && data.status === 'active') {
        if (!data.boundDeviceId) {
          try {
            await updateDoc(doc(db, 'users', uid), {
              boundDeviceId: localDeviceId,
              updatedAt: serverTimestamp()
            });
            data.boundDeviceId = localDeviceId;
          } catch (err) {
            handleFirestoreError(err, OperationType.UPDATE, path);
          }
        } else if (data.boundDeviceId !== localDeviceId) {
          setDeviceMismatch(true);
        }
      }

      setNeedsProfileSetup(false);
      setProfile(data);
      const resolvedActiveId = syncActiveOfficeFromSession(
        data,
        officeListOverride || officesRef.current,
        forceFreshOfficeSelection
      );
      return { ...data, _resolvedActiveOfficeId: resolvedActiveId };
    },
    [localDeviceId, syncActiveOfficeFromSession]
  );

  // Keep activeOfficeId in sync if offices or profile update
  useEffect(() => {
    if (!profile || !offices.length) return;
    syncActiveOfficeFromSession(profile, offices, false);
  }, [profile, offices, syncActiveOfficeFromSession]);

  useEffect(() => {
    let active = true;
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!active) return;
      setLoading(true);
      try {
        const officeList = await fetchPublicBootstrap();
        if (!active) return;
        if (user) {
          setFirebaseUser(user);
          await loadUserProfile(user.uid, { officeListOverride: officeList });
        } else {
          setFirebaseUser(null);
          setProfile(null);
          setActiveOfficeId('');
          setNeedsProfileSetup(false);
          setDeviceMismatch(false);
        }
      } catch (err) {
        console.error('Auth listener error:', err);
      } finally {
        if (active) {
          setAuthReady(true);
          setLoading(false);
        }
      }
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, [fetchPublicBootstrap, loadUserProfile]);

  const login = useCallback(
    async (email, password) => {
      setError('');
      setLoading(true);
      try {
        const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
        setFirebaseUser(cred.user);
        const officeList = await fetchPublicBootstrap();
        const loadedProfile = await loadUserProfile(cred.user.uid, {
          forceFreshOfficeSelection: true,
          officeListOverride: officeList
        });
        if (!loadedProfile) {
          if (!auth.currentUser) {
            return { profile: null, needsProfileSetup: false };
          }
          return {
            profile: null,
            needsProfileSetup: true,
            uid: cred.user.uid,
            email: cred.user.email || email.trim().toLowerCase()
          };
        }
        return {
          profile: loadedProfile,
          needsProfileSetup: false,
          resolvedActiveOfficeId: loadedProfile._resolvedActiveOfficeId || ''
        };
      } catch (err) {
        if (err.code === 'auth/operation-not-allowed') {
          setError('Firebase Console-এ Email/Password লগইন চালু নেই। অনুগ্রহ করে Authentication -> Sign-in method থেকে Email/Password চালু করুন।');
        } else if (err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password' || err.code === 'auth/user-not-found') {
          setError('ইমেইল অথবা পাসওয়ার্ড সঠিক নয়। পুনরায় চেষ্টা করুন।');
        } else if (err.code === 'auth/too-many-requests') {
          setError('অতিরিক্ত ভুল চেষ্টার কারণে সাময়িকভাবে ব্লক করা হয়েছে। কিছুক্ষণ পর চেষ্টা করুন।');
        } else {
          setError(err.message || 'লগইন করতে সমস্যা হয়েছে।');
        }
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [fetchPublicBootstrap, loadUserProfile]
  );

  const sendPasswordReset = useCallback(async (email) => {
    setError('');
    try {
      await sendPasswordResetEmail(auth, email.trim());
    } catch (err) {
      if (err.code === 'auth/user-not-found') {
        setError('এই ইমেইলে কোনো অ্যাকাউন্ট পাওয়া যায়নি।');
      } else {
        setError(err.message || 'পাসওয়ার্ড রিসেট ইমেইল পাঠানো যায়নি।');
      }
      throw err;
    }
  }, []);

  const uploadOptionalProfilePhoto = useCallback(async (uid, photoFile) => {
    if (!photoFile) return { path: '', skipped: true, reason: 'No photo selected' };
    const path = `profiles/${uid}.jpg`;
    const uploadRes = await uploadImageSafe(path, photoFile, photoFile.type || 'image/jpeg');
    if (!uploadRes.ok) {
      return { path: '', skipped: true, reason: uploadRes.reason };
    }
    try {
      await withTimeout(
        updateDoc(doc(db, 'users', uid), {
          profilePhotoPath: path,
          updatedAt: serverTimestamp()
        }),
        10000,
        'Profile photo path update timed out'
      );
      return { path, skipped: false, reason: 'Photo uploaded' };
    } catch (err) {
      console.warn('Profile photo path update failed:', err?.code || err?.message);
      return { path: '', skipped: true, reason: err?.message || 'Profile photo path update failed' };
    }
  }, []);

  const registerEmployee = useCallback(
    async (form, photoFile, onTaskUpdate) => {
      setError('');
      setLoading(true);
      const emit = (id, status, detail = '') => {
        if (typeof onTaskUpdate === 'function') onTaskUpdate(id, status, detail);
      };

      try {
        emit('settings', 'running', 'Checking public registration availability...');
        await withTimeout(fetchPublicBootstrap(), 12000, 'Could not load office & registration settings.');
        const settingsSnap = await withTimeout(
          getDoc(doc(db, 'settings', 'app')),
          10000,
          'Registration check timed out.'
        ).catch(() => null);
        const open = settingsSnap && settingsSnap.exists() ? settingsSnap.data().registrationOpen !== false : true;
        if (!open) {
          emit('settings', 'error', 'Public registration is closed.');
          throw new Error('রেজিস্ট্রেশন বন্ধ আছে');
        }
        emit('settings', 'done', 'Registration is open');

        emit('auth', 'running', 'Creating Firebase Auth account...');
        let cred;
        try {
          cred = await withTimeout(
            createUserWithEmailAndPassword(auth, form.email.trim(), form.password),
            20000,
            'Firebase Auth account creation timed out.'
          );
        } catch (authErr) {
          emit('auth', 'error', authErr.message || 'Auth creation failed');
          throw authErr;
        }
        const uid = cred.user.uid;
        setFirebaseUser(cred.user);
        emit('auth', 'done', `UID: ${uid}`);

        emit('profile', 'running', 'Writing Firestore users document...');
        const districtOfficeId = computeDistrictOfficeId(form.officeId);
        const payload = {
          uid,
          name: form.name.trim(),
          designation: form.designation.trim(),
          address: form.address.trim(),
          mobile: form.mobile.trim(),
          email: form.email.trim().toLowerCase(),
          officeId: form.officeId || '',
          districtOfficeId,
          joiningDate: form.joiningDate,
          status: form.status,
          resignationDate: form.status === 'resigned' ? form.resignationDate : null,
          profilePhotoPath: '',
          role: 'employee',
          approvalStatus: 'pending',
          boundDeviceId: null,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        };

        try {
          await withTimeout(
            setDoc(doc(db, 'users', uid), payload),
            15000,
            'Saving Firestore profile timed out.'
          );
          emit('profile', 'done', `users/${uid} saved`);
        } catch (err) {
          emit('profile', 'error', err.message || 'Firestore write failed');
          handleFirestoreError(err, OperationType.CREATE, `users/${uid}`);
        }

        if (photoFile) {
          emit('photo', 'running', 'Uploading profile photo...');
          const photoRes = await uploadOptionalProfilePhoto(uid, photoFile);
          emit('photo', photoRes.skipped ? 'skipped' : 'done', photoRes.reason);
        } else {
          emit('photo', 'skipped', 'No photo selected');
        }

        emit('session', 'running', 'Finalizing session...');
        if (form.status === 'resigned') {
          await signOut(auth);
          setFirebaseUser(null);
          setProfile(null);
          setActiveOfficeId('');
          setNeedsProfileSetup(false);
          emit('session', 'done', 'Saved as resigned');
          return { resigned: true };
        }

        await withTimeout(loadUserProfile(uid), 12000, 'Loading profile timed out.');
        emit('session', 'done', 'Profile loaded');
        return { resigned: false };
      } catch (err) {
        if (err.code === 'auth/email-already-in-use') {
          setError('এই ইমেইল দিয়ে ইতোমধ্যে একটি Auth অ্যাকাউন্ট তৈরি করা আছে। প্রোফাইল তৈরি না হয়ে থাকলে লগইন করে প্রোফাইল সম্পূর্ণ করুন।');
        } else if (err.code === 'auth/operation-not-allowed') {
          setError('Firebase Console-এ Email/Password লগইন চালু নেই। Authentication -> Sign-in method থেকে Email/Password চালু করুন।');
        } else if (err.code === 'auth/weak-password') {
          setError('পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে।');
        } else {
          setError(err.message || 'রেজিস্ট্রেশন সম্পন্ন করা যায়নি।');
        }
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [computeDistrictOfficeId, fetchPublicBootstrap, loadUserProfile, uploadOptionalProfilePhoto]
  );

  const completeMissingProfile = useCallback(
    async (form, photoFile, onTaskUpdate) => {
      setError('');
      const emit = (id, status, detail = '') => {
        if (typeof onTaskUpdate === 'function') onTaskUpdate(id, status, detail);
      };

      const currentUser = auth.currentUser;
      if (!currentUser) {
        throw new Error('অ্যাকাউন্ট সেশন পাওয়া যায়নি। পুনরায় লগইন করুন।');
      }

      setLoading(true);
      try {
        emit('settings', 'running', 'Checking permissions & registration settings...');
        await withTimeout(fetchPublicBootstrap(), 12000, 'Could not load office & registration settings.');
        const uid = currentUser.uid;
        const bootstrapAdmin =
          currentUser.emailVerified === true &&
          BOOTSTRAP_SUPER_ADMIN_EMAILS.includes((currentUser.email || '').toLowerCase());

        if (!bootstrapAdmin) {
          const settingsSnap = await withTimeout(
            getDoc(doc(db, 'settings', 'app')),
            10000,
            'Registration settings check timed out.'
          ).catch(() => null);
          const open = settingsSnap && settingsSnap.exists() ? settingsSnap.data().registrationOpen !== false : true;
          if (!open) {
            emit('settings', 'error', 'Public registration is closed.');
            throw new Error('রেজিস্ট্রেশন বন্ধ আছে। আপনার UID সুপার অ্যাডমিনকে দিন।');
          }
        }
        emit('settings', 'done', bootstrapAdmin ? 'Super Admin verified' : 'Registration open');

        emit('profile', 'running', `Writing users/${uid}...`);
        const districtOfficeId = computeDistrictOfficeId(form.officeId);
        const payload = {
          uid,
          name: form.name.trim(),
          designation: form.designation.trim(),
          address: form.address.trim(),
          mobile: form.mobile.trim(),
          email: (currentUser.email || form.email || '').trim().toLowerCase(),
          officeId: form.officeId || '',
          districtOfficeId,
          joiningDate: form.joiningDate,
          status: form.status || 'active',
          resignationDate: form.status === 'resigned' ? form.resignationDate : null,
          profilePhotoPath: '',
          role: bootstrapAdmin ? 'super_admin' : 'employee',
          approvalStatus: bootstrapAdmin ? 'approved' : 'pending',
          boundDeviceId: null,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        };

        try {
          await withTimeout(
            setDoc(doc(db, 'users', uid), payload),
            15000,
            'Saving Firestore profile timed out.'
          );
          emit('profile', 'done', `users/${uid} saved`);
        } catch (err) {
          emit('profile', 'error', err.message || 'Firestore write failed');
          handleFirestoreError(err, OperationType.CREATE, `users/${uid}`);
        }

        if (photoFile) {
          emit('photo', 'running', 'Uploading optional photo...');
          const photoRes = await uploadOptionalProfilePhoto(uid, photoFile);
          emit('photo', photoRes.skipped ? 'skipped' : 'done', photoRes.reason);
        } else {
          emit('photo', 'skipped', 'No photo selected');
        }

        emit('session', 'running', 'Loading staff session...');
        if (form.status === 'resigned') {
          await signOut(auth);
          setFirebaseUser(null);
          setProfile(null);
          setActiveOfficeId('');
          setNeedsProfileSetup(false);
          emit('session', 'done', 'Saved as resigned');
          return { resigned: true };
        }

        const loaded = await withTimeout(loadUserProfile(uid), 12000, 'Loading profile timed out.');
        emit('session', 'done', 'Profile loaded');
        return { resigned: false, profile: loaded };
      } catch (err) {
        setError(err.message || 'প্রোফাইল তৈরি করা যায়নি।');
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [computeDistrictOfficeId, fetchPublicBootstrap, loadUserProfile, uploadOptionalProfilePhoto]
  );

  const getProfilePhotoDownloadUrl = useCallback(async (path) => {
    if (!path) return '';
    try {
      return await getDownloadURL(storageRef(storage, path));
    } catch {
      return '';
    }
  }, []);

  const logout = useCallback(async () => {
    const uid = profile?.uid || profile?.id || firebaseUser?.uid;
    if (uid) {
      try {
        sessionStorage.removeItem(getActiveOfficeStorageKey(uid));
      } catch {
        // ignore
      }
    }
    await signOut(auth);
    setFirebaseUser(null);
    setProfile(null);
    setActiveOfficeId('');
    setNeedsProfileSetup(false);
    setDeviceMismatch(false);
    setError('');
  }, [profile, firebaseUser?.uid]);

  const value = useMemo(
    () => ({
      firebaseUser,
      profile,
      needsProfileSetup,
      isBootstrapSuperAdmin,
      offices,
      primaryOffice,
      assignedOffices,
      hasMultipleOffices,
      activeOfficeId,
      activeOffice,
      activeChargeType,
      selectActiveOffice,
      clearActiveOffice,
      registrationOpen,
      setRegistrationOpen,
      authReady,
      loading,
      error,
      setError,
      localDeviceId,
      deviceMismatch,
      isAuthenticated,
      isApproved,
      userRole,
      userOffice,
      getRoleHomePath,
      computeDistrictOfficeId,
      fetchPublicBootstrap,
      loadUserProfile,
      login,
      sendPasswordReset,
      registerEmployee,
      completeMissingProfile,
      getProfilePhotoDownloadUrl,
      logout
    }),
    [
      firebaseUser,
      profile,
      needsProfileSetup,
      isBootstrapSuperAdmin,
      offices,
      primaryOffice,
      assignedOffices,
      hasMultipleOffices,
      activeOfficeId,
      activeOffice,
      activeChargeType,
      selectActiveOffice,
      clearActiveOffice,
      registrationOpen,
      authReady,
      loading,
      error,
      localDeviceId,
      deviceMismatch,
      isAuthenticated,
      isApproved,
      userRole,
      userOffice,
      getRoleHomePath,
      computeDistrictOfficeId,
      fetchPublicBootstrap,
      loadUserProfile,
      login,
      sendPasswordReset,
      registerEmployee,
      completeMissingProfile,
      getProfilePhotoDownloadUrl,
      logout
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
