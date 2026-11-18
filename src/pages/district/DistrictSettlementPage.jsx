import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  setDoc,
  updateDoc,
  addDoc,
  serverTimestamp
} from 'firebase/firestore';
import AppShell from '../../components/AppShell.jsx';
import StatusText from '../../components/StatusText.jsx';
import LocationPinMap from '../../components/LocationPinMap.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useData } from '../../context/DataContext.jsx';
import { db, OperationType, handleFirestoreError } from '../../firebase/config.js';
import { getTodayDhaka, formatDhakaTime, isWeekendDhaka } from '../../utils/dhakaTime.js';

export default function DistrictSettlementPage() {
  const { profile, offices, activeOfficeId, activeOffice, activeChargeType } = useAuth();
  const { resolveStorageUrl, deleteStoragePathSafe, logAudit } = useData();

  const [loading, setLoading] = useState(true);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [detailSaving, setDetailSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [feedbackMsg, setFeedbackMsg] = useState('');
  const [detailError, setDetailError] = useState('');

  const [filters, setFilters] = useState(() => ({
    officeId: 'all',
    date: getTodayDhaka(),
    initialStatus: 'all',
    unsettledOnly: false
  }));

  const [staffList, setStaffList] = useState([]);
  const [attendanceDocs, setAttendanceDocs] = useState([]);
  const [holidays, setHolidays] = useState([]);
  const [approvedLeaves, setApprovedLeaves] = useState([]);
  const [approvedFieldDuties, setApprovedFieldDuties] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [activeItem, setActiveItem] = useState(null);
  const [detailUrls, setDetailUrls] = useState({ profile: '', checkIn: '', checkOut: '' });
  const [settleForm, setSettleForm] = useState({
    finalStatus: 'On Time',
    comment: '',
    reason: ''
  });

  const myOfficeId = activeOfficeId || profile?.officeId || '';

  useEffect(() => {
    setFilters((f) => ({ ...f, officeId: 'all' }));
    setSelectedIds([]);
    setActiveItem(null);
    setFeedbackMsg('');
    setErrorMsg('');
  }, [myOfficeId]);

  const managedOffices = useMemo(
    () => offices.filter((o) => o.id === myOfficeId || o.parentOfficeId === myOfficeId),
    [offices, myOfficeId]
  );

  const officeName = useCallback(
    (id) => offices.find((o) => o.id === id)?.name || id,
    [offices]
  );

  const loadData = useCallback(async (dateOverride = filters.date) => {
    if (!myOfficeId) return;
    setLoading(true);
    setErrorMsg('');
    setSelectedIds([]);
    try {
      const [uDist, uOwn, aDist, aOwn, hSnap, lDist, lOwn, fDist, fOwn] = await Promise.all([
        getDocs(query(collection(db, 'users'), where('districtOfficeId', '==', myOfficeId))),
        getDocs(query(collection(db, 'users'), where('officeId', '==', myOfficeId))),
        getDocs(query(collection(db, 'attendance'), where('districtOfficeId', '==', myOfficeId), where('date', '==', dateOverride))),
        getDocs(query(collection(db, 'attendance'), where('officeId', '==', myOfficeId), where('date', '==', dateOverride))),
        getDocs(query(collection(db, 'holidays'), where('type', 'in', ['government', 'national', 'optional']))),
        getDocs(query(collection(db, 'leaves'), where('districtOfficeId', '==', myOfficeId), where('status', '==', 'approved'))),
        getDocs(query(collection(db, 'leaves'), where('officeId', '==', myOfficeId), where('status', '==', 'approved'))),
        getDocs(query(collection(db, 'fieldDuties'), where('districtOfficeId', '==', myOfficeId), where('status', '==', 'approved'))),
        getDocs(query(collection(db, 'fieldDuties'), where('officeId', '==', myOfficeId), where('status', '==', 'approved')))
      ]);

      const mergeById = (s1, s2, fallbackUid = false) => {
        const map = new Map();
        for (const d of [...s1.docs, ...s2.docs]) {
          const data = d.data();
          map.set(d.id, fallbackUid ? { uid: d.id, id: d.id, ...data } : { id: d.id, ...data });
        }
        return Array.from(map.values());
      };

      setStaffList(mergeById(uDist, uOwn, true));
      setAttendanceDocs(mergeById(aDist, aOwn));
      setHolidays(hSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setApprovedLeaves(mergeById(lDist, lOwn));
      setApprovedFieldDuties(mergeById(fDist, fOwn));
    } catch (err) {
      setErrorMsg('নিষ্পত্তি ড্যাশবোর্ডের তথ্য লোড করা যায়নি।');
      handleFirestoreError(err, OperationType.LIST, 'district-settlement');
    } finally {
      setLoading(false);
    }
  }, [myOfficeId, filters.date]);

  useEffect(() => {
    loadData(filters.date);
  }, [loadData, filters.date]);

  const combinedItems = useMemo(() => {
    const dateStr = filters.date;
    const items = attendanceDocs.map((rec) => ({
      ...rec,
      key: rec.id,
      isProposedAbsent: false
    }));

    const recordedUids = new Set(attendanceDocs.map((r) => r.uid));
    const isHoliday = holidays.some((h) => h.date === dateStr);
    const isWeekend = isWeekendDhaka(dateStr);

    if (!isHoliday && !isWeekend) {
      for (const emp of staffList) {
        if (emp.approvalStatus !== 'approved') continue;
        if (emp.joiningDate && dateStr < emp.joiningDate) continue;
        if (emp.status === 'resigned' && emp.resignationDate && dateStr > emp.resignationDate) continue;
        if (emp.status === 'resigned' && !emp.resignationDate) continue;
        if (recordedUids.has(emp.uid)) continue;

        const hasLeave = approvedLeaves.some(
          (l) => l.uid === emp.uid && l.startDate <= dateStr && l.endDate >= dateStr
        );
        if (hasLeave) continue;

        const hasField = approvedFieldDuties.some(
          (f) => f.uid === emp.uid && f.startDate <= dateStr && f.endDate >= dateStr
        );
        if (hasField) continue;

        items.push({
          key: `proposed_${emp.uid}_${dateStr}`,
          id: `${emp.uid}_${dateStr}`,
          uid: emp.uid,
          employeeName: emp.name || emp.email || emp.uid,
          designation: emp.designation,
          officeId: emp.officeId,
          districtOfficeId: emp.districtOfficeId || myOfficeId,
          profilePhotoPath: emp.profilePhotoPath || '',
          date: dateStr,
          initialStatus: 'Absent (প্রস্তাবিত)',
          finalStatus: null,
          settled: false,
          photoDeleted: false,
          isProposedAbsent: true
        });
      }
    }

    return items.sort((a, b) => (a.employeeName || '').localeCompare(b.employeeName || ''));
  }, [attendanceDocs, staffList, holidays, approvedLeaves, approvedFieldDuties, filters.date, myOfficeId]);

  const filteredItems = useMemo(() => {
    return combinedItems.filter((item) => {
      if (filters.officeId !== 'all' && item.officeId !== filters.officeId) return false;
      if (filters.initialStatus !== 'all' && item.initialStatus !== filters.initialStatus) return false;
      if (filters.unsettledOnly && item.settled) return false;
      return true;
    });
  }, [combinedItems, filters]);

  const unsettledCount = useMemo(
    () => filteredItems.filter((i) => !i.settled).length,
    [filteredItems]
  );

  const activeItemOffice = useMemo(() => {
    if (!activeItem) return null;
    return offices.find((o) => o.id === activeItem.officeId) || null;
  }, [activeItem, offices]);

  const requiresReason = !!(
    activeItem &&
    activeItem.settled &&
    settleForm.finalStatus !== activeItem.finalStatus
  );

  const toggleSelect = (key) => {
    setSelectedIds((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  };

  const openDetail = async (item) => {
    setActiveItem(item);
    setDetailError('');
    setSettleForm({
      finalStatus:
        item.finalStatus ||
        (item.initialStatus === 'সময়মতো' ? 'On Time' : item.initialStatus === 'বিলম্বিত' ? 'Late' : 'Absent'),
      comment: item.districtComment || '',
      reason: ''
    });
    setDetailUrls({ profile: '', checkIn: '', checkOut: '' });

    const staff = staffList.find((s) => s.uid === item.uid);
    const profilePath = staff?.profilePhotoPath || item.profilePhotoPath || '';

    const [profileUrl, checkInUrl, checkOutUrl] = await Promise.all([
      profilePath ? resolveStorageUrl(profilePath) : Promise.resolve(''),
      !item.photoDeleted && item.checkIn?.photoPath ? resolveStorageUrl(item.checkIn.photoPath) : Promise.resolve(''),
      !item.photoDeleted && item.checkOut?.photoPath ? resolveStorageUrl(item.checkOut.photoPath) : Promise.resolve('')
    ]);
    setDetailUrls({ profile: profileUrl, checkIn: checkInUrl, checkOut: checkOutUrl });
  };

  const settleSingleItem = async (item, finalStatus, comment, reason = '') => {
    const officer = profile;
    const oldStatus = item.finalStatus || item.initialStatus;

    if (!item.isProposedAbsent && !item.photoDeleted) {
      if (item.checkIn?.photoPath) {
        await deleteStoragePathSafe(item.checkIn.photoPath);
      }
      if (item.checkOut?.photoPath) {
        await deleteStoragePathSafe(item.checkOut.photoPath);
      }
    }

    const attendanceRef = doc(db, 'attendance', item.id);
    if (item.isProposedAbsent) {
      await setDoc(attendanceRef, {
        uid: item.uid,
        employeeName: item.employeeName,
        designation: item.designation || '',
        officeId: item.officeId,
        districtOfficeId: item.districtOfficeId || myOfficeId,
        date: item.date,
        isFieldDuty: false,
        checkIn: null,
        checkOut: null,
        initialStatus: 'Absent (প্রস্তাবিত)',
        finalStatus,
        settled: true,
        settledBy: officer.uid,
        settledByName: officer.name,
        settledAt: serverTimestamp(),
        districtComment: comment || null,
        photoDeleted: true,
        photoDeletedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    } else {
      const updatedCheckIn = item.checkIn ? { ...item.checkIn, photoDeleted: true } : null;
      const updatedCheckOut = item.checkOut ? { ...item.checkOut, photoDeleted: true } : null;
      await updateDoc(attendanceRef, {
        finalStatus,
        settled: true,
        settledBy: officer.uid,
        settledByName: officer.name,
        settledAt: serverTimestamp(),
        districtComment: comment || null,
        photoDeleted: true,
        photoDeletedAt: serverTimestamp(),
        checkIn: updatedCheckIn,
        checkOut: updatedCheckOut,
        updatedAt: serverTimestamp()
      });
    }

    await addDoc(collection(db, 'settlements'), {
      attendanceId: item.id,
      employeeUid: item.uid,
      employeeName: item.employeeName,
      officeId: item.officeId,
      districtOfficeId: item.districtOfficeId || myOfficeId,
      date: item.date,
      oldStatus,
      newStatus: finalStatus,
      comment: comment || '',
      reason: reason || (item.settled ? 'Status changed' : 'Initial settlement'),
      settledBy: officer.uid,
      settledByName: officer.name,
      settledAt: serverTimestamp()
    });

    await logAudit({
      actor: officer,
      action: item.settled ? 'SETTLEMENT_UPDATED' : 'ATTENDANCE_SETTLED',
      targetCollection: 'attendance',
      targetId: item.id,
      oldValue: oldStatus,
      newValue: finalStatus,
      reason: reason || comment || 'District settlement',
      officeId: item.officeId,
      districtOfficeId: item.districtOfficeId || myOfficeId
    });
  };

  const saveSettlement = async (e) => {
    e.preventDefault();
    if (!activeItem) return;
    setDetailError('');
    if (requiresReason && !settleForm.reason.trim()) {
      setDetailError('নিষ্পত্তিকৃত স্ট্যাটাস পরিবর্তন করতে কারণ উল্লেখ করা বাধ্যতামূলক।');
      return;
    }
    setDetailSaving(true);
    try {
      await settleSingleItem(
        activeItem,
        settleForm.finalStatus,
        settleForm.comment.trim(),
        settleForm.reason.trim()
      );
      setFeedbackMsg(`${activeItem.employeeName}-এর হাজিরা নিষ্পত্তি সম্পন্ন হয়েছে এবং সেলফি মুছে ফেলা হয়েছে।`);
      setActiveItem(null);
      await loadData(filters.date);
    } catch (err) {
      setDetailError(err.message || 'নিষ্পত্তি সংরক্ষণ করা যায়নি।');
    } finally {
      setDetailSaving(false);
    }
  };

  const bulkSetOnTime = async () => {
    if (!selectedIds.length) return;
    setBulkSaving(true);
    setErrorMsg('');
    setFeedbackMsg('');
    try {
      const targets = filteredItems.filter((i) => selectedIds.includes(i.key));
      for (const item of targets) {
        await settleSingleItem(item, 'On Time', 'Bulk settled as On Time', 'Bulk On Time settlement');
      }
      setFeedbackMsg(`${targets.length}টি রেকর্ড 'On Time' হিসেবে নিষ্পত্তি করা হয়েছে।`);
      await loadData(filters.date);
    } catch (err) {
      setErrorMsg(err.message || 'একসাথে নিষ্পত্তি করতে সমস্যা হয়েছে।');
    } finally {
      setBulkSaving(false);
    }
  };

  return (
    <AppShell>
      <div className="space-y-4">
        <section className="bg-white rounded-2xl border border-slate-200 p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-bold text-slate-900 font-display">Attendance Settlement (নিষ্পত্তি)</h2>
                {activeOffice && (
                  <span
                    className={`text-[11px] font-semibold px-2 py-0.5 rounded-lg ${
                      activeChargeType === 'additional'
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-emerald-100 text-emerald-800'
                    }`}
                  >
                    {activeChargeType === 'additional' ? 'অতিরিক্ত দায়িত্ব' : 'মূল দায়িত্ব'} · {activeOffice.name}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Unsettled in view: <span className="font-bold text-rose-700 tabular-nums">{unsettledCount}</span>
                <span aria-hidden="true"> · </span>
                Total listed: <span className="font-semibold text-slate-700 tabular-nums">{filteredItems.length}</span>
              </p>
            </div>

            {selectedIds.length > 0 && (
              <button
                type="button"
                disabled={bulkSaving}
                onClick={bulkSetOnTime}
                className="min-h-[44px] px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold disabled:opacity-60"
              >
                {bulkSaving ? 'সংরক্ষণ হচ্ছে...' : `Set ${selectedIds.length} as On Time`}
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">Office</label>
              <select
                value={filters.officeId}
                onChange={(e) => setFilters((f) => ({ ...f, officeId: e.target.value }))}
                className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 text-xs bg-white"
              >
                <option value="all">All District &amp; Upazila Offices</option>
                {managedOffices.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">Date (Asia/Dhaka)</label>
              <input
                value={filters.date}
                onChange={(e) => setFilters((f) => ({ ...f, date: e.target.value }))}
                type="date"
                className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 text-xs font-mono-tabular bg-white"
              />
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">Initial Status</label>
              <select
                value={filters.initialStatus}
                onChange={(e) => setFilters((f) => ({ ...f, initialStatus: e.target.value }))}
                className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 text-xs bg-white"
              >
                <option value="all">All Statuses</option>
                <option value="সময়মতো">সময়মতো</option>
                <option value="বিলম্বিত">বিলম্বিত</option>
                <option value="Absent (প্রস্তাবিত)">Absent (প্রস্তাবিত)</option>
              </select>
            </div>

            <div className="flex items-end">
              <label className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
                <input
                  checked={filters.unsettledOnly}
                  onChange={(e) => setFilters((f) => ({ ...f, unsettledOnly: e.target.checked }))}
                  type="checkbox"
                  className="w-4 h-4 accent-emerald-700"
                />
                <span>Unsettled only</span>
              </label>
            </div>
          </div>
        </section>

        {feedbackMsg && (
          <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800">
            {feedbackMsg}
          </div>
        )}
        {errorMsg && (
          <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800">{errorMsg}</div>
        )}

        {loading ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-sm text-slate-600">
            লোড হচ্ছে...
          </div>
        ) : !filteredItems.length ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-sm text-slate-500">
            নির্বাচিত ফিল্টারে কোনো রেকর্ড বা প্রস্তাবিত অনুপস্থিতি পাওয়া যায়নি।
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100">
            {filteredItems.map((item) => (
              <div key={item.key} className="p-4 flex items-center gap-3 hover:bg-slate-50/70 transition-colors">
                <input
                  type="checkbox"
                  checked={selectedIds.includes(item.key)}
                  onChange={() => toggleSelect(item.key)}
                  className="w-5 h-5 accent-emerald-700 shrink-0"
                  aria-label={`Select ${item.employeeName}`}
                />

                <button
                  type="button"
                  onClick={() => openDetail(item)}
                  className="flex-1 min-w-0 text-left flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-900 truncate">{item.employeeName}</div>
                    <div className="text-xs text-slate-500 truncate">
                      {officeName(item.officeId)} · {item.designation || 'Staff'}
                    </div>
                    <div className="text-[11px] font-mono-tabular text-slate-500 mt-0.5">
                      {!item.isProposedAbsent ? (
                        <>
                          In: {item.checkIn ? formatDhakaTime(item.checkIn.time) : '—'} · Out:{' '}
                          {item.checkOut ? formatDhakaTime(item.checkOut.time) : '—'}
                          {item.photoDeleted && <span> · ছবি মুছে গেছে</span>}
                        </>
                      ) : (
                        <>No check-in recorded on {item.date}</>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col sm:items-end gap-0.5 shrink-0">
                    <StatusText status={item.finalStatus || item.initialStatus} />
                    <span className="text-[11px] text-slate-400">{item.settled ? 'Settled' : 'Unsettled'}</span>
                  </div>
                </button>
              </div>
            ))}
          </div>
        )}

        {activeItem && (
          <div
            className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4"
            onClick={(e) => {
              if (e.target === e.currentTarget) setActiveItem(null);
            }}
          >
            <div className="w-full sm:max-w-2xl max-h-[92vh] overflow-y-auto bg-white rounded-t-3xl sm:rounded-2xl p-5 sm:p-6 space-y-5 shadow-xl">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-bold text-slate-900 font-display">{activeItem.employeeName}</h3>
                  <p className="text-xs text-slate-500">
                    {officeName(activeItem.officeId)} · {activeItem.date}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveItem(null)}
                  className="min-h-[44px] px-3 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100"
                >
                  Close
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="bg-slate-50 rounded-xl p-3 space-y-2">
                  <div className="text-xs font-semibold text-slate-700">Permanent Profile Photo</div>
                  <div className="aspect-square rounded-lg bg-slate-200 overflow-hidden flex items-center justify-center">
                    {detailUrls.profile ? (
                      <img
                        src={detailUrls.profile}
                        alt="Employee permanent profile photo"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <span className="text-xs text-slate-500 px-2 text-center">No profile photo</span>
                    )}
                  </div>
                </div>

                <div className="bg-slate-50 rounded-xl p-3 space-y-2">
                  <div className="text-xs font-semibold text-slate-700">Check-In Selfie</div>
                  <div className="aspect-square rounded-lg bg-slate-200 overflow-hidden flex items-center justify-center">
                    {activeItem.photoDeleted ? (
                      <span className="text-xs font-semibold text-rose-700 px-2 text-center">ছবি মুছে গেছে</span>
                    ) : detailUrls.checkIn ? (
                      <img
                        src={detailUrls.checkIn}
                        alt="Attendance check-in selfie"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <span className="text-xs text-slate-500 px-2 text-center">
                        {activeItem.isProposedAbsent ? 'No check-in' : 'ছবি মুছে গেছে'}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {!activeItem.isProposedAbsent && detailUrls.checkOut && !activeItem.photoDeleted && (
                <div className="bg-slate-50 rounded-xl p-3 space-y-2">
                  <div className="text-xs font-semibold text-slate-700">Check-Out Selfie</div>
                  <img
                    src={detailUrls.checkOut}
                    alt="Attendance check-out selfie"
                    className="w-40 h-40 rounded-lg object-cover"
                  />
                </div>
              )}

              {!activeItem.isProposedAbsent && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div className="p-3 rounded-xl bg-slate-50">
                      <div className="text-slate-500">Check-In Time &amp; Accuracy</div>
                      <div className="font-mono-tabular font-semibold text-slate-900 mt-1">
                        {activeItem.checkIn ? formatDhakaTime(activeItem.checkIn.time) : '—'}
                        {activeItem.checkIn && <span> · ±{activeItem.checkIn.accuracy}m</span>}
                      </div>
                    </div>
                    <div className="p-3 rounded-xl bg-slate-50">
                      <div className="text-slate-500">Check-Out Time &amp; Accuracy</div>
                      <div className="font-mono-tabular font-semibold text-slate-900 mt-1">
                        {activeItem.checkOut ? formatDhakaTime(activeItem.checkOut.time) : '—'}
                        {activeItem.checkOut && <span> · ±{activeItem.checkOut.accuracy}m</span>}
                      </div>
                    </div>
                  </div>

                  {activeItemOffice && (
                    <LocationPinMap
                      officeLat={activeItemOffice.lat}
                      officeLng={activeItemOffice.lng}
                      radiusMeters={activeItemOffice.geofenceRadiusMeters || 100}
                      checkInLat={activeItem.checkIn?.lat ?? null}
                      checkInLng={activeItem.checkIn?.lng ?? null}
                      checkOutLat={activeItem.checkOut?.lat ?? null}
                      checkOutLng={activeItem.checkOut?.lng ?? null}
                    />
                  )}
                </div>
              )}

              <form onSubmit={saveSettlement} className="space-y-4 pt-2 border-t border-slate-100">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Final Status</label>
                    <select
                      value={settleForm.finalStatus}
                      onChange={(e) => setSettleForm((s) => ({ ...s, finalStatus: e.target.value }))}
                      required
                      className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 text-sm bg-white"
                    >
                      <option value="On Time">On Time</option>
                      <option value="Late">Late</option>
                      <option value="Leave">Leave</option>
                      <option value="Absent">Absent</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">District Comment</label>
                    <input
                      value={settleForm.comment}
                      onChange={(e) => setSettleForm((s) => ({ ...s, comment: e.target.value }))}
                      type="text"
                      placeholder="Optional note for employee..."
                      className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 text-sm"
                    />
                  </div>
                </div>

                {requiresReason && (
                  <div>
                    <label className="block text-xs font-semibold text-rose-700 mb-1">
                      Reason for Changing Settled Status (Required)
                    </label>
                    <input
                      value={settleForm.reason}
                      onChange={(e) => setSettleForm((s) => ({ ...s, reason: e.target.value }))}
                      type="text"
                      required
                      minLength={3}
                      placeholder="Explain why the settled status is being changed..."
                      className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-rose-300 text-sm"
                    />
                  </div>
                )}

                {detailError && (
                  <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800">
                    {detailError}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={detailSaving}
                  className="w-full min-h-[48px] px-5 py-3 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold disabled:opacity-60"
                >
                  {detailSaving ? 'সংরক্ষণ হচ্ছে...' : 'Save Settlement & Delete Selfie'}
                </button>
              </form>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
