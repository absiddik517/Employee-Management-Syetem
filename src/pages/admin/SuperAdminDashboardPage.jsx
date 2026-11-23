import React, { useCallback, useEffect, useState } from 'react';
import {
  addDoc,
  collection,
  query,
  where,
  getDocs,
  doc,
  setDoc,
  updateDoc,
  serverTimestamp
} from 'firebase/firestore';
import AppShell from '../../components/AppShell.jsx';
import StatusText from '../../components/StatusText.jsx';
import ConfirmSheet from '../../components/ConfirmSheet.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useData } from '../../context/DataContext.jsx';
import { db, OperationType, handleFirestoreError } from '../../firebase/config.js';
import { getTodayDhaka, isDateOlderThanDays, toBanglaDigits } from '../../utils/dhakaTime.js';
import { getDefaultRoleKey, getRoleLabel } from '../../lib/permissions.js';

export default function SuperAdminDashboardPage() {
  const {
    profile,
    offices,
    roles,
    roleRegistry,
    defaultRoleKey,
    assignableRoles,
    can,
    registrationOpen,
    setRegistrationOpen,
    fetchPublicBootstrap,
    computeDistrictOfficeId
  } = useAuth();
  const { deleteStoragePathSafe, logAudit } = useData();

  const [loading, setLoading] = useState(true);
  const [togglingReg, setTogglingReg] = useState(false);
  const [cleaningPhotos, setCleaningPhotos] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [confirmCleanup, setConfirmCleanup] = useState(false);
  const [pendingUsers, setPendingUsers] = useState([]);
  const [approvalEdits, setApprovalEdits] = useState({});
  const [oldUnsettledPhotos, setOldUnsettledPhotos] = useState([]);
  const [expiredChargeCount, setExpiredChargeCount] = useState(0);
  const [feedbackMsg, setFeedbackMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setErrorMsg('');
    try {
      await fetchPublicBootstrap();
      const [uSnap, aSnap] = await Promise.all([
        getDocs(query(collection(db, 'users'), where('approvalStatus', '==', 'pending'))),
        getDocs(query(collection(db, 'attendance'), where('settled', '==', false), where('photoDeleted', '==', false)))
      ]);

      const users = uSnap.docs.map((d) => ({ uid: d.id, id: d.id, ...d.data() }));
      setPendingUsers(users);

      const validDefaultRole =
        defaultRoleKey && roleRegistry[defaultRoleKey] ? defaultRoleKey : '';
      const edits = {};
      for (const u of users) {
        const targetUid = u.uid || u.id;
        edits[targetUid] = {
          officeId: u.officeId || offices[0]?.id || '',
          role: u.role || validDefaultRole || ''
        };
      }
      setApprovalEdits(edits);

      const oldPhotos = aSnap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((r) => isDateOlderThanDays(r.date, 15) && (r.checkIn?.photoPath || r.checkOut?.photoPath));
      setOldUnsettledPhotos(oldPhotos);

      if (can('assignment.manage')) {
        const allUsersSnap = await getDocs(collection(db, 'users'));
        const activeChargeUsers = allUsersSnap.docs
          .map((d) => ({ uid: d.id, ...d.data() }))
          .filter(
            (u) =>
              u.approvalStatus === 'approved' &&
              u.status === 'active' &&
              ((Array.isArray(u.additionalOfficeIds) && u.additionalOfficeIds.length > 0) ||
                Boolean(u.attachedOfficeId) ||
                Boolean(u.actingOfficeId))
          );
        const today = getTodayDhaka();
        let expiredCount = 0;
        await Promise.all(
          activeChargeUsers.map(async (u) => {
            try {
              const assignSnap = await getDocs(collection(db, 'users', u.uid, 'assignments'));
              const recs = assignSnap.docs.map((d) => d.data());
              const hasExpired = recs.some(
                (r) =>
                  !r.closedAt &&
                  r.endDate &&
                  r.endDate < today &&
                  ((r.kind === 'additional_charge' &&
                    Array.isArray(u.additionalOfficeIds) &&
                    u.additionalOfficeIds.includes(r.officeId)) ||
                    (r.kind === 'acting_charge' && u.actingOfficeId === r.officeId) ||
                    (r.kind === 'attachment' && u.attachedOfficeId === r.officeId))
              );
              if (hasExpired) expiredCount += 1;
            } catch {
              // ignore individual subcollection warning
            }
          })
        );
        setExpiredChargeCount(expiredCount);
      } else {
        setExpiredChargeCount(0);
      }
    } catch (err) {
      setErrorMsg('অ্যাডমিন ড্যাশবোর্ড লোড করা যায়নি।');
      handleFirestoreError(err, OperationType.LIST, 'admin-dashboard');
    } finally {
      setLoading(false);
    }
  }, [fetchPublicBootstrap, offices, can]);

  useEffect(() => {
    loadDashboard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!offices.length || !pendingUsers.length) return;
    setApprovalEdits((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const u of pendingUsers) {
        const targetUid = u.uid || u.id;
        if (next[targetUid] && !next[targetUid].officeId) {
          next[targetUid] = { ...next[targetUid], officeId: offices[0].id };
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [offices, pendingUsers]);

  const toggleRegistration = async () => {
    if (!can('settings.manage')) return;
    setTogglingReg(true);
    setErrorMsg('');
    setFeedbackMsg('');
    const nextVal = !registrationOpen;
    const preservedDefaultRole =
      defaultRoleKey && roleRegistry[defaultRoleKey] ? defaultRoleKey : '';
    try {
      await setDoc(
        doc(db, 'settings', 'app'),
        {
          registrationOpen: nextVal,
          defaultRole: preservedDefaultRole,
          updatedAt: serverTimestamp(),
          updatedBy: profile.uid
        },
        { merge: true }
      );
      setRegistrationOpen(nextVal);
      await logAudit({
        actor: profile,
        action: 'REGISTRATION_SETTING_CHANGED',
        targetCollection: 'settings',
        targetId: 'app',
        oldValue: String(!nextVal),
        newValue: String(nextVal),
        reason: nextVal ? 'Opened public registration' : 'Closed public registration'
      });
      setFeedbackMsg(nextVal ? 'পাবলিক রেজিস্ট্রেশন চালু করা হয়েছে।' : 'পাবলিক রেজিস্ট্রেশন বন্ধ করা হয়েছে।');
    } catch (err) {
      setErrorMsg('সেটিংস পরিবর্তন করা যায়নি।');
      handleFirestoreError(err, OperationType.UPDATE, 'settings/app');
    } finally {
      setTogglingReg(false);
    }
  };

  const updateEdit = (uid, patch) => {
    const validDefault = getDefaultRoleKey();
    const fallbackRole = validDefault && roleRegistry[validDefault] ? validDefault : '';
    setApprovalEdits((prev) => ({
      ...prev,
      [uid]: { ...(prev[uid] || { officeId: '', role: fallbackRole }), ...patch }
    }));
  };

  const decideUser = async (user, status) => {
    const targetUid = user.uid || user.id;
    if (!can('user.approve', { uid: targetUid, role: user.role, officeId: user.officeId, districtOfficeId: user.districtOfficeId })) {
      return;
    }
    setErrorMsg('');
    setFeedbackMsg('');
    const validDefault = getDefaultRoleKey();
    const fallbackRole = validDefault && roleRegistry[validDefault] ? validDefault : '';
    const edit = approvalEdits[targetUid] || { officeId: '', role: fallbackRole };
    if (!edit.role) {
      setErrorMsg('অনুমোদন বা বাতিল করার আগে ব্যবহারকারীর জন্য একটি রোল নির্বাচন করুন।');
      return;
    }
    const districtOfficeId = computeDistrictOfficeId(edit.officeId);
    try {
      await updateDoc(doc(db, 'users', targetUid), {
        approvalStatus: status,
        officeId: edit.officeId,
        districtOfficeId,
        role: edit.role,
        updatedAt: serverTimestamp()
      });
      if (status === 'approved' && edit.officeId && edit.role) {
        try {
          const existingAssignSnap = await getDocs(
            query(collection(db, 'users', targetUid, 'assignments'), where('kind', '==', 'primary'))
          );
          if (existingAssignSnap.empty) {
            const resolvedOfficeName = offices.find((o) => o.id === edit.officeId)?.name || edit.officeId;
            await addDoc(collection(db, 'users', targetUid, 'assignments'), {
              kind: 'primary',
              officeId: edit.officeId,
              districtOfficeId: districtOfficeId || '',
              officeName: String(resolvedOfficeName).slice(0, 160),
              designation: String(user.designation || '').slice(0, 120),
              roleKey: edit.role,
              roleLabel: String(getRoleLabel(edit.role, roleRegistry) || edit.role).slice(0, 80),
              startDate: /^\d{4}-\d{2}-\d{2}$/.test(String(user.joiningDate || ''))
                ? user.joiningDate
                : getTodayDhaka(),
              endDate: null,
              type: 'joined',
              createdBy: profile.uid,
              createdByName: String(profile.name || profile.email || 'Admin').slice(0, 120),
              createdAt: serverTimestamp()
            });
          }
        } catch (assignErr) {
          console.warn('Initial assignment record write failed:', assignErr);
        }
      }
      await logAudit({
        actor: profile,
        action: status === 'approved' ? 'USER_APPROVED' : 'USER_REJECTED',
        targetCollection: 'users',
        targetId: targetUid,
        oldValue: 'pending',
        newValue: `${status} (${edit.role})`,
        reason: `Admin ${status} registration`,
        officeId: edit.officeId,
        districtOfficeId
      });
      setFeedbackMsg(
        `${user.name || user.email || targetUid}-এর অ্যাকাউন্ট ${status === 'approved' ? 'অনুমোদন' : 'বাতিল'} করা হয়েছে।`
      );
      await loadDashboard();
    } catch (err) {
      setErrorMsg('ব্যবহারকারী আপডেট করা যায়নি।');
      handleFirestoreError(err, OperationType.UPDATE, `users/${targetUid}`);
    }
  };

  const runPhotoCleanup = async () => {
    setConfirmCleanup(false);
    if (!can('attendance.photo.purge')) return;
    setCleaningPhotos(true);
    setErrorMsg('');
    setFeedbackMsg('');
    try {
      let count = 0;
      for (const rec of oldUnsettledPhotos) {
        if (rec.checkIn?.photoPath) {
          await deleteStoragePathSafe(rec.checkIn.photoPath);
        }
        if (rec.checkOut?.photoPath) {
          await deleteStoragePathSafe(rec.checkOut.photoPath);
        }
        const updatedIn = rec.checkIn ? { ...rec.checkIn, photoDeleted: true } : null;
        const updatedOut = rec.checkOut ? { ...rec.checkOut, photoDeleted: true } : null;
        await updateDoc(doc(db, 'attendance', rec.id), {
          photoDeleted: true,
          photoDeletedAt: serverTimestamp(),
          checkIn: updatedIn,
          checkOut: updatedOut,
          updatedAt: serverTimestamp()
        });
        count++;
      }

      await logAudit({
        actor: profile,
        action: 'CLEANUP_15_DAY_OLD_PHOTOS',
        targetCollection: 'attendance',
        targetId: 'batch-cleanup',
        oldValue: `${count} photos`,
        newValue: 'deleted',
        reason: '15-day old unsettled photo cleanup'
      });

      setFeedbackMsg(`${toBanglaDigits(count)}টি পুরোনো ছবি সফলভাবে মুছে ফেলা হয়েছে।`);
      await loadDashboard();
    } catch (err) {
      setErrorMsg('পুরোনো ছবি মুছে ফেলতে সমস্যা হয়েছে।');
      handleFirestoreError(err, OperationType.UPDATE, 'attendance-cleanup');
    } finally {
      setCleaningPhotos(false);
    }
  };

  const seedSampleData = async () => {
    if (!can('office.manage') || !can('holiday.manage') || !can('settings.manage')) return;
    setSeeding(true);
    setErrorMsg('');
    setFeedbackMsg('');
    const uid = profile.uid;
    const preservedDefaultRole =
      defaultRoleKey && roleRegistry[defaultRoleKey] ? defaultRoleKey : '';
    try {
      await setDoc(
        doc(db, 'settings', 'app'),
        {
          registrationOpen: true,
          defaultRole: preservedDefaultRole,
          updatedAt: serverTimestamp(),
          updatedBy: uid
        },
        { merge: true }
      );

      const sampleOffices = [
        {
          id: 'head-office',
          name: 'Directorate of Non-Formal Education (Head Office)',
          address: '232/1 Tejgaon Industrial Area, Dhaka 1208',
          level: 'head',
          parentOfficeId: null,
          lat: 23.7654,
          lng: 90.3995,
          geofenceRadiusMeters: 150,
          startTime: '09:00',
          graceMinutes: 15,
          endTime: '17:00'
        },
        {
          id: 'dhaka-district',
          name: 'Dhaka District Non-Formal Education Office',
          address: 'Segunbagicha, Dhaka 1000',
          level: 'district',
          parentOfficeId: 'head-office',
          lat: 23.7336,
          lng: 90.4084,
          geofenceRadiusMeters: 100,
          startTime: '09:00',
          graceMinutes: 15,
          endTime: '17:00'
        },
        {
          id: 'savar-upazila',
          name: 'Savar Upazila Non-Formal Education Office',
          address: 'Upazila Parishad Complex, Savar, Dhaka',
          level: 'upazila',
          parentOfficeId: 'dhaka-district',
          lat: 23.8583,
          lng: 90.2667,
          geofenceRadiusMeters: 100,
          startTime: '09:00',
          graceMinutes: 15,
          endTime: '17:00'
        },
        {
          id: 'dhamrai-upazila',
          name: 'Dhamrai Upazila Non-Formal Education Office',
          address: 'Upazila Parishad Complex, Dhamrai, Dhaka',
          level: 'upazila',
          parentOfficeId: 'dhaka-district',
          lat: 23.9136,
          lng: 90.2141,
          geofenceRadiusMeters: 100,
          startTime: '09:00',
          graceMinutes: 15,
          endTime: '17:00'
        }
      ];

      for (const o of sampleOffices) {
        const { id, ...fields } = o;
        await setDoc(doc(db, 'offices', id), {
          ...fields,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
      }

      const sampleHolidays = [
        { id: '2026-12-16', date: '2026-12-16', title: 'Victory Day', type: 'national' },
        { id: '2026-02-21', date: '2026-02-21', title: 'International Mother Language Day', type: 'national' },
        { id: '2026-03-26', date: '2026-03-26', title: 'Independence Day', type: 'national' }
      ];

      for (const h of sampleHolidays) {
        const { id, ...fields } = h;
        await setDoc(doc(db, 'holidays', id), {
          ...fields,
          createdBy: uid,
          createdAt: serverTimestamp()
        });
      }

      await logAudit({
        actor: profile,
        action: 'SEED_SAMPLE_DATA',
        targetCollection: 'offices',
        targetId: 'initial-hierarchy',
        newValue: '4 offices, 3 holidays',
        reason: 'Seeded initial office hierarchy and holidays'
      });

      await loadDashboard();
      setFeedbackMsg('নমুনা অফিস হায়ারার্কি ও ছুটির দিন সফলভাবে Firestore-এ সিড করা হয়েছে।');
    } catch (err) {
      setErrorMsg('নমুনা তথ্য সিড করা যায়নি।');
      handleFirestoreError(err, OperationType.WRITE, 'seed-sample-data');
    } finally {
      setSeeding(false);
    }
  };

  const banglaCount = toBanglaDigits(oldUnsettledPhotos.length);

  return (
    <AppShell>
      <div className="space-y-5">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {can('settings.manage') && (
            <section className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 flex items-center justify-between gap-4">
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 font-display">Public Employee Registration</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  {registrationOpen
                    ? 'Open: New staff can register and await approval.'
                    : 'Closed: Register screen displays রেজিস্ট্রেশন বন্ধ আছে.'}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={registrationOpen}
                disabled={togglingReg}
                onClick={toggleRegistration}
                className={`min-h-[44px] px-4 py-2 rounded-xl text-xs font-semibold transition-colors shrink-0 ${
                  registrationOpen
                    ? 'bg-emerald-700 text-white hover:bg-emerald-800'
                    : 'bg-slate-200 text-slate-800 hover:bg-slate-300'
                }`}
              >
                {togglingReg ? 'আপডেট হচ্ছে...' : registrationOpen ? 'Open (Turn Off)' : 'Closed (Turn On)'}
              </button>
            </section>
          )}

          {can('attendance.photo.purge') && (
            <section className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 font-display">
                  অনিষ্পন্ন ১৫ দিনের পুরোনো ছবি: {banglaCount} টি
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Unsettled attendance selfies older than 15 days eligible for Storage cleanup.
                </p>
              </div>
              <button
                type="button"
                disabled={cleaningPhotos || oldUnsettledPhotos.length === 0}
                onClick={() => setConfirmCleanup(true)}
                className="min-h-[44px] px-4 py-2 rounded-xl bg-rose-700 hover:bg-rose-800 text-white text-xs font-semibold shrink-0 disabled:opacity-50"
              >
                {cleaningPhotos ? 'মুছে ফেলা হচ্ছে...' : 'Delete Old Photos'}
              </button>
            </section>
          )}
        </div>

        {can('assignment.manage') && expiredChargeCount > 0 && (
          <section className="rounded-2xl border border-amber-300 dark:border-amber-800 bg-amber-50/80 dark:bg-amber-950/40 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-bold text-amber-950 dark:text-amber-100 font-display">
                মেয়াদ শেষ – এখনো চালু ({toBanglaDigits(expiredChargeCount)} জন)
              </h2>
              <p className="text-xs text-amber-800 dark:text-amber-300 mt-1">
                কয়েকজন কর্মকর্তার অতিরিক্ত/চলতি দায়িত্ব বা সংযুক্তির নির্ধারিত মেয়াদ শেষ হলেও এখনো চালু আছে।
              </p>
            </div>
            <a
              href="#/assignments"
              className="min-h-[44px] px-4 py-2 rounded-xl bg-amber-700 hover:bg-amber-800 text-white text-xs font-semibold inline-flex items-center justify-center shrink-0 whitespace-nowrap"
            >
              দায়িত্ব ও সংযুক্তি খুলুন
            </a>
          </section>
        )}

        {can('settings.manage') && roles.length === 0 && (
          <section className="rounded-2xl border border-amber-300 dark:border-amber-800 bg-amber-50/80 dark:bg-amber-950/40 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-bold text-amber-950 dark:text-amber-100 font-display">
                কোনো রোল তৈরি করা হয়নি
              </h2>
              <p className="text-xs text-amber-800 dark:text-amber-300 mt-1">
                সিস্টেমে এখনো কোনো ডায়নামিক রোল তৈরি বা আমদানি করা হয়নি। ব্যবহারকারীরা রোল ছাড়া লগইন করতে পারবেন না।
              </p>
            </div>
            <a
              href="#/admin/permissions"
              className="min-h-[44px] px-4 py-2 rounded-xl bg-amber-700 hover:bg-amber-800 text-white text-xs font-semibold inline-flex items-center justify-center shrink-0 whitespace-nowrap"
            >
              Role Manager খুলুন
            </a>
          </section>
        )}

        {can('settings.manage') && (
          <section className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 font-display">
                Role Manager
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                রোল তৈরি/সম্পাদনা, পারমিশন, অনুমোদন চেইন (Leave / Field Duty / Settlement), ডিফল্ট রেজিস্ট্রেশন রোল ও JSON আমদানি/রপ্তানি পরিচালনা করুন।
              </p>
            </div>
            <a
              href="#/admin/permissions"
              className="min-h-[44px] px-4 py-2 rounded-xl bg-[#0b6b4f] hover:bg-[#09553f] dark:bg-[#4fd1a1] dark:text-slate-950 text-white text-xs font-semibold inline-flex items-center justify-center shrink-0 whitespace-nowrap"
            >
              Open Role Manager
            </a>
          </section>
        )}

        {can('office.manage') && can('holiday.manage') && (
          <section className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 font-display">
                Seed Bangladesh Office Hierarchy &amp; Holidays
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Seeds Head Office, District Office, two Upazila Offices, default app settings, and national holidays into Firestore.
              </p>
            </div>
            <button
              type="button"
              disabled={seeding}
              onClick={seedSampleData}
              className="min-h-[44px] px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 text-white text-xs font-semibold shrink-0 disabled:opacity-60"
            >
              {seeding ? 'সিড হচ্ছে...' : 'Seed Sample Offices & Holidays'}
            </button>
          </section>
        )}

        {feedbackMsg && (
          <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800">
            {feedbackMsg}
          </div>
        )}
        {errorMsg && (
          <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800">{errorMsg}</div>
        )}

        <section className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800">
          <div className="p-4 sm:p-5 flex items-center justify-between gap-2">
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 font-display">Pending Registration Approval Queue</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Confirm office assignment and set official role before approving
              </p>
            </div>
            <span className="text-xs font-semibold text-amber-700 tabular-nums">{pendingUsers.length} Pending</span>
          </div>

          {loading ? (
            <div className="p-8 text-center text-sm text-slate-600">লোড হচ্ছে...</div>
          ) : !pendingUsers.length ? (
            <div className="p-8 text-center text-sm text-slate-500">
              অনুমোদনের অপেক্ষায় কোনো নতুন রেজিস্ট্রেশন নেই।
            </div>
          ) : (
            pendingUsers.map((u) => {
              const targetUid = u.uid || u.id;
              const validDefault = getDefaultRoleKey();
              const fallbackRole = validDefault && roleRegistry[validDefault] ? validDefault : '';
              const edit = approvalEdits[targetUid] || { officeId: '', role: fallbackRole };
              return (
                <div key={targetUid} className="p-4 sm:p-5 space-y-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="text-sm font-bold text-slate-900 dark:text-slate-100">{u.name || u.email || targetUid}</div>
                      <div className="text-xs text-slate-600 dark:text-slate-300">
                        {u.designation} · {u.email} · {u.mobile}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        Joined {u.joiningDate} · Address: {u.address}
                      </div>
                    </div>
                    <StatusText status="pending" />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">Confirm Office</label>
                      <select
                        value={edit.officeId}
                        onChange={(e) => updateEdit(targetUid, { officeId: e.target.value })}
                        className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-xs bg-white dark:bg-slate-800"
                      >
                        <option value="" disabled>
                          Select office...
                        </option>
                        {offices.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">Assign Role</label>
                      <select
                        value={edit.role}
                        onChange={(e) => updateEdit(targetUid, { role: e.target.value })}
                        className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-xs bg-white dark:bg-slate-800"
                      >
                        <option value="" disabled>
                          Select role...
                        </option>
                        {assignableRoles.map((r) => (
                          <option key={r.key} value={r.key}>
                            {r.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex items-end gap-2">
                      <button
                        type="button"
                        disabled={!edit.role}
                        onClick={() => decideUser(u, 'approved')}
                        className="flex-1 min-h-[44px] px-3 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold disabled:opacity-50"
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        onClick={() => decideUser(u, 'rejected')}
                        className="min-h-[44px] px-3 py-2 rounded-xl border border-rose-300 text-rose-700 hover:bg-rose-50 text-xs font-semibold"
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </section>

        <ConfirmSheet
          open={confirmCleanup}
          title="Delete Old Attendance Selfies"
          message={`Are you sure you want to delete ${oldUnsettledPhotos.length} unsettled attendance selfie record(s) older than 15 days from Firebase Storage?`}
          confirmLabel="Delete Photos"
          danger={true}
          onConfirm={runPhotoCleanup}
          onCancel={() => setConfirmCleanup(false)}
        />
      </div>
    </AppShell>
  );
}
