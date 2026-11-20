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

export default function EmployeeHomePage() {
  const {
    profile,
    userOffice: office,
    deviceMismatch,
    localDeviceId,
    computeDistrictOfficeId,
    loadUserProfile
  } = useAuth();

  const [loadingToday, setLoadingToday] = useState(true);
  const [todayRecord, setTodayRecord] = useState(null);
  const [activeFieldDuty, setActiveFieldDuty] = useState(null);
  const [gpsChecking, setGpsChecking] = useState(false);
  const [cameraMode, setCameraMode] = useState(false);
  const [punchType, setPunchType] = useState('in');
  const [verifiedGps, setVerifiedGps] = useState({ lat: 0, lng: 0, accuracy: 0, distanceMeters: 0 });
  const [lastDistanceBangla, setLastDistanceBangla] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState('');
  const [actionSuccess, setActionSuccess] = useState('');

  const todayStr = useMemo(() => getTodayDhaka(), []);
  const todayDisplay = useMemo(() => formatDisplayDate(todayStr), [todayStr]);
  const isTodayFieldDuty = !!activeFieldDuty;

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

    if (!userData.boundDeviceId) {
      try {
        await updateDoc(userRef, {
          boundDeviceId: localDeviceId,
          updatedAt: serverTimestamp()
        });
        await loadUserProfile(profile.uid);
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

    return { ok: true, userData };
  }, [profile?.uid, localDeviceId, loadUserProfile]);

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
      const fdQ = query(
        collection(db, 'fieldDuties'),
        where('uid', '==', profile.uid),
        where('status', '==', 'approved')
      );
      const fdSnap = await getDocs(fdQ);
      const found = fdSnap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .find((fd) => fd.startDate <= todayStr && fd.endDate >= todayStr);
      setActiveFieldDuty(found || null);
    } catch (err) {
      console.warn('Field duty fetch notice:', err);
    } finally {
      setLoadingToday(false);
    }
  }, [profile, todayStr]);

  useEffect(() => {
    loadTodayData();
  }, [loadTodayData]);

  const startPunchFlow = async (type) => {
    setActionError('');
    setActionSuccess('');
    setLastDistanceBangla('');

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
    if (!office) {
      setActionError('আপনার অফিসের তথ্য পাওয়া যায়নি।');
      return;
    }

    const officeLat = Number(office.lat);
    const officeLng = Number(office.lng);
    if (!Number.isFinite(officeLat) || !Number.isFinite(officeLng)) {
      setActionError('আপনার অফিসের GPS স্থানাঙ্ক সঠিক নয়। সুপার অ্যাডমিনকে অফিসের লোকেশন আপডেট করতে বলুন।');
      return;
    }

    setGpsChecking(true);
    try {
      const liveCheck = await verifyLiveUserAndDevice();
      if (!liveCheck.ok) {
        setActionError(liveCheck.message);
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

      const distance = haversineDistanceMeters(pos.lat, pos.lng, officeLat, officeLng);
      if (!Number.isFinite(distance) || distance < 0) {
        setActionError('অফিস থেকে দূরত্ব নির্ণয় করা যায়নি। পুনরায় চেষ্টা করুন।');
        return;
      }
      const radius = Number(office.geofenceRadiusMeters || 100);
      setLastDistanceBangla(
        `অফিস থেকে দূরত্ব: ${toBanglaDigits(distance)} মিটার (নির্ভুলতা ±${toBanglaDigits(pos.accuracy)} মিটার)`
      );

      if (!isTodayFieldDuty && distance > radius) {
        setActionError(
          `আপনি অফিসের নির্ধারিত সীমানার (${toBanglaDigits(radius)} মিটার) বাইরে আছেন। বর্তমান দূরত্ব: ${toBanglaDigits(distance)} মিটার।`
        );
        return;
      }

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

      if (punchType === 'in') {
        const existingSnap = await getDoc(doc(db, 'attendance', docId)).catch(() => null);
        if (existingSnap && existingSnap.exists()) {
          await loadTodayData();
          setActionError('আজকের হাজিরা রেকর্ড ইতোমধ্যে বিদ্যমান রয়েছে। পৃষ্ঠাটি রিফ্রেশ করে দেখুন।');
          return;
        }

        const initialStatus = computeInitialStatus(new Date(), office.startTime, office.graceMinutes);
        const employeeName = String(profile.name || profile.email || 'User').trim().slice(0, 120) || 'User';
        const designation = String(profile.designation || '').trim().slice(0, 120);
        const districtOfficeId = String(profile.districtOfficeId || computeDistrictOfficeId(office.id) || '').slice(0, 128);

        const payload = {
          uid,
          employeeName,
          designation,
          officeId: office.id,
          districtOfficeId,
          date: todayStr,
          isFieldDuty: isTodayFieldDuty,
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
          handleFirestoreError(err, OperationType.CREATE, `attendance/${docId}`);
        }
        setActionSuccess(
          photoUnavailable
            ? `আজকের হাজিরা সংরক্ষিত হয়েছে (${initialStatus}), তবে Firebase Storage চালু না থাকায় সেলফি আপলোড হয়নি।`
            : `আজকের হাজিরা সফলভাবে সংরক্ষিত হয়েছে (${initialStatus})।`
        );
      } else {
        try {
          await updateDoc(doc(db, 'attendance', docId), {
            checkOut: punchObj,
            updatedAt: serverTimestamp()
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, `attendance/${docId}`);
        }
        setActionSuccess(
          photoUnavailable
            ? 'আজকের প্রস্থান সংরক্ষিত হয়েছে, তবে Firebase Storage চালু না থাকায় সেলফি আপলোড হয়নি।'
            : 'আজকের প্রস্থান সফলভাবে সংরক্ষিত হয়েছে।'
        );
      }

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

          {isTodayFieldDuty && (
            <div className="p-3 rounded-xl bg-sky-50 border border-sky-200 text-xs text-sky-900">
              Approved Field Duty active today ({activeFieldDuty.location}). Geofence check is bypassed, GPS &amp; selfie still required.
            </div>
          )}

          {loadingToday ? (
            <div className="py-4 text-sm text-slate-500">লোড হচ্ছে...</div>
          ) : (
            <div className="grid grid-cols-2 gap-3 pt-1">
              <div className="p-3.5 rounded-xl bg-slate-50">
                <div className="text-xs text-slate-500">Check-In (হাজিরা)</div>
                <div className="text-base font-bold font-mono-tabular text-slate-900 mt-1">
                  {todayRecord?.checkIn ? formatDhakaTime(todayRecord.checkIn.time) : '—'}
                </div>
                {todayRecord?.checkIn && (
                  <div className="text-[11px] text-slate-500 mt-1 font-mono-tabular">
                    দূরত্ব: {toBanglaDigits(todayRecord.checkIn.distanceMeters ?? 0)} মিটার · ±
                    {todayRecord.checkIn.accuracy}m
                  </div>
                )}
              </div>

              <div className="p-3.5 rounded-xl bg-slate-50">
                <div className="text-xs text-slate-500">Check-Out (প্রস্থান)</div>
                <div className="text-base font-bold font-mono-tabular text-slate-900 mt-1">
                  {todayRecord?.checkOut ? formatDhakaTime(todayRecord.checkOut.time) : '—'}
                </div>
                {todayRecord?.checkOut && (
                  <div className="text-[11px] text-slate-500 mt-1 font-mono-tabular">
                    দূরত্ব: {toBanglaDigits(todayRecord.checkOut.distanceMeters ?? 0)} মিটার · ±
                    {todayRecord.checkOut.accuracy}m
                  </div>
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
