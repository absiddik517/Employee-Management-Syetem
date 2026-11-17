import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import AppShell from '../../components/AppShell.jsx';
import { db, OperationType, handleFirestoreError } from '../../firebase/config.js';
import { formatDhakaDateTime } from '../../utils/dhakaTime.js';
import { downloadReportCsv } from '../../utils/csv.js';

export default function HeadOfficeReportsPage() {
  const [loading, setLoading] = useState(true);
  const [reports, setReports] = useState([]);
  const [filterMonth, setFilterMonth] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');

  const loadReports = useCallback(async () => {
    setLoading(true);
    setErrorMsg('');
    try {
      const snap = await getDocs(collection(db, 'reports'));
      setReports(
        snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (b.month || '').localeCompare(a.month || ''))
      );
    } catch (err) {
      setErrorMsg('প্রতিবেদন তালিকা লোড করা যায়নি।');
      handleFirestoreError(err, OperationType.LIST, 'reports');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadReports();
  }, [loadReports]);

  const filteredReports = useMemo(() => {
    if (!filterMonth) return reports;
    return reports.filter((r) => r.month === filterMonth);
  }, [reports, filterMonth]);

  return (
    <AppShell>
      <div className="space-y-4">
        <div className="bg-white rounded-2xl border border-slate-200 p-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-900 font-display">Head Office (DG) — Submitted Reports</h2>
            <p className="text-xs text-slate-500">Read-only archive of monthly office reports</p>
          </div>
          <input
            value={filterMonth}
            onChange={(e) => setFilterMonth(e.target.value)}
            type="month"
            className="min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 text-xs font-mono-tabular bg-white"
          />
        </div>

        {loading ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-sm text-slate-600">
            লোড হচ্ছে...
          </div>
        ) : errorMsg ? (
          <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-xs text-rose-800">{errorMsg}</div>
        ) : !filteredReports.length ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-sm text-slate-500">
            কোনো জমাকৃত প্রতিবেদন পাওয়া যায়নি।
          </div>
        ) : (
          <div className="space-y-3">
            {filteredReports.map((rep) => (
              <div key={rep.id} className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">
                      {rep.officeName} · {rep.month}
                    </h3>
                    <p className="text-xs text-slate-500">
                      Submitted by {rep.generatedByName} · {formatDhakaDateTime(rep.submittedAt)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setExpandedId((prev) => (prev === rep.id ? null : rep.id))}
                      className="min-h-[40px] px-3 py-1.5 rounded-xl border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      {expandedId === rep.id ? 'Hide Details' : 'View Breakdown'}
                    </button>
                    <button
                      type="button"
                      onClick={() => downloadReportCsv(rep)}
                      className="min-h-[40px] px-3 py-1.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold"
                    >
                      Export CSV
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-4 gap-2 text-center bg-slate-50 rounded-xl p-3 text-xs tabular-nums">
                  <div>
                    <div className="text-slate-500">On Time</div>
                    <div className="text-base font-bold text-emerald-700 font-mono-tabular">{rep.summary?.onTime || 0}</div>
                  </div>
                  <div>
                    <div className="text-slate-500">Late</div>
                    <div className="text-base font-bold text-amber-700 font-mono-tabular">{rep.summary?.late || 0}</div>
                  </div>
                  <div>
                    <div className="text-slate-500">Leave</div>
                    <div className="text-base font-bold text-sky-700 font-mono-tabular">{rep.summary?.leave || 0}</div>
                  </div>
                  <div>
                    <div className="text-slate-500">Absent</div>
                    <div className="text-base font-bold text-rose-700 font-mono-tabular">{rep.summary?.absent || 0}</div>
                  </div>
                </div>

                {expandedId === rep.id && (
                  <div className="overflow-x-auto pt-2 border-t border-slate-100">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 text-slate-500">
                          <th className="py-2 pr-3 font-semibold">Employee</th>
                          <th className="py-2 px-2 text-right font-semibold">On Time</th>
                          <th className="py-2 px-2 text-right font-semibold">Late</th>
                          <th className="py-2 px-2 text-right font-semibold">Leave</th>
                          <th className="py-2 pl-2 text-right font-semibold">Absent</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 tabular-nums">
                        {(rep.rows || []).map((row) => (
                          <tr key={row.uid}>
                            <td className="py-2 pr-3 font-medium text-slate-900">
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
    </AppShell>
  );
}
