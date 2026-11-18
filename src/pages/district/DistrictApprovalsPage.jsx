import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, query, where, getDocs, doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import AppShell from '../../components/AppShell.jsx';
import StatusText from '../../components/StatusText.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useData } from '../../context/DataContext.jsx';
import { db, OperationType, handleFirestoreError } from '../../firebase/config.js';

export default function DistrictApprovalsPage() {
  const { profile, offices, activeOfficeId, activeOffice, activeChargeType } = useAuth();
  const { logAudit } = useData();

  const [tab, setTab] = useState('leaves');
  const [loading, setLoading] = useState(true);
  const [leaves, setLeaves] = useState([]);
  const [fieldDuties, setFieldDuties] = useState([]);
  const [comments, setComments] = useState({});
  const [feedbackMsg, setFeedbackMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const myOfficeId = activeOfficeId || profile?.officeId || '';

  useEffect(() => {
    setComments({});
    setFeedbackMsg('');
    setErrorMsg('');
  }, [myOfficeId]);

  const officeName = useCallback(
    (id) => offices.find((o) => o.id === id)?.name || id,
    [offices]
  );

  const loadRequests = useCallback(async () => {
    if (!myOfficeId) return;
    setLoading(true);
    setErrorMsg('');
    try {
      const [l1, l2, f1, f2] = await Promise.all([
        getDocs(query(collection(db, 'leaves'), where('districtOfficeId', '==', myOfficeId))),
        getDocs(query(collection(db, 'leaves'), where('officeId', '==', myOfficeId))),
        getDocs(query(collection(db, 'fieldDuties'), where('districtOfficeId', '==', myOfficeId))),
        getDocs(query(collection(db, 'fieldDuties'), where('officeId', '==', myOfficeId)))
      ]);

      const merge = (a, b) => {
        const map = new Map();
        for (const d of [...a.docs, ...b.docs]) map.set(d.id, { id: d.id, ...d.data() });
        return Array.from(map.values()).sort((x, y) => {
          if (x.status === 'pending' && y.status !== 'pending') return -1;
          if (x.status !== 'pending' && y.status === 'pending') return 1;
          return (y.startDate || '').localeCompare(x.startDate || '');
        });
      };

      setLeaves(merge(l1, l2));
      setFieldDuties(merge(f1, f2));
    } catch (err) {
      setErrorMsg('আবেদনসমূহ লোড করা যায়নি।');
      handleFirestoreError(err, OperationType.LIST, 'leaves/fieldDuties');
    } finally {
      setLoading(false);
    }
  }, [myOfficeId]);

  useEffect(() => {
    loadRequests();
  }, [loadRequests]);

  const activeList = tab === 'leaves' ? leaves : fieldDuties;
  const pendingLeavesCount = useMemo(() => leaves.filter((l) => l.status === 'pending').length, [leaves]);
  const pendingFieldCount = useMemo(() => fieldDuties.filter((f) => f.status === 'pending').length, [fieldDuties]);

  const reviewItem = async (item, decision) => {
    setErrorMsg('');
    setFeedbackMsg('');
    const col = tab === 'leaves' ? 'leaves' : 'fieldDuties';
    const officer = profile;
    const comment = (comments[item.id] || '').trim();
    try {
      await updateDoc(doc(db, col, item.id), {
        status: decision,
        reviewedBy: officer.uid,
        reviewedByName: officer.name,
        reviewComment: comment,
        reviewedAt: serverTimestamp()
      });
      await logAudit({
        actor: officer,
        action: `${col.toUpperCase()}_${decision.toUpperCase()}`,
        targetCollection: col,
        targetId: item.id,
        oldValue: 'pending',
        newValue: decision,
        reason: comment || decision,
        officeId: item.officeId,
        districtOfficeId: item.districtOfficeId || myOfficeId
      });
      setFeedbackMsg(`${item.employeeName}-এর আবেদন ${decision} করা হয়েছে।`);
      await loadRequests();
    } catch (err) {
      setErrorMsg('সিদ্ধান্ত সংরক্ষণ করা যায়নি।');
      handleFirestoreError(err, OperationType.UPDATE, `${col}/${item.id}`);
    }
  };

  return (
    <AppShell>
      <div className="space-y-4">
        {activeOffice && (
          <div className="bg-white rounded-2xl border border-slate-200 px-4 py-3 flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs font-semibold text-slate-700">
              কার্যালয়: <span className="text-slate-900 font-bold">{activeOffice.name}</span>
            </div>
            <span
              className={`text-[11px] font-semibold px-2 py-0.5 rounded-lg ${
                activeChargeType === 'additional'
                  ? 'bg-amber-100 text-amber-800'
                  : 'bg-emerald-100 text-emerald-800'
              }`}
            >
              {activeChargeType === 'additional' ? 'অতিরিক্ত দায়িত্ব' : 'মূল দায়িত্ব'}
            </span>
          </div>
        )}

        <div className="grid grid-cols-2 gap-1 p-1 bg-slate-200/70 rounded-xl">
          <button
            type="button"
            onClick={() => setTab('leaves')}
            className={`min-h-[44px] rounded-lg text-sm font-semibold transition-colors ${
              tab === 'leaves' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
            }`}
          >
            Leave Requests ({pendingLeavesCount})
          </button>
          <button
            type="button"
            onClick={() => setTab('field')}
            className={`min-h-[44px] rounded-lg text-sm font-semibold transition-colors ${
              tab === 'field' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
            }`}
          >
            Field Duty ({pendingFieldCount})
          </button>
        </div>

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
        ) : !activeList.length ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-sm text-slate-500">
            কোনো আবেদন পাওয়া যায়নি।
          </div>
        ) : (
          <div className="space-y-3">
            {activeList.map((item) => (
              <div key={item.id} className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="text-sm font-bold text-slate-900">{item.employeeName}</div>
                    <div className="text-xs text-slate-500">
                      {officeName(item.officeId)} · {item.startDate} to {item.endDate}
                    </div>
                    <div className="text-xs text-slate-700 mt-1">
                      <span className="font-semibold">{item.leaveType || item.location}:</span> {item.reason}
                    </div>
                  </div>
                  <StatusText status={item.status} />
                </div>

                {item.status === 'pending' ? (
                  <div className="pt-2 border-t border-slate-100 flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                    <input
                      value={comments[item.id] || ''}
                      onChange={(e) => setComments((c) => ({ ...c, [item.id]: e.target.value }))}
                      type="text"
                      placeholder="Optional review comment..."
                      className="flex-1 min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 text-xs"
                    />
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => reviewItem(item, 'approved')}
                        className="flex-1 sm:flex-none min-h-[44px] px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold"
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        onClick={() => reviewItem(item, 'rejected')}
                        className="flex-1 sm:flex-none min-h-[44px] px-4 py-2 rounded-xl bg-rose-700 hover:bg-rose-800 text-white text-xs font-semibold"
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                ) : (
                  item.reviewComment && (
                    <div className="text-xs text-slate-500">
                      Comment: {item.reviewComment} ({item.reviewedByName})
                    </div>
                  )
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
