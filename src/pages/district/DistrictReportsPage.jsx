import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, query, where, getDocs, addDoc, serverTimestamp } from 'firebase/firestore';
import AppShell from '../../components/AppShell.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useData } from '../../context/DataContext.jsx';
import { db, OperationType, handleFirestoreError } from '../../firebase/config.js';
import { getCurrentMonthDhaka } from '../../utils/dhakaTime.js';
import { downloadReportCsv } from '../../utils/csv.js';

export default function DistrictReportsPage() {
  const { profile, offices, activeOfficeId, activeOffice, activeChargeType, can, permissionScope } = useAuth();
  const { logAudit } = useData();

  const myOfficeId = activeOfficeId || profile?.officeId || '';
  const managedOffices = useMemo(
    () => offices.filter((o) => o.id === myOfficeId || o.parentOfficeId === myOfficeId),
    [offices, myOfficeId]
  );

  const [selectedOfficeId, setSelectedOfficeId] = useState('');
  const [selectedMonth, setSelectedMonth] = useState(() => getCurrentMonthDhaka());
  const [generating, setGenerating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [previewReport, setPreviewReport] = useState(null);
  const [submittedReports, setSubmittedReports] = useState([]);
  const [feedbackMsg, setFeedbackMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    setPreviewReport(null);
    setFeedbackMsg('');
    setErrorMsg('');
    setSelectedOfficeId(managedOffices[0]?.id || '');
  }, [myOfficeId, managedOffices]);

  const loadSubmittedReports = useCallback(async () => {
    if (!myOfficeId || !can('report.view')) return;
    try {
      const reportScope = permissionScope('report.view');
      const isWide = reportScope === 'subtree' || reportScope === 'all';
      const [r1, r2] = await Promise.all([
        isWide
          ? getDocs(query(collection(db, 'reports'), where('districtOfficeId', '==', myOfficeId)))
          : Promise.resolve({ docs: [] }),
        getDocs(query(collection(db, 'reports'), where('officeId', '==', myOfficeId)))
      ]);
      const map = new Map();
      for (const d of [...r1.docs, ...r2.docs]) {
        map.set(d.id, { id: d.id, ...d.data() });
      }
      setSubmittedReports(
        Array.from(map.values()).sort((a, b) => (b.month || '').localeCompare(a.month || ''))
      );
    } catch (err) {
      console.warn('Reports load warning:', err);
    }
  }, [myOfficeId, can, permissionScope]);

  useEffect(() => {
    loadSubmittedReports();
  }, [loadSubmittedReports]);

  const generatePreview = async () => {
    setGenerating(true);
    setErrorMsg('');
    setFeedbackMsg('');
    try {
      const office = managedOffices.find((o) => o.id === selectedOfficeId);
      if (!office) return;

      const [uSnap, aSnap] = await Promise.all([
        getDocs(query(collection(db, 'users'), where('officeId', '==', office.id))),
        getDocs(
          query(
            collection(db, 'attendance'),
            where('officeId', '==', office.id),
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
        officeId: office.id,
        officeName: office.name,
        districtOfficeId: myOfficeId,
        month: selectedMonth,
        summary,
        rows: Array.from(rowsMap.values()).sort((a, b) => (a.name || '').localeCompare(b.name || ''))
      });
    } catch (err) {
      setErrorMsg('প্রতিবেদন তৈরি করা যায়নি।');
      handleFirestoreError(err, OperationType.LIST, 'reports-generate');
    } finally {
      setGenerating(false);
    }
  };

  const submitToHeadOffice = async () => {
    if (!previewReport) return;
    setSubmitting(true);
    setErrorMsg('');
    setFeedbackMsg('');
    const officer = profile;
    try {
      const refDoc = await addDoc(collection(db, 'reports'), {
        officeId: previewReport.officeId,
        officeName: previewReport.officeName,
        districtOfficeId: myOfficeId,
        month: previewReport.month,
        generatedBy: officer.uid,
        generatedByName: officer.name,
        submittedAt: serverTimestamp(),
        summary: previewReport.summary,
        rows: previewReport.rows
      });

      await logAudit({
        actor: officer,
        action: 'REPORT_SUBMITTED_TO_HEAD_OFFICE',
        targetCollection: 'reports',
        targetId: refDoc.id,
        oldValue: '',
        newValue: `${previewReport.officeName} (${previewReport.month})`,
        reason: 'Monthly report submitted to Head Office',
        officeId: previewReport.officeId,
        districtOfficeId: myOfficeId
      });

      setFeedbackMsg('প্রতিবেদন সফলভাবে প্রধান কার্যালয়ে পাঠানো হয়েছে।');
      await loadSubmittedReports();
    } catch (err) {
      setErrorMsg('প্রতিবেদন পাঠানো যায়নি।');
      handleFirestoreError(err, OperationType.CREATE, 'reports');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AppShell>
      <div className="space-y-5">
        <section className="bg-white rounded-2xl border border-slate-200 p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-bold text-slate-900 font-display">Monthly Settled Report Generator</h2>
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
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">Office</label>
              <select
                value={selectedOfficeId}
                onChange={(e) => setSelectedOfficeId(e.target.value)}
                className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 text-xs bg-white"
              >
                {managedOffices.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">Month</label>
              <input
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                type="month"
                className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 text-xs font-mono-tabular bg-white"
              />
            </div>
            <div className="flex items-end">
              <button
                type="button"
                disabled={generating || !selectedOfficeId}
                onClick={generatePreview}
                className="w-full min-h-[44px] px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold disabled:opacity-60"
              >
                {generating ? 'প্রস্তুত হচ্ছে...' : 'Generate From Settled Data'}
              </button>
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

        {previewReport && (
          <section className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-slate-900 font-display">
                  {previewReport.officeName} · {previewReport.month}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5 tabular-nums">
                  On Time: {previewReport.summary.onTime} · Late: {previewReport.summary.late} · Leave:{' '}
                  {previewReport.summary.leave} · Absent: {previewReport.summary.absent}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => downloadReportCsv(previewReport)}
                  className="min-h-[44px] px-4 py-2 rounded-xl border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Export CSV
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={submitToHeadOffice}
                  className="min-h-[44px] px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold disabled:opacity-60"
                >
                  {submitting ? 'পাঠানো হচ্ছে...' : 'প্রধান কার্যালয়ে পাঠান'}
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th className="py-2 pr-3 font-semibold">Employee</th>
                    <th className="py-2 px-2 font-semibold text-right">On Time</th>
                    <th className="py-2 px-2 font-semibold text-right">Late</th>
                    <th className="py-2 px-2 font-semibold text-right">Leave</th>
                    <th className="py-2 pl-2 font-semibold text-right">Absent</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 tabular-nums">
                  {previewReport.rows.map((row) => (
                    <tr key={row.uid}>
                      <td className="py-2.5 pr-3">
                        <div className="font-semibold text-slate-900">{row.name}</div>
                        <div className="text-[11px] text-slate-500">{row.designation}</div>
                      </td>
                      <td className="py-2.5 px-2 text-right font-mono-tabular text-emerald-700">{row.onTime}</td>
                      <td className="py-2.5 px-2 text-right font-mono-tabular text-amber-700">{row.late}</td>
                      <td className="py-2.5 px-2 text-right font-mono-tabular text-sky-700">{row.leave}</td>
                      <td className="py-2.5 pl-2 text-right font-mono-tabular text-rose-700">{row.absent}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <section className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100">
          <div className="p-4">
            <h3 className="text-sm font-bold text-slate-900 font-display">Submitted Reports</h3>
          </div>
          {!submittedReports.length ? (
            <div className="p-6 text-center text-xs text-slate-500">এখনো কোনো মাসিক প্রতিবেদন পাঠানো হয়নি।</div>
          ) : (
            submittedReports.map((rep) => (
              <div key={rep.id} className="p-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-900">
                    {rep.officeName} · {rep.month}
                  </div>
                  <div className="text-xs text-slate-500 tabular-nums">
                    On Time {rep.summary?.onTime || 0} · Late {rep.summary?.late || 0} · Leave{' '}
                    {rep.summary?.leave || 0} · Absent {rep.summary?.absent || 0}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => downloadReportCsv(rep)}
                  className="min-h-[40px] px-3 py-1.5 rounded-xl border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  CSV
                </button>
              </div>
            ))
          )}
        </section>
      </div>
    </AppShell>
  );
}
