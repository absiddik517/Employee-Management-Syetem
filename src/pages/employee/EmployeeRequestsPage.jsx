import React, { useCallback, useEffect, useState } from 'react';
import { collection, query, where, getDocs, addDoc, serverTimestamp } from 'firebase/firestore';
import AppShell from '../../components/AppShell.jsx';
import StatusText from '../../components/StatusText.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { db, OperationType, handleFirestoreError } from '../../firebase/config.js';
import { getTodayDhaka } from '../../utils/dhakaTime.js';

export default function EmployeeRequestsPage() {
  const { profile, computeDistrictOfficeId } = useAuth();
  const today = getTodayDhaka();

  const [activeTab, setActiveTab] = useState('leave');
  const [submitting, setSubmitting] = useState(false);
  const [loadingList, setLoadingList] = useState(true);
  const [feedbackMsg, setFeedbackMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [leaves, setLeaves] = useState([]);
  const [fieldDuties, setFieldDuties] = useState([]);

  const [leaveForm, setLeaveForm] = useState({
    startDate: today,
    endDate: today,
    leaveType: 'Casual Leave',
    reason: ''
  });

  const [fieldForm, setFieldForm] = useState({
    startDate: today,
    endDate: today,
    location: '',
    reason: ''
  });

  const loadRequests = useCallback(async () => {
    if (!profile) return;
    setLoadingList(true);
    const uid = profile.uid;
    try {
      const [lSnap, fSnap] = await Promise.all([
        getDocs(query(collection(db, 'leaves'), where('uid', '==', uid))),
        getDocs(query(collection(db, 'fieldDuties'), where('uid', '==', uid)))
      ]);
      setLeaves(
        lSnap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''))
      );
      setFieldDuties(
        fSnap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''))
      );
    } catch (err) {
      setErrorMsg('আবেদন তালিকা লোড করা যায়নি।');
      handleFirestoreError(err, OperationType.LIST, 'leaves/fieldDuties');
    } finally {
      setLoadingList(false);
    }
  }, [profile]);

  useEffect(() => {
    loadRequests();
  }, [loadRequests]);

  const submitLeave = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    setFeedbackMsg('');
    if (leaveForm.endDate < leaveForm.startDate) {
      setErrorMsg('শেষের তারিখ শুরুর তারিখের আগে হতে পারবে না।');
      return;
    }
    setSubmitting(true);
    try {
      await addDoc(collection(db, 'leaves'), {
        uid: profile.uid,
        employeeName: profile.name,
        officeId: profile.officeId,
        districtOfficeId: profile.districtOfficeId || computeDistrictOfficeId(profile.officeId),
        startDate: leaveForm.startDate,
        endDate: leaveForm.endDate,
        leaveType: leaveForm.leaveType,
        reason: leaveForm.reason.trim(),
        status: 'pending',
        reviewedBy: null,
        reviewedByName: null,
        reviewComment: null,
        reviewedAt: null,
        createdAt: serverTimestamp()
      });
      setLeaveForm((prev) => ({ ...prev, reason: '' }));
      setFeedbackMsg('ছুটির আবেদন সফলভাবে জমা দেওয়া হয়েছে।');
      await loadRequests();
    } catch (err) {
      setErrorMsg('আবেদন জমা দেওয়া যায়নি।');
      handleFirestoreError(err, OperationType.CREATE, 'leaves');
    } finally {
      setSubmitting(false);
    }
  };

  const submitFieldDuty = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    setFeedbackMsg('');
    if (fieldForm.endDate < fieldForm.startDate) {
      setErrorMsg('শেষের তারিখ শুরুর তারিখের আগে হতে পারবে না।');
      return;
    }
    setSubmitting(true);
    try {
      await addDoc(collection(db, 'fieldDuties'), {
        uid: profile.uid,
        employeeName: profile.name,
        officeId: profile.officeId,
        districtOfficeId: profile.districtOfficeId || computeDistrictOfficeId(profile.officeId),
        startDate: fieldForm.startDate,
        endDate: fieldForm.endDate,
        location: fieldForm.location.trim(),
        reason: fieldForm.reason.trim(),
        status: 'pending',
        reviewedBy: null,
        reviewedByName: null,
        reviewComment: null,
        reviewedAt: null,
        createdAt: serverTimestamp()
      });
      setFieldForm((prev) => ({ ...prev, location: '', reason: '' }));
      setFeedbackMsg('মাঠ পর্যায়ের কাজের (Field Duty) আবেদন জমা হয়েছে।');
      await loadRequests();
    } catch (err) {
      setErrorMsg('আবেদন জমা দেওয়া যায়নি।');
      handleFirestoreError(err, OperationType.CREATE, 'fieldDuties');
    } finally {
      setSubmitting(false);
    }
  };

  const currentList = activeTab === 'leave' ? leaves : fieldDuties;

  return (
    <AppShell>
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-1 p-1 bg-slate-200/70 rounded-xl">
          <button
            type="button"
            onClick={() => setActiveTab('leave')}
            className={`min-h-[44px] rounded-lg text-sm font-semibold transition-colors ${
              activeTab === 'leave' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
            }`}
          >
            Leave Application
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('field')}
            className={`min-h-[44px] rounded-lg text-sm font-semibold transition-colors ${
              activeTab === 'field' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
            }`}
          >
            Field Duty Request
          </button>
        </div>

        {activeTab === 'leave' ? (
          <form onSubmit={submitLeave} className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
            <h2 className="text-base font-bold text-slate-900 font-display">Apply for Leave</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Start Date</label>
                <input
                  value={leaveForm.startDate}
                  onChange={(e) => setLeaveForm((p) => ({ ...p, startDate: e.target.value }))}
                  type="date"
                  required
                  className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 text-sm font-mono-tabular"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">End Date</label>
                <input
                  value={leaveForm.endDate}
                  onChange={(e) => setLeaveForm((p) => ({ ...p, endDate: e.target.value }))}
                  type="date"
                  required
                  className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 text-sm font-mono-tabular"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-slate-700 mb-1">Leave Type</label>
                <select
                  value={leaveForm.leaveType}
                  onChange={(e) => setLeaveForm((p) => ({ ...p, leaveType: e.target.value }))}
                  required
                  className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 text-sm bg-white"
                >
                  <option value="Casual Leave">Casual Leave (নৈমিত্তিক ছুটি)</option>
                  <option value="Earned Leave">Earned Leave (অর্জিত ছুটি)</option>
                  <option value="Medical Leave">Medical Leave (অসুস্থতাজনিত ছুটি)</option>
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-slate-700 mb-1">Reason</label>
                <textarea
                  value={leaveForm.reason}
                  onChange={(e) => setLeaveForm((p) => ({ ...p, reason: e.target.value }))}
                  rows={3}
                  required
                  minLength={2}
                  placeholder="Explain the reason for leave..."
                  className="w-full p-3 rounded-xl border border-slate-300 text-sm"
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="w-full sm:w-auto min-h-[44px] px-6 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold disabled:opacity-60"
            >
              {submitting ? 'জমা হচ্ছে...' : 'Submit Leave Request'}
            </button>
          </form>
        ) : (
          <form onSubmit={submitFieldDuty} className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4">
            <h2 className="text-base font-bold text-slate-900 font-display">Request Field Duty</h2>
            <p className="text-xs text-slate-500">
              Approved field duty dates skip the office geofence check while still capturing GPS and selfie.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Start Date</label>
                <input
                  value={fieldForm.startDate}
                  onChange={(e) => setFieldForm((p) => ({ ...p, startDate: e.target.value }))}
                  type="date"
                  required
                  className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 text-sm font-mono-tabular"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">End Date</label>
                <input
                  value={fieldForm.endDate}
                  onChange={(e) => setFieldForm((p) => ({ ...p, endDate: e.target.value }))}
                  type="date"
                  required
                  className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 text-sm font-mono-tabular"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-slate-700 mb-1">Field Location</label>
                <input
                  value={fieldForm.location}
                  onChange={(e) => setFieldForm((p) => ({ ...p, location: e.target.value }))}
                  type="text"
                  required
                  minLength={2}
                  placeholder="e.g. Union Learning Center Inspection"
                  className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 text-sm"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-slate-700 mb-1">Purpose / Reason</label>
                <textarea
                  value={fieldForm.reason}
                  onChange={(e) => setFieldForm((p) => ({ ...p, reason: e.target.value }))}
                  rows={3}
                  required
                  minLength={2}
                  placeholder="Describe official field duty assignment..."
                  className="w-full p-3 rounded-xl border border-slate-300 text-sm"
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="w-full sm:w-auto min-h-[44px] px-6 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold disabled:opacity-60"
            >
              {submitting ? 'জমা হচ্ছে...' : 'Submit Field Duty Request'}
            </button>
          </form>
        )}

        {feedbackMsg && (
          <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800">{feedbackMsg}</div>
        )}
        {errorMsg && (
          <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800">{errorMsg}</div>
        )}

        <section className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100">
          <div className="p-4">
            <h3 className="text-sm font-bold text-slate-900 font-display">
              {activeTab === 'leave' ? 'My Leave Applications' : 'My Field Duty Requests'}
            </h3>
          </div>

          {loadingList ? (
            <div className="p-6 text-center text-xs text-slate-500">লোড হচ্ছে...</div>
          ) : !currentList.length ? (
            <div className="p-6 text-center text-xs text-slate-500">কোনো আবেদন পাওয়া যায়নি।</div>
          ) : (
            currentList.map((item) => (
              <div key={item.id} className="p-4 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold text-slate-900 font-mono-tabular">
                    {item.startDate} to {item.endDate}
                  </div>
                  <StatusText status={item.status} />
                </div>
                <div className="text-xs text-slate-600">
                  {item.leaveType || item.location} · {item.reason}
                </div>
                {item.reviewComment && (
                  <div className="text-xs text-slate-500">District Office Note: {item.reviewComment}</div>
                )}
              </div>
            ))
          )}
        </section>
      </div>
    </AppShell>
  );
}
