import React, { useMemo, useState } from 'react';
import { collection, doc, addDoc, updateDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import AppShell from '../../components/AppShell.jsx';
import LocationPinMap from '../../components/LocationPinMap.jsx';
import ConfirmSheet from '../../components/ConfirmSheet.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useData } from '../../context/DataContext.jsx';
import { db, OperationType, handleFirestoreError } from '../../firebase/config.js';

const INITIAL_FORM = {
  name: '',
  address: '',
  level: 'upazila',
  parentOfficeId: '',
  lat: 23.8103,
  lng: 90.4125,
  geofenceRadiusMeters: 100,
  startTime: '09:00',
  graceMinutes: 15,
  endTime: '17:00'
};

export default function AdminOfficesPage() {
  const { profile, offices, fetchPublicBootstrap } = useAuth();
  const { logAudit } = useData();

  const [editingId, setEditingId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [feedbackMsg, setFeedbackMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [form, setForm] = useState(INITIAL_FORM);

  const parentOptions = useMemo(
    () => offices.filter((o) => o.id !== editingId && o.level !== 'upazila'),
    [offices, editingId]
  );

  const officeName = (id) => offices.find((o) => o.id === id)?.name || id;

  const resetForm = () => {
    setEditingId(null);
    setForm(INITIAL_FORM);
  };

  const editOffice = (o) => {
    setEditingId(o.id);
    setForm({
      name: o.name,
      address: o.address,
      level: o.level,
      parentOfficeId: o.parentOfficeId || '',
      lat: o.lat,
      lng: o.lng,
      geofenceRadiusMeters: o.geofenceRadiusMeters || 100,
      startTime: o.startTime || '09:00',
      graceMinutes: o.graceMinutes ?? 15,
      endTime: o.endTime || '17:00'
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const saveOffice = async (e) => {
    e.preventDefault();
    setSaving(true);
    setErrorMsg('');
    setFeedbackMsg('');
    try {
      const payload = {
        name: form.name.trim(),
        address: form.address.trim(),
        level: form.level,
        parentOfficeId: form.level === 'head' ? null : form.parentOfficeId || null,
        lat: Number(form.lat),
        lng: Number(form.lng),
        geofenceRadiusMeters: Number(form.geofenceRadiusMeters),
        startTime: form.startTime,
        graceMinutes: Number(form.graceMinutes),
        endTime: form.endTime,
        updatedAt: serverTimestamp()
      };

      if (editingId) {
        await updateDoc(doc(db, 'offices', editingId), payload);
        await logAudit({
          actor: profile,
          action: 'OFFICE_UPDATED',
          targetCollection: 'offices',
          targetId: editingId,
          newValue: payload.name,
          reason: 'Updated office configuration'
        });
        setFeedbackMsg('অফিসের তথ্য আপডেট করা হয়েছে।');
      } else {
        const refDoc = await addDoc(collection(db, 'offices'), {
          ...payload,
          createdAt: serverTimestamp()
        });
        await logAudit({
          actor: profile,
          action: 'OFFICE_CREATED',
          targetCollection: 'offices',
          targetId: refDoc.id,
          newValue: payload.name,
          reason: 'Created new office'
        });
        setFeedbackMsg('নতুন অফিস তৈরি করা হয়েছে।');
      }

      resetForm();
      await fetchPublicBootstrap();
    } catch (err) {
      setErrorMsg('অফিস সংরক্ষণ করা যায়নি।');
      handleFirestoreError(err, OperationType.WRITE, 'offices');
    } finally {
      setSaving(false);
    }
  };

  const confirmDeleteOffice = async () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    try {
      await deleteDoc(doc(db, 'offices', target.id));
      await fetchPublicBootstrap();
      setFeedbackMsg(`${target.name} মুছে ফেলা হয়েছে।`);
    } catch (err) {
      setErrorMsg('অফিস মুছে ফেলা যায়নি।');
      handleFirestoreError(err, OperationType.DELETE, `offices/${target.id}`);
    }
  };

  return (
    <AppShell>
      <div className="space-y-5">
        <form onSubmit={saveOffice} className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-bold text-slate-900 font-display">
              {editingId ? 'Edit Office' : 'Add New Office'}
            </h2>
            {editingId && (
              <button
                type="button"
                onClick={resetForm}
                className="text-xs font-semibold text-slate-600 hover:text-slate-900 py-1 px-2"
              >
                Cancel Edit
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Office Name</label>
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                type="text"
                required
                minLength={2}
                placeholder="e.g. Savar Upazila Office"
                className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Hierarchy Level</label>
              <select
                value={form.level}
                onChange={(e) => setForm((f) => ({ ...f, level: e.target.value }))}
                required
                className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 text-sm bg-white"
              >
                <option value="head">Head Office (Director General)</option>
                <option value="district">District Office (Assistant Director)</option>
                <option value="upazila">Upazila Office (UNFEO)</option>
              </select>
            </div>

            {form.level !== 'head' && (
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Parent Office</label>
                <select
                  value={form.parentOfficeId}
                  onChange={(e) => setForm((f) => ({ ...f, parentOfficeId: e.target.value }))}
                  className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 text-sm bg-white"
                >
                  <option value="">None</option>
                  {parentOptions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.level})
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="sm:col-span-2 lg:col-span-3">
              <label className="block text-xs font-semibold text-slate-700 mb-1">Office Address</label>
              <input
                value={form.address}
                onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                type="text"
                required
                minLength={2}
                placeholder="Full office address"
                className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Center Latitude</label>
              <input
                value={form.lat}
                onChange={(e) => setForm((f) => ({ ...f, lat: e.target.value }))}
                type="number"
                step="0.000001"
                required
                className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 text-sm font-mono-tabular"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Center Longitude</label>
              <input
                value={form.lng}
                onChange={(e) => setForm((f) => ({ ...f, lng: e.target.value }))}
                type="number"
                step="0.000001"
                required
                className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 text-sm font-mono-tabular"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Geofence Radius (Meters)</label>
              <input
                value={form.geofenceRadiusMeters}
                onChange={(e) => setForm((f) => ({ ...f, geofenceRadiusMeters: e.target.value }))}
                type="number"
                min={10}
                max={50000}
                required
                className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 text-sm font-mono-tabular"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Start Time</label>
              <input
                value={form.startTime}
                onChange={(e) => setForm((f) => ({ ...f, startTime: e.target.value }))}
                type="time"
                required
                className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 text-sm font-mono-tabular"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Grace Minutes</label>
              <input
                value={form.graceMinutes}
                onChange={(e) => setForm((f) => ({ ...f, graceMinutes: e.target.value }))}
                type="number"
                min={0}
                max={180}
                required
                className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 text-sm font-mono-tabular"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">End Time</label>
              <input
                value={form.endTime}
                onChange={(e) => setForm((f) => ({ ...f, endTime: e.target.value }))}
                type="time"
                required
                className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 text-sm font-mono-tabular"
              />
            </div>
          </div>

          <LocationPinMap
            officeLat={Number(form.lat) || 23.8103}
            officeLng={Number(form.lng) || 90.4125}
            radiusMeters={Number(form.geofenceRadiusMeters) || 100}
            editable={true}
            onUpdateCoords={(coords) => setForm((f) => ({ ...f, lat: coords.lat, lng: coords.lng }))}
          />

          {feedbackMsg && (
            <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800">
              {feedbackMsg}
            </div>
          )}
          {errorMsg && (
            <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800">{errorMsg}</div>
          )}

          <button
            type="submit"
            disabled={saving}
            className="w-full sm:w-auto min-h-[44px] px-6 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold disabled:opacity-60"
          >
            {saving ? 'সংরক্ষণ হচ্ছে...' : editingId ? 'Update Office' : 'Create Office'}
          </button>
        </form>

        <section className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100">
          <div className="p-4">
            <h3 className="text-sm font-bold text-slate-900 font-display">Registered Offices ({offices.length})</h3>
          </div>
          {!offices.length ? (
            <div className="p-6 text-center text-xs text-slate-500">এখনো কোনো অফিস যোগ করা হয়নি।</div>
          ) : (
            offices.map((o) => (
              <div key={o.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-bold text-slate-900">{o.name}</div>
                  <div className="text-xs text-slate-500">
                    {o.level.toUpperCase()}
                    {o.parentOfficeId && <span> · Under {officeName(o.parentOfficeId)}</span>}
                    <span> · {o.address}</span>
                  </div>
                  <div className="text-[11px] font-mono-tabular text-slate-500 mt-0.5">
                    {o.lat}, {o.lng} · Radius {o.geofenceRadiusMeters}m · {o.startTime} (+{o.graceMinutes}m) –{' '}
                    {o.endTime}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => editOffice(o)}
                    className="min-h-[40px] px-3 py-1.5 rounded-xl border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteTarget(o)}
                    className="min-h-[40px] px-3 py-1.5 rounded-xl border border-rose-200 text-xs font-semibold text-rose-700 hover:bg-rose-50"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))
          )}
        </section>

        <ConfirmSheet
          open={!!deleteTarget}
          title="Delete Office"
          message={`Delete ${deleteTarget?.name}? Ensure no active users depend on this office.`}
          confirmLabel="Delete"
          danger={true}
          onConfirm={confirmDeleteOffice}
          onCancel={() => setDeleteTarget(null)}
        />
      </div>
    </AppShell>
  );
}
