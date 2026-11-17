import React, { useCallback, useEffect, useState } from 'react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import AppShell from '../../components/AppShell.jsx';
import StatusText from '../../components/StatusText.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { db, OperationType, handleFirestoreError } from '../../firebase/config.js';
import { getTodayDhaka, formatDhakaTime } from '../../utils/dhakaTime.js';

export default function OfficeHeadPage() {
  const { profile, userOffice: office } = useAuth();
  const [selectedDate, setSelectedDate] = useState(() => getTodayDhaka());
  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState([]);
  const [errorMsg, setErrorMsg] = useState('');

  const loadAttendance = useCallback(async (dateStr = selectedDate) => {
    if (!profile) return;
    setLoading(true);
    setErrorMsg('');
    try {
      const q = query(
        collection(db, 'attendance'),
        where('officeId', '==', profile.officeId),
        where('date', '==', dateStr)
      );
      const snap = await getDocs(q);
      const list = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (a.employeeName || '').localeCompare(b.employeeName || ''));
      setRecords(list);
    } catch (err) {
      setErrorMsg('অফিসের হাজিরা লোড করা যায়নি।');
      handleFirestoreError(err, OperationType.LIST, 'attendance');
    } finally {
      setLoading(false);
    }
  }, [profile, selectedDate]);

  useEffect(() => {
    loadAttendance(selectedDate);
  }, [loadAttendance, selectedDate]);

  return (
    <AppShell>
      <div className="space-y-4">
        <div className="bg-white rounded-2xl border border-slate-200 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-900 font-display">{office?.name || 'Upazila Office'}</h2>
            <p className="text-xs text-slate-500">View-only daily attendance for your office staff</p>
          </div>
          <input
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            type="date"
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
            নির্বাচিত তারিখে কোনো হাজিরা রেকর্ড নেই।
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100">
            {records.map((rec) => (
              <div key={rec.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold text-slate-900">{rec.employeeName}</div>
                  <div className="text-xs text-slate-500">
                    {rec.designation || 'Staff'} · In {rec.checkIn ? formatDhakaTime(rec.checkIn.time) : '—'} · Out{' '}
                    {rec.checkOut ? formatDhakaTime(rec.checkOut.time) : '—'}
                  </div>
                  {rec.districtComment && (
                    <div className="text-xs text-slate-600 mt-1">Note: {rec.districtComment}</div>
                  )}
                </div>

                <div className="flex flex-col sm:items-end gap-0.5">
                  <StatusText status={rec.finalStatus || rec.initialStatus} />
                  <span className="text-[11px] text-slate-400">
                    {rec.settled ? 'Settled by District Office' : 'Awaiting Settlement'}
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
