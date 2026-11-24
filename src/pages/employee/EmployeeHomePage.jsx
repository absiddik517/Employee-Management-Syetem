import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  query,
  where,
  getDocs,
  serverTimestamp,
  Timestamp
} from 'firebase/firestore';
import AppShell from '../../components/AppShell.jsx';
import StatusText from '../../components/StatusText.jsx';
import CameraSelfieCapture from '../../components/CameraSelfieCapture.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { db, OperationType, handleFirestoreError } from '../../firebase/config.js';
import { uploadImageSafe } from '../../utils/storageUpload.js';
import {
  getTodayDhaka,
  formatDisplayDate,
  formatDhakaTime,
  computeInitialStatus,
  toBanglaDigits
} from '../../utils/dhakaTime.js';
import { getHighAccuracyPosition, haversineDistanceMeters } from '../../utils/geo.js';
import {
  can as canPerm,
  getValidAttendanceOfficeIds,
  getWorkingOfficeId
} from '../../lib/permissions.js';

function deriveDistrictIdFromOfficeData(officeData, officeId, fallbackCompute) {
  if (!officeId) return '';
  if (officeData) {
    if (officeData.level === 'district') return officeId;
    if (officeData.level === 'upazila') {
      return typeof officeData.parentOfficeId === 'string' ? officeData.parentOfficeId : '';
    }
    return '';
  }
  return typeof fallbackCompute === 'function' ? fallbackCompute(officeId) || '' : '';
}

function sameStringArray(a, b) {
  const arrA = Array.isArray(a) ? a : [];
  const arrB = Array.isArray(b) ? b : [];
  if (arrA.length !== arrB.length) return false;
  for (let i = 0; i < arrA.length; i += 1) {
    if (arrA[i] !== arrB[i]) return false;
  }
  return true;
}

function hasUserAttendanceContextChanged(prevProfile, liveUser) {
  if (!prevProfile || !liveUser) return false;
  const prevRole = typeof prevProfile.role === 'string' ? prevProfile.role.trim() : '';
  const liveRole = typeof liveUser.role === 'string' ? liveUser.role.trim() : '';
  return (
    (prevProfile.officeId || '') !== (liveUser.officeId || '') ||
    (prevProfile.districtOfficeId || '') !== (liveUser.districtOfficeId || '') ||
    (prevProfile.attachedOfficeId || '') !== (liveUser.attachedOfficeId || '') ||
    (prevProfile.actingOfficeId || '') !== (liveUser.actingOfficeId || '') ||
    (prevProfile.actingRoleKey || '') !== (liveUser.actingRoleKey || '') ||
    prevRole !== liveRole ||
    (prevProfile.name || '') !== (liveUser.name || '') ||
    (prevProfile.designation || '') !== (liveUser.designation || '') ||
    !sameStringArray(prevProfile.additionalOfficeIds, liveUser.additionalOfficeIds)
  );
}

function isRawValidAttendanceOffice(userData, officeId) {
  if (!userData || typeof officeId !== 'string' || !officeId) return false;
  if (userData.officeId === officeId) return true;
  if (Array.isArray(userData.additionalOfficeIds) && userData.additionalOfficeIds.includes(officeId)) return true;
  if (typeof userData.attachedOfficeId === 'string' && userData.attachedOfficeId === officeId) return true;
  if (typeof userData.actingOfficeId === 'string' && userData.actingOfficeId === officeId) return true;
  return false;
}

const SOURCE_LABELS = {
  primary: 'মূল কর্মস্থল',
  attached: 'সংযুক্তি',
  additional: 'অতিরিক্ত দায়িত্ব',
  acting: 'চলতি দায়িত্ব'
};

export default function EmployeeHomePage() {
  const {
    profile,
    effectiveAuthUser,
    offices,
    userOffice,
    roleRegistry,
    deviceMismatch,
    localDeviceId,
    computeDistrictOfficeId,
    fetchPublicBootstrap,
    loadUserProfile
  } = useAuth();

  const [loadingToday, setLoadingToday] = useState(true);
  const [todayRecord, setTodayRecord] = useState(null);
  const [activeFieldDuty, setActiveFieldDuty] = useState(null);
  const [expiredExclusions, setExpiredExclusions] = useState([]);
  const [selectedOfficeId, setSelectedOfficeId] = useState('');
  const [userPickedOffice, setUserPickedOffice] = useState(false);
  const [gpsMatching, setGpsMatching] = useState(false);
  const [gpsMultiMatches, setGpsMultiMatches] = useState([]);
  const [gpsMatchHint, setGpsMatchHint] = useState('');
  const [gpsChecking, setGpsChecking] = useState(false);
  const [cameraMode, setCameraMode] = useState(false);
  const [punchType, setPunchType] = useState('in');
  const [pendingPunchOffice, setPendingPunchOffice] = useState(null);
  const [verifiedGps, setVerifiedGps] = useState({ lat: 0, lng: 0, accuracy: 0, distanceMeters: 0 });
  const [lastDistanceBangla, setLastDistanceBangla] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState('');
  const [actionSuccess, setActionSuccess] = useState('');

  const todayStr = useMemo(() => getTodayDhaka(), []);
  const todayDisplay = useMemo(() => formatDisplayDate(todayStr), [todayStr]);
  const isTodayFieldDuty = !!activeFieldDuty;

  const officeById = useMemo(() => new Map(offices.map((o) => [o.id, o])), [offices]);
  const getOfficeName = useCallback(
    (id) => officeById.get(id)?.name || id || '—',
    [officeById]
  );

  const { validOffices, expiredOfficeNames } = useMemo(() => {
    if (!profile) return { validOffices: [], expiredOfficeNames: [] };

    const expiredSet = new Set(
      expiredExclusions.map((ex) => `${ex.kind}:${ex.officeId}`)
    );
    const expiredNames = [];
    const seen = new Map();

    const addEntry = (id, source, excludeKind = null) => {
      if (!id || typeof id !== 'string') return;
      const trimmed = id.trim();
      if (!trimmed) return;
      if (excludeKind && expiredSet.has(`${excludeKind}:${trimmed}`)) {
        const name = officeById.get(trimmed)?.name || trimmed;
        if (!expiredNames.includes(name)) expiredNames.push(name);
        return;
      }
      const officeObj = officeById.get(trimmed);
      if (!officeObj) return;
      if (!seen.has(trimmed)) {
        seen.set(trimmed, {
          ...officeObj,
          sources: [source]
        });
      } else {
        const prev = seen.get(trimmed);
        if (!prev.sources.includes(source)) {
          prev.sources.push(source);
        }
      }
    };

    addEntry(profile.officeId, 'primary');
    addEntry(profile.attachedOfficeId, 'attached', 'attachment');
    if (Array.isArray(profile.additionalOfficeIds)) {
      for (const addId of profile.additionalOfficeIds) {
        addEntry(addId, 'additional', 'additional_charge');
      }
    }
    if (profile.actingOfficeId) {
      addEntry(profile.actingOfficeId, 'acting', 'acting_charge');
    }

    return {
      validOffices: Array.from(seen.values()),
      expiredOfficeNames: expiredNames
    };
  }, [profile, expiredExclusions, officeById]);

  useEffect(() => {
    if (validOffices.length === 0) {
      setSelectedOfficeId('');
      return;
    }
    if (selectedOfficeId && validOffices.some((o) => o.id === selectedOfficeId)) {
      return;
    }
    const preferredWorking = getWorkingOfficeId(effectiveAuthUser);
    const initialChoice =
      (todayRecord?.officeId && validOffices.find((o) => o.id === todayRecord.officeId)?.id) ||
      (preferredWorking && validOffices.find((o) => o.id === preferredWorking)?.id) ||
      validOffices[0].id;
    setSelectedOfficeId(initialChoice);
  }, [validOffices, selectedOfficeId, todayRecord?.officeId, effectiveAuthUser]);

  const office = useMemo(
    () => validOffices.find((o) => o.id === selectedOfficeId) || validOffices[0] || userOffice || null,
    [validOffices, selectedOfficeId, userOffice]
  );

  const verifyLiveUserAndDevice = useCallback(async () => {
    if (!profile?.uid) {
      return { ok: false, message: 'ব্যবহারকারীর প্রোফাইল পাওয়া যায়নি। পুনরায় লগইন করুন।' };
    }
    const userRef = doc(db, 'users', profile.uid);
    let userSnap;
    try {
      userSnap = await getDoc(userRef);
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, `users/${profile.uid}`);
      return { ok: false, message: 'ব্যবহারকারীর তথ্য যাচাই করা যায়নি।' };
    }

    if (!userSnap.exists()) {
      await loadUserProfile(profile.uid);
      return { ok: false, message: 'আপনার প্রোফাইল পাওয়া যায়নি। সুপার অ্যাডমিনের সাথে যোগাযোগ করুন।' };
    }

    const userData = userSnap.data();
    if (userData.approvalStatus !== 'approved' || userData.status !== 'active') {
      await loadUserProfile(profile.uid);
      return { ok: false, message: 'আপনার অ্যাকাউন্টটি সক্রিয় বা অনুমোদিত নয়।' };
    }

    if (typeof localDeviceId !== 'string' || localDeviceId.length < 4 || localDeviceId.length > 128) {
      return { ok: false, message: 'ডিভাইস আইডি সঠিক নয়। অনুগ্রহ করে পৃষ্ঠাটি রিলোড করুন।' };
    }

    let boundNow = false;
    if (!userData.boundDeviceId) {
      try {
        await updateDoc(userRef, {
          boundDeviceId: localDeviceId,
          updatedAt: serverTimestamp()
        });
        boundNow = true;
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, `users/${profile.uid}`);
        return { ok: false, message: 'ডিভাইস নিবন্ধন করা যায়নি।' };
      }
    } else if (userData.boundDeviceId !== localDeviceId) {
      await loadUserProfile(profile.uid);
      return {
        ok: false,
        message: 'এই ডিভাইসটি অনুমোদিত নয়। সুপার অ্যাডমিন বা দায়িত্বপ্রাপ্ত কর্মকর্তাকে ডিভাইস রিসেট করতে বলুন।'
      };
    }

    const liveRole = typeof userData.role === 'string' ? userData.role.trim() : '';
    const liveUser = {
      ...userData,
      uid: userSnap.id,
      id: userSnap.id,
      role: liveRole,
      boundDeviceId: userData.boundDeviceId || localDeviceId
    };

    let effectiveRegistry = roleRegistry;
    if (liveRole) {
      try {
        const roleSnap = await getDoc(doc(db, 'roles', liveRole));
        if (roleSnap.exists()) {
          effectiveRegistry = {
            ...effectiveRegistry,
            [liveRole]: { key: roleSnap.id, ...roleSnap.data() }
          };
        } else {
          const nextReg = { ...(effectiveRegistry || {}) };
          delete nextReg[liveRole];
          effectiveRegistry = nextReg;
        }
      } catch (roleErr) {
        console.warn('Live role check fallback notice:', roleErr);
      }
    }

    if (!canPerm(liveUser, 'attendance.checkin', null, effectiveRegistry)) {
      await loadUserProfile(profile.uid);
      return {
        ok: false,
        message: 'আপনার বর্তমান রোলে দৈনিক হাজিরা দেওয়ার অনুমতি নেই। অনুগ্রহ করে প্রশাসকের সাথে যোগাযোগ করুন।'
      };
    }

    if (boundNow || hasUserAttendanceContextChanged(profile, liveUser)) {
      await loadUserProfile(profile.uid);
    }

    return { ok: true, userData: liveUser };
  }, [profile, roleRegistry, localDeviceId, loadUserProfile]);

  const loadTodayData = useCallback(async () => {
    if (!profile) return;
    setLoadingToday(true);
    setActionError('');
    const docId = `${profile.uid}_${todayStr}`;
    try {
      const snap = await getDoc(doc(db, 'attendance', docId));
      setTodayRecord(snap.exists() ? { id: snap.id, ...snap.data() } : null);
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, `attendance/${docId}`);
    }

    try {
      const [fdSnap, assignSnap] = await Promise.all([
        getDocs(
          query(
            collection(db, 'fieldDuties'),
            where('uid', '==', profile.uid),
            where('status', '==', 'approved')
          )
        ),
        getDocs(collection(db, 'users', profile.uid, 'assignments')).catch(() => null)
      ]);
      const found = fdSnap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .find((fd) => fd.startDate <= todayStr && fd.endDate >= todayStr);
      setActiveFieldDuty(found || null);

      if (assignSnap) {
        const expired = assignSnap.docs
          .map((d) => d.data())
          .filter((r) => !r.closedAt && r.endDate && r.endDate < todayStr)
          .map((r) => ({ kind: r.kind, officeId: r.officeId }));
        setExpiredExclusions(expired);
      } else {
        setExpiredExclusions([]);
      }
    } catch (err) {
      console.warn('Field duty / assignments fetch notice:', err);
    } finally {
      setLoadingToday(false);
    }
  }, [profile, todayStr]);

  useEffect(() => {
    loadTodayData();
  }, [loadTodayData]);

  const computeMatchesForFix = useCallback(
    (lat, lng) => {
      const matched = [];
      for (const candidate of validOffices) {
        const cLat = Number(candidate.lat);
        const cLng = Number(candidate.lng);
        if (!Number.isFinite(cLat) || !Number.isFinite(cLng)) continue;
        const dist = haversineDistanceMeters(lat, lng, cLat, cLng);
        if (!Number.isFinite(dist) || dist < 0) continue;
        const radius = Number(candidate.geofenceRadiusMeters || 100);
        if (dist <= radius) {
          matched.push({ office: candidate, distance: dist, radius });
        }
      }
      return matched.sort((a, b) => a.distance - b.distance);
    },
    [validOffices]
  );

  const handleAutoDetectOffice = async () => {
    if (validOffices.length <= 1 || gpsMatching) return;
    setActionError('');
    setGpsMatchHint('');
    setGpsMultiMatches([]);
    setGpsMatching(true);
    try {
      const pos = await getHighAccuracyPosition();
      if (!Number.isFinite(pos.lat) || !Number.isFinite(pos.lng)) {
        setGpsMatchHint('GPS স্থানাঙ্ক পাওয়া যায়নি।');
        return;
      }
      const matches = computeMatchesForFix(pos.lat, pos.lng);
      if (matches.length === 1) {
        setSelectedOfficeId(matches[0].office.id);
        setUserPickedOffice(true);
        setGpsMatchHint(
          `GPS অনুযায়ী "${matches[0].office.name}" শনাক্ত হয়েছে (দূরত্ব: ${toBanglaDigits(matches[0].distance)} মিটার)।`
        );
      } else if (matches.length > 1) {
        setGpsMultiMatches(matches);
        setUserPickedOffice(false);
        setGpsMatchHint(
          `${toBanglaDigits(matches.length)}টি অফিস আপনার বর্তমান অবস্থানের সীমানার মধ্যে রয়েছে। নিচ থেকে একটি নির্বাচন করুন।`
        );
      } else {
        setGpsMatchHint('কোনো অফিসের জিওফেন্স সীমানার মধ্যে অবস্থান শনাক্ত হয়নি। তালিকা থেকে অফিস নির্বাচন করুন।');
      }
    } catch (err) {
      setActionError(err.message || 'GPS অবস্থান শনাক্ত করা যায়নি।');
    } finally {
      setGpsMatching(false);
    }
  };

  const startPunchFlow = async (type, forcedOffice = null) => {
    setActionError('');
    setActionSuccess('');
    setLastDistanceBangla('');
    setGpsMultiMatches([]);

    if (!navigator.onLine) {
      setActionError('ইন্টারনেট সংযোগ নেই। অনলাইনে যুক্ত হয়ে পুনরায় চেষ্টা করুন।');
      return;
    }
    if (deviceMismatch) {
      setActionError('এই ডিভাইসটি অনুমোদিত নয়। সুপার অ্যাডমিনকে ডিভাইস রিসেট করতে বলুন।');
      return;
    }
    if (type === 'out' && !todayRecord?.checkIn) {
      setActionError('একই দিনে আগে হাজিরা না দিয়ে প্রস্থান দেওয়া যাবে না।');
      return;
    }

    let targetOffice = forcedOffice || office;
    if (!targetOffice) {
      setActionError('আপনার অফিসের তথ্য পাওয়া যায়নি।');
      return;
    }

    setGpsChecking(true);
    try {
      const liveCheck = await verifyLiveUserAndDevice();
      if (!liveCheck.ok) {
        setActionError(liveCheck.message);
        return;
      }

      const liveValidOfficeIds = getValidAttendanceOfficeIds(liveCheck.userData);
      if (
        !liveValidOfficeIds.includes(targetOffice.id) ||
        !isRawValidAttendanceOffice(liveCheck.userData, targetOffice.id)
      ) {
        await fetchPublicBootstrap();
        setPendingPunchOffice(null);
        setActionError(
          'আপনার পদায়ন বা দায়িত্বপ্রাপ্ত অফিস সম্প্রতি পরিবর্তিত হয়েছে। অনুগ্রহ করে আপডেট হওয়া তালিকা থেকে অফিস নির্বাচন করে আবার চেষ্টা করুন।'
        );
        return;
      }

      const pos = await getHighAccuracyPosition();
      if (!Number.isFinite(pos.lat) || !Number.isFinite(pos.lng) || !Number.isFinite(pos.accuracy) || pos.accuracy < 0) {
        setActionError('GPS স্থানাঙ্ক সঠিক পাওয়া যায়নি। অনুগ্রহ করে পুনরায় চেষ্টা করুন।');
        return;
      }
      if (pos.accuracy > 50) {
        setActionError(
          `GPS নির্ভুলতা ৫০ মিটারের বেশি (±${toBanglaDigits(pos.accuracy)} মিটার)। অনুগ্রহ করে খোলা জায়গায় পুনরায় চেষ্টা করুন।`
        );
        return;
      }

      // If multiple valid offices and user didn't explicitly lock an office choice, auto-match geofence
      if (!forcedOffice && !userPickedOffice && validOffices.length > 1) {
        const matches = computeMatchesForFix(pos.lat, pos.lng);
        if (matches.length === 1) {
          if (liveValidOfficeIds.includes(matches[0].office.id)) {
            targetOffice = matches[0].office;
            setSelectedOfficeId(targetOffice.id);
            setGpsMatchHint(
              `GPS অনুযায়ী "${targetOffice.name}" স্বয়ংক্রিয়ভাবে নির্বাচিত হয়েছে।`
            );
          }
        } else if (matches.length > 1) {
          setGpsMultiMatches(matches);
          setGpsMatchHint(
            `${toBanglaDigits(matches.length)}টি অফিসের জিওফেন্স মিলেছে। কোন অফিসে ${type === 'in' ? 'হাজিরা' : 'প্রস্থান'} দেবেন তা নির্বাচন করুন।`
          );
          return;
        }
      }

      const liveOfficeSnap = await getDoc(doc(db, 'offices', targetOffice.id)).catch(() => null);
      if (liveOfficeSnap) {
        if (!liveOfficeSnap.exists()) {
          await fetchPublicBootstrap();
          setPendingPunchOffice(null);
          setActionError('নির্বাচিত অফিসটি সিস্টেমে পাওয়া যায়নি।');
          return;
        }
        targetOffice = { ...targetOffice, id: liveOfficeSnap.id, ...liveOfficeSnap.data() };
      }

      const officeLat = Number(targetOffice.lat);
      const officeLng = Number(targetOffice.lng);
      if (!Number.isFinite(officeLat) || !Number.isFinite(officeLng)) {
        setActionError('নির্বাচিত অফিসের GPS স্থানাঙ্ক সঠিক নয়। সুপার অ্যাডমিনকে অফিসের লোকেশন আপডেট করতে বলুন।');
        return;
      }

      const distance = haversineDistanceMeters(pos.lat, pos.lng, officeLat, officeLng);
      if (!Number.isFinite(distance) || distance < 0) {
        setActionError('অফিস থেকে দূরত্ব নির্ণয় করা যায়নি। পুনরায় চেষ্টা করুন।');
        return;
      }
      const radius = Number(targetOffice.geofenceRadiusMeters || 100);
      setLastDistanceBangla(
        `${targetOffice.name} থেকে দূরত্ব: ${toBanglaDigits(distance)} মিটার (নির্ভুলতা ±${toBanglaDigits(pos.accuracy)} মিটার)`
      );

      if (!isTodayFieldDuty && distance > radius) {
        setActionError(
          `আপনি "${targetOffice.name}"-এর নির্ধারিত সীমানার (${toBanglaDigits(radius)} মিটার) বাইরে আছেন। বর্তমান দূরত্ব: ${toBanglaDigits(distance)} মিটার।`
        );
        return;
      }

      setPendingPunchOffice(targetOffice);
      setVerifiedGps({
        lat: pos.lat,
        lng: pos.lng,
        accuracy: pos.accuracy,
        distanceMeters: distance
      });
      setPunchType(type);
      setCameraMode(true);
    } catch (err) {
      setActionError(err.message || 'লোকেশন যাচাই ব্যর্থ হয়েছে।');
    } finally {
      setGpsChecking(false);
    }
  };

  const handleSelfieCaptured = async (blob) => {
    if (!navigator.onLine) {
      setCameraMode(false);
      setActionError('ইন্টারনেট সংযোগ নেই। অনলাইনে যুক্ত হয়ে পুনরায় চেষ্টা করুন।');
      return;
    }

    setCameraMode(false);
    setSubmitting(true);
    setActionError('');

    const uid = profile.uid;
    const docId = `${uid}_${todayStr}`;
    const targetPath = `attendance/${uid}/${todayStr}_${punchType}.jpg`;

    try {
      const liveCheck = await verifyLiveUserAndDevice();
      if (!liveCheck.ok) {
        setActionError(liveCheck.message);
        return;
      }

      const liveUser = liveCheck.userData || profile;
      const punchTargetOffice = pendingPunchOffice || office;
      if (!punchTargetOffice) {
        setActionError('নির্বাচিত অফিসের তথ্য পাওয়া যায়নি।');
        return;
      }

      const liveValidOfficeIds = getValidAttendanceOfficeIds(liveUser);
      if (
        !liveValidOfficeIds.includes(punchTargetOffice.id) ||
        !isRawValidAttendanceOffice(liveUser, punchTargetOffice.id)
      ) {
        await fetchPublicBootstrap();
        setPendingPunchOffice(null);
        setActionError(
          'আপনার অফিস পদায়ন বা দায়িত্ব সম্প্রতি পরিবর্তিত হয়েছে। অনুগ্রহ করে আপডেটকৃত অফিস নির্বাচন করে পুনরায় চেষ্টা করুন।'
        );
        return;
      }

      const targetOfficeSnap = await getDoc(doc(db, 'offices', punchTargetOffice.id));
      if (!targetOfficeSnap.exists()) {
        await fetchPublicBootstrap();
        setPendingPunchOffice(null);
        setActionError('নির্বাচিত অফিসটি সিস্টেমে পাওয়া যায়নি।');
        return;
      }
      const liveTargetOffice = { ...punchTargetOffice, id: targetOfficeSnap.id, ...targetOfficeSnap.data() };
      const targetDistrictId = String(
        deriveDistrictIdFromOfficeData(
          liveTargetOffice,
          liveTargetOffice.id,
          computeDistrictOfficeId
        )
      ).slice(0, 128);

      const uploadRes = await uploadImageSafe(targetPath, blob, 'image/jpeg');
      const photoPath = uploadRes.ok ? targetPath : 'storage-unavailable/no-bucket';
      const photoUnavailable = !uploadRes.ok;

      const punchObj = {
        time: Timestamp.now(),
        lat: verifiedGps.lat,
        lng: verifiedGps.lng,
        accuracy: verifiedGps.accuracy,
        distanceMeters: verifiedGps.distanceMeters,
        deviceId: localDeviceId,
        photoPath,
        photoDeleted: photoUnavailable
      };

      const hasValidPunchData =
        Number.isFinite(punchObj.lat) &&
        punchObj.lat >= -90 &&
        punchObj.lat <= 90 &&
        Number.isFinite(punchObj.lng) &&
        punchObj.lng >= -180 &&
        punchObj.lng <= 180 &&
        Number.isFinite(punchObj.accuracy) &&
        punchObj.accuracy >= 0 &&
        punchObj.accuracy <= 50 &&
        Number.isFinite(punchObj.distanceMeters) &&
        punchObj.distanceMeters >= 0 &&
        typeof punchObj.deviceId === 'string' &&
        punchObj.deviceId.length >= 4 &&
        punchObj.deviceId.length <= 128 &&
        typeof liveUser.boundDeviceId === 'string' &&
        liveUser.boundDeviceId === punchObj.deviceId &&
        typeof punchObj.photoPath === 'string' &&
        punchObj.photoPath.length >= 5 &&
        punchObj.photoPath.length <= 300;

      if (!hasValidPunchData) {
        setActionError('লোকেশন বা ডিভাইস তথ্য সঠিক নয়। অনুগ্রহ করে পৃষ্ঠাটি রিফ্রেশ করে আবার চেষ্টা করুন।');
        return;
      }

      if (punchType === 'in') {
        const existingSnap = await getDoc(doc(db, 'attendance', docId)).catch((checkErr) => {
          console.warn('Existing attendance pre-check notice:', checkErr?.code || checkErr?.message);
          return null;
        });
        if (existingSnap && existingSnap.exists()) {
          await loadTodayData();
          setActionError('আজকের হাজিরা রেকর্ড ইতোমধ্যে বিদ্যমান রয়েছে। পৃষ্ঠাটি রিফ্রেশ করে দেখুন।');
          return;
        }

        const initialStatus = computeInitialStatus(
          new Date(),
          liveTargetOffice.startTime,
          liveTargetOffice.graceMinutes
        );
        const employeeName =
          String(liveUser.name || liveUser.email || profile.email || 'User').trim().slice(0, 120) || 'User';
        const designation = String(liveUser.designation || '').trim().slice(0, 120);
        const homeOfficeId = typeof liveUser.officeId === 'string' ? liveUser.officeId.slice(0, 128) : '';

        let homeDistrictOfficeId = '';
        if (homeOfficeId) {
          if (homeOfficeId === liveTargetOffice.id) {
            homeDistrictOfficeId = targetDistrictId;
          } else {
            const homeOfficeSnap = await getDoc(doc(db, 'offices', homeOfficeId)).catch(() => null);
            homeDistrictOfficeId = String(
              deriveDistrictIdFromOfficeData(
                homeOfficeSnap?.exists() ? homeOfficeSnap.data() : null,
                homeOfficeId,
                computeDistrictOfficeId
              ) || liveUser.districtOfficeId || ''
            ).slice(0, 128);
          }
        }

        const payload = {
          uid,
          employeeName,
          designation,
          officeId: liveTargetOffice.id,
          districtOfficeId: targetDistrictId,
          homeOfficeId,
          homeDistrictOfficeId,
          date: todayStr,
          isFieldDuty: Boolean(isTodayFieldDuty),
          checkIn: punchObj,
          checkOut: null,
          initialStatus,
          finalStatus: null,
          settled: false,
          settledBy: null,
          settledByName: null,
          settledAt: null,
          districtComment: null,
          photoDeleted: photoUnavailable,
          photoDeletedAt: null,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        };

        try {
          await setDoc(doc(db, 'attendance', docId), payload);
        } catch (err) {
          console.error('Attendance create failed context:', {
            docId,
            officeId: payload.officeId,
            districtOfficeId: payload.districtOfficeId,
            homeOfficeId: payload.homeOfficeId,
            role: liveUser.role,
            approvalStatus: liveUser.approvalStatus,
            status: liveUser.status,
            boundMatches: liveUser.boundDeviceId === punchObj.deviceId,
            accuracy: punchObj.accuracy,
            distanceMeters: punchObj.distanceMeters,
            photoDeleted: payload.photoDeleted,
            errorCode: err?.code || null
          });
          handleFirestoreError(err, OperationType.CREATE, `attendance/${docId}`);
        }
        setActionSuccess(
          photoUnavailable
            ? `${liveTargetOffice.name}-এ আজকের হাজিরা সংরক্ষিত হয়েছে (${initialStatus}), তবে Firebase Storage চালু না থাকায় সেলফি আপলোড হয়নি।`
            : `${liveTargetOffice.name}-এ আজকের হাজিরা সফলভাবে সংরক্ষিত হয়েছে (${initialStatus})।`
        );
      } else {
        const checkOutDistrictOfficeId = targetDistrictId;
        try {
          await updateDoc(doc(db, 'attendance', docId), {
            checkOut: punchObj,
            checkOutOfficeId: liveTargetOffice.id,
            checkOutDistrictOfficeId,
            updatedAt: serverTimestamp()
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, `attendance/${docId}`);
        }
        setActionSuccess(
          photoUnavailable
            ? `${liveTargetOffice.name}-এ আজকের প্রস্থান সংরক্ষিত হয়েছে, তবে Firebase Storage চালু না থাকায় সেলফি আপলোড হয়নি।`
            : `${liveTargetOffice.name}-এ আজকের প্রস্থান সফলভাবে সংরক্ষিত হয়েছে।`
        );
      }

      setPendingPunchOffice(null);
      setUserPickedOffice(false);
      await loadTodayData();
    } catch (err) {
      setActionError(err.message || 'হাজিরা সংরক্ষণ করা যায়নি।');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AppShell>
      <div className="space-y-5">
        {deviceMismatch && (
          <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4 text-sm text-rose-900 space-y-1">
            <div className="font-bold">Device Mismatch Blocked</div>
            <p className="text-xs text-rose-800 leading-relaxed">
              এই অ্যাকাউন্টটি অন্য একটি ডিভাইসের সাথে যুক্ত (Bound) আছে। নতুন ডিভাইস থেকে হাজিরা দিতে হলে সুপার অ্যাডমিনকে ডিভাইস রিসেট করতে হবে।
            </p>
          </div>
        )}

        {expiredOfficeNames.length > 0 && (
          <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900">
            দ্রষ্টব্য: {expiredOfficeNames.join(', ')}-এ আপনার নির্ধারিত দায়িত্ব বা সংযুক্তির মেয়াদ শেষ হওয়ায় তালিকা থেকে বাদ দেওয়া হয়েছে। অনুগ্রহ করে প্রশাসকের সাথে যোগাযোগ করুন।
          </div>
        )}

        <section className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="text-xs text-slate-500">Today · {todayDisplay}</div>
              <h2 className="text-lg font-bold text-slate-900 font-display mt-0.5">
                {office?.name || 'Assigned Office'}
              </h2>
              {office && (
                <div className="text-xs text-slate-500 mt-0.5">
                  Shift: {office.startTime} – {office.endTime} · Grace {office.graceMinutes}m · Radius{' '}
                  {office.geofenceRadiusMeters}m
                </div>
              )}
            </div>

            {todayRecord ? (
              <StatusText status={todayRecord.finalStatus || todayRecord.initialStatus} />
            ) : (
              <span className="text-xs font-medium text-slate-500">Not Checked In</span>
            )}
          </div>

          {validOffices.length > 1 && (!todayRecord?.checkIn || !todayRecord?.checkOut) && (
            <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label
                  htmlFor="attendance-office-select"
                  className="text-xs font-semibold text-slate-700"
                >
                  {todayRecord?.checkIn
                    ? 'প্রস্থানের অফিস নির্বাচন করুন (Check-Out Office)'
                    : 'হাজিরার অফিস নির্বাচন করুন (Check-In Office)'}
                </label>
                <button
                  type="button"
                  disabled={gpsMatching}
                  onClick={handleAutoDetectOffice}
                  className="text-xs font-semibold text-[#0b6b4f] hover:underline disabled:opacity-50"
                >
                  {gpsMatching ? 'শনাক্ত হচ্ছে...' : 'GPS দিয়ে নিকটতম অফিস খুঁজুন'}
                </button>
              </div>
              <select
                id="attendance-office-select"
                value={selectedOfficeId}
                onChange={(e) => {
                  setSelectedOfficeId(e.target.value);
                  setUserPickedOffice(true);
                  setGpsMultiMatches([]);
                }}
                className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 bg-white text-sm text-slate-900"
              >
                {validOffices.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name} ({o.sources.map((s) => SOURCE_LABELS[s] || s).join(', ')})
                  </option>
                ))}
              </select>
              {gpsMatchHint && (
                <div className="text-xs text-emerald-800">{gpsMatchHint}</div>
              )}
              {gpsMultiMatches.length > 1 && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {gpsMultiMatches.map((m) => (
                    <button
                      key={m.office.id}
                      type="button"
                      onClick={() => {
                        setSelectedOfficeId(m.office.id);
                        setUserPickedOffice(true);
                        startPunchFlow(todayRecord?.checkIn ? 'out' : 'in', m.office);
                      }}
                      className="min-h-[38px] px-3 py-1.5 rounded-xl bg-[#0b6b4f] hover:bg-[#09553f] text-white text-xs font-semibold"
                    >
                      {m.office.name} ({toBanglaDigits(m.distance)} মি.)
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {isTodayFieldDuty && (
            <div className="p-3 rounded-xl bg-sky-50 border border-sky-200 text-xs text-sky-900">
              Approved Field Duty active today ({activeFieldDuty.location}). Geofence check is bypassed, GPS &amp; selfie still required.
            </div>
          )}

          {loadingToday ? (
            <div className="py-4 text-sm text-slate-500">লোড হচ্ছে...</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <div className="p-3.5 rounded-xl bg-slate-50">
                <div className="text-xs text-slate-500">Check-In (হাজিরা)</div>
                <div className="text-base font-bold font-mono-tabular text-slate-900 mt-1">
                  {todayRecord?.checkIn ? formatDhakaTime(todayRecord.checkIn.time) : '—'}
                </div>
                {todayRecord?.checkIn && (
                  <>
                    <div className="text-[11px] font-medium text-slate-700 mt-1 truncate">
                      অফিস: {getOfficeName(todayRecord.officeId)}
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5 font-mono-tabular">
                      দূরত্ব: {toBanglaDigits(todayRecord.checkIn.distanceMeters ?? 0)} মিটার · ±
                      {todayRecord.checkIn.accuracy}m
                    </div>
                  </>
                )}
              </div>

              <div className="p-3.5 rounded-xl bg-slate-50">
                <div className="text-xs text-slate-500">Check-Out (প্রস্থান)</div>
                <div className="text-base font-bold font-mono-tabular text-slate-900 mt-1">
                  {todayRecord?.checkOut ? formatDhakaTime(todayRecord.checkOut.time) : '—'}
                </div>
                {todayRecord?.checkOut && (
                  <>
                    <div className="text-[11px] font-medium text-slate-700 mt-1 truncate">
                      অফিস: {getOfficeName(todayRecord.checkOutOfficeId || todayRecord.officeId)}
                    </div>
                    <div className="text-[11px] text-slate-500 mt-0.5 font-mono-tabular">
                      দূরত্ব: {toBanglaDigits(todayRecord.checkOut.distanceMeters ?? 0)} মিটার · ±
                      {todayRecord.checkOut.accuracy}m
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {todayRecord?.districtComment && (
            <div className="pt-3 border-t border-slate-100 text-xs text-slate-600">
              <span className="font-semibold text-slate-800">District Officer Note:</span>{' '}
              {todayRecord.districtComment}
            </div>
          )}
        </section>

        {lastDistanceBangla && (
          <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs font-medium text-emerald-900">
            {lastDistanceBangla}
          </div>
        )}

        {actionError && (
          <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800 leading-relaxed" role="alert">
            {actionError}
          </div>
        )}

        {actionSuccess && (
          <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 font-medium">
            {actionSuccess}
          </div>
        )}

        {cameraMode && (
          <CameraSelfieCapture
            employeeName={profile?.name || ''}
            lat={verifiedGps.lat}
            lng={verifiedGps.lng}
            accuracy={verifiedGps.accuracy}
            onCaptured={handleSelfieCaptured}
            onCancel={() => setCameraMode(false)}
          />
        )}

        {submitting && (
          <div className="bg-white rounded-2xl border border-slate-200 p-6 text-center text-sm font-medium text-emerald-800">
            তথ্য ও সেলফি আপলোড হচ্ছে, অনুগ্রহ করে অপেক্ষা করুন...
          </div>
        )}

        {!cameraMode && !submitting && !loadingToday && (
          <div className="space-y-3">
            {!todayRecord?.checkIn ? (
              <button
                type="button"
                disabled={gpsChecking || deviceMismatch || !office}
                onClick={() => startPunchFlow('in')}
                className="w-full min-h-[54px] px-6 py-3.5 rounded-2xl bg-emerald-700 hover:bg-emerald-800 active:scale-[0.99] text-white text-base font-bold shadow-sm transition-all disabled:opacity-50"
              >
                {gpsChecking ? 'GPS যাচাই হচ্ছে...' : 'হাজিরা দিন'}
              </button>
            ) : !todayRecord?.checkOut ? (
              <button
                type="button"
                disabled={gpsChecking || deviceMismatch || !office}
                onClick={() => startPunchFlow('out')}
                className="w-full min-h-[54px] px-6 py-3.5 rounded-2xl bg-slate-900 hover:bg-slate-800 active:scale-[0.99] text-white text-base font-bold shadow-sm transition-all disabled:opacity-50"
              >
                {gpsChecking ? 'GPS যাচাই হচ্ছে...' : 'প্রস্থান দিন'}
              </button>
            ) : (
              <div className="bg-white rounded-2xl border border-slate-200 p-4 text-center text-xs font-medium text-emerald-800">
                আজকের হাজিরা ও প্রস্থান উভয়ই সম্পন্ন হয়েছে।
              </div>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}
