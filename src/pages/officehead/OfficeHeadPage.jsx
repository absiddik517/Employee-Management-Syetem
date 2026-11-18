import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { collection, query, where, getDocs, doc, updateDoc, addDoc, serverTimestamp } from 'firebase/firestore';
import { Camera, Users, X } from 'lucide-react';
import AppShell from '../../components/AppShell.jsx';
import StatusText from '../../components/StatusText.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useData } from '../../context/DataContext.jsx';
import { db, OperationType, handleFirestoreError } from '../../firebase/config.js';
import { getTodayDhaka, getCurrentMonthDhaka, formatDhakaTime } from '../../utils/dhakaTime.js';
import { downloadReportCsv } from '../../utils/csv.js';
import { getApproverHint, getRoleLabel } from '../../lib/permissions.js';

export default function OfficeHeadPage() {
  const {
    profile,
    userOffice,
    activeOfficeId,
    activeOffice,
    activeChargeType,
    can,
    canReview
  } = useAuth();
  const { resolveStorageUrl, logAudit } = useData();

  const myOfficeId = activeOfficeId || profile?.officeId || '';
  const currentOffice = activeOffice || userOffice;

  const [tab, setTab] = useState('attendance');
  const [selectedDate, setSelectedDate] = useState(() => getTodayDhaka());
  const [selectedMonth, setSelectedMonth] = useState(() => getCurrentMonthDhaka());

  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState([]);
  const [staffList, setStaffList] = useState([]);
  const [leaves, setLeaves] = useState([]);
  const [submittedReports, setSubmittedReports] = useState([]);

  const [comments, setComments] = useState({});
  const [reviewingId, setReviewingId] = useState('');
  const [generatingReport, setGeneratingReport] = useState(false);
  const [submittingReport, setSubmittingReport] = useState(false);
  const [previewReport, setPreviewReport] = useState(null);

  const [photoModal, setPhotoModal] = useState(null);
  const [loadingPhotos, setLoadingPhotos] = useState(false);

  const [feedbackMsg, setFeedbackMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const canViewAttendance = can('attendance.view');
  const canViewLeaves = can('leave.review');
  const canCreateReports = can('report.create');
  const canViewReports = can('report.view');
  const canViewUsers = can('user.view');

  const staffByUid = useMemo(() => {
    const map = new Map();
    for (const s of staffList) {
      map.set(s.uid, s);
    }
    return map;
  }, [staffList]);

  useEffect(() => {
    setPreviewReport(null);
    setComments({});
    setFeedbackMsg('');
    setErrorMsg('');
  }, [myOfficeId]);

  const loadOfficeData = useCallback(
    async (dateStr = selectedDate) => {
      if (!myOfficeId) return;
      setLoading(true);
      setErrorMsg('');
      try {
        const tasks = [];

        if (canViewAttendance) {
          tasks.push(
            getDocs(
              query(
                collection(db, 'attendance'),
                where('officeId', '==', myOfficeId),
                where('date', '==', dateStr)
              )
            ).then((snap) => {
              setRecords(
                snap.docs
                  .map((d) => ({ id: d.id, ...d.data() }))
                  .sort((a, b) => (a.employeeName || '').localeCompare(b.employeeName || ''))
              );
            })
          );
        }

        if (canViewUsers) {
          tasks.push(
            getDocs(query(collection(db, 'users'), where('officeId', '==', myOfficeId))).then((snap) => {
              setStaffList(
                snap.docs
                  .map((d) => ({ uid: d.id, id: d.id, ...d.data() }))
                  .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
              );
            })
          );
        }

        if (canViewLeaves) {
          tasks.push(
            getDocs(query(collection(db, 'leaves'), where('officeId', '==', myOfficeId))).then((snap) => {
              const list = snap.docs
                .map((d) => ({ id: d.id, ...d.data() }))
                .sort((a, b) => {
                  if (a.status === 'pending' && b.status !== 'pending') return -1;
                  if (xNotPending(a, b)) return 1;
                  return (b.startDate || '').localeCompare(a.startDate || '');
                });
              setLeaves(list);
            })
          );
        }

        if (canViewReports) {
          tasks.push(
            getDocs(query(collection(db, 'reports'), where('officeId', '==', myOfficeId))).then((snap) => {
              setSubmittedReports(
                snap.docs
                  .map((d) => ({ id: d.id, ...d.data() }))
                  .sort((a, b) => (b.month || '').localeCompare(a.month || ''))
              );
            })
          );
        }

        await Promise.all(tasks);
      } catch (err) {
        setErrorMsg('অফিসের তথ্য লোড করা যায়নি।');
        handleFirestoreError(err, OperationType.LIST, 'office-portal');
      } finally {
        setLoading(false);
      }
    },
    [myOfficeId, selectedDate, canViewAttendance, canViewUsers, canViewLeaves, canViewReports]
  );

  useEffect(() => {
    loadOfficeData(selectedDate);
  }, [loadOfficeData, selectedDate]);

  const pendingReviewableLeaveCount = useMemo(
    () =>
      leaves.filter((item) => {
        if (item.status !== 'pending') return false;
        const staff = staffByUid.get(item.uid);
        return canReview(
          {
            uid: item.uid,
            officeId: item.officeId,
            districtOfficeId: item.districtOfficeId,
            role: staff?.role || null
          },
          'leave'
        );
      }).length,
    [leaves, staffByUid, canReview]
  );

  const openPhotoModal = async (rec) => {
    if (!can('attendance.photo.view', rec)) return;
    setLoadingPhotos(true);
    setPhotoModal({
      employeeName: rec.employeeName,
      date: rec.date,
      checkInUrl: '',
      checkOutUrl: ''
    });
    try {
      const [checkInUrl, checkOutUrl] = await Promise.all([
        !rec.photoDeleted && rec.checkIn?.photoPath ? resolveStorageUrl(rec.checkIn.photoPath) : Promise.resolve(''),
        !rec.photoDeleted && rec.checkOut?.photoPath ? resolveStorageUrl(rec.checkOut.photoPath) : Promise.resolve('')
      ]);
      setPhotoModal({
        employeeName: rec.employeeName,
        date: rec.date,
        checkInUrl,
        checkOutUrl
      });
    } finally {
      setLoadingPhotos(false);
    }
  };

  const reviewLeave = async (item, decision) => {
    const staff = staffByUid.get(item.uid);
    const applicantObj = {
      uid: item.uid,
      officeId: item.officeId,
      districtOfficeId: item.districtOfficeId,
      role: staff?.role || null
    };
    if (!canReview(applicantObj, 'leave')) return;

    setReviewingId(item.id);
    setErrorMsg('');
    setFeedbackMsg('');
    const comment = (comments[item.id] || '').trim();
    try {
      await updateDoc(doc(db, 'leaves', item.id), {
        status: decision,
        reviewedBy: profile.uid,
        reviewedByName: profile.name,
        reviewComment: comment,
        reviewedAt: serverTimestamp()
      });
      await logAudit({
        actor: profile,
        action: `LEAVES_${decision.toUpperCase()}`,
        targetCollection: 'leaves',
        targetId: item.id,
        oldValue: 'pending',
        newValue: decision,
        reason: comment || decision,
        officeId: item.officeId,
        districtOfficeId: item.districtOfficeId || currentOffice?.parentOfficeId || ''
      });
      setFeedbackMsg(`${item.employeeName}-এর ছুটির আবেদন ${decision} করা হয়েছে।`);
      await loadOfficeData(selectedDate);
    } catch (err) {
      setErrorMsg('সিদ্ধান্ত সংরক্ষণ করা যায়নি।');
      handleFirestoreError(err, OperationType.UPDATE, `leaves/${item.id}`);
    } finally {
      setReviewingId('');
    }
  };

  const generateMonthlyReport = async () => {
    if (!canCreateReports || !myOfficeId) return;
    setGeneratingReport(true);
    setErrorMsg('');
    setFeedbackMsg('');
    try {
      const [uSnap, aSnap] = await Promise.all([
        getDocs(query(collection(db, 'users'), where('officeId', '==', myOfficeId))),
        getDocs(
          query(
            collection(db, 'attendance'),
            where('officeId', '==', myOfficeId),
            where('settled', '==', true)
          )
        )
      ]);

      const employees = uSnap.docs
        .map((d) => ({ uid: d.id, id: d.id, ...d.data() }))
        .filter((u) => u.approvalStatus === 'approved');
      const settledRecords = aSnap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((r) => r.date && r.date.startsWith(selectedMonth));

      const rowsMap = new Map();
      for (const emp of employees) {
        const empUid = emp.uid || emp.id;
        rowsMap.set(empUid, {
          uid: empUid,
          name: emp.name || emp.email || empUid,
          designation: emp.designation || '',
          onTime: 0,
          late: 0,
          leave: 0,
          absent: 0
        });
      }

      const summary = { totalEmployees: employees.length, onTime: 0, late: 0, leave: 0, absent: 0 };

      for (const rec of settledRecords) {
        if (!rowsMap.has(rec.uid)) {
          rowsMap.set(rec.uid, {
            uid: rec.uid,
            name: rec.employeeName,
            designation: rec.designation || '',
            onTime: 0,
            late: 0,
            leave: 0,
            absent: 0
          });
        }
        const row = rowsMap.get(rec.uid);
        if (rec.finalStatus === 'On Time') {
          row.onTime++;
          summary.onTime++;
        } else if (rec.finalStatus === 'Late') {
          row.late++;
          summary.late++;
        } else if (rec.finalStatus === 'Leave') {
          row.leave++;
          summary.leave++;
        } else if (rec.finalStatus === 'Absent') {
          row.absent++;
          summary.absent++;
        }
      }

      setPreviewReport({
        officeId: myOfficeId,
        officeName: currentOffice?.name || myOfficeId,
        districtOfficeId: currentOffice?.parentOfficeId || '',
        month: selectedMonth,
        summary,
        rows: Array.from(rowsMap.values()).sort((a, b) => (a.name || '').localeCompare(b.name || ''))
      });
    } catch (err) {
      setErrorMsg('মাসিক প্রতিবেদন তৈরি করা যায়নি।');
      handleFirestoreError(err, OperationType.LIST, 'office-reports-generate');
    } finally {
      setGeneratingReport(false);
    }
  };

  const submitMonthlyReport = async () => {
    if (!previewReport || !canCreateReports) return;
    setSubmittingReport(true);
    setErrorMsg('');
    setFeedbackMsg('');
    try {
      const refDoc = await addDoc(collection(db, 'reports'), {
        officeId: previewReport.officeId,
        officeName: previewReport.officeName,
        districtOfficeId: previewReport.districtOfficeId || '',
        month: previewReport.month,
        generatedBy: profile.uid,
        generatedByName: profile.name,
        submittedAt: serverTimestamp(),
        summary: previewReport.summary,
        rows: previewReport.rows
      });

      await logAudit({
        actor: profile,
        action: 'REPORT_SUBMITTED_TO_HEAD_OFFICE',
        targetCollection: 'reports',
        targetId: refDoc.id,
        oldValue: '',
        newValue: `${previewReport.officeName} (${previewReport.month})`,
        reason: 'Upazila office monthly report submitted',
        officeId: previewReport.officeId,
        districtOfficeId: previewReport.districtOfficeId || ''
      });

      setFeedbackMsg('অফিসের মাসিক প্রতিবেদন সফলভাবে জমা দেওয়া হয়েছে।');
      await loadOfficeData(selectedDate);
    } catch (err) {
      setErrorMsg('প্রতিবেদন জমা দেওয়া যায়নি।');
      handleFirestoreError(err, OperationType.CREATE, 'reports');
    } finally {
      setSubmittingReport(false);
    }
  };

  return (
    <AppShell showThemeToggle>
      <div className="space-y-4">
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 font-display">
                {currentOffice?.name || 'Upazila Office'}
              </h2>
              {activeChargeType && (
                <span
                  className={`text-[11px] font-semibold px-2 py-0.5 rounded-lg ${
                    activeChargeType === 'additional'
                      ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
                      : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
                  }`}
                >
                  {activeChargeType === 'additional' ? 'অতিরিক্ত দায়িত্ব' : 'মূল দায়িত্ব'}
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              কার্যালয়ের দৈনিক হাজিরা, অধীনস্থ কর্মচারীদের ছুটি অনুমোদন এবং মাসিক প্রতিবেদন।
            </p>
          </div>

          {canViewUsers && (
            <Link
              to="/admin/users"
              className="min-h-[44px] px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 inline-flex items-center gap-2 shrink-0"
            >
              <Users className="w-4 h-4 text-[#0b6b4f] dark:text-[#4fd1a1]" />
              <span>Staff &amp; Devices</span>
            </Link>
          )}
        </div>

        <div className="grid grid-cols-3 gap-1 p-1 bg-slate-200/70 dark:bg-slate-800 rounded-xl">
          <button
            type="button"
            onClick={() => setTab('attendance')}
            className={`min-h-[44px] rounded-lg text-xs sm:text-sm font-semibold transition-colors ${
              tab === 'attendance'
                ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                : 'text-slate-600 dark:text-slate-300'
            }`}
          >
            Attendance ({records.length})
          </button>
          {canViewLeaves && (
            <button
              type="button"
              onClick={() => setTab('leaves')}
              className={`min-h-[44px] rounded-lg text-xs sm:text-sm font-semibold transition-colors ${
                tab === 'leaves'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              Leaves ({pendingReviewableLeaveCount})
            </button>
          )}
          {(canCreateReports || canViewReports) && (
            <button
              type="button"
              onClick={() => setTab('reports')}
              className={`min-h-[44px] rounded-lg text-xs sm:text-sm font-semibold transition-colors ${
                tab === 'reports'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              Reports ({submittedReports.length})
            </button>
          )}
        </div>

        {feedbackMsg && (
          <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-800 dark:text-emerald-200">
            {feedbackMsg}
          </div>
        )}
        {errorMsg && (
          <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-xs text-rose-800 dark:text-rose-200">
            {errorMsg}
          </div>
        )}

        {tab === 'attendance' && (
          <div className="space-y-4">
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 font-display">
                  Daily Attendance (Read-Only)
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  হাজিরা নিষ্পত্তির ক্ষমতা শুধুমাত্র জেলা সহকারী পরিচালকের।
                </p>
              </div>
              <input
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                type="date"
                className="min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-base sm:text-sm font-mono-tabular bg-white dark:bg-slate-950"
              />
            </div>

            {loading ? (
              <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-8 text-center text-sm text-slate-600 dark:text-slate-300">
                লোড হচ্ছে...
              </div>
            ) : !records.length ? (
              <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-8 text-center text-sm text-slate-500 dark:text-slate-400">
                নির্বাচিত তারিখে কোনো হাজিরা রেকর্ড নেই।
              </div>
            ) : (
              <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800">
                {records.map((rec) => {
                  const canViewPhoto =
                    can('attendance.photo.view', rec) &&
                    !rec.photoDeleted &&
                    Boolean(rec.checkIn?.photoPath || rec.checkOut?.photoPath);
                  return (
                    <div
                      key={rec.id}
                      className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                    >
                      <div>
                        <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                          {rec.employeeName}
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">
                          {rec.designation || 'Staff'} · In {rec.checkIn ? formatDhakaTime(rec.checkIn.time) : '—'} ·
                          Out {rec.checkOut ? formatDhakaTime(rec.checkOut.time) : '—'}
                        </div>
                        {rec.districtComment && (
                          <div className="text-xs text-slate-600 dark:text-slate-300 mt-1">
                            Note: {rec.districtComment}
                          </div>
                        )}
                      </div>

                      <div className="flex items-center justify-between sm:justify-end gap-3">
                        {canViewPhoto && (
                          <button
                            type="button"
                            onClick={() => openPhotoModal(rec)}
                            className="min-h-[44px] px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 inline-flex items-center gap-1.5"
                          >
                            <Camera className="w-4 h-4 text-[#0b6b4f] dark:text-[#4fd1a1]" />
                            <span>সেলফি দেখুন</span>
                          </button>
                        )}
                        <div className="flex flex-col items-end gap-0.5">
                          <StatusText status={rec.finalStatus || rec.initialStatus} />
                          <span className="text-[11px] text-slate-400 dark:text-slate-500">
                            {rec.settled ? 'Settled by District Office' : 'Awaiting Settlement'}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {tab === 'leaves' && canViewLeaves && (
          <div className="space-y-3">
            {loading ? (
              <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-8 text-center text-sm text-slate-600 dark:text-slate-300">
                লোড হচ্ছে...
              </div>
            ) : !leaves.length ? (
              <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-8 text-center text-sm text-slate-500 dark:text-slate-400">
                এই কার্যালয়ের কোনো ছুটির আবেদন পাওয়া যায়নি।
              </div>
            ) : (
              leaves.map((item) => {
                const staff = staffByUid.get(item.uid);
                const applicantRole = staff?.role || null;
                const canReviewThis = canReview(
                  {
                    uid: item.uid,
                    officeId: item.officeId,
                    districtOfficeId: item.districtOfficeId,
                    role: applicantRole
                  },
                  'leave'
                );

                return (
                  <div
                    key={item.id}
                    className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 space-y-3"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-bold text-slate-900 dark:text-slate-100">
                            {item.employeeName}
                          </span>
                          {applicantRole && (
                            <span className="text-[11px] font-medium px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                              {getRoleLabel(applicantRole)}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400 font-mono-tabular mt-0.5">
                          {item.startDate} to {item.endDate}
                        </div>
                        <div className="text-xs text-slate-700 dark:text-slate-300 mt-1">
                          <span className="font-semibold">{item.leaveType}:</span> {item.reason}
                        </div>
                      </div>
                      <StatusText status={item.status} />
                    </div>

                    {item.status === 'pending' ? (
                      canReviewThis ? (
                        <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                          <input
                            value={comments[item.id] || ''}
                            onChange={(e) => setComments((c) => ({ ...c, [item.id]: e.target.value }))}
                            type="text"
                            placeholder="Optional review comment..."
                            className="flex-1 min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 text-base sm:text-xs"
                          />
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              disabled={reviewingId === item.id}
                              onClick={() => reviewLeave(item, 'approved')}
                              className="flex-1 sm:flex-none min-h-[44px] px-4 py-2 rounded-xl bg-[#0b6b4f] hover:bg-[#09553f] text-white text-xs font-semibold disabled:opacity-60"
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              disabled={reviewingId === item.id}
                              onClick={() => reviewLeave(item, 'rejected')}
                              className="flex-1 sm:flex-none min-h-[44px] px-4 py-2 rounded-xl bg-rose-700 hover:bg-rose-800 text-white text-xs font-semibold disabled:opacity-60"
                            >
                              Reject
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="pt-2 border-t border-slate-100 dark:border-slate-800 text-xs text-amber-700 dark:text-amber-300">
                          অনুমোদনকারী কর্তৃপক্ষ:{' '}
                          <strong>{getApproverHint(applicantRole || profile?.role, 'leave')}</strong>
                        </div>
                      )
                    ) : (
                      item.reviewComment && (
                        <div className="text-xs text-slate-500 dark:text-slate-400">
                          Comment: {item.reviewComment} {item.reviewedByName ? `(${item.reviewedByName})` : ''}
                        </div>
                      )
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}

        {tab === 'reports' && (canCreateReports || canViewReports) && (
          <div className="space-y-4">
            {canCreateReports && (
              <section className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 font-display">
                  Monthly Office Report Generator
                </h3>
                <div className="flex flex-col sm:flex-row gap-3">
                  <input
                    value={selectedMonth}
                    onChange={(e) => setSelectedMonth(e.target.value)}
                    type="month"
                    className="min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-base sm:text-xs font-mono-tabular bg-white dark:bg-slate-950"
                  />
                  <button
                    type="button"
                    disabled={generatingReport}
                    onClick={generateMonthlyReport}
                    className="min-h-[44px] px-5 py-2 rounded-xl bg-slate-900 dark:bg-slate-100 dark:text-slate-900 hover:bg-slate-800 text-white text-xs font-semibold disabled:opacity-60"
                  >
                    {generatingReport ? 'প্রস্তুত হচ্ছে...' : 'Generate From Settled Data'}
                  </button>
                </div>
              </section>
            )}

            {previewReport && (
              <section className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                      {previewReport.officeName} · {previewReport.month}
                    </h4>
                    <p className="text-xs text-slate-500 dark:text-slate-400 tabular-nums mt-0.5">
                      On Time: {previewReport.summary.onTime} · Late: {previewReport.summary.late} · Leave:{' '}
                      {previewReport.summary.leave} · Absent: {previewReport.summary.absent}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => downloadReportCsv(previewReport)}
                      className="min-h-[44px] px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200"
                    >
                      Export CSV
                    </button>
                    <button
                      type="button"
                      disabled={submittingReport}
                      onClick={submitMonthlyReport}
                      className="min-h-[44px] px-4 py-2 rounded-xl bg-[#0b6b4f] hover:bg-[#09553f] text-white text-xs font-semibold disabled:opacity-60"
                    >
                      {submittingReport ? 'পাঠানো হচ্ছে...' : 'Submit Report'}
                    </button>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                        <th className="py-2 pr-3 font-semibold">Employee</th>
                        <th className="py-2 px-2 text-right font-semibold">On Time</th>
                        <th className="py-2 px-2 text-right font-semibold">Late</th>
                        <th className="py-2 px-2 text-right font-semibold">Leave</th>
                        <th className="py-2 pl-2 text-right font-semibold">Absent</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800 tabular-nums">
                      {previewReport.rows.map((row) => (
                        <tr key={row.uid}>
                          <td className="py-2 pr-3 font-medium text-slate-900 dark:text-slate-100">
                            {row.name} ({row.designation})
                          </td>
                          <td className="py-2 px-2 text-right font-mono-tabular text-emerald-700 dark:text-emerald-400">
                            {row.onTime}
                          </td>
                          <td className="py-2 px-2 text-right font-mono-tabular text-amber-700 dark:text-amber-400">
                            {row.late}
                          </td>
                          <td className="py-2 px-2 text-right font-mono-tabular text-sky-700 dark:text-sky-400">
                            {row.leave}
                          </td>
                          <td className="py-2 pl-2 text-right font-mono-tabular text-rose-700 dark:text-rose-400">
                            {row.absent}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            <section className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800">
              <div className="p-4">
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 font-display">
                  Submitted Reports
                </h3>
              </div>
              {!submittedReports.length ? (
                <div className="p-6 text-center text-xs text-slate-500 dark:text-slate-400">
                  এখনো কোনো মাসিক প্রতিবেদন জমা দেওয়া হয়নি।
                </div>
              ) : (
                submittedReports.map((rep) => (
                  <div key={rep.id} className="p-4 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                        {rep.officeName} · {rep.month}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                        On Time {rep.summary?.onTime || 0} · Late {rep.summary?.late || 0} · Leave{' '}
                        {rep.summary?.leave || 0} · Absent {rep.summary?.absent || 0}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => downloadReportCsv(rep)}
                      className="min-h-[44px] px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200"
                    >
                      CSV
                    </button>
                  </div>
                ))
              )}
            </section>
          </div>
        )}

        {photoModal && (
          <div
            className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4"
            onClick={(e) => {
              if (e.target === e.currentTarget) setPhotoModal(null);
            }}
          >
            <div className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4 shadow-xl">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">{photoModal.employeeName}</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 font-mono-tabular">{photoModal.date}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setPhotoModal(null)}
                  className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800"
                  aria-label="Close"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              {loadingPhotos ? (
                <div className="py-10 text-center text-xs text-slate-500">ছবি লোড হচ্ছে...</div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="bg-slate-50 dark:bg-slate-800/70 rounded-xl p-3 space-y-2">
                    <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">Check-In Selfie</div>
                    <div className="aspect-square rounded-lg bg-slate-200 dark:bg-slate-800 overflow-hidden flex items-center justify-center">
                      {photoModal.checkInUrl ? (
                        <img src={photoModal.checkInUrl} alt="Check-in selfie" className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-xs text-slate-500">ছবি নেই</span>
                      )}
                    </div>
                  </div>
                  <div className="bg-slate-50 dark:bg-slate-800/70 rounded-xl p-3 space-y-2">
                    <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">Check-Out Selfie</div>
                    <div className="aspect-square rounded-lg bg-slate-200 dark:bg-slate-800 overflow-hidden flex items-center justify-center">
                      {photoModal.checkOutUrl ? (
                        <img src={photoModal.checkOutUrl} alt="Check-out selfie" className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-xs text-slate-500">ছবি নেই</span>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

function xNotPending(a, b) {
  return a.status !== 'pending' && b.status === 'pending';
}
