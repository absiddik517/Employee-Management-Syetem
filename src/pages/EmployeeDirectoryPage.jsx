import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore';
import {
  Briefcase,
  Building2,
  Calendar,
  Check,
  ChevronRight,
  Clock,
  Copy,
  FileText,
  LayoutGrid,
  Mail,
  MapPin,
  Phone,
  Search,
  Table2,
  User as UserIcon,
  Users,
  X
} from 'lucide-react';
import AppShell from '../components/AppShell.jsx';
import StatusText from '../components/StatusText.jsx';
import BottomSheet from '../components/users/BottomSheet.jsx';
import AssignmentsTimeline from '../components/users/AssignmentsTimeline.jsx';
import { getUserInitials } from '../components/users/StatusBadge.jsx';
import { getLevelShortLabel } from '../components/offices/officeHelpers.js';
import { useAuth } from '../context/AuthContext.jsx';
import { db, OperationType, handleFirestoreError, withTimeout } from '../firebase/config.js';
import {
  getActingGrant,
  getAuthorityOfficeIds,
  getPermissionScope,
  getRoleLabel,
  getWorkingOfficeId,
  normalizeRole,
  rankOf
} from '../lib/permissions.js';
import { formatDhakaTime, formatDisplayDate, getCurrentMonthDhaka } from '../utils/dhakaTime.js';

const SCOPE_WEIGHT = {
  none: 0,
  self: 1,
  office: 2,
  subtree: 3,
  all: 4
};

function maxScopeValue(a, b) {
  return (SCOPE_WEIGHT[a] || 0) >= (SCOPE_WEIGHT[b] || 0) ? a : b;
}

function buildScopedCapabilities(permKey, ownUser, actingUser, roleRegistry, authorityIds) {
  const ownScope = ownUser ? getPermissionScope(ownUser, permKey, roleRegistry) || 'none' : 'none';
  const actScope = actingUser ? getPermissionScope(actingUser, permKey, roleRegistry) || 'none' : 'none';

  const hasAll = ownScope === 'all';
  const hasSelf = ownScope === 'self';
  const officeScopes = new Map();

  if (ownScope === 'office' || ownScope === 'subtree') {
    for (const oid of authorityIds) {
      if (!oid) continue;
      officeScopes.set(oid, maxScopeValue(officeScopes.get(oid) || 'none', ownScope));
    }
  }

  if ((actScope === 'office' || actScope === 'subtree') && actingUser?.actingOfficeId) {
    const oid = actingUser.actingOfficeId;
    officeScopes.set(oid, maxScopeValue(officeScopes.get(oid) || 'none', actScope));
  }

  return { ownScope, actScope, hasAll, hasSelf, officeScopes };
}

function computeDescendantOfficeTree(rootIds, offices) {
  const allowedIds = new Set();
  const ownIds = new Set();
  const queue = [];

  for (const id of rootIds) {
    if (!id || allowedIds.has(id)) continue;
    allowedIds.add(id);
    ownIds.add(id);
    queue.push(id);
  }

  while (queue.length > 0) {
    const parentId = queue.shift();
    for (const office of offices) {
      if (office.parentOfficeId === parentId && !allowedIds.has(office.id)) {
        allowedIds.add(office.id);
        queue.push(office.id);
      }
    }
  }

  const subIds = new Set();
  for (const id of allowedIds) {
    if (!ownIds.has(id)) subIds.add(id);
  }

  return { allowedIds, ownIds, subIds };
}

function getEmployeeRelatedOfficeIds(emp) {
  if (!emp) return [];
  const ids = [];
  const push = (val) => {
    if (typeof val === 'string' && val.trim() && !ids.includes(val.trim())) {
      ids.push(val.trim());
    }
  };
  push(emp.officeId);
  if (Array.isArray(emp.additionalOfficeIds)) {
    emp.additionalOfficeIds.forEach(push);
  }
  push(emp.attachedOfficeId);
  push(emp.actingOfficeId);
  return ids;
}

function empMatchesOfficeSet(emp, officeSet) {
  if (!emp || !officeSet || officeSet.size === 0) return false;
  return getEmployeeRelatedOfficeIds(emp).some((id) => officeSet.has(id));
}

function getChargeBadgesForEmployee(emp, filterOfficeId, allowedIds) {
  if (!emp) return [];
  const targetSet =
    filterOfficeId && filterOfficeId !== 'all'
      ? new Set([filterOfficeId])
      : allowedIds;

  const matchesSet = (id) => Boolean(id && (targetSet.size === 0 || targetSet.has(id)));
  const badges = [];

  if (
    Array.isArray(emp.additionalOfficeIds) &&
    emp.additionalOfficeIds.some((id) => id && id !== emp.officeId && matchesSet(id))
  ) {
    badges.push({
      key: 'additional',
      label: 'অতিরিক্ত দায়িত্ব',
      className:
        'border-amber-300/80 dark:border-amber-700/70 bg-amber-50 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300'
    });
  }

  if (emp.actingOfficeId && emp.actingRoleKey && matchesSet(emp.actingOfficeId)) {
    badges.push({
      key: 'acting',
      label: 'চলতি দায়িত্ব',
      className:
        'border-indigo-300/80 dark:border-indigo-700/70 bg-indigo-50 dark:bg-indigo-950/50 text-indigo-800 dark:text-indigo-300'
    });
  }

  if (emp.attachedOfficeId && matchesSet(emp.attachedOfficeId)) {
    badges.push({
      key: 'attachment',
      label: 'সংযুক্ত',
      className:
        'border-sky-300/80 dark:border-sky-700/70 bg-sky-50 dark:bg-sky-950/50 text-sky-800 dark:text-sky-300'
    });
  }

  return badges;
}

function DetailRow({ label, value, mono = false, action = null }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      <dt className="text-xs font-medium text-slate-500 dark:text-slate-400 shrink-0">{label}</dt>
      <dd className="min-w-0 flex items-center justify-end gap-2 text-right">
        <span
          className={`text-sm text-slate-900 dark:text-slate-100 break-words ${
            mono ? 'font-mono-tabular text-xs' : 'font-medium'
          }`}
        >
          {value || '—'}
        </span>
        {action}
      </dd>
    </div>
  );
}

export default function EmployeeDirectoryPage() {
  const {
    profile,
    effectiveAuthUser,
    roleRegistry,
    offices,
    userOffice,
    can,
    computeDistrictOfficeId
  } = useAuth();

  const [loading, setLoading] = useState(true);
  const [employees, setEmployees] = useState([]);
  const [search, setSearch] = useState('');
  const [scopeTab, setScopeTab] = useState('all'); // 'all' | 'own' | 'sub'
  const [selectedOfficeFilter, setSelectedOfficeFilter] = useState('all');
  const [viewMode, setViewMode] = useState('cards'); // 'cards' | 'table' (>=720px)
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [activeDetailTab, setActiveDetailTab] = useState('profile'); // 'profile' | 'attendance' | 'leave' | 'career'
  const [copiedEmail, setCopiedEmail] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Detail tab states
  const [detailMonth, setDetailMonth] = useState(() => getCurrentMonthDhaka());
  const [attendanceRecords, setAttendanceRecords] = useState([]);
  const [attendanceLoading, setAttendanceLoading] = useState(false);
  const [attendanceError, setAttendanceError] = useState('');

  const [leaveItems, setLeaveItems] = useState([]);
  const [leaveLoading, setLeaveLoading] = useState(false);
  const [leaveError, setLeaveError] = useState('');

  const [assignments, setAssignments] = useState([]);
  const [careerLoading, setCareerLoading] = useState(false);
  const [careerError, setCareerError] = useState('');

  const officeById = useMemo(() => new Map(offices.map((o) => [o.id, o])), [offices]);

  const officeName = useCallback(
    (id) => (id ? officeById.get(id)?.name || id : ''),
    [officeById]
  );

  const authorityOfficeIds = useMemo(
    () => getAuthorityOfficeIds(effectiveAuthUser),
    [effectiveAuthUser]
  );

  const actingGrant = useMemo(
    () => getActingGrant(effectiveAuthUser, roleRegistry),
    [effectiveAuthUser, roleRegistry]
  );

  const ownOnlyUser = useMemo(() => {
    if (!effectiveAuthUser) return null;
    return { ...effectiveAuthUser, actingOfficeId: '', actingRoleKey: '' };
  }, [effectiveAuthUser]);

  const actingOnlyUser = useMemo(() => {
    if (!effectiveAuthUser || !actingGrant) return null;
    return {
      uid: effectiveAuthUser.uid,
      id: effectiveAuthUser.id,
      approvalStatus: effectiveAuthUser.approvalStatus,
      status: effectiveAuthUser.status,
      actingOfficeId: actingGrant.officeId,
      actingRoleKey: actingGrant.role.key
    };
  }, [effectiveAuthUser, actingGrant]);

  const userViewCaps = useMemo(
    () =>
      buildScopedCapabilities(
        'user.view',
        ownOnlyUser,
        actingOnlyUser,
        roleRegistry,
        authorityOfficeIds
      ),
    [ownOnlyUser, actingOnlyUser, roleRegistry, authorityOfficeIds]
  );

  const attendanceViewCaps = useMemo(
    () =>
      buildScopedCapabilities(
        'attendance.view',
        ownOnlyUser,
        actingOnlyUser,
        roleRegistry,
        authorityOfficeIds
      ),
    [ownOnlyUser, actingOnlyUser, roleRegistry, authorityOfficeIds]
  );

  const leaveViewCaps = useMemo(
    () =>
      buildScopedCapabilities(
        'leave.view',
        ownOnlyUser,
        actingOnlyUser,
        roleRegistry,
        authorityOfficeIds
      ),
    [ownOnlyUser, actingOnlyUser, roleRegistry, authorityOfficeIds]
  );

  const leaveReviewCaps = useMemo(
    () =>
      buildScopedCapabilities(
        'leave.review',
        ownOnlyUser,
        actingOnlyUser,
        roleRegistry,
        authorityOfficeIds
      ),
    [ownOnlyUser, actingOnlyUser, roleRegistry, authorityOfficeIds]
  );

  const fieldDutyReviewCaps = useMemo(
    () =>
      buildScopedCapabilities(
        'fieldduty.review',
        ownOnlyUser,
        actingOnlyUser,
        roleRegistry,
        authorityOfficeIds
      ),
    [ownOnlyUser, actingOnlyUser, roleRegistry, authorityOfficeIds]
  );

  const { allowedIds, ownIds, subIds } = useMemo(() => {
    if (userViewCaps.hasAll) {
      const own = new Set(authorityOfficeIds);
      const allowed = new Set(offices.map((o) => o.id));
      const sub = new Set();
      for (const o of offices) {
        if (!own.has(o.id)) sub.add(o.id);
      }
      return { allowedIds: allowed, ownIds: own, subIds: sub };
    }

    const own = new Set(userViewCaps.officeScopes.keys());
    const subtreeRoots = [];
    for (const [oid, scope] of userViewCaps.officeScopes.entries()) {
      if (scope === 'subtree') subtreeRoots.push(oid);
    }

    const tree = computeDescendantOfficeTree(subtreeRoots, offices);
    const sub = new Set();
    for (const id of tree.allowedIds) {
      if (!own.has(id)) sub.add(id);
    }
    const allowed = new Set([...own, ...sub]);
    return { allowedIds: allowed, ownIds: own, subIds: sub };
  }, [userViewCaps, authorityOfficeIds, offices]);

  const scopedOffices = useMemo(() => {
    const list = offices.filter((o) => allowedIds.has(o.id));
    if (list.length === 0 && userViewCaps.hasAll) {
      return offices;
    }
    return list.sort((a, b) => {
      const aOwn = ownIds.has(a.id) ? 0 : 1;
      const bOwn = ownIds.has(b.id) ? 0 : 1;
      if (aOwn !== bOwn) return aOwn - bOwn;
      return (a.name || '').localeCompare(b.name || '');
    });
  }, [offices, allowedIds, ownIds, userViewCaps.hasAll]);

  useEffect(() => {
    setScopeTab('all');
    setSelectedOfficeFilter('all');
  }, [userOffice?.id]);

  useEffect(() => {
    setCopiedEmail(false);
    setActiveDetailTab('profile');
    setDetailMonth(getCurrentMonthDhaka());
    setAttendanceRecords([]);
    setAttendanceError('');
    setLeaveItems([]);
    setLeaveError('');
    setAssignments([]);
    setCareerError('');
  }, [selectedEmployee?.uid]);

  const loadDirectory = useCallback(async () => {
    if (!effectiveAuthUser) {
      setEmployees([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setErrorMsg('');

    try {
      let rawList = [];

      if (userViewCaps.hasAll) {
        const snap = await withTimeout(
          getDocs(collection(db, 'users')),
          15000,
          'কর্মচারী তালিকা লোড করতে সময় বেশি লাগছে।'
        );
        rawList = snap.docs.map((d) => ({ uid: d.id, id: d.id, ...d.data() }));
      } else if (userViewCaps.officeScopes.size > 0) {
        const queries = [];
        for (const [oid, scope] of userViewCaps.officeScopes.entries()) {
          if (!oid) continue;
          queries.push(getDocs(query(collection(db, 'users'), where('officeId', '==', oid))));
          queries.push(getDocs(query(collection(db, 'users'), where('attachedOfficeId', '==', oid))));
          queries.push(getDocs(query(collection(db, 'users'), where('actingOfficeId', '==', oid))));
          if (scope === 'subtree') {
            queries.push(getDocs(query(collection(db, 'users'), where('districtOfficeId', '==', oid))));
          }
        }
        if (userViewCaps.ownScope === 'office' || userViewCaps.ownScope === 'subtree') {
          if (effectiveAuthUser.officeId) {
            queries.push(
              getDocs(
                query(
                  collection(db, 'users'),
                  where('additionalOfficeIds', 'array-contains', effectiveAuthUser.officeId)
                )
              )
            );
          }
          if (
            Array.isArray(effectiveAuthUser.additionalOfficeIds) &&
            effectiveAuthUser.additionalOfficeIds.length > 0
          ) {
            queries.push(
              getDocs(
                query(
                  collection(db, 'users'),
                  where('additionalOfficeIds', 'array-contains-any', effectiveAuthUser.additionalOfficeIds)
                )
              )
            );
          }
        }
        if (
          actingGrant?.officeId &&
          (userViewCaps.actScope === 'office' || userViewCaps.actScope === 'subtree')
        ) {
          queries.push(
            getDocs(
              query(
                collection(db, 'users'),
                where('additionalOfficeIds', 'array-contains', actingGrant.officeId)
              )
            )
          );
        }
        if (profile?.uid) {
          queries.push(getDoc(doc(db, 'users', profile.uid)));
        }

        const snaps = await withTimeout(
          Promise.all(queries),
          15000,
          'কর্মচারী তালিকা লোড করতে সময় বেশি লাগছে।'
        );
        const byUid = new Map();
        for (const snap of snaps) {
          if (Array.isArray(snap.docs)) {
            for (const d of snap.docs) {
              byUid.set(d.id, { uid: d.id, id: d.id, ...d.data() });
            }
          } else if (typeof snap.exists === 'function' && snap.exists()) {
            byUid.set(snap.id, { uid: snap.id, id: snap.id, ...snap.data() });
          }
        }
        rawList = Array.from(byUid.values());
      } else if (userViewCaps.hasSelf && profile?.uid) {
        const selfSnap = await withTimeout(
          getDoc(doc(db, 'users', profile.uid)),
          12000,
          'কর্মচারী তথ্য লোড করতে সময় বেশি লাগছে।'
        );
        if (selfSnap.exists()) {
          rawList = [{ uid: selfSnap.id, id: selfSnap.id, ...selfSnap.data() }];
        }
      }

      const activeApproved = rawList.filter((u) => {
        if (u.approvalStatus !== 'approved') return false;
        if ((u.status || 'active') !== 'active') return false;
        if (!can('user.view', u)) return false;
        if (userViewCaps.hasAll) return true;
        if (allowedIds.size > 0) {
          if (empMatchesOfficeSet(u, allowedIds)) return true;
        }
        return userViewCaps.hasSelf && (u.uid || u.id) === profile?.uid;
      });

      activeApproved.sort((a, b) => {
        const rankDiff = rankOf(b.role, roleRegistry) - rankOf(a.role, roleRegistry);
        if (rankDiff !== 0) return rankDiff;
        return (a.name || a.email || '').localeCompare(b.name || b.email || '');
      });

      setEmployees(activeApproved);
    } catch (err) {
      setErrorMsg('কর্মচারী তালিকা লোড করা যায়নি।');
      handleFirestoreError(err, OperationType.LIST, 'users');
    } finally {
      setLoading(false);
    }
  }, [
    effectiveAuthUser,
    userViewCaps,
    profile?.uid,
    can,
    allowedIds,
    roleRegistry
  ]);

  useEffect(() => {
    loadDirectory();
  }, [loadDirectory]);

  const counts = useMemo(() => {
    let own = 0;
    let sub = 0;
    for (const emp of employees) {
      if (empMatchesOfficeSet(emp, ownIds)) own += 1;
      if (empMatchesOfficeSet(emp, subIds)) sub += 1;
    }
    return {
      all: employees.length,
      own,
      sub
    };
  }, [employees, ownIds, subIds]);

  const filteredEmployees = useMemo(() => {
    const q = search.trim().toLowerCase();
    return employees.filter((emp) => {
      if (scopeTab === 'own' && !empMatchesOfficeSet(emp, ownIds)) return false;
      if (scopeTab === 'sub' && !empMatchesOfficeSet(emp, subIds)) return false;
      if (selectedOfficeFilter !== 'all') {
        const related = getEmployeeRelatedOfficeIds(emp);
        if (!related.includes(selectedOfficeFilter)) return false;
      }

      if (!q) return true;
      const relatedNames = getEmployeeRelatedOfficeIds(emp)
        .map((id) => officeName(id).toLowerCase())
        .join(' ');
      const rLabel = getRoleLabel(normalizeRole(emp.role, roleRegistry) || emp.role, roleRegistry).toLowerCase();
      return (
        (emp.name || '').toLowerCase().includes(q) ||
        (emp.designation || '').toLowerCase().includes(q) ||
        (emp.mobile || '').toLowerCase().includes(q) ||
        (emp.email || '').toLowerCase().includes(q) ||
        relatedNames.includes(q) ||
        rLabel.includes(q)
      );
    });
  }, [employees, scopeTab, selectedOfficeFilter, search, ownIds, subIds, officeName, roleRegistry]);

  // Evaluate detail-tab visibility for the selected employee
  const selectedEmpTabAccess = useMemo(() => {
    if (!selectedEmployee) {
      return { attendance: false, leave: false, fieldDuty: false, leaveTab: false };
    }
    const uid = selectedEmployee.uid || selectedEmployee.id;
    const isSelf = Boolean(profile?.uid && uid === profile.uid);
    const relatedIds = getEmployeeRelatedOfficeIds(selectedEmployee);
    const workingOfficeId = getWorkingOfficeId(selectedEmployee) || selectedEmployee.officeId || '';

    const canPermOnAnyRelated = (perm) => {
      if (can(perm, selectedEmployee)) return true;
      return relatedIds.some((oid) =>
        can(perm, {
          uid,
          officeId: oid,
          districtOfficeId: computeDistrictOfficeId(oid)
        })
      );
    };

    const attendance = isSelf || canPermOnAnyRelated('attendance.view');
    const leaveReadByView = isSelf || canPermOnAnyRelated('leave.view') || attendance;

    const reviewTargetPrimary = {
      ...selectedEmployee,
      uid,
      applicantRole: selectedEmployee.role,
      officeId: workingOfficeId,
      districtOfficeId: computeDistrictOfficeId(workingOfficeId) || selectedEmployee.districtOfficeId || ''
    };
    const reviewTargetHome = {
      ...selectedEmployee,
      uid,
      applicantRole: selectedEmployee.role,
      officeId: selectedEmployee.officeId || '',
      districtOfficeId:
        selectedEmployee.districtOfficeId || computeDistrictOfficeId(selectedEmployee.officeId) || ''
    };

    const leave =
      leaveReadByView ||
      can('leave.review', reviewTargetPrimary) ||
      can('leave.review', reviewTargetHome);

    const fieldDuty =
      leaveReadByView ||
      can('fieldduty.review', reviewTargetPrimary) ||
      can('fieldduty.review', reviewTargetHome);

    return {
      attendance,
      leave,
      fieldDuty,
      leaveTab: leave || fieldDuty
    };
  }, [selectedEmployee, profile?.uid, can, computeDistrictOfficeId]);

  const detailTabs = useMemo(() => {
    const tabs = [{ key: 'profile', label: 'প্রোফাইল', Icon: UserIcon }];
    if (selectedEmpTabAccess.attendance) {
      tabs.push({ key: 'attendance', label: 'হাজিরা', Icon: Clock });
    }
    if (selectedEmpTabAccess.leaveTab) {
      tabs.push({ key: 'leave', label: 'ছুটি', Icon: Calendar });
    }
    tabs.push({ key: 'career', label: 'কর্মজীবন', Icon: Briefcase });
    return tabs;
  }, [selectedEmpTabAccess]);

  useEffect(() => {
    if (!detailTabs.some((t) => t.key === activeDetailTab)) {
      setActiveDetailTab('profile');
    }
  }, [detailTabs, activeDetailTab]);

  // Scoped Attendance loader for selected employee
  const loadEmployeeAttendance = useCallback(async () => {
    const empUid = selectedEmployee?.uid || selectedEmployee?.id;
    if (!empUid || !selectedEmpTabAccess.attendance || !profile?.uid) return;

    setAttendanceLoading(true);
    setAttendanceError('');

    try {
      const isSelf = empUid === profile.uid;
      let raw = [];

      if (isSelf || attendanceViewCaps.hasAll) {
        const snap = await withTimeout(
          getDocs(query(collection(db, 'attendance'), where('uid', '==', empUid))),
          12000,
          'হাজিরার তথ্য লোড করতে সময় বেশি লাগছে।'
        );
        raw = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      } else if (attendanceViewCaps.officeScopes.size > 0) {
        const queries = [];
        for (const [oid, scope] of attendanceViewCaps.officeScopes.entries()) {
          queries.push(
            getDocs(query(collection(db, 'attendance'), where('uid', '==', empUid), where('officeId', '==', oid)))
          );
          queries.push(
            getDocs(
              query(collection(db, 'attendance'), where('uid', '==', empUid), where('homeOfficeId', '==', oid))
            )
          );
          queries.push(
            getDocs(
              query(collection(db, 'attendance'), where('uid', '==', empUid), where('checkOutOfficeId', '==', oid))
            )
          );
          if (scope === 'subtree') {
            queries.push(
              getDocs(
                query(collection(db, 'attendance'), where('uid', '==', empUid), where('districtOfficeId', '==', oid))
              )
            );
            queries.push(
              getDocs(
                query(
                  collection(db, 'attendance'),
                  where('uid', '==', empUid),
                  where('homeDistrictOfficeId', '==', oid)
                )
              )
            );
            queries.push(
              getDocs(
                query(
                  collection(db, 'attendance'),
                  where('uid', '==', empUid),
                  where('checkOutDistrictOfficeId', '==', oid)
                )
              )
            );
          }
        }

        const snaps = await withTimeout(
          Promise.all(queries),
          12000,
          'হাজিরার তথ্য লোড করতে সময় বেশি লাগছে।'
        );
        const byId = new Map();
        for (const snap of snaps) {
          for (const d of snap.docs) {
            byId.set(d.id, { id: d.id, ...d.data() });
          }
        }
        raw = Array.from(byId.values());
      }

      const monthFiltered = raw
        .filter((rec) => !detailMonth || String(rec.date || '').startsWith(detailMonth))
        .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
      setAttendanceRecords(monthFiltered);
    } catch (err) {
      setAttendanceError('হাজিরার তথ্য লোড করা যায়নি।');
      handleFirestoreError(err, OperationType.LIST, 'attendance');
    } finally {
      setAttendanceLoading(false);
    }
  }, [selectedEmployee, selectedEmpTabAccess.attendance, profile?.uid, attendanceViewCaps, detailMonth]);

  // Scoped Leaves & Field Duties loader for selected employee
  const loadEmployeeLeaves = useCallback(async () => {
    const empUid = selectedEmployee?.uid || selectedEmployee?.id;
    if (!empUid || !selectedEmpTabAccess.leaveTab || !profile?.uid) return;

    setLeaveLoading(true);
    setLeaveError('');

    const runCollectionQueries = async (colName, reviewCaps, allowedFlag) => {
      if (!allowedFlag) return [];
      const isSelf = empUid === profile.uid;
      if (isSelf || leaveViewCaps.hasAll || attendanceViewCaps.hasAll || reviewCaps.hasAll) {
        const snap = await getDocs(query(collection(db, colName), where('uid', '==', empUid)));
        return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      }

      const allOfficeKeys = new Set([
        ...leaveViewCaps.officeScopes.keys(),
        ...attendanceViewCaps.officeScopes.keys(),
        ...reviewCaps.officeScopes.keys()
      ]);

      if (allOfficeKeys.size === 0) return [];

      const queries = [];
      for (const oid of allOfficeKeys) {
        const vScope = maxScopeValue(
          leaveViewCaps.officeScopes.get(oid) || 'none',
          attendanceViewCaps.officeScopes.get(oid) || 'none'
        );
        const rScope = reviewCaps.officeScopes.get(oid) || 'none';
        const anyOffice = vScope === 'office' || vScope === 'subtree' || rScope === 'office' || rScope === 'subtree';
        const anySubtree = vScope === 'subtree' || rScope === 'subtree';

        if (anyOffice) {
          queries.push(
            getDocs(query(collection(db, colName), where('uid', '==', empUid), where('officeId', '==', oid)))
          );
        }
        if (anySubtree) {
          queries.push(
            getDocs(query(collection(db, colName), where('uid', '==', empUid), where('districtOfficeId', '==', oid)))
          );
        }
        if (vScope === 'office' || vScope === 'subtree') {
          queries.push(
            getDocs(query(collection(db, colName), where('uid', '==', empUid), where('homeOfficeId', '==', oid)))
          );
        }
        if (vScope === 'subtree') {
          queries.push(
            getDocs(
              query(collection(db, colName), where('uid', '==', empUid), where('homeDistrictOfficeId', '==', oid))
            )
          );
        }
      }

      if (queries.length === 0) return [];
      const snaps = await Promise.all(queries);
      const byId = new Map();
      for (const snap of snaps) {
        for (const d of snap.docs) {
          byId.set(d.id, { id: d.id, ...d.data() });
        }
      }
      return Array.from(byId.values());
    };

    try {
      const [leavesList, fdList] = await withTimeout(
        Promise.all([
          runCollectionQueries('leaves', leaveReviewCaps, selectedEmpTabAccess.leave),
          runCollectionQueries('fieldDuties', fieldDutyReviewCaps, selectedEmpTabAccess.fieldDuty)
        ]),
        12000,
        'ছুটি ও ফিল্ড ডিউটির তথ্য লোড করতে সময় বেশি লাগছে।'
      );

      const merged = [
        ...leavesList.map((item) => ({ ...item, _kind: 'leave' })),
        ...fdList.map((item) => ({ ...item, _kind: 'fieldduty' }))
      ].sort((a, b) => String(b.startDate || '').localeCompare(String(a.startDate || '')));

      setLeaveItems(merged);
    } catch (err) {
      setLeaveError('ছুটি ও ফিল্ড ডিউটির তথ্য লোড করা যায়নি।');
      handleFirestoreError(err, OperationType.LIST, 'leaves');
    } finally {
      setLeaveLoading(false);
    }
  }, [
    selectedEmployee,
    selectedEmpTabAccess,
    profile?.uid,
    leaveViewCaps,
    attendanceViewCaps,
    leaveReviewCaps,
    fieldDutyReviewCaps
  ]);

  // Career / Assignments loader for selected employee
  const loadEmployeeCareer = useCallback(async () => {
    const empUid = selectedEmployee?.uid || selectedEmployee?.id;
    if (!empUid) return;

    setCareerLoading(true);
    setCareerError('');

    try {
      const snap = await withTimeout(
        getDocs(collection(db, 'users', empUid, 'assignments')),
        12000,
        'কর্মজীবন ইতিহাস লোড করতে সময় বেশি লাগছে।'
      );
      const list = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => {
          const aOpen = !a.endDate ? 0 : 1;
          const bOpen = !b.endDate ? 0 : 1;
          if (aOpen !== bOpen) return aOpen - bOpen;
          return String(b.startDate || '').localeCompare(String(a.startDate || ''));
        });
      setAssignments(list);
    } catch (err) {
      setCareerError('কর্মজীবনের ইতিহাস লোড করা যায়নি।');
      handleFirestoreError(err, OperationType.LIST, `users/${empUid}/assignments`);
    } finally {
      setCareerLoading(false);
    }
  }, [selectedEmployee]);

  useEffect(() => {
    if (!selectedEmployee) return;
    if (activeDetailTab === 'attendance') {
      loadEmployeeAttendance();
    } else if (activeDetailTab === 'leave') {
      loadEmployeeLeaves();
    } else if (activeDetailTab === 'career') {
      loadEmployeeCareer();
    }
  }, [
    selectedEmployee,
    activeDetailTab,
    loadEmployeeAttendance,
    loadEmployeeLeaves,
    loadEmployeeCareer
  ]);

  const handleCopyEmail = async (email) => {
    if (!email || !navigator?.clipboard) return;
    try {
      await navigator.clipboard.writeText(email);
      setCopiedEmail(true);
      setTimeout(() => setCopiedEmail(false), 1800);
    } catch {
      // ignore clipboard errors
    }
  };

  const scopeSummaryText = useMemo(() => {
    if (subIds.size > 0) {
      return `${employees.length} active staff across ${scopedOffices.length} offices`;
    }
    if (userOffice?.name) {
      return `${employees.length} active staff · ${userOffice.name}`;
    }
    return `${employees.length} active staff`;
  }, [employees.length, scopedOffices.length, subIds.size, userOffice?.name]);

  const selectedEmpOffice = selectedEmployee ? officeById.get(selectedEmployee.officeId) || null : null;
  const selectedEmpParentOffice = selectedEmpOffice?.parentOfficeId
    ? officeById.get(selectedEmpOffice.parentOfficeId) || null
    : null;

  return (
    <AppShell title="Employees" showThemeToggle>
      <div className="space-y-5">
        {/* Header */}
        <section className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100 font-display">
              Employees
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
              {scopeSummaryText}
            </p>
          </div>

          <div
            role="group"
            aria-label="List view switch"
            className="hidden min-[720px]:inline-flex items-center p-1 rounded-[16px] bg-slate-200/70 dark:bg-slate-800/80 border border-slate-200/80 dark:border-slate-700/80 self-start"
          >
            <button
              type="button"
              aria-pressed={viewMode === 'cards'}
              onClick={() => setViewMode('cards')}
              className={`min-h-[44px] px-3.5 py-2 rounded-[12px] text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b6b4f] dark:focus-visible:ring-[#4fd1a1] ${
                viewMode === 'cards'
                  ? 'bg-white dark:bg-slate-900 text-[#0b6b4f] dark:text-[#4fd1a1] shadow-xs'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <LayoutGrid className="w-4 h-4" />
              <span>Cards</span>
            </button>
            <button
              type="button"
              aria-pressed={viewMode === 'table'}
              onClick={() => setViewMode('table')}
              className={`min-h-[44px] px-3.5 py-2 rounded-[12px] text-xs font-semibold inline-flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b6b4f] dark:focus-visible:ring-[#4fd1a1] ${
                viewMode === 'table'
                  ? 'bg-white dark:bg-slate-900 text-[#0b6b4f] dark:text-[#4fd1a1] shadow-xs'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Table2 className="w-4 h-4" />
              <span>Table</span>
            </button>
          </div>
        </section>

        {/* Search & Office Filters */}
        <section className="space-y-3">
          <div className="flex flex-col min-[720px]:flex-row min-[720px]:items-center gap-3">
            <div className="relative flex-1 min-[720px]:max-w-md">
              <Search
                aria-hidden="true"
                className="w-4 h-4 text-slate-400 dark:text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
              />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                type="search"
                aria-label="Search employees by name, designation, office, or phone"
                placeholder="Search by name, designation, office, or phone..."
                className="w-full min-h-[44px] pl-10 pr-10 py-2 rounded-[16px] border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-base text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-[#0b6b4f] dark:focus:ring-[#4fd1a1] focus:border-transparent transition-colors"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  aria-label="Clear search"
                  className="min-h-[44px] min-w-[44px] absolute right-0 top-1/2 -translate-y-1/2 inline-flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-r-[16px]"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {scopedOffices.length > 1 && (
              <div className="min-[720px]:w-72">
                <select
                  aria-label="Filter by office"
                  value={selectedOfficeFilter}
                  onChange={(e) => setSelectedOfficeFilter(e.target.value)}
                  className="w-full min-h-[44px] px-3.5 py-2 rounded-[16px] border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-base sm:text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#0b6b4f] dark:focus:ring-[#4fd1a1] focus:border-transparent transition-colors"
                >
                  <option value="all">All offices ({scopedOffices.length})</option>
                  {scopedOffices.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name} ({getLevelShortLabel(o.level)})
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {subIds.size > 0 && (
            <div
              role="group"
              aria-label="Filter employees by office hierarchy"
              className="flex flex-wrap items-center gap-2"
            >
              {[
                { key: 'all', label: `All (${counts.all})` },
                { key: 'own', label: `My office (${counts.own})` },
                { key: 'sub', label: `Sub-offices (${counts.sub})` }
              ].map((tab) => {
                const selected = scopeTab === tab.key;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => {
                      setScopeTab(tab.key);
                      setSelectedOfficeFilter('all');
                    }}
                    className={`min-h-[44px] px-4 py-2 rounded-[14px] border text-xs font-semibold tabular-nums whitespace-nowrap shrink-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b6b4f] dark:focus-visible:ring-[#4fd1a1] ${
                      selected
                        ? 'bg-[#0b6b4f] dark:bg-[#4fd1a1] text-white dark:text-slate-950 border-[#0b6b4f] dark:border-[#4fd1a1]'
                        : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-800 hover:bg-slate-100/70 dark:hover:bg-slate-800'
                    }`}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {errorMsg && (
          <div
            role="alert"
            className="p-3.5 rounded-[16px] bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/70 text-xs text-rose-800 dark:text-rose-200"
          >
            {errorMsg}
          </div>
        )}

        {/* Directory List */}
        {loading ? (
          <div className="rounded-[22px] border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-10 text-center text-sm text-slate-500 dark:text-slate-400">
            Loading employees...
          </div>
        ) : filteredEmployees.length === 0 ? (
          <div className="rounded-[22px] border border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900/60 p-10 text-center space-y-3">
            <div className="w-12 h-12 rounded-[16px] bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 mx-auto flex items-center justify-center">
              <Users className="w-6 h-6" />
            </div>
            <div className="space-y-1">
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                No matching employees
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto">
                No active staff members match your current search or office filter.
              </p>
            </div>
            {(search || scopeTab !== 'all' || selectedOfficeFilter !== 'all') && (
              <button
                type="button"
                onClick={() => {
                  setSearch('');
                  setScopeTab('all');
                  setSelectedOfficeFilter('all');
                }}
                className="min-h-[44px] px-4 py-2 rounded-[14px] border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                Clear search and filters
              </button>
            )}
          </div>
        ) : (
          <>
            {/* Cards View: Always on <720px; optional on >=720px */}
            <div
              className={
                viewMode === 'cards'
                  ? 'grid grid-cols-1 min-[720px]:grid-cols-2 gap-3'
                  : 'grid grid-cols-1 gap-3 min-[720px]:hidden'
              }
            >
              {filteredEmployees.map((emp) => {
                const uid = emp.uid || emp.id;
                const isSelf = uid === profile?.uid;
                const displayName = emp.name || emp.email || uid;
                const initials = getUserInitials(emp.name, emp.email);
                const resolvedOffice = officeName(emp.officeId);
                const empRoleLabel = getRoleLabel(normalizeRole(emp.role, roleRegistry) || emp.role, roleRegistry);
                const chargeBadges = getChargeBadgesForEmployee(emp, selectedOfficeFilter, allowedIds);

                return (
                  <button
                    key={uid}
                    type="button"
                    onClick={() => setSelectedEmployee(emp)}
                    aria-label={`View details for ${displayName}`}
                    className="group w-full text-left min-h-[44px] rounded-[20px] border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-xs hover:border-[#0b6b4f]/40 dark:hover:border-[#4fd1a1]/40 hover:shadow-sm active:scale-[0.995] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b6b4f] dark:focus-visible:ring-[#4fd1a1]"
                  >
                    <div className="flex items-start gap-3.5">
                      <div
                        aria-hidden="true"
                        className="w-11 h-11 rounded-[14px] bg-[#0b6b4f]/10 dark:bg-[#4fd1a1]/15 text-[#0b6b4f] dark:text-[#4fd1a1] font-bold text-sm flex items-center justify-center shrink-0"
                      >
                        {initials}
                      </div>

                      <div className="min-w-0 flex-1 space-y-1.5">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-[15px] font-semibold text-slate-900 dark:text-slate-100 truncate">
                              {displayName}
                              {isSelf && (
                                <span className="ml-1.5 text-xs font-medium text-[#0b6b4f] dark:text-[#4fd1a1]">
                                  (You)
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
                              {emp.designation || 'Staff'} · {empRoleLabel}
                            </div>
                          </div>
                          <ChevronRight
                            aria-hidden="true"
                            className="w-4 h-4 text-slate-400 dark:text-slate-500 group-hover:text-[#0b6b4f] dark:group-hover:text-[#4fd1a1] transition-colors shrink-0 mt-1"
                          />
                        </div>

                        {chargeBadges.length > 0 && (
                          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                            {chargeBadges.map((b) => (
                              <span
                                key={b.key}
                                className={`inline-flex items-center px-2 py-0.5 rounded-[8px] border text-[11px] font-semibold leading-tight ${b.className}`}
                              >
                                {b.label}
                              </span>
                            ))}
                          </div>
                        )}

                        <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-slate-100 dark:border-slate-800/80 text-xs text-slate-600 dark:text-slate-300">
                          <span className="inline-flex items-center gap-1.5 min-w-0 truncate">
                            <Building2 className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 shrink-0" aria-hidden="true" />
                            <span className="truncate">{resolvedOffice || '—'}</span>
                          </span>
                          {emp.mobile && (
                            <span className="font-mono-tabular text-[11.5px] text-slate-500 dark:text-slate-400 shrink-0">
                              {emp.mobile}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Table View: >=720px when viewMode === 'table' */}
            {viewMode === 'table' && (
              <div className="hidden min-[720px]:block overflow-hidden rounded-[20px] border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200/80 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/60 text-xs font-semibold text-slate-600 dark:text-slate-300">
                        <th scope="col" className="py-3.5 pl-4 pr-3">Employee</th>
                        <th scope="col" className="py-3.5 px-3">Role</th>
                        <th scope="col" className="py-3.5 px-3">Office</th>
                        <th scope="col" className="py-3.5 px-3">Mobile</th>
                        <th scope="col" className="py-3.5 pl-3 pr-4">Email</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 text-sm">
                      {filteredEmployees.map((emp) => {
                        const uid = emp.uid || emp.id;
                        const isSelf = uid === profile?.uid;
                        const displayName = emp.name || emp.email || uid;
                        const initials = getUserInitials(emp.name, emp.email);
                        const resolvedOffice = officeName(emp.officeId);
                        const empRoleLabel = getRoleLabel(normalizeRole(emp.role, roleRegistry) || emp.role, roleRegistry);
                        const chargeBadges = getChargeBadgesForEmployee(emp, selectedOfficeFilter, allowedIds);

                        return (
                          <tr
                            key={uid}
                            tabIndex={0}
                            role="button"
                            aria-label={`View details for ${displayName}`}
                            onClick={() => setSelectedEmployee(emp)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                setSelectedEmployee(emp);
                              }
                            }}
                            className="group cursor-pointer hover:bg-slate-50/90 dark:hover:bg-slate-800/50 transition-colors focus-visible:outline-none focus-visible:bg-[#0b6b4f]/5 dark:focus-visible:bg-[#4fd1a1]/10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0b6b4f] dark:focus-visible:ring-[#4fd1a1]"
                          >
                            <td className="py-3.5 pl-4 pr-3">
                              <div className="flex items-center gap-3 min-w-[200px]">
                                <div
                                  aria-hidden="true"
                                  className="w-10 h-10 rounded-[14px] bg-[#0b6b4f]/10 dark:bg-[#4fd1a1]/15 text-[#0b6b4f] dark:text-[#4fd1a1] font-bold text-xs flex items-center justify-center shrink-0"
                                >
                                  {initials}
                                </div>
                                <div className="min-w-0">
                                  <div className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                                    {displayName}
                                    {isSelf && (
                                      <span className="ml-1.5 text-xs font-medium text-[#0b6b4f] dark:text-[#4fd1a1]">
                                        (You)
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                                    {emp.designation || 'Staff'}
                                  </div>
                                  {chargeBadges.length > 0 && (
                                    <div className="flex flex-wrap items-center gap-1 mt-1">
                                      {chargeBadges.map((b) => (
                                        <span
                                          key={b.key}
                                          className={`inline-flex items-center px-1.5 py-0.5 rounded-[7px] border text-[10.5px] font-semibold leading-tight ${b.className}`}
                                        >
                                          {b.label}
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </td>
                            <td className="py-3.5 px-3 text-xs font-medium text-slate-700 dark:text-slate-200 whitespace-nowrap">
                              {empRoleLabel}
                            </td>
                            <td className="py-3.5 px-3 text-xs text-slate-600 dark:text-slate-300 max-w-[220px] truncate">
                              {resolvedOffice || '—'}
                            </td>
                            <td className="py-3.5 px-3 text-xs font-mono-tabular text-slate-700 dark:text-slate-200 whitespace-nowrap">
                              {emp.mobile || '—'}
                            </td>
                            <td className="py-3.5 pl-3 pr-4">
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-xs text-slate-500 dark:text-slate-400 truncate max-w-[200px]">
                                  {emp.email || '—'}
                                </span>
                                <ChevronRight
                                  aria-hidden="true"
                                  className="w-4 h-4 text-slate-300 dark:text-slate-600 group-hover:text-[#0b6b4f] dark:group-hover:text-[#4fd1a1] transition-colors shrink-0"
                                />
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Scoped Multi-Tab Employee Detail Bottom Sheet */}
      <BottomSheet
        open={Boolean(selectedEmployee)}
        onClose={() => setSelectedEmployee(null)}
        title={selectedEmployee?.name || selectedEmployee?.email || 'Employee'}
        subtitle={
          selectedEmployee
            ? [
                selectedEmployee.designation || 'Staff',
                getRoleLabel(normalizeRole(selectedEmployee.role, roleRegistry) || selectedEmployee.role, roleRegistry)
              ]
                .filter(Boolean)
                .join(' · ')
            : ''
        }
        headerLeading={
          selectedEmployee ? (
            <div
              aria-hidden="true"
              className="w-11 h-11 rounded-[14px] bg-[#0b6b4f]/10 dark:bg-[#4fd1a1]/15 text-[#0b6b4f] dark:text-[#4fd1a1] font-bold text-sm flex items-center justify-center shrink-0"
            >
              {getUserInitials(selectedEmployee.name, selectedEmployee.email)}
            </div>
          ) : null
        }
        footer={
          selectedEmployee ? (
            <div className="flex items-center gap-2.5">
              {selectedEmployee.mobile && (
                <a
                  href={`tel:${selectedEmployee.mobile}`}
                  className="flex-1 min-h-[44px] px-4 py-2.5 rounded-[14px] bg-[#0b6b4f] hover:bg-[#095941] dark:bg-[#4fd1a1] dark:hover:bg-[#3fc090] text-white dark:text-slate-950 text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors whitespace-nowrap"
                >
                  <Phone className="w-4 h-4 shrink-0" />
                  <span>Call</span>
                </a>
              )}
              <button
                type="button"
                onClick={() => setSelectedEmployee(null)}
                className="flex-1 min-h-[44px] px-4 py-2.5 rounded-[14px] border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors whitespace-nowrap"
              >
                Close
              </button>
            </div>
          ) : null
        }
      >
        {selectedEmployee && (
          <div className="space-y-4">
            {/* Permission-gated Tab Bar */}
            <div
              role="tablist"
              aria-label="Employee detail sections"
              className="flex items-center gap-1.5 overflow-x-auto pb-1 border-b border-slate-200 dark:border-slate-800"
            >
              {detailTabs.map((tab) => {
                const TabIcon = tab.Icon;
                const active = activeDetailTab === tab.key;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setActiveDetailTab(tab.key)}
                    className={`min-h-[40px] px-3 py-2 rounded-[12px] text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 border transition-colors ${
                      active
                        ? 'bg-[#0b6b4f] dark:bg-[#4fd1a1] text-white dark:text-slate-950 border-[#0b6b4f] dark:border-[#4fd1a1]'
                        : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    <TabIcon className="w-3.5 h-3.5 shrink-0" />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Tab 1: প্রোফাইল */}
            {activeDetailTab === 'profile' && (
              <div className="space-y-4">
                <section className="rounded-[18px] border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 divide-y divide-slate-200/80 dark:divide-slate-800">
                  <DetailRow label="মূল অফিস" value={selectedEmpOffice?.name || officeName(selectedEmployee.officeId)} />
                  {selectedEmpOffice?.level && (
                    <DetailRow label="অফিস স্তর" value={getLevelShortLabel(selectedEmpOffice.level)} />
                  )}
                  {selectedEmpParentOffice && (
                    <DetailRow label="অধীনস্থ জেলা / ঊর্ধ্বতন" value={selectedEmpParentOffice.name} />
                  )}
                  {Array.isArray(selectedEmployee.additionalOfficeIds) &&
                    selectedEmployee.additionalOfficeIds.filter((id) => id && id !== selectedEmployee.officeId).length > 0 && (
                      <DetailRow
                        label="অতিরিক্ত দায়িত্ব"
                        value={selectedEmployee.additionalOfficeIds
                          .filter((id) => id && id !== selectedEmployee.officeId)
                          .map((id) => officeName(id))
                          .join(', ')}
                      />
                    )}
                  {selectedEmployee.attachedOfficeId && (
                    <DetailRow
                      label="সংযুক্ত অফিস"
                      value={officeName(selectedEmployee.attachedOfficeId)}
                    />
                  )}
                  {selectedEmployee.actingOfficeId && selectedEmployee.actingRoleKey && (
                    <DetailRow
                      label="চলতি দায়িত্ব"
                      value={`${officeName(selectedEmployee.actingOfficeId)} (${getRoleLabel(selectedEmployee.actingRoleKey, roleRegistry)})`}
                    />
                  )}
                </section>

                <section className="rounded-[18px] border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 divide-y divide-slate-200/80 dark:divide-slate-800">
                  <DetailRow label="পদবি" value={selectedEmployee.designation || '—'} />
                  <DetailRow label="যোগদানের তারিখ" value={selectedEmployee.joiningDate || '—'} mono />
                  <DetailRow
                    label="মোবাইল"
                    value={selectedEmployee.mobile || '—'}
                    mono
                    action={
                      selectedEmployee.mobile ? (
                        <a
                          href={`tel:${selectedEmployee.mobile}`}
                          aria-label={`Call ${selectedEmployee.mobile}`}
                          className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center rounded-[10px] text-[#0b6b4f] dark:text-[#4fd1a1] hover:bg-[#0b6b4f]/10 dark:hover:bg-[#4fd1a1]/15 transition-colors"
                        >
                          <Phone className="w-4 h-4" />
                        </a>
                      ) : null
                    }
                  />
                  <DetailRow
                    label="ইমেইল"
                    value={selectedEmployee.email || '—'}
                    action={
                      selectedEmployee.email ? (
                        <div className="flex items-center gap-1">
                          <a
                            href={`mailto:${selectedEmployee.email}`}
                            aria-label={`Email ${selectedEmployee.email}`}
                            className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center rounded-[10px] text-slate-600 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-700 transition-colors"
                          >
                            <Mail className="w-4 h-4" />
                          </a>
                          <button
                            type="button"
                            onClick={() => handleCopyEmail(selectedEmployee.email)}
                            aria-label="Copy email address"
                            className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center rounded-[10px] text-slate-600 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-700 transition-colors"
                          >
                            {copiedEmail ? (
                              <Check className="w-4 h-4 text-[#0b6b4f] dark:text-[#4fd1a1]" />
                            ) : (
                              <Copy className="w-4 h-4" />
                            )}
                          </button>
                        </div>
                      ) : null
                    }
                  />
                  {selectedEmployee.address && (
                    <DetailRow label="ঠিকানা" value={selectedEmployee.address} />
                  )}
                </section>
              </div>
            )}

            {/* Tab 2: হাজিরা */}
            {activeDetailTab === 'attendance' && selectedEmpTabAccess.attendance && (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <label htmlFor="emp-detail-month" className="text-xs font-medium text-slate-600 dark:text-slate-300">
                    মাস নির্বাচন করুন
                  </label>
                  <input
                    id="emp-detail-month"
                    type="month"
                    value={detailMonth}
                    onChange={(e) => setDetailMonth(e.target.value)}
                    className="min-h-[40px] px-3 py-1.5 rounded-[12px] border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-base sm:text-xs font-mono-tabular text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#0b6b4f] dark:focus:ring-[#4fd1a1]"
                  />
                </div>

                {attendanceError && (
                  <div className="p-3 rounded-[14px] bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/70 text-xs text-rose-700 dark:text-rose-200">
                    {attendanceError}
                  </div>
                )}

                {attendanceLoading ? (
                  <div className="rounded-[16px] border border-slate-200 dark:border-slate-800 p-6 text-center text-xs text-slate-500 dark:text-slate-400">
                    হাজিরার তথ্য লোড হচ্ছে...
                  </div>
                ) : attendanceRecords.length === 0 ? (
                  <div className="rounded-[16px] border border-dashed border-slate-300 dark:border-slate-700 p-6 text-center text-xs text-slate-500 dark:text-slate-400">
                    নির্বাচিত মাসে অনুমোদিত স্কোপে কোনো হাজিরার রেকর্ড পাওয়া যায়নি।
                  </div>
                ) : (
                  <div className="rounded-[16px] border border-slate-200 dark:border-slate-800 divide-y divide-slate-200/80 dark:divide-slate-800 bg-slate-50/50 dark:bg-slate-800/30">
                    {attendanceRecords.map((rec) => {
                      const statusVal = rec.finalStatus || rec.initialStatus || '—';
                      const checkInOffice = officeName(rec.officeId);
                      const checkOutOffice =
                        rec.checkOutOfficeId && rec.checkOutOfficeId !== rec.officeId
                          ? officeName(rec.checkOutOfficeId)
                          : '';

                      return (
                        <div key={rec.id} className="px-4 py-3 space-y-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-semibold font-mono-tabular text-slate-900 dark:text-slate-100">
                              {formatDisplayDate(rec.date)}
                            </span>
                            <StatusText status={statusVal} />
                          </div>
                          <div className="flex flex-wrap items-center justify-between gap-2 text-[11.5px] text-slate-500 dark:text-slate-400">
                            <span className="font-mono-tabular">
                              ইন: {formatDhakaTime(rec.checkIn?.time)} · আউট: {formatDhakaTime(rec.checkOut?.time)}
                            </span>
                            {rec.isFieldDuty && (
                              <span className="inline-flex items-center gap-1 text-sky-700 dark:text-sky-300 font-medium">
                                <MapPin className="w-3 h-3" />
                                ফিল্ড ডিউটি
                              </span>
                            )}
                          </div>
                          {checkInOffice && (
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                              অফিস: {checkInOffice}
                              {checkOutOffice ? ` → ${checkOutOffice}` : ''}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Tab 3: ছুটি */}
            {activeDetailTab === 'leave' && selectedEmpTabAccess.leaveTab && (
              <div className="space-y-3">
                {leaveError && (
                  <div className="p-3 rounded-[14px] bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/70 text-xs text-rose-700 dark:text-rose-200">
                    {leaveError}
                  </div>
                )}

                {leaveLoading ? (
                  <div className="rounded-[16px] border border-slate-200 dark:border-slate-800 p-6 text-center text-xs text-slate-500 dark:text-slate-400">
                    ছুটি ও ফিল্ড ডিউটির আবেদন লোড হচ্ছে...
                  </div>
                ) : leaveItems.length === 0 ? (
                  <div className="rounded-[16px] border border-dashed border-slate-300 dark:border-slate-700 p-6 text-center text-xs text-slate-500 dark:text-slate-400">
                    অনুমোদিত স্কোপে কোনো ছুটি বা ফিল্ড ডিউটির আবেদন পাওয়া যায়নি।
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {leaveItems.map((item) => (
                      <div
                        key={`${item._kind}_${item.id}`}
                        className="rounded-[16px] border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 p-3.5 space-y-1.5"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-900 dark:text-slate-100">
                              <FileText className="w-3.5 h-3.5 text-[#0b6b4f] dark:text-[#4fd1a1] shrink-0" />
                              {item._kind === 'leave'
                                ? item.leaveType || 'ছুটির আবেদন'
                                : `ফিল্ড ডিউটি · ${item.location || ''}`}
                            </span>
                            <div className="text-[11.5px] font-mono-tabular text-slate-500 dark:text-slate-400 mt-0.5">
                              {item.startDate} → {item.endDate}
                            </div>
                          </div>
                          <StatusText status={item.status || 'pending'} />
                        </div>
                        {item.reason && (
                          <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                            {item.reason}
                          </p>
                        )}
                        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400 pt-1 border-t border-slate-200/70 dark:border-slate-700/70">
                          <span>অফিস: {officeName(item.officeId) || '—'}</span>
                          {item.reviewedByName && (
                            <span>নিষ্পত্তিকারী: {item.reviewedByName}</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Tab 4: কর্মজীবন */}
            {activeDetailTab === 'career' && (
              <AssignmentsTimeline
                assignments={assignments}
                loading={careerLoading}
                error={careerError}
                officeName={officeName}
                roleRegistry={roleRegistry}
              />
            )}
          </div>
        )}
      </BottomSheet>
    </AppShell>
  );
}
