import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  where,
  writeBatch
} from 'firebase/firestore';
import {
  AlertTriangle,
  Briefcase,
  Building2,
  CalendarClock,
  CheckCircle2,
  Paperclip,
  Plus,
  Search,
  ShieldCheck,
  Users,
  X
} from 'lucide-react';
import AppShell from '../components/AppShell.jsx';
import BottomSheet from '../components/users/BottomSheet.jsx';
import StatusBadge, { getUserInitials } from '../components/users/StatusBadge.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useData } from '../context/DataContext.jsx';
import { db, OperationType, handleFirestoreError, withTimeout } from '../firebase/config.js';
import { addDaysDhaka, getTodayDhaka, toBanglaDigits } from '../utils/dhakaTime.js';
import {
  getAuthorityOfficeIds,
  getRoleLabel,
  getRoleList,
  getRoleMeta,
  normalizeRole,
  rankOf
} from '../lib/permissions.js';

const INPUT_CLASS =
  'w-full min-h-[44px] px-3.5 py-2 rounded-[14px] border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800/90 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-[#0b6b4f] dark:focus:ring-[#4fd1a1]';

const LABEL_CLASS = 'block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1';

function getOpenAssignment(records, kind, officeId = null) {
  if (!Array.isArray(records)) return null;
  const open = records.filter(
    (r) =>
      r.kind === kind &&
      !r.closedAt &&
      (officeId == null || r.officeId === officeId)
  );
  if (open.length === 0) return null;
  return open.sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''))[0];
}

function isExpiredOpenAssignment(rec, todayStr) {
  return Boolean(rec && !rec.closedAt && rec.endDate && rec.endDate < todayStr);
}

export default function AssignmentsManagePage() {
  const {
    profile,
    effectiveAuthUser,
    isBootstrapSuperAdmin,
    roleMeta,
    roleRegistry,
    offices,
    permissionScope,
    computeDistrictOfficeId
  } = useAuth();
  const { logAudit } = useData();

  const manageScope = permissionScope('assignment.manage');
  const isSuper = isBootstrapSuperAdmin || Boolean(roleMeta?.isSuper);
  const callerRank = roleMeta?.rank ?? 0;
  const todayStr = getTodayDhaka();

  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState([]);
  const [assignmentsByUid, setAssignmentsByUid] = useState(() => new Map());
  const [search, setSearch] = useState('');
  const [filterMode, setFilterMode] = useState('eligible'); // 'eligible' | 'active' | 'expired'
  const [errorMsg, setErrorMsg] = useState('');
  const [toastMsg, setToastMsg] = useState('');
  const toastTimerRef = useRef(null);

  // Sheet state
  const [activeUser, setActiveUser] = useState(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetTab, setSheetTab] = useState('additional'); // 'additional' | 'acting' | 'attachment'
  const [saving, setSaving] = useState(false);
  const [sheetError, setSheetError] = useState('');

  const [addForm, setAddForm] = useState({
    officeId: '',
    startDate: todayStr,
    endDate: '',
    orderNo: '',
    orderDate: '',
    reason: ''
  });

  const [actingForm, setActingForm] = useState({
    officeId: '',
    roleKey: '',
    startDate: todayStr,
    endDate: '',
    orderNo: '',
    orderDate: '',
    reason: ''
  });

  const [attachForm, setAttachForm] = useState({
    officeId: '',
    startDate: todayStr,
    endDate: '',
    orderNo: '',
    orderDate: '',
    reason: ''
  });

  const [closingTarget, setClosingTarget] = useState(null); // { kind, officeId, label, closeDate }

  const showToast = useCallback((msg) => {
    setToastMsg(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => {
      setToastMsg('');
    }, 3600);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  const officeMap = useMemo(() => new Map(offices.map((o) => [o.id, o])), [offices]);
  const officeName = useCallback((id) => officeMap.get(id)?.name || id || '—', [officeMap]);

  const authorityIds = useMemo(() => getAuthorityOfficeIds(effectiveAuthUser), [effectiveAuthUser]);

  const selectableOffices = useMemo(() => {
    if (manageScope === 'all') return offices;
    if (manageScope === 'subtree') {
      const authSet = new Set(authorityIds);
      return offices.filter((o) => authSet.has(o.id) || authSet.has(o.parentOfficeId));
    }
    return [];
  }, [manageScope, offices, authorityIds]);

  const actingRoles = useMemo(() => {
    return getRoleList(roleRegistry).filter(
      (r) => r.actingEligible && (isSuper || callerRank > (r.rank ?? 0))
    );
  }, [roleRegistry, isSuper, callerRank]);

  const isTargetManageable = useCallback(
    (u) => {
      if (!u) return false;
      const uid = u.uid || u.id;
      if (!uid || uid === profile?.uid) return false;
      if (u.approvalStatus !== 'approved' || u.status !== 'active') return false;

      const meta = getRoleMeta(u.role, roleRegistry);
      if (!meta?.chargeEligible) return false;
      if (!isSuper && callerRank <= rankOf(u.role, roleRegistry)) return false;

      if (manageScope === 'all') return true;
      if (manageScope === 'subtree') {
        const authSet = new Set(authorityIds);
        return authSet.has(u.officeId) || authSet.has(u.districtOfficeId);
      }
      return false;
    },
    [profile?.uid, roleRegistry, isSuper, callerRank, manageScope, authorityIds]
  );

  const loadData = useCallback(async () => {
    if (!profile) return;
    setLoading(true);
    setErrorMsg('');
    try {
      let loadedUsers = [];
      if (manageScope === 'all') {
        const snap = await withTimeout(
          getDocs(collection(db, 'users')),
          15000,
          'কর্মকর্তাদের তালিকা লোড করতে সময় বেশি লাগছে।'
        );
        loadedUsers = snap.docs.map((d) => ({ uid: d.id, id: d.id, ...d.data() }));
      } else if (manageScope === 'subtree' && authorityIds.length > 0) {
        const queries = [];
        for (const oid of authorityIds) {
          queries.push(getDocs(query(collection(db, 'users'), where('officeId', '==', oid))));
          queries.push(getDocs(query(collection(db, 'users'), where('districtOfficeId', '==', oid))));
        }
        const snaps = await withTimeout(
          Promise.all(queries),
          15000,
          'অধীনস্থ কর্মকর্তাদের তালিকা লোড করতে সময় বেশি লাগছে।'
        );
        const byUid = new Map();
        for (const snap of snaps) {
          for (const d of snap.docs) {
            byUid.set(d.id, { uid: d.id, id: d.id, ...d.data() });
          }
        }
        loadedUsers = Array.from(byUid.values());
      }

      loadedUsers.sort((a, b) =>
        (a.name || a.email || a.uid || '').localeCompare(b.name || b.email || b.uid || '')
      );
      setUsers(loadedUsers);

      // Fetch /users/{uid}/assignments only for users that currently have active charges/attachments
      const usersWithCharges = loadedUsers.filter(
        (u) =>
          (Array.isArray(u.additionalOfficeIds) && u.additionalOfficeIds.length > 0) ||
          Boolean(u.attachedOfficeId) ||
          Boolean(u.actingOfficeId)
      );

      const assignMap = new Map();
      await Promise.all(
        usersWithCharges.map(async (u) => {
          const uid = u.uid || u.id;
          try {
            const snap = await getDocs(collection(db, 'users', uid, 'assignments'));
            assignMap.set(
              uid,
              snap.docs.map((d) => ({ id: d.id, ...d.data() }))
            );
          } catch (err) {
            console.warn(`Assignments fetch notice for ${uid}:`, err?.code || err?.message);
          }
        })
      );
      setAssignmentsByUid(assignMap);
    } catch (err) {
      setErrorMsg('দায়িত্ব ও সংযুক্তির তালিকা লোড করা যায়নি।');
      handleFirestoreError(err, OperationType.LIST, 'users-assignments');
    } finally {
      setLoading(false);
    }
  }, [profile, manageScope, authorityIds]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const manageableUsers = useMemo(
    () => users.filter(isTargetManageable),
    [users, isTargetManageable]
  );

  // Keep activeUser synced after reload
  useEffect(() => {
    if (!activeUser) return;
    const updated = users.find((u) => (u.uid || u.id) === (activeUser.uid || activeUser.id));
    if (updated) setActiveUser(updated);
  }, [users, activeUser]);

  const getUserExpiredInfo = useCallback(
    (u) => {
      const uid = u.uid || u.id;
      const recs = assignmentsByUid.get(uid) || [];
      const additionalIds = Array.isArray(u.additionalOfficeIds)
        ? u.additionalOfficeIds.filter((id) => id && id !== u.officeId)
        : [];
      const expiredAdditional = additionalIds.filter((oid) =>
        isExpiredOpenAssignment(getOpenAssignment(recs, 'additional_charge', oid), todayStr)
      );
      const actRec = u.actingOfficeId ? getOpenAssignment(recs, 'acting_charge', u.actingOfficeId) : null;
      const expiredActing = Boolean(u.actingOfficeId && isExpiredOpenAssignment(actRec, todayStr));
      const attRec = u.attachedOfficeId ? getOpenAssignment(recs, 'attachment', u.attachedOfficeId) : null;
      const expiredAttachment = Boolean(u.attachedOfficeId && isExpiredOpenAssignment(attRec, todayStr));
      const hasExpired = expiredAdditional.length > 0 || expiredActing || expiredAttachment;
      return {
        recs,
        additionalIds,
        expiredAdditional,
        expiredActing,
        expiredAttachment,
        hasExpired
      };
    },
    [assignmentsByUid, todayStr]
  );

  const counts = useMemo(() => {
    let activeCount = 0;
    let expiredCount = 0;
    for (const u of manageableUsers) {
      const info = getUserExpiredInfo(u);
      const hasActive =
        info.additionalIds.length > 0 ||
        Boolean(u.attachedOfficeId) ||
        Boolean(u.actingOfficeId && u.actingRoleKey);
      if (hasActive) activeCount += 1;
      if (info.hasExpired) expiredCount += 1;
    }
    return {
      eligible: manageableUsers.length,
      active: activeCount,
      expired: expiredCount
    };
  }, [manageableUsers, getUserExpiredInfo]);

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return manageableUsers.filter((u) => {
      const info = getUserExpiredInfo(u);
      const hasActive =
        info.additionalIds.length > 0 ||
        Boolean(u.attachedOfficeId) ||
        Boolean(u.actingOfficeId && u.actingRoleKey);

      if (filterMode === 'active' && !hasActive) return false;
      if (filterMode === 'expired' && !info.hasExpired) return false;

      if (!q) return true;
      const primary = officeName(u.officeId).toLowerCase();
      const addStr = info.additionalIds.map((id) => officeName(id).toLowerCase()).join(' ');
      const attStr = u.attachedOfficeId ? officeName(u.attachedOfficeId).toLowerCase() : '';
      const actStr = u.actingOfficeId ? officeName(u.actingOfficeId).toLowerCase() : '';
      return (
        (u.name || '').toLowerCase().includes(q) ||
        (u.email || '').toLowerCase().includes(q) ||
        (u.designation || '').toLowerCase().includes(q) ||
        primary.includes(q) ||
        addStr.includes(q) ||
        attStr.includes(q) ||
        actStr.includes(q)
      );
    });
  }, [manageableUsers, getUserExpiredInfo, filterMode, search, officeName]);

  const openManageSheet = (u, initialTab = 'additional') => {
    setActiveUser(u);
    setSheetTab(initialTab);
    setSheetError('');
    setClosingTarget(null);
    setAddForm({
      officeId: '',
      startDate: todayStr,
      endDate: '',
      orderNo: '',
      orderDate: '',
      reason: ''
    });
    setActingForm({
      officeId: u.actingOfficeId || '',
      roleKey: normalizeRole(u.actingRoleKey, roleRegistry) || '',
      startDate: todayStr,
      endDate: '',
      orderNo: '',
      orderDate: '',
      reason: ''
    });
    setAttachForm({
      officeId: u.attachedOfficeId || '',
      startDate: todayStr,
      endDate: '',
      orderNo: '',
      orderDate: '',
      reason: ''
    });
    setSheetOpen(true);
  };

  const validateDates = (form) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.startDate || '')) {
      return 'শুরুর তারিখ (YYYY-MM-DD) দিন।';
    }
    if (form.endDate && !/^\d{4}-\d{2}-\d{2}$/.test(form.endDate)) {
      return 'সমাপ্তির তারিখ সঠিক ফরম্যাটে (YYYY-MM-DD) দিন।';
    }
    if (form.endDate && form.endDate < form.startDate) {
      return 'সমাপ্তির তারিখ শুরুর তারিখের আগে হতে পারবে না।';
    }
    if (form.orderDate && !/^\d{4}-\d{2}-\d{2}$/.test(form.orderDate)) {
      return 'আদেশের তারিখ সঠিক ফরম্যাটে (YYYY-MM-DD) দিন।';
    }
    return '';
  };

  const handleAddAdditionalCharge = async (e) => {
    e.preventDefault();
    if (!activeUser || saving) return;
    setSheetError('');

    const targetUid = activeUser.uid || activeUser.id;
    const existingIds = Array.isArray(activeUser.additionalOfficeIds)
      ? activeUser.additionalOfficeIds.filter((id) => Boolean(id))
      : [];

    if (!addForm.officeId) {
      setSheetError('অতিরিক্ত দায়িত্বের জন্য একটি অফিস নির্বাচন করুন।');
      return;
    }
    if (addForm.officeId === activeUser.officeId) {
      setSheetError('মূল কর্মস্থলকে অতিরিক্ত দায়িত্ব হিসেবে দেওয়া যাবে না।');
      return;
    }
    if (existingIds.includes(addForm.officeId)) {
      setSheetError('এই অফিসটি ইতোমধ্যে অতিরিক্ত দায়িত্ব হিসেবে যুক্ত আছে।');
      return;
    }
    if (existingIds.length >= 20) {
      setSheetError('সর্বোচ্চ ২০টি অতিরিক্ত অফিস নির্ধারণ করা যাবে।');
      return;
    }

    const dateErr = validateDates(addForm);
    if (dateErr) {
      setSheetError(dateErr);
      return;
    }

    setSaving(true);
    try {
      const nextAdditionalIds = [...existingIds, addForm.officeId];
      const batch = writeBatch(db);
      batch.update(doc(db, 'users', targetUid), {
        additionalOfficeIds: nextAdditionalIds,
        updatedAt: serverTimestamp()
      });

      const assignRef = doc(collection(db, 'users', targetUid, 'assignments'));
      batch.set(assignRef, {
        kind: 'additional_charge',
        officeId: addForm.officeId,
        districtOfficeId: computeDistrictOfficeId(addForm.officeId) || '',
        officeName: String(officeName(addForm.officeId)).slice(0, 160),
        designation: String(activeUser.designation || '').slice(0, 120),
        roleKey: activeUser.role,
        roleLabel: String(getRoleLabel(activeUser.role, roleRegistry) || activeUser.role).slice(0, 80),
        startDate: addForm.startDate,
        endDate: addForm.endDate || null,
        type: 'charge_started',
        orderNo: (addForm.orderNo || '').trim().slice(0, 120),
        orderDate: addForm.orderDate || null,
        reason: (addForm.reason || '').trim().slice(0, 500),
        createdBy: profile.uid,
        createdByName: String(profile.name || profile.email || 'Admin').slice(0, 120),
        createdAt: serverTimestamp()
      });

      await batch.commit();

      await logAudit({
        actor: profile,
        action: 'ADDITIONAL_CHARGE_ADDED',
        targetCollection: 'users',
        targetId: targetUid,
        oldValue: existingIds.map((id) => officeName(id)).join(', ') || 'None',
        newValue: officeName(addForm.officeId),
        reason: addForm.reason.trim() || 'Additional charge started',
        officeId: addForm.officeId,
        districtOfficeId: computeDistrictOfficeId(addForm.officeId) || activeUser.districtOfficeId || ''
      });

      setAddForm({
        officeId: '',
        startDate: todayStr,
        endDate: '',
        orderNo: '',
        orderDate: '',
        reason: ''
      });
      await loadData();
      showToast(`${officeName(addForm.officeId)} অতিরিক্ত দায়িত্ব হিসেবে যুক্ত করা হয়েছে।`);
    } catch (err) {
      setSheetError(err?.message || 'অতিরিক্ত দায়িত্ব সংরক্ষণ করা যায়নি।');
      handleFirestoreError(err, OperationType.UPDATE, `users/${targetUid}`);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveActingCharge = async (e) => {
    e.preventDefault();
    if (!activeUser || saving) return;
    setSheetError('');

    if (!actingForm.officeId) {
      setSheetError('চলতি দায়িত্বের জন্য অফিস নির্বাচন করুন।');
      return;
    }
    if (!actingForm.roleKey) {
      setSheetError('চলতি দায়িত্বের জন্য রোল নির্বাচন করুন।');
      return;
    }
    const dateErr = validateDates(actingForm);
    if (dateErr) {
      setSheetError(dateErr);
      return;
    }

    const targetUid = activeUser.uid || activeUser.id;
    const prevRecs = (assignmentsByUid.get(targetUid) || []).filter(
      (r) => r.kind === 'acting_charge' && !r.closedAt
    );

    setSaving(true);
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, 'users', targetUid), {
        actingOfficeId: actingForm.officeId,
        actingRoleKey: actingForm.roleKey,
        updatedAt: serverTimestamp()
      });

      for (const prev of prevRecs) {
        const candidateClose = addDaysDhaka(actingForm.startDate, -1);
        const closeDate =
          prev.startDate && candidateClose < prev.startDate ? actingForm.startDate : candidateClose;
        batch.update(doc(db, 'users', targetUid, 'assignments', prev.id), {
          endDate: closeDate,
          closedBy: profile.uid,
          closedAt: serverTimestamp()
        });
      }

      const assignRef = doc(collection(db, 'users', targetUid, 'assignments'));
      batch.set(assignRef, {
        kind: 'acting_charge',
        officeId: actingForm.officeId,
        districtOfficeId: computeDistrictOfficeId(actingForm.officeId) || '',
        officeName: String(officeName(actingForm.officeId)).slice(0, 160),
        designation: String(activeUser.designation || '').slice(0, 120),
        roleKey: actingForm.roleKey,
        roleLabel: String(
          getRoleLabel(actingForm.roleKey, roleRegistry) || actingForm.roleKey
        ).slice(0, 80),
        startDate: actingForm.startDate,
        endDate: actingForm.endDate || null,
        type: 'charge_started',
        orderNo: (actingForm.orderNo || '').trim().slice(0, 120),
        orderDate: actingForm.orderDate || null,
        reason: (actingForm.reason || '').trim().slice(0, 500),
        createdBy: profile.uid,
        createdByName: String(profile.name || profile.email || 'Admin').slice(0, 120),
        createdAt: serverTimestamp()
      });

      await batch.commit();

      await logAudit({
        actor: profile,
        action: 'ACTING_CHARGE_UPDATED',
        targetCollection: 'users',
        targetId: targetUid,
        oldValue: activeUser.actingOfficeId
          ? `${officeName(activeUser.actingOfficeId)} (${activeUser.actingRoleKey || ''})`
          : 'None',
        newValue: `${officeName(actingForm.officeId)} (${actingForm.roleKey})`,
        reason: actingForm.reason.trim() || 'Acting charge assigned',
        officeId: actingForm.officeId,
        districtOfficeId: computeDistrictOfficeId(actingForm.officeId) || activeUser.districtOfficeId || ''
      });

      await loadData();
      showToast('চলতি দায়িত্ব সফলভাবে নির্ধারণ করা হয়েছে।');
    } catch (err) {
      setSheetError(err?.message || 'চলতি দায়িত্ব সংরক্ষণ করা যায়নি।');
      handleFirestoreError(err, OperationType.UPDATE, `users/${targetUid}`);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAttachment = async (e) => {
    e.preventDefault();
    if (!activeUser || saving) return;
    setSheetError('');

    if (!attachForm.officeId) {
      setSheetError('সংযুক্তির জন্য একটি অফিস নির্বাচন করুন।');
      return;
    }
    if (attachForm.officeId === activeUser.officeId) {
      setSheetError('মূল কর্মস্থলে সংযুক্তি দেওয়া যাবে না।');
      return;
    }
    const dateErr = validateDates(attachForm);
    if (dateErr) {
      setSheetError(dateErr);
      return;
    }

    const targetUid = activeUser.uid || activeUser.id;
    const prevRecs = (assignmentsByUid.get(targetUid) || []).filter(
      (r) => r.kind === 'attachment' && !r.closedAt
    );

    setSaving(true);
    try {
      const batch = writeBatch(db);
      batch.update(doc(db, 'users', targetUid), {
        attachedOfficeId: attachForm.officeId,
        updatedAt: serverTimestamp()
      });

      for (const prev of prevRecs) {
        const candidateClose = addDaysDhaka(attachForm.startDate, -1);
        const closeDate =
          prev.startDate && candidateClose < prev.startDate ? attachForm.startDate : candidateClose;
        batch.update(doc(db, 'users', targetUid, 'assignments', prev.id), {
          endDate: closeDate,
          closedBy: profile.uid,
          closedAt: serverTimestamp()
        });
      }

      const assignRef = doc(collection(db, 'users', targetUid, 'assignments'));
      batch.set(assignRef, {
        kind: 'attachment',
        officeId: attachForm.officeId,
        districtOfficeId: computeDistrictOfficeId(attachForm.officeId) || '',
        officeName: String(officeName(attachForm.officeId)).slice(0, 160),
        designation: String(activeUser.designation || '').slice(0, 120),
        roleKey: activeUser.role,
        roleLabel: String(getRoleLabel(activeUser.role, roleRegistry) || activeUser.role).slice(0, 80),
        startDate: attachForm.startDate,
        endDate: attachForm.endDate || null,
        type: 'charge_started',
        orderNo: (attachForm.orderNo || '').trim().slice(0, 120),
        orderDate: attachForm.orderDate || null,
        reason: (attachForm.reason || '').trim().slice(0, 500),
        createdBy: profile.uid,
        createdByName: String(profile.name || profile.email || 'Admin').slice(0, 120),
        createdAt: serverTimestamp()
      });

      await batch.commit();

      await logAudit({
        actor: profile,
        action: 'ATTACHMENT_UPDATED',
        targetCollection: 'users',
        targetId: targetUid,
        oldValue: activeUser.attachedOfficeId ? officeName(activeUser.attachedOfficeId) : 'None',
        newValue: officeName(attachForm.officeId),
        reason: attachForm.reason.trim() || 'Attachment assigned',
        officeId: attachForm.officeId,
        districtOfficeId: computeDistrictOfficeId(attachForm.officeId) || activeUser.districtOfficeId || ''
      });

      await loadData();
      showToast('সংযুক্তি সফলভাবে সংরক্ষণ করা হয়েছে।');
    } catch (err) {
      setSheetError(err?.message || 'সংযুক্তি সংরক্ষণ করা যায়নি।');
      handleFirestoreError(err, OperationType.UPDATE, `users/${targetUid}`);
    } finally {
      setSaving(false);
    }
  };

  const confirmCloseEntry = async () => {
    if (!activeUser || !closingTarget || saving) return;
    setSheetError('');
    const { kind, officeId, closeDate } = closingTarget;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(closeDate || '')) {
      setSheetError('সমাপ্তির সঠিক তারিখ দিন।');
      return;
    }

    const targetUid = activeUser.uid || activeUser.id;
    const allRecs = assignmentsByUid.get(targetUid) || [];
    const openRecs = allRecs.filter(
      (r) => r.kind === kind && !r.closedAt && (officeId == null || r.officeId === officeId)
    );

    setSaving(true);
    try {
      const batch = writeBatch(db);
      if (kind === 'additional_charge') {
        const existingIds = Array.isArray(activeUser.additionalOfficeIds)
          ? activeUser.additionalOfficeIds
          : [];
        batch.update(doc(db, 'users', targetUid), {
          additionalOfficeIds: existingIds.filter((id) => id !== officeId),
          updatedAt: serverTimestamp()
        });
      } else if (kind === 'acting_charge') {
        batch.update(doc(db, 'users', targetUid), {
          actingOfficeId: null,
          actingRoleKey: null,
          updatedAt: serverTimestamp()
        });
      } else if (kind === 'attachment') {
        batch.update(doc(db, 'users', targetUid), {
          attachedOfficeId: null,
          updatedAt: serverTimestamp()
        });
      }

      for (const rec of openRecs) {
        batch.update(doc(db, 'users', targetUid, 'assignments', rec.id), {
          endDate: closeDate,
          closedBy: profile.uid,
          closedAt: serverTimestamp()
        });
      }

      await batch.commit();

      await logAudit({
        actor: profile,
        action: `${kind.toUpperCase()}_ENDED`,
        targetCollection: 'users',
        targetId: targetUid,
        oldValue: officeName(officeId || activeUser.officeId),
        newValue: 'Closed',
        reason: `Assignment closed effective ${closeDate}`,
        officeId: officeId || activeUser.officeId || '',
        districtOfficeId: activeUser.districtOfficeId || ''
      });

      setClosingTarget(null);
      await loadData();
      showToast('দায়িত্ব / সংযুক্তি সফলভাবে সমাপ্ত করা হয়েছে।');
    } catch (err) {
      setSheetError(err?.message || 'সমাপ্ত করতে সমস্যা হয়েছে।');
      handleFirestoreError(err, OperationType.UPDATE, `users/${targetUid}`);
    } finally {
      setSaving(false);
    }
  };

  const activeUserInfo = useMemo(
    () => (activeUser ? getUserExpiredInfo(activeUser) : null),
    [activeUser, getUserExpiredInfo]
  );

  const filterChips = [
    { key: 'eligible', label: 'দায়িত্বযোগ্য সবাই', count: counts.eligible },
    { key: 'active', label: 'চলমান দায়িত্ব/সংযুক্তি', count: counts.active },
    { key: 'expired', label: 'মেয়াদ শেষ – এখনো চালু', count: counts.expired }
  ];

  return (
    <AppShell title="দায়িত্ব ও সংযুক্তি" showThemeToggle>
      <div className="space-y-5">
        <section className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100 font-display">
              দায়িত্ব ও সংযুক্তি ব্যবস্থাপনা
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              অতিরিক্ত দায়িত্ব (Additional Charge), চলতি দায়িত্ব (Acting Charge) এবং সংযুক্তি (Attachment) নির্ধারণ ও সমাপ্ত করুন
            </p>
          </div>
        </section>

        {counts.expired > 0 && (
          <section
            role="status"
            className="rounded-[18px] border border-amber-300 dark:border-amber-800 bg-amber-50/90 dark:bg-amber-950/40 p-4 flex flex-wrap items-center justify-between gap-3"
          >
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="w-5 h-5 text-amber-700 dark:text-amber-300 shrink-0 mt-0.5" />
              <div className="text-xs text-amber-950 dark:text-amber-100 space-y-0.5">
                <div className="font-bold">
                  {toBanglaDigits(counts.expired)} জন কর্মকর্তা/কর্মচারীর দায়িত্ব বা সংযুক্তির মেয়াদ শেষ হলেও এখনো চালু আছে
                </div>
                <p className="text-amber-800 dark:text-amber-300">
                  মেয়াদোত্তীর্ণ এন্ট্রি পর্যালোচনা করে &ldquo;শেষ করুন&rdquo; বাটনে ক্লিক করে আনুষ্ঠানিকভাবে সমাপ্ত করুন।
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setFilterMode('expired')}
              className="min-h-[40px] px-3.5 py-2 rounded-xl bg-amber-700 hover:bg-amber-800 text-white text-xs font-semibold shrink-0"
            >
              মেয়াদোত্তীর্ণ দেখুন
            </button>
          </section>
        )}

        {/* Search & Filter Chips */}
        <section className="space-y-3">
          <div className="relative max-w-md">
            <Search
              aria-hidden="true"
              className="w-4 h-4 text-slate-400 dark:text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              type="search"
              placeholder="নাম, ইমেইল, পদবি বা অফিস খুঁজুন..."
              className="w-full min-h-[44px] pl-10 pr-10 py-2 rounded-[16px] border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#0b6b4f] dark:focus:ring-[#4fd1a1]"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                aria-label="Clear search"
                className="min-h-[44px] min-w-[44px] absolute right-0 top-1/2 -translate-y-1/2 inline-flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <div role="group" aria-label="Filter staff" className="flex flex-wrap items-center gap-2">
            {filterChips.map((chip) => {
              const selected = filterMode === chip.key;
              return (
                <button
                  key={chip.key}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setFilterMode(chip.key)}
                  className={`min-h-[44px] px-3.5 py-2 rounded-[14px] border text-xs font-semibold inline-flex items-center gap-2 transition-colors ${
                    selected
                      ? 'bg-[#0b6b4f] dark:bg-[#4fd1a1] text-white dark:text-slate-950 border-[#0b6b4f] dark:border-[#4fd1a1]'
                      : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-800 hover:bg-slate-100/70 dark:hover:bg-slate-800'
                  }`}
                >
                  <span>{chip.label}</span>
                  <span
                    className={`px-1.5 py-0.5 rounded-[10px] text-[11px] font-mono-tabular ${
                      selected
                        ? 'bg-white/20 dark:bg-slate-950/20'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    {chip.count}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        {errorMsg && (
          <div
            role="alert"
            className="p-3.5 rounded-[16px] bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/70 text-xs text-rose-800 dark:text-rose-200"
          >
            {errorMsg}
          </div>
        )}

        {loading ? (
          <div className="rounded-[22px] border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-10 text-center text-sm text-slate-500">
            লোড হচ্ছে...
          </div>
        ) : filteredUsers.length === 0 ? (
          <div className="rounded-[22px] border border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900/60 p-10 text-center space-y-2">
            <Users className="w-7 h-7 text-slate-400 mx-auto" />
            <div className="text-sm font-semibold text-slate-800 dark:text-slate-200">
              কোনো দায়িত্বযোগ্য কর্মকর্তা/কর্মচারী পাওয়া যায়নি
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              আপনার আওতাধীন অফিসে অনুমোদিত ও সক্রিয় দায়িত্বযোগ্য (chargeEligible) ব্যবহারকারী থাকলে এখানে প্রদর্শিত হবে।
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {filteredUsers.map((u) => {
              const uid = u.uid || u.id;
              const info = getUserExpiredInfo(u);
              const initials = getUserInitials(u.name, u.email);

              return (
                <article
                  key={uid}
                  className={`rounded-[20px] border bg-white dark:bg-slate-900 p-4 sm:p-5 flex flex-col justify-between gap-4 ${
                    info.hasExpired
                      ? 'border-amber-400 dark:border-amber-700'
                      : 'border-slate-200 dark:border-slate-800'
                  }`}
                >
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-11 h-11 rounded-[14px] bg-[#0b6b4f]/10 dark:bg-[#4fd1a1]/15 text-[#0b6b4f] dark:text-[#4fd1a1] font-bold text-sm flex items-center justify-center shrink-0">
                          {initials}
                        </div>
                        <div className="min-w-0">
                          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 truncate">
                            {u.name || u.email || uid}
                          </h2>
                          <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                            {u.designation || 'No designation'} · {officeName(u.officeId)}
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <StatusBadge kind="role" value={u.role || ''} />
                        {info.hasExpired && (
                          <span className="px-2 py-0.5 rounded-[8px] bg-amber-100 dark:bg-amber-950/70 text-amber-800 dark:text-amber-200 border border-amber-300 dark:border-amber-800 text-[10.5px] font-semibold">
                            মেয়াদ শেষ – এখনো চালু
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="rounded-[14px] bg-slate-50 dark:bg-slate-800/50 border border-slate-200/70 dark:border-slate-800 p-3 space-y-2.5 text-xs">
                      {/* Additional charges */}
                      <div>
                        <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                          অতিরিক্ত দায়িত্ব ({info.additionalIds.length})
                        </div>
                        {info.additionalIds.length === 0 ? (
                          <div className="text-slate-500 dark:text-slate-400 mt-0.5">নেই</div>
                        ) : (
                          <ul className="mt-1 space-y-1">
                            {info.additionalIds.map((oid) => {
                              const rec = getOpenAssignment(info.recs, 'additional_charge', oid);
                              const expired = isExpiredOpenAssignment(rec, todayStr);
                              return (
                                <li
                                  key={oid}
                                  className="flex flex-wrap items-center justify-between gap-1.5 text-amber-800 dark:text-amber-300 font-medium"
                                >
                                  <span className="truncate">{officeName(oid)}</span>
                                  {expired && (
                                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-200/70 dark:bg-amber-900/70 text-amber-900 dark:text-amber-100 font-semibold">
                                      মেয়াদ শেষ – এখনো চালু ({rec.endDate})
                                    </span>
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>

                      {/* Acting charge */}
                      <div className="pt-2 border-t border-slate-200/70 dark:border-slate-700/60 flex flex-wrap items-center justify-between gap-1.5">
                        <div>
                          <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                            চলতি দায়িত্ব
                          </div>
                          {u.actingOfficeId && u.actingRoleKey ? (
                            <div className="font-medium text-sky-800 dark:text-sky-300 mt-0.5">
                              {officeName(u.actingOfficeId)} ({getRoleLabel(u.actingRoleKey, roleRegistry)})
                            </div>
                          ) : (
                            <div className="text-slate-500 dark:text-slate-400 mt-0.5">নেই</div>
                          )}
                        </div>
                        {info.expiredActing && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-200/70 dark:bg-amber-900/70 text-amber-900 dark:text-amber-100 font-semibold">
                            মেয়াদ শেষ – এখনো চালু
                          </span>
                        )}
                      </div>

                      {/* Attachment */}
                      <div className="pt-2 border-t border-slate-200/70 dark:border-slate-700/60 flex flex-wrap items-center justify-between gap-1.5">
                        <div>
                          <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                            সংযুক্তি (Attachment)
                          </div>
                          {u.attachedOfficeId ? (
                            <div className="font-medium text-violet-800 dark:text-violet-300 mt-0.5">
                              {officeName(u.attachedOfficeId)}
                            </div>
                          ) : (
                            <div className="text-slate-500 dark:text-slate-400 mt-0.5">নেই</div>
                          )}
                        </div>
                        {info.expiredAttachment && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-200/70 dark:bg-amber-900/70 text-amber-900 dark:text-amber-100 font-semibold">
                            মেয়াদ শেষ – এখনো চালু
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => openManageSheet(u)}
                    className="w-full min-h-[44px] px-4 py-2.5 rounded-[14px] bg-[#0b6b4f] hover:bg-[#095941] dark:bg-[#4fd1a1] dark:hover:bg-[#3fc090] text-white dark:text-slate-950 text-xs font-semibold inline-flex items-center justify-center gap-2 transition-colors"
                  >
                    <Briefcase className="w-4 h-4 shrink-0" />
                    <span>দায়িত্ব ও সংযুক্তি পরিচালনা</span>
                  </button>
                </article>
              );
            })}
          </div>
        )}
      </div>

      {/* Assignment Management Sheet */}
      <BottomSheet
        open={sheetOpen && Boolean(activeUser)}
        onClose={saving ? undefined : () => setSheetOpen(false)}
        title="দায়িত্ব ও সংযুক্তি ব্যবস্থাপনা"
        subtitle={
          activeUser
            ? `${activeUser.name || activeUser.email} · ${getRoleLabel(activeUser.role, roleRegistry)}`
            : ''
        }
        maxWidthClass="sm:max-w-2xl"
      >
        {activeUser && activeUserInfo && (
          <div className="space-y-4">
            <div className="p-3.5 rounded-[16px] bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                  মূল কর্মস্থল (Primary Office)
                </div>
                <div className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5 mt-0.5">
                  <Building2 className="w-4 h-4 text-[#0b6b4f] dark:text-[#4fd1a1]" />
                  <span>{officeName(activeUser.officeId)}</span>
                </div>
              </div>
              <StatusBadge kind="role" value={activeUser.role || ''} />
            </div>

            {/* Sheet Tabs */}
            <div className="grid grid-cols-3 gap-1 p-1 bg-slate-200/70 dark:bg-slate-800 rounded-xl">
              <button
                type="button"
                onClick={() => {
                  setSheetTab('additional');
                  setClosingTarget(null);
                  setSheetError('');
                }}
                className={`min-h-[42px] px-2 rounded-lg text-xs font-semibold transition-colors ${
                  sheetTab === 'additional'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-300'
                }`}
              >
                অতিরিক্ত দায়িত্ব ({activeUserInfo.additionalIds.length})
              </button>
              <button
                type="button"
                onClick={() => {
                  setSheetTab('acting');
                  setClosingTarget(null);
                  setSheetError('');
                }}
                className={`min-h-[42px] px-2 rounded-lg text-xs font-semibold transition-colors ${
                  sheetTab === 'acting'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-300'
                }`}
              >
                চলতি দায়িত্ব
              </button>
              <button
                type="button"
                onClick={() => {
                  setSheetTab('attachment');
                  setClosingTarget(null);
                  setSheetError('');
                }}
                className={`min-h-[42px] px-2 rounded-lg text-xs font-semibold transition-colors ${
                  sheetTab === 'attachment'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-300'
                }`}
              >
                সংযুক্তি
              </button>
            </div>

            {sheetError && (
              <div
                role="alert"
                className="p-3 rounded-[14px] bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/70 text-xs text-rose-800 dark:text-rose-200"
              >
                {sheetError}
              </div>
            )}

            {/* Close confirmation bar */}
            {closingTarget && (
              <div className="p-3.5 rounded-[16px] border border-rose-300 dark:border-rose-800 bg-rose-50/70 dark:bg-rose-950/30 space-y-3">
                <div className="text-xs font-semibold text-rose-900 dark:text-rose-100">
                  সমাপ্ত নিশ্চিত করুন: {closingTarget.label}
                </div>
                <div className="flex flex-wrap items-end gap-2">
                  <div className="flex-1 min-w-[160px]">
                    <label className="block text-[11px] font-semibold text-rose-800 dark:text-rose-200 mb-1">
                      সমাপ্তির তারিখ
                    </label>
                    <input
                      type="date"
                      value={closingTarget.closeDate}
                      onChange={(e) =>
                        setClosingTarget((prev) => ({ ...prev, closeDate: e.target.value }))
                      }
                      className={INPUT_CLASS}
                    />
                  </div>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={confirmCloseEntry}
                    className="min-h-[44px] px-4 py-2 rounded-xl bg-rose-700 hover:bg-rose-800 text-white text-xs font-semibold disabled:opacity-50"
                  >
                    {saving ? 'সংরক্ষণ হচ্ছে...' : 'নিশ্চিত করুন'}
                  </button>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => setClosingTarget(null)}
                    className="min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-xs font-semibold"
                  >
                    বাতিল
                  </button>
                </div>
              </div>
            )}

            {/* TAB 1: ADDITIONAL CHARGE */}
            {sheetTab === 'additional' && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="text-xs font-bold text-slate-700 dark:text-slate-300">
                    বর্তমান অতিরিক্ত দায়িত্বসমূহ
                  </div>
                  {activeUserInfo.additionalIds.length === 0 ? (
                    <div className="p-3.5 rounded-[14px] border border-dashed border-slate-300 dark:border-slate-700 text-xs text-slate-500">
                      এখনো কোনো অতিরিক্ত দায়িত্ব নেই।
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {activeUserInfo.additionalIds.map((oid) => {
                        const rec = getOpenAssignment(activeUserInfo.recs, 'additional_charge', oid);
                        const expired = isExpiredOpenAssignment(rec, todayStr);
                        return (
                          <div
                            key={oid}
                            className={`p-3 rounded-[14px] border flex flex-wrap items-center justify-between gap-2 ${
                              expired
                                ? 'border-amber-300 dark:border-amber-800 bg-amber-50/70 dark:bg-amber-950/30'
                                : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900'
                            }`}
                          >
                            <div className="min-w-0 space-y-0.5">
                              <div className="text-xs font-bold text-slate-900 dark:text-slate-100">
                                {officeName(oid)}
                              </div>
                              <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono-tabular">
                                শুরু: {rec?.startDate || '—'}
                                {rec?.endDate ? ` · নির্ধারিত শেষ: ${rec.endDate}` : ' · চলমান'}
                                {rec?.orderNo ? ` · আদেশ: ${rec.orderNo}` : ''}
                              </div>
                              {expired && (
                                <span className="inline-block text-[10.5px] font-semibold px-2 py-0.5 rounded bg-amber-200/80 dark:bg-amber-900 text-amber-950 dark:text-amber-100">
                                  মেয়াদ শেষ – এখনো চালু
                                </span>
                              )}
                            </div>
                            <button
                              type="button"
                              disabled={saving}
                              onClick={() =>
                                setClosingTarget({
                                  kind: 'additional_charge',
                                  officeId: oid,
                                  label: `অতিরিক্ত দায়িত্ব · ${officeName(oid)}`,
                                  closeDate: todayStr
                                })
                              }
                              className="min-h-[38px] px-3 py-1.5 rounded-xl border border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-xs font-semibold"
                            >
                              শেষ করুন
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <form
                  onSubmit={handleAddAdditionalCharge}
                  className="p-4 rounded-[16px] border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/40 space-y-3"
                >
                  <div className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                    <Plus className="w-4 h-4 text-[#0b6b4f] dark:text-[#4fd1a1]" />
                    <span>নতুন অতিরিক্ত দায়িত্ব যোগ করুন</span>
                  </div>

                  <div>
                    <label className={LABEL_CLASS}>অতিরিক্ত অফিস *</label>
                    <select
                      value={addForm.officeId}
                      onChange={(e) => setAddForm((p) => ({ ...p, officeId: e.target.value }))}
                      required
                      className={INPUT_CLASS}
                    >
                      <option value="">অফিস নির্বাচন করুন...</option>
                      {selectableOffices
                        .filter(
                          (o) =>
                            o.id !== activeUser.officeId &&
                            !activeUserInfo.additionalIds.includes(o.id)
                        )
                        .map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.name}
                          </option>
                        ))}
                    </select>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className={LABEL_CLASS}>শুরুর তারিখ *</label>
                      <input
                        type="date"
                        required
                        value={addForm.startDate}
                        onChange={(e) => setAddForm((p) => ({ ...p, startDate: e.target.value }))}
                        className={INPUT_CLASS}
                      />
                    </div>
                    <div>
                      <label className={LABEL_CLASS}>সমাপ্তির তারিখ (ঐচ্ছিক)</label>
                      <input
                        type="date"
                        value={addForm.endDate}
                        onChange={(e) => setAddForm((p) => ({ ...p, endDate: e.target.value }))}
                        className={INPUT_CLASS}
                      />
                    </div>
                    <div>
                      <label className={LABEL_CLASS}>আদেশ নং (ঐচ্ছিক)</label>
                      <input
                        type="text"
                        maxLength={120}
                        placeholder="স্মারক / আদেশ নং"
                        value={addForm.orderNo}
                        onChange={(e) => setAddForm((p) => ({ ...p, orderNo: e.target.value }))}
                        className={INPUT_CLASS}
                      />
                    </div>
                    <div>
                      <label className={LABEL_CLASS}>আদেশের তারিখ (ঐচ্ছিক)</label>
                      <input
                        type="date"
                        value={addForm.orderDate}
                        onChange={(e) => setAddForm((p) => ({ ...p, orderDate: e.target.value }))}
                        className={INPUT_CLASS}
                      />
                    </div>
                  </div>

                  <div>
                    <label className={LABEL_CLASS}>কারণ / মন্তব্য (ঐচ্ছিক)</label>
                    <input
                      type="text"
                      maxLength={500}
                      placeholder="দাপ্তরিক প্রয়োজন বা আদেশের সারসংক্ষেপ..."
                      value={addForm.reason}
                      onChange={(e) => setAddForm((p) => ({ ...p, reason: e.target.value }))}
                      className={INPUT_CLASS}
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={saving}
                    className="w-full min-h-[44px] px-4 py-2.5 rounded-xl bg-[#0b6b4f] hover:bg-[#095941] dark:bg-[#4fd1a1] dark:text-slate-950 text-white text-xs font-semibold disabled:opacity-50"
                  >
                    {saving ? 'সংরক্ষণ হচ্ছে...' : 'অতিরিক্ত দায়িত্ব যোগ করুন'}
                  </button>
                </form>
              </div>
            )}

            {/* TAB 2: ACTING CHARGE */}
            {sheetTab === 'acting' && (
              <div className="space-y-4">
                {activeUser.actingOfficeId && activeUser.actingRoleKey && (
                  <div
                    className={`p-3.5 rounded-[14px] border flex flex-wrap items-center justify-between gap-2 ${
                      activeUserInfo.expiredActing
                        ? 'border-amber-300 dark:border-amber-800 bg-amber-50/70 dark:bg-amber-950/30'
                        : 'border-sky-200 dark:border-sky-800 bg-sky-50/60 dark:bg-sky-950/30'
                    }`}
                  >
                    <div className="space-y-0.5">
                      <div className="text-xs font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                        <ShieldCheck className="w-4 h-4 text-sky-700 dark:text-sky-300" />
                        <span>
                          {officeName(activeUser.actingOfficeId)} ·{' '}
                          {getRoleLabel(activeUser.actingRoleKey, roleRegistry)}
                        </span>
                      </div>
                      {(() => {
                        const rec = getOpenAssignment(
                          activeUserInfo.recs,
                          'acting_charge',
                          activeUser.actingOfficeId
                        );
                        return (
                          <div className="text-[11px] text-slate-600 dark:text-slate-300 font-mono-tabular">
                            শুরু: {rec?.startDate || '—'}
                            {rec?.endDate ? ` · নির্ধারিত শেষ: ${rec.endDate}` : ' · চলমান'}
                          </div>
                        );
                      })()}
                      {activeUserInfo.expiredActing && (
                        <span className="inline-block text-[10.5px] font-semibold px-2 py-0.5 rounded bg-amber-200/80 dark:bg-amber-900 text-amber-950 dark:text-amber-100">
                          মেয়াদ শেষ – এখনো চালু
                        </span>
                      )}
                    </div>

                    <button
                      type="button"
                      disabled={saving}
                      onClick={() =>
                        setClosingTarget({
                          kind: 'acting_charge',
                          officeId: activeUser.actingOfficeId,
                          label: `চলতি দায়িত্ব · ${officeName(activeUser.actingOfficeId)}`,
                          closeDate: todayStr
                        })
                      }
                      className="min-h-[38px] px-3 py-1.5 rounded-xl border border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-xs font-semibold"
                    >
                      শেষ করুন
                    </button>
                  </div>
                )}

                <form
                  onSubmit={handleSaveActingCharge}
                  className="p-4 rounded-[16px] border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/40 space-y-3"
                >
                  <div className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                    <CalendarClock className="w-4 h-4 text-sky-700 dark:text-sky-300" />
                    <span>
                      {activeUser.actingOfficeId ? 'চলতি দায়িত্ব পরিবর্তন করুন' : 'চলতি দায়িত্ব নির্ধারণ করুন'}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className={LABEL_CLASS}>অফিস *</label>
                      <select
                        value={actingForm.officeId}
                        onChange={(e) => setActingForm((p) => ({ ...p, officeId: e.target.value }))}
                        required
                        className={INPUT_CLASS}
                      >
                        <option value="">অফিস নির্বাচন করুন...</option>
                        {selectableOffices.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className={LABEL_CLASS}>চলতি দায়িত্বের রোল *</label>
                      <select
                        value={actingForm.roleKey}
                        onChange={(e) => setActingForm((p) => ({ ...p, roleKey: e.target.value }))}
                        required
                        className={INPUT_CLASS}
                      >
                        <option value="">রোল নির্বাচন করুন...</option>
                        {actingRoles.map((r) => (
                          <option key={r.key} value={r.key}>
                            {r.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className={LABEL_CLASS}>শুরুর তারিখ *</label>
                      <input
                        type="date"
                        required
                        value={actingForm.startDate}
                        onChange={(e) => setActingForm((p) => ({ ...p, startDate: e.target.value }))}
                        className={INPUT_CLASS}
                      />
                    </div>
                    <div>
                      <label className={LABEL_CLASS}>সমাপ্তির তারিখ (ঐচ্ছিক)</label>
                      <input
                        type="date"
                        value={actingForm.endDate}
                        onChange={(e) => setActingForm((p) => ({ ...p, endDate: e.target.value }))}
                        className={INPUT_CLASS}
                      />
                    </div>
                    <div>
                      <label className={LABEL_CLASS}>আদেশ নং (ঐচ্ছিক)</label>
                      <input
                        type="text"
                        maxLength={120}
                        value={actingForm.orderNo}
                        onChange={(e) => setActingForm((p) => ({ ...p, orderNo: e.target.value }))}
                        className={INPUT_CLASS}
                      />
                    </div>
                    <div>
                      <label className={LABEL_CLASS}>আদেশের তারিখ (ঐচ্ছিক)</label>
                      <input
                        type="date"
                        value={actingForm.orderDate}
                        onChange={(e) => setActingForm((p) => ({ ...p, orderDate: e.target.value }))}
                        className={INPUT_CLASS}
                      />
                    </div>
                  </div>

                  <div>
                    <label className={LABEL_CLASS}>কারণ / মন্তব্য (ঐচ্ছিক)</label>
                    <input
                      type="text"
                      maxLength={500}
                      value={actingForm.reason}
                      onChange={(e) => setActingForm((p) => ({ ...p, reason: e.target.value }))}
                      className={INPUT_CLASS}
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={saving}
                    className="w-full min-h-[44px] px-4 py-2.5 rounded-xl bg-[#0b6b4f] hover:bg-[#095941] dark:bg-[#4fd1a1] dark:text-slate-950 text-white text-xs font-semibold disabled:opacity-50"
                  >
                    {saving ? 'সংরক্ষণ হচ্ছে...' : 'চলতি দায়িত্ব সংরক্ষণ করুন'}
                  </button>
                </form>
              </div>
            )}

            {/* TAB 3: ATTACHMENT */}
            {sheetTab === 'attachment' && (
              <div className="space-y-4">
                {activeUser.attachedOfficeId && (
                  <div
                    className={`p-3.5 rounded-[14px] border flex flex-wrap items-center justify-between gap-2 ${
                      activeUserInfo.expiredAttachment
                        ? 'border-amber-300 dark:border-amber-800 bg-amber-50/70 dark:bg-amber-950/30'
                        : 'border-violet-200 dark:border-violet-800 bg-violet-50/60 dark:bg-violet-950/30'
                    }`}
                  >
                    <div className="space-y-0.5">
                      <div className="text-xs font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                        <Paperclip className="w-4 h-4 text-violet-700 dark:text-violet-300" />
                        <span>{officeName(activeUser.attachedOfficeId)}</span>
                      </div>
                      {(() => {
                        const rec = getOpenAssignment(
                          activeUserInfo.recs,
                          'attachment',
                          activeUser.attachedOfficeId
                        );
                        return (
                          <div className="text-[11px] text-slate-600 dark:text-slate-300 font-mono-tabular">
                            শুরু: {rec?.startDate || '—'}
                            {rec?.endDate ? ` · নির্ধারিত শেষ: ${rec.endDate}` : ' · চলমান'}
                          </div>
                        );
                      })()}
                      {activeUserInfo.expiredAttachment && (
                        <span className="inline-block text-[10.5px] font-semibold px-2 py-0.5 rounded bg-amber-200/80 dark:bg-amber-900 text-amber-950 dark:text-amber-100">
                          মেয়াদ শেষ – এখনো চালু
                        </span>
                      )}
                    </div>

                    <button
                      type="button"
                      disabled={saving}
                      onClick={() =>
                        setClosingTarget({
                          kind: 'attachment',
                          officeId: activeUser.attachedOfficeId,
                          label: `সংযুক্তি · ${officeName(activeUser.attachedOfficeId)}`,
                          closeDate: todayStr
                        })
                      }
                      className="min-h-[38px] px-3 py-1.5 rounded-xl border border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-xs font-semibold"
                    >
                      শেষ করুন
                    </button>
                  </div>
                )}

                <form
                  onSubmit={handleSaveAttachment}
                  className="p-4 rounded-[16px] border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/40 space-y-3"
                >
                  <div className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                    <Paperclip className="w-4 h-4 text-violet-700 dark:text-violet-300" />
                    <span>
                      {activeUser.attachedOfficeId ? 'সংযুক্তি পরিবর্তন করুন' : 'সংযুক্তি (Attachment) নির্ধারণ করুন'}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    সংযুক্তি সক্রিয় থাকলে কর্মচারীর ছুটি ও ফিল্ড ডিউটি আবেদন সংযুক্ত অফিসের অনুমোদন চেইনে পাঠানো হবে।
                  </p>

                  <div>
                    <label className={LABEL_CLASS}>সংযুক্ত অফিস *</label>
                    <select
                      value={attachForm.officeId}
                      onChange={(e) => setAttachForm((p) => ({ ...p, officeId: e.target.value }))}
                      required
                      className={INPUT_CLASS}
                    >
                      <option value="">অফিস নির্বাচন করুন...</option>
                      {selectableOffices
                        .filter((o) => o.id !== activeUser.officeId)
                        .map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.name}
                          </option>
                        ))}
                    </select>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className={LABEL_CLASS}>শুরুর তারিখ *</label>
                      <input
                        type="date"
                        required
                        value={attachForm.startDate}
                        onChange={(e) => setAttachForm((p) => ({ ...p, startDate: e.target.value }))}
                        className={INPUT_CLASS}
                      />
                    </div>
                    <div>
                      <label className={LABEL_CLASS}>সমাপ্তির তারিখ (ঐচ্ছিক)</label>
                      <input
                        type="date"
                        value={attachForm.endDate}
                        onChange={(e) => setAttachForm((p) => ({ ...p, endDate: e.target.value }))}
                        className={INPUT_CLASS}
                      />
                    </div>
                    <div>
                      <label className={LABEL_CLASS}>আদেশ নং (ঐচ্ছিক)</label>
                      <input
                        type="text"
                        maxLength={120}
                        value={attachForm.orderNo}
                        onChange={(e) => setAttachForm((p) => ({ ...p, orderNo: e.target.value }))}
                        className={INPUT_CLASS}
                      />
                    </div>
                    <div>
                      <label className={LABEL_CLASS}>আদেশের তারিখ (ঐচ্ছিক)</label>
                      <input
                        type="date"
                        value={attachForm.orderDate}
                        onChange={(e) => setAttachForm((p) => ({ ...p, orderDate: e.target.value }))}
                        className={INPUT_CLASS}
                      />
                    </div>
                  </div>

                  <div>
                    <label className={LABEL_CLASS}>কারণ / মন্তব্য (ঐচ্ছিক)</label>
                    <input
                      type="text"
                      maxLength={500}
                      value={attachForm.reason}
                      onChange={(e) => setAttachForm((p) => ({ ...p, reason: e.target.value }))}
                      className={INPUT_CLASS}
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={saving}
                    className="w-full min-h-[44px] px-4 py-2.5 rounded-xl bg-[#0b6b4f] hover:bg-[#095941] dark:bg-[#4fd1a1] dark:text-slate-950 text-white text-xs font-semibold disabled:opacity-50"
                  >
                    {saving ? 'সংরক্ষণ হচ্ছে...' : 'সংযুক্তি সংরক্ষণ করুন'}
                  </button>
                </form>
              </div>
            )}
          </div>
        )}
      </BottomSheet>

      {toastMsg && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-20 lg:bottom-6 left-1/2 -translate-x-1/2 z-[120] max-w-[calc(100vw-2rem)] px-4 py-3 rounded-[16px] bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-950 shadow-xl flex items-center gap-2.5 text-sm font-medium"
        >
          <CheckCircle2 className="w-4 h-4 text-[#4fd1a1] dark:text-[#0b6b4f] shrink-0" />
          <span className="truncate">{toastMsg}</span>
        </div>
      )}
    </AppShell>
  );
}
