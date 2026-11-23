import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, query, where, getDocs, doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import AppShell from '../../components/AppShell.jsx';
import StatusText from '../../components/StatusText.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useData } from '../../context/DataContext.jsx';
import { db, OperationType, handleFirestoreError } from '../../firebase/config.js';
import { getApproverHint, getRoleLabel } from '../../lib/permissions.js';

export default function DistrictApprovalsPage() {
  const { profile, offices, activeOfficeId, activeOffice, activeChargeType, can, canReview, permissionScope } = useAuth();
  const { logAudit } = useData();

  const canLeaveReview = can('leave.review');
  const canFieldReview = can('fieldduty.review');
  const canViewUsers = can('user.view');
  const canViewAttendance = can('attendance.view');

  const [tab, setTab] = useState(() => (canLeaveReview ? 'leaves' : 'field'));
  const [loading, setLoading] = useState(true);
  const [leaves, setLeaves] = useState([]);
  const [fieldDuties, setFieldDuties] = useState([]);
  const [staffByUid, setStaffByUid] = useState(() => new Map());
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
      const emptySnap = { docs: [] };
      const isWideScope = (perm) => {
        const s = permissionScope(perm);
        return s === 'subtree' || s === 'all';
      };

      const canQueryLeaves = canLeaveReview || canViewAttendance;
      const canQueryLeavesSubtree = isWideScope('leave.review') || isWideScope('attendance.view');
      const canQueryField = canFieldReview || canViewAttendance;
      const canQueryFieldSubtree = isWideScope('fieldduty.review') || isWideScope('attendance.view');
      const canQueryUsersSubtree = isWideScope('user.view');

      const userQueries = [];
      if (canViewUsers) {
        if (canQueryUsersSubtree) {
          userQueries.push(getDocs(query(collection(db, 'users'), where('districtOfficeId', '==', myOfficeId))));
        }
        userQueries.push(
          getDocs(query(collection(db, 'users'), where('officeId', '==', myOfficeId))),
          getDocs(query(collection(db, 'users'), where('attachedOfficeId', '==', myOfficeId))),
          getDocs(query(collection(db, 'users'), where('actingOfficeId', '==', myOfficeId)))
        );
        if (myOfficeId === profile?.officeId || myOfficeId === profile?.actingOfficeId) {
          userQueries.push(
            getDocs(query(collection(db, 'users'), where('additionalOfficeIds', 'array-contains', myOfficeId)))
          );
        } else if (
          Array.isArray(profile?.additionalOfficeIds) &&
          profile.additionalOfficeIds.includes(myOfficeId)
        ) {
          userQueries.push(
            getDocs(
              query(
                collection(db, 'users'),
                where('additionalOfficeIds', 'array-contains-any', profile.additionalOfficeIds)
              )
            )
          );
        }
      }

      const [l1, l2, f1, f2, ...uSnaps] = await Promise.all([
        canQueryLeaves && canQueryLeavesSubtree
          ? getDocs(query(collection(db, 'leaves'), where('districtOfficeId', '==', myOfficeId)))
          : Promise.resolve(emptySnap),
        canQueryLeaves
          ? getDocs(query(collection(db, 'leaves'), where('officeId', '==', myOfficeId)))
          : Promise.resolve(emptySnap),
        canQueryField && canQueryFieldSubtree
          ? getDocs(query(collection(db, 'fieldDuties'), where('districtOfficeId', '==', myOfficeId)))
          : Promise.resolve(emptySnap),
        canQueryField
          ? getDocs(query(collection(db, 'fieldDuties'), where('officeId', '==', myOfficeId)))
          : Promise.resolve(emptySnap),
        ...userQueries
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

      const uMap = new Map();
      for (const snap of uSnaps) {
        for (const d of snap.docs) {
          uMap.set(d.id, { uid: d.id, id: d.id, ...d.data() });
        }
      }

      setStaffByUid(uMap);
      setLeaves(merge(l1, l2));
      setFieldDuties(merge(f1, f2));
    } catch (err) {
      setErrorMsg('আবেদনসমূহ লোড করা যায়নি।');
      handleFirestoreError(err, OperationType.LIST, 'leaves/fieldDuties');
    } finally {
      setLoading(false);
    }
  }, [myOfficeId, canLeaveReview, canFieldReview, canViewUsers, canViewAttendance, permissionScope]);

  useEffect(() => {
    loadRequests();
  }, [loadRequests]);

  const activeList = tab === 'leaves' ? leaves : fieldDuties;
  const kind = tab === 'leaves' ? 'leave' : 'fieldduty';

  const canReviewItem = useCallback(
    (item, reviewKind) => {
      const staff = staffByUid.get(item.uid);
      return canReview(
        {
          uid: item.uid,
          officeId: item.officeId,
          districtOfficeId: item.districtOfficeId,
          role: staff?.role || null
        },
        reviewKind
      );
    },
    [staffByUid, canReview]
  );

  const pendingLeavesCount = useMemo(
    () => leaves.filter((l) => l.status === 'pending' && canReviewItem(l, 'leave')).length,
    [leaves, canReviewItem]
  );
  const pendingFieldCount = useMemo(
    () => fieldDuties.filter((f) => f.status === 'pending' && canReviewItem(f, 'fieldduty')).length,
    [fieldDuties, canReviewItem]
  );

  const reviewItem = async (item, decision) => {
    if (!canReviewItem(item, kind)) return;
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
    <AppShell showThemeToggle>
      <div className="space-y-4">
        {activeOffice && (
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 px-4 py-3 flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              কার্যালয়: <span className="text-slate-900 dark:text-slate-100 font-bold">{activeOffice.name}</span>
            </div>
            <span
              className={`text-[11px] font-semibold px-2 py-0.5 rounded-lg ${
                activeChargeType === 'additional'
                  ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
                  : activeChargeType === 'acting'
                  ? 'bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300'
                  : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
              }`}
            >
              {activeChargeType === 'additional'
                ? 'অতিরিক্ত দায়িত্ব'
                : activeChargeType === 'acting'
                ? 'চলতি দায়িত্ব'
                : 'মূল দায়িত্ব'}
            </span>
          </div>
        )}

        <div className="grid grid-cols-2 gap-1 p-1 bg-slate-200/70 dark:bg-slate-800 rounded-xl">
          {canLeaveReview && (
            <button
              type="button"
              onClick={() => setTab('leaves')}
              className={`min-h-[44px] rounded-lg text-sm font-semibold transition-colors ${
                tab === 'leaves'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              Leave Requests ({pendingLeavesCount})
            </button>
          )}
          {canFieldReview && (
            <button
              type="button"
              onClick={() => setTab('field')}
              className={`min-h-[44px] rounded-lg text-sm font-semibold transition-colors ${
                tab === 'field'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              Field Duty ({pendingFieldCount})
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

        {loading ? (
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-8 text-center text-sm text-slate-600 dark:text-slate-300">
            লোড হচ্ছে...
          </div>
        ) : !activeList.length ? (
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-8 text-center text-sm text-slate-500 dark:text-slate-400">
            কোনো আবেদন পাওয়া যায়নি।
          </div>
        ) : (
          <div className="space-y-3">
            {activeList.map((item) => {
              const staff = staffByUid.get(item.uid);
              const applicantRole = staff?.role || null;
              const allowed = canReviewItem(item, kind);

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
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        {officeName(item.officeId)}
                        {item.homeOfficeId && item.homeOfficeId !== item.officeId
                          ? ` (মূল কর্মস্থল: ${officeName(item.homeOfficeId)})`
                          : ''}{' '}
                        · {item.startDate} to {item.endDate}
                      </div>
                      <div className="text-xs text-slate-700 dark:text-slate-300 mt-1">
                        <span className="font-semibold">{item.leaveType || item.location}:</span> {item.reason}
                      </div>
                    </div>
                    <StatusText status={item.status} />
                  </div>

                  {item.status === 'pending' ? (
                    allowed ? (
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
                            onClick={() => reviewItem(item, 'approved')}
                            className="flex-1 sm:flex-none min-h-[44px] px-4 py-2 rounded-xl bg-[#0b6b4f] hover:bg-[#09553f] text-white text-xs font-semibold"
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
                      <div className="pt-2 border-t border-slate-100 dark:border-slate-800 text-xs text-amber-700 dark:text-amber-300">
                        অনুমোদনকারী কর্তৃপক্ষ:{' '}
                        <strong>{getApproverHint(applicantRole || profile?.role, kind)}</strong>
                      </div>
                    )
                  ) : (
                    item.reviewComment && (
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        Comment: {item.reviewComment} ({item.reviewedByName})
                      </div>
                    )
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}
