import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { collection, getDocs, query, where, doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { History, Users } from 'lucide-react';
import AppShell from '../../components/AppShell.jsx';
import StatusText from '../../components/StatusText.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useData } from '../../context/DataContext.jsx';
import { db, OperationType, handleFirestoreError } from '../../firebase/config.js';
import { formatDhakaDateTime, formatDhakaTime, getTodayDhaka } from '../../utils/dhakaTime.js';
import { downloadReportCsv } from '../../utils/csv.js';
import { getRoleLabel } from '../../lib/permissions.js';

export default function HeadOfficeReportsPage() {
  const { profile, offices, can, canReview, roleLabel } = useAuth();
  const { logAudit } = useData();

  const canViewReports = can('report.view');
  const canViewAttendance = can('attendance.view');
  const canReviewLeaves = can('leave.review');
  const canViewUsers = can('user.view');
  const canViewAudit = can('audit.view');

  const [tab, setTab] = useState('reports');
  const [loading, setLoading] = useState(true);
  const [reports, setReports] = useState([]);
  const [filterMonth, setFilterMonth] = useState('');
  const [expandedId, setExpandedId] = useState(null);

  const [selectedDate, setSelectedDate] = useState(() => getTodayDhaka());
  const [filterOfficeId, setFilterOfficeId] = useState('all');
  const [attendanceRecords, setAttendanceRecords] = useState([]);

  const [usersByUid, setUsersByUid] = useState(() => new Map());
  const [allLeaves, setAllLeaves] = useState([]);
  const [comments, setComments] = useState({});
  const [reviewingId, setReviewingId] = useState('');

  const [feedbackMsg, setFeedbackMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const officeName = useCallback(
    (id) => offices.find((o) => o.id === id)?.name || id,
    [offices]
  );

  const loadOversightData = useCallback(async () => {
    setLoading(true);
    setErrorMsg('');
    try {
      const tasks = [];

      if (canViewReports) {
        tasks.push(
          getDocs(collection(db, 'reports')).then((snap) => {
            setReports(
              snap.docs
                .map((d) => ({ id: d.id, ...d.data() }))
                .sort((a, b) => (b.month || '').localeCompare(a.month || ''))
            );
          })
        );
      }

      if (canViewAttendance) {
        tasks.push(
          getDocs(query(collection(db, 'attendance'), where('date', '==', selectedDate))).then((snap) => {
            setAttendanceRecords(
              snap.docs
                .map((d) => ({ id: d.id, ...d.data() }))
                .sort((a, b) => (a.employeeName || '').localeCompare(b.employeeName || ''))
            );
          })
        );
      }

      if (canReviewLeaves) {
        tasks.push(
          Promise.all([getDocs(collection(db, 'users')), getDocs(collection(db, 'leaves'))]).then(([uSnap, lSnap]) => {
            const uMap = new Map();
            for (const d of uSnap.docs) {
              uMap.set(d.id, { uid: d.id, id: d.id, ...d.data() });
            }
            setUsersByUid(uMap);
            setAllLeaves(
              lSnap.docs
                .map((d) => ({ id: d.id, ...d.data() }))
                .sort((a, b) => {
                  if (a.status === 'pending' && b.status !== 'pending') return -1;
                  if (a.status !== 'pending' && b.status === 'pending') return 1;
                  return (b.startDate || '').localeCompare(a.startDate || '');
                })
            );
          })
        );
      }

      await Promise.all(tasks);
    } catch (err) {
      setErrorMsg('তথ্য লোড করা যায়নি।');
      handleFirestoreError(err, OperationType.LIST, 'head-office-oversight');
    } finally {
      setLoading(false);
    }
  }, [canViewReports, canViewAttendance, canReviewLeaves, selectedDate]);

  useEffect(() => {
    loadOversightData();
  }, [loadOversightData]);

  const filteredReports = useMemo(() => {
    if (!filterMonth) return reports;
    return reports.filter((r) => r.month === filterMonth);
  }, [reports, filterMonth]);

  const filteredAttendance = useMemo(() => {
    if (filterOfficeId === 'all') return attendanceRecords;
    return attendanceRecords.filter((r) => r.officeId === filterOfficeId);
  }, [attendanceRecords, filterOfficeId]);

  const reviewableAdLeaves = useMemo(() => {
    if (!canReviewLeaves) return [];
    return allLeaves.filter((item) => {
      const applicant = usersByUid.get(item.uid);
      if (!applicant) return false;
      return canReview(
        {
          uid: applicant.uid,
          officeId: applicant.officeId,
          districtOfficeId: applicant.districtOfficeId,
          role: applicant.role
        },
        'leave'
      );
    });
  }, [canReviewLeaves, allLeaves, usersByUid, canReview]);

  const pendingAdLeaveCount = useMemo(
    () => reviewableAdLeaves.filter((l) => l.status === 'pending').length,
    [reviewableAdLeaves]
  );

  const reviewLeave = async (item, decision) => {
    const applicant = usersByUid.get(item.uid);
    if (
      !applicant ||
      !canReview(
        {
          uid: applicant.uid,
          officeId: applicant.officeId,
          districtOfficeId: applicant.districtOfficeId,
          role: applicant.role
        },
        'leave'
      )
    ) {
      return;
    }

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
        districtOfficeId: item.districtOfficeId || ''
      });
      setFeedbackMsg(`${item.employeeName}-এর ছুটির আবেদন ${decision} করা হয়েছে।`);
      await loadOversightData();
    } catch (err) {
      setErrorMsg('সিদ্ধান্ত সংরক্ষণ করা যায়নি।');
      handleFirestoreError(err, OperationType.UPDATE, `leaves/${item.id}`);
    } finally {
      setReviewingId('');
    }
  };

  return (
    <AppShell showThemeToggle>
      <div className="space-y-4">
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 font-display">
              Head Office Oversight · {roleLabel}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              সকল কার্যালয়ের প্রতিবেদন ও হাজিরার সার্বিক তদারকি
              {canReviewLeaves ? ' এবং সহকারী পরিচালকদের ছুটির আবেদন অনুমোদন।' : ' (Read-only oversight)।'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canViewUsers && (
              <Link
                to="/admin/users"
                className="min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 inline-flex items-center gap-1.5"
              >
                <Users className="w-4 h-4 text-[#0b6b4f] dark:text-[#4fd1a1]" />
                <span>Staff Directory</span>
              </Link>
            )}
            {canViewAudit && (
              <Link
                to="/audit"
                className="min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 inline-flex items-center gap-1.5"
              >
                <History className="w-4 h-4 text-[#0b6b4f] dark:text-[#4fd1a1]" />
                <span>Audit Trail</span>
              </Link>
            )}
          </div>
        </div>

        <div
          className={`grid gap-1 p-1 bg-slate-200/70 dark:bg-slate-800 rounded-xl ${
            canReviewLeaves ? 'grid-cols-3' : 'grid-cols-2'
          }`}
        >
          {canViewReports && (
            <button
              type="button"
              onClick={() => setTab('reports')}
              className={`min-h-[44px] rounded-lg text-xs sm:text-sm font-semibold transition-colors ${
                tab === 'reports'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              Reports ({reports.length})
            </button>
          )}
          {canViewAttendance && (
            <button
              type="button"
              onClick={() => setTab('attendance')}
              className={`min-h-[44px] rounded-lg text-xs sm:text-sm font-semibold transition-colors ${
                tab === 'attendance'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              Attendance ({attendanceRecords.length})
            </button>
          )}
          {canReviewLeaves && (
            <button
              type="button"
              onClick={() => setTab('adLeaves')}
              className={`min-h-[44px] rounded-lg text-xs sm:text-sm font-semibold transition-colors ${
                tab === 'adLeaves'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              AD Leaves ({pendingAdLeaveCount})
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

        {tab === 'reports' && (
          <div className="space-y-4">
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 font-display">
                  Submitted Monthly Reports
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">Read-only archive of submitted reports</p>
              </div>
              <input
                value={filterMonth}
                onChange={(e) => setFilterMonth(e.target.value)}
                type="month"
                className="min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-base sm:text-xs font-mono-tabular bg-white dark:bg-slate-950"
              />
            </div>

            {loading ? (
              <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-8 text-center text-sm text-slate-600 dark:text-slate-300">
                লোড হচ্ছে...
              </div>
            ) : !filteredReports.length ? (
              <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-8 text-center text-sm text-slate-500 dark:text-slate-400">
                কোনো জমাকৃত প্রতিবেদন পাওয়া যায়নি।
              </div>
            ) : (
              <div className="space-y-3">
                {filteredReports.map((rep) => (
                  <div
                    key={rep.id}
                    className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 space-y-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                          {rep.officeName} · {rep.month}
                        </h4>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          Submitted by {rep.generatedByName} · {formatDhakaDateTime(rep.submittedAt)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setExpandedId((prev) => (prev === rep.id ? null : rep.id))}
                          className="min-h-[44px] px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
                        >
                          {expandedId === rep.id ? 'Hide Details' : 'View Breakdown'}
                        </button>
                        <button
                          type="button"
                          onClick={() => downloadReportCsv(rep)}
                          className="min-h-[44px] px-3 py-1.5 rounded-xl bg-[#0b6b4f] hover:bg-[#09553f] text-white text-xs font-semibold"
                        >
                          Export CSV
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-4 gap-2 text-center bg-slate-50 dark:bg-slate-800/70 rounded-xl p-3 text-xs tabular-nums">
                      <div>
                        <div className="text-slate-500 dark:text-slate-400">On Time</div>
                        <div className="text-base font-bold text-emerald-700 dark:text-emerald-400 font-mono-tabular">
                          {rep.summary?.onTime || 0}
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-500 dark:text-slate-400">Late</div>
                        <div className="text-base font-bold text-amber-700 dark:text-amber-400 font-mono-tabular">
                          {rep.summary?.late || 0}
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-500 dark:text-slate-400">Leave</div>
                        <div className="text-base font-bold text-sky-700 dark:text-sky-400 font-mono-tabular">
                          {rep.summary?.leave || 0}
                        </div>
                      </div>
                      <div>
                        <div className="text-slate-500 dark:text-slate-400">Absent</div>
                        <div className="text-base font-bold text-rose-700 dark:text-rose-400 font-mono-tabular">
                          {rep.summary?.absent || 0}
                        </div>
                      </div>
                    </div>

                    {expandedId === rep.id && (
                      <div className="overflow-x-auto pt-2 border-t border-slate-100 dark:border-slate-800">
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
                            {(rep.rows || []).map((row) => (
                              <tr key={row.uid}>
                                <td className="py-2 pr-3 font-medium text-slate-900 dark:text-slate-100">
                                  {row.name} ({row.designation})
                                </td>
                                <td className="py-2 px-2 text-right font-mono-tabular">{row.onTime}</td>
                                <td className="py-2 px-2 text-right font-mono-tabular">{row.late}</td>
                                <td className="py-2 px-2 text-right font-mono-tabular">{row.leave}</td>
                                <td className="py-2 pl-2 text-right font-mono-tabular">{row.absent}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'attendance' && canViewAttendance && (
          <div className="space-y-4">
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                  Date (Asia/Dhaka)
                </label>
                <input
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  type="date"
                  className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-base sm:text-xs font-mono-tabular bg-white dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                  Filter Office
                </label>
                <select
                  value={filterOfficeId}
                  onChange={(e) => setFilterOfficeId(e.target.value)}
                  className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-base sm:text-xs bg-white dark:bg-slate-950"
                >
                  <option value="all">All Offices ({attendanceRecords.length})</option>
                  {offices.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {loading ? (
              <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-8 text-center text-sm text-slate-600 dark:text-slate-300">
                লোড হচ্ছে...
              </div>
            ) : !filteredAttendance.length ? (
              <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-8 text-center text-sm text-slate-500 dark:text-slate-400">
                নির্বাচিত তারিখে কোনো হাজিরা রেকর্ড নেই।
              </div>
            ) : (
              <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800">
                {filteredAttendance.map((rec) => (
                  <div
                    key={rec.id}
                    className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                  >
                    <div>
                      <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                        {rec.employeeName}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        {officeName(rec.officeId)} · {rec.designation || 'Staff'} · In{' '}
                        {rec.checkIn ? formatDhakaTime(rec.checkIn.time) : '—'} · Out{' '}
                        {rec.checkOut ? formatDhakaTime(rec.checkOut.time) : '—'}
                      </div>
                    </div>
                    <div className="flex flex-col sm:items-end gap-0.5">
                      <StatusText status={rec.finalStatus || rec.initialStatus} />
                      <span className="text-[11px] text-slate-400 dark:text-slate-500">
                        {rec.settled ? 'Settled' : 'Unsettled'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'adLeaves' && canReviewLeaves && (
          <div className="space-y-3">
            {loading ? (
              <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-8 text-center text-sm text-slate-600 dark:text-slate-300">
                লোড হচ্ছে...
              </div>
            ) : !reviewableAdLeaves.length ? (
              <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-8 text-center text-sm text-slate-500 dark:text-slate-400">
                সহকারী পরিচালকদের কোনো ছুটির আবেদন পাওয়া যায়নি।
              </div>
            ) : (
              reviewableAdLeaves.map((item) => {
                const applicant = usersByUid.get(item.uid);
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
                          {applicant?.role && (
                            <span className="text-[11px] font-medium px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                              {getRoleLabel(applicant.role)}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">
                          {officeName(item.officeId)} · {item.startDate} to {item.endDate}
                        </div>
                        <div className="text-xs text-slate-700 dark:text-slate-300 mt-1">
                          <span className="font-semibold">{item.leaveType}:</span> {item.reason}
                        </div>
                      </div>
                      <StatusText status={item.status} />
                    </div>

                    {item.status === 'pending' ? (
                      <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                        <input
                          value={comments[item.id] || ''}
                          onChange={(e) => setComments((c) => ({ ...c, [item.id]: e.target.value }))}
                          type="text"
                          placeholder="Optional DG review comment..."
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
      </div>
    </AppShell>
  );
}
