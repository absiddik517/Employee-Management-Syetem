import React, { useCallback, useEffect, useState } from 'react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import AppShell from '../../components/AppShell.jsx';
import StatusText from '../../components/StatusText.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { db, OperationType, handleFirestoreError } from '../../firebase/config.js';
import { getCurrentMonthDhaka, formatDisplayDate, formatDhakaTime } from '../../utils/dhakaTime.js';

export default function EmployeeHistoryPage() {
  const { profile } = useAuth();
  const [selectedMonth, setSelectedMonth] = useState(() => getCurrentMonthDhaka());
  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState([]);
  const [errorMsg, setErrorMsg] = useState('');

  const loadHistory = useCallback(async (month = selectedMonth) => {
    if (!profile) return;
    setLoading(true);
    setErrorMsg('');
    try {
      const q = query(collection(db, 'attendance'), where('uid', '==', profile.uid));
      const snap = await getDocs(q);
      const list = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((r) => r.date && r.date.startsWith(month))
        .sort((a, b) => b.date.localeCompare(a.date));
      setRecords(list);
    } catch (err) {
      setErrorMsg('ইতিহাস লোড করা যায়নি।');
      handleFirestoreError(err, OperationType.LIST, 'attendance');
    } finally {
      setLoading(false);
    }
  }, [profile, selectedMonth]);

  useEffect(() => {
    loadHistory(selectedMonth);
  }, [loadHistory, selectedMonth]);

  return (
    <AppShell>
      <div className="space-y-4">
        <div className="bg-white rounded-2xl border border-slate-200 p-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-900 font-display">Monthly Attendance History</h2>
            <p className="text-xs text-slate-500">All times displayed in Asia/Dhaka</p>
          </div>
          <input
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            type="month"
            className="min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 text-sm font-mono-tabular bg-white"
          />
        </div>

        {loading ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-sm text-slate-600">
            লোড হচ্ছে...
          </div>
        ) : errorMsg ? (
          <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-xs text-rose-800">{errorMsg}</div>
        ) : !records.length ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-sm text-slate-500">
            এই মাসের কোনো হাজিরা রেকর্ড পাওয়া যায়নি।
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100">
            {records.map((rec) => (
              <div key={rec.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold text-slate-900">{formatDisplayDate(rec.date)}</div>
                  <div className="text-xs text-slate-500 font-mono-tabular mt-0.5">
                    In: {rec.checkIn ? formatDhakaTime(rec.checkIn.time) : '—'}
                    <span aria-hidden="true"> · </span>
                    Out: {rec.checkOut ? formatDhakaTime(rec.checkOut.time) : '—'}
                  </div>
                  {rec.districtComment && (
                    <div className="text-xs text-slate-600 mt-1">Comment: {rec.districtComment}</div>
                  )}
                </div>

                <div className="flex flex-col sm:items-end gap-1">
                  <StatusText status={rec.finalStatus || rec.initialStatus} />
                  <span className="text-[11px] text-slate-400">
                    {rec.settled ? 'Final (Settled)' : 'Initial Status'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
