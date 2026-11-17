import React, { useCallback, useEffect, useState } from 'react';
import { collection, query, where, getDocs, addDoc, deleteDoc, doc, serverTimestamp } from 'firebase/firestore';
import AppShell from '../../components/AppShell.jsx';
import ConfirmSheet from '../../components/ConfirmSheet.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { db, OperationType, handleFirestoreError } from '../../firebase/config.js';
import { getTodayDhaka, formatDisplayDate } from '../../utils/dhakaTime.js';

export default function AdminHolidaysPage() {
  const { profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [holidays, setHolidays] = useState([]);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [feedbackMsg, setFeedbackMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [form, setForm] = useState(() => ({
    date: getTodayDhaka(),
    title: '',
    type: 'government'
  }));

  const loadHolidays = useCallback(async () => {
    setLoading(true);
    try {
      const snap = await getDocs(
        query(collection(db, 'holidays'), where('type', 'in', ['government', 'national', 'optional']))
      );
      setHolidays(
        snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
      );
    } catch (err) {
      setErrorMsg('ছুটির দিন লোড করা যায়নি।');
      handleFirestoreError(err, OperationType.LIST, 'holidays');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHolidays();
  }, [loadHolidays]);

  const addHoliday = async (e) => {
    e.preventDefault();
    setSaving(true);
    setErrorMsg('');
    setFeedbackMsg('');
    try {
      await addDoc(collection(db, 'holidays'), {
        date: form.date,
        title: form.title.trim(),
        type: form.type,
        createdBy: profile.uid,
        createdAt: serverTimestamp()
      });
      setForm((f) => ({ ...f, title: '' }));
      setFeedbackMsg('সরকারি ছুটির দিন সংরক্ষিত হয়েছে।');
      await loadHolidays();
    } catch (err) {
      setErrorMsg('ছুটির দিন সংরক্ষণ করা যায়নি।');
      handleFirestoreError(err, OperationType.CREATE, 'holidays');
    } finally {
      setSaving(false);
    }
  };

  const removeHoliday = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    try {
      await deleteDoc(doc(db, 'holidays', target.id));
      setFeedbackMsg('ছুটির দিন মুছে ফেলা হয়েছে।');
      await loadHolidays();
    } catch (err) {
      setErrorMsg('ছুটির দিন মুছে ফেলা যায়নি।');
      handleFirestoreError(err, OperationType.DELETE, `holidays/${target.id}`);
    }
  };

  return (
    <AppShell>
      <div className="space-y-5">
        <form onSubmit={addHoliday} className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
          <h2 className="text-base font-bold text-slate-900 font-display">Add Government Holiday</h2>
          <p className="text-xs text-slate-500">
            Fridays, Saturdays, and holidays added here are excluded from Absent proposals.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Date</label>
              <input
                value={form.date}
                onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                type="date"
                required
                className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 text-sm font-mono-tabular"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Holiday Title</label>
              <input
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                type="text"
                required
                minLength={2}
                placeholder="e.g. Victory Day"
                className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Type</label>
              <select
                value={form.type}
                onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
                required
                className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 text-sm bg-white"
              >
                <option value="government">Government Holiday</option>
                <option value="national">National Holiday</option>
                <option value="optional">Optional Holiday</option>
              </select>
            </div>
          </div>

          <button
            type="submit"
            disabled={saving}
            className="min-h-[44px] px-5 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold disabled:opacity-60"
          >
            {saving ? 'সংরক্ষণ হচ্ছে...' : 'Add Holiday'}
          </button>
        </form>

        {feedbackMsg && (
          <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800">
            {feedbackMsg}
          </div>
        )}
        {errorMsg && (
          <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800">{errorMsg}</div>
        )}

        <section className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100">
          <div className="p-4">
            <h3 className="text-sm font-bold text-slate-900 font-display">Configured Holidays ({holidays.length})</h3>
          </div>
          {loading ? (
            <div className="p-6 text-center text-xs text-slate-500">লোড হচ্ছে...</div>
          ) : !holidays.length ? (
            <div className="p-6 text-center text-xs text-slate-500">কোনো ছুটির দিন যুক্ত করা হয়নি।</div>
          ) : (
            holidays.map((h) => (
              <div key={h.id} className="p-4 flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-900">{h.title}</div>
                  <div className="text-xs text-slate-500 font-mono-tabular">
                    {formatDisplayDate(h.date)} · {h.type}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setDeleteTarget(h)}
                  className="min-h-[40px] px-3 py-1.5 rounded-xl border border-rose-200 text-xs font-semibold text-rose-700 hover:bg-rose-50"
                >
                  Remove
                </button>
              </div>
            ))
          )}
        </section>

        <ConfirmSheet
          open={!!deleteTarget}
          title="Remove Holiday"
          message={`Remove ${deleteTarget?.title} (${deleteTarget?.date})?`}
          confirmLabel="Remove"
          danger={true}
          onConfirm={removeHoliday}
          onCancel={() => setDeleteTarget(null)}
        />
      </div>
    </AppShell>
  );
}
