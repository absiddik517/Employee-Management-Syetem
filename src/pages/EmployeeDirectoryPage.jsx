import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import {
  Building2,
  Check,
  ChevronRight,
  Copy,
  LayoutGrid,
  Mail,
  Phone,
  Search,
  Table2,
  Users,
  X
} from 'lucide-react';
import AppShell from '../components/AppShell.jsx';
import BottomSheet from '../components/users/BottomSheet.jsx';
import { getUserInitials } from '../components/users/StatusBadge.jsx';
import { getLevelShortLabel } from '../components/offices/officeHelpers.js';
import { useAuth } from '../context/AuthContext.jsx';
import { db, OperationType, handleFirestoreError, withTimeout } from '../firebase/config.js';
import { getRoleLabel, getUserOfficeScopeIds, normalizeRole, rankOf } from '../lib/permissions.js';

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
    offices,
    userOffice,
    permissionScope
  } = useAuth();

  const [loading, setLoading] = useState(true);
  const [employees, setEmployees] = useState([]);
  const [search, setSearch] = useState('');
  const [scopeTab, setScopeTab] = useState('all'); // 'all' | 'own' | 'sub'
  const [selectedOfficeFilter, setSelectedOfficeFilter] = useState('all');
  const [viewMode, setViewMode] = useState('cards'); // 'cards' | 'table' (>=720px)
  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [copiedEmail, setCopiedEmail] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const officeById = useMemo(() => new Map(offices.map((o) => [o.id, o])), [offices]);

  const officeName = useCallback(
    (id) => (id ? officeById.get(id)?.name || id : ''),
    [officeById]
  );

  const rootOfficeIds = useMemo(() => {
    if (userOffice?.id) return [userOffice.id];
    return getUserOfficeScopeIds(effectiveAuthUser);
  }, [userOffice?.id, effectiveAuthUser]);

  const { allowedIds, ownIds, subIds } = useMemo(
    () => computeDescendantOfficeTree(rootOfficeIds, offices),
    [rootOfficeIds, offices]
  );

  const hasHeadRoot = useMemo(
    () => rootOfficeIds.some((id) => officeById.get(id)?.level === 'head'),
    [rootOfficeIds, officeById]
  );

  const scopedOffices = useMemo(() => {
    const list = offices.filter((o) => allowedIds.has(o.id));
    if (list.length === 0 && permissionScope('user.view') === 'all' && rootOfficeIds.length === 0) {
      return offices;
    }
    return list.sort((a, b) => {
      const aOwn = ownIds.has(a.id) ? 0 : 1;
      const bOwn = ownIds.has(b.id) ? 0 : 1;
      if (aOwn !== bOwn) return aOwn - bOwn;
      return (a.name || '').localeCompare(b.name || '');
    });
  }, [offices, allowedIds, ownIds, permissionScope, rootOfficeIds.length]);

  useEffect(() => {
    setScopeTab('all');
    setSelectedOfficeFilter('all');
  }, [userOffice?.id]);

  useEffect(() => {
    setCopiedEmail(false);
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
      const canQueryAll =
        hasHeadRoot ||
        (permissionScope('user.view') === 'all' && rootOfficeIds.length === 0);

      let rawList = [];

      if (canQueryAll) {
        const snap = await withTimeout(
          getDocs(collection(db, 'users')),
          15000,
          'কর্মচারী তালিকা লোড করতে সময় বেশি লাগছে।'
        );
        rawList = snap.docs.map((d) => ({ uid: d.id, id: d.id, ...d.data() }));
      } else if (rootOfficeIds.length > 0) {
        const queries = [];
        for (const oid of rootOfficeIds) {
          queries.push(getDocs(query(collection(db, 'users'), where('officeId', '==', oid))));
          if (subIds.size > 0) {
            queries.push(getDocs(query(collection(db, 'users'), where('districtOfficeId', '==', oid))));
          }
        }
        const snaps = await withTimeout(
          Promise.all(queries),
          15000,
          'কর্মচারী তালিকা লোড করতে সময় বেশি লাগছে।'
        );
        const byUid = new Map();
        for (const snap of snaps) {
          for (const d of snap.docs) {
            byUid.set(d.id, { uid: d.id, id: d.id, ...d.data() });
          }
        }
        rawList = Array.from(byUid.values());
      }

      const activeApproved = rawList.filter((u) => {
        if (u.approvalStatus !== 'approved') return false;
        if ((u.status || 'active') !== 'active') return false;
        if (allowedIds.size > 0) {
          return allowedIds.has(u.officeId);
        }
        return permissionScope('user.view') === 'all';
      });

      activeApproved.sort((a, b) => {
        const rankDiff = rankOf(b.role) - rankOf(a.role);
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
  }, [effectiveAuthUser, hasHeadRoot, permissionScope, rootOfficeIds, subIds.size, allowedIds]);

  useEffect(() => {
    loadDirectory();
  }, [loadDirectory]);

  const counts = useMemo(() => {
    let own = 0;
    let sub = 0;
    for (const emp of employees) {
      if (ownIds.has(emp.officeId)) own += 1;
      else if (subIds.has(emp.officeId)) sub += 1;
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
      if (scopeTab === 'own' && !ownIds.has(emp.officeId)) return false;
      if (scopeTab === 'sub' && !subIds.has(emp.officeId)) return false;
      if (selectedOfficeFilter !== 'all' && emp.officeId !== selectedOfficeFilter) return false;

      if (!q) return true;
      const oName = officeName(emp.officeId).toLowerCase();
      const rLabel = getRoleLabel(normalizeRole(emp.role) || emp.role).toLowerCase();
      return (
        (emp.name || '').toLowerCase().includes(q) ||
        (emp.designation || '').toLowerCase().includes(q) ||
        (emp.mobile || '').toLowerCase().includes(q) ||
        (emp.email || '').toLowerCase().includes(q) ||
        oName.includes(q) ||
        rLabel.includes(q)
      );
    });
  }, [employees, scopeTab, selectedOfficeFilter, search, ownIds, subIds, officeName]);

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
                const empRoleLabel = getRoleLabel(normalizeRole(emp.role) || emp.role);

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
                        const empRoleLabel = getRoleLabel(normalizeRole(emp.role) || emp.role);

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

      {/* Read-only Employee Detail Bottom Sheet */}
      <BottomSheet
        open={Boolean(selectedEmployee)}
        onClose={() => setSelectedEmployee(null)}
        title={selectedEmployee?.name || selectedEmployee?.email || 'Employee'}
        subtitle={
          selectedEmployee
            ? [
                selectedEmployee.designation || 'Staff',
                getRoleLabel(normalizeRole(selectedEmployee.role) || selectedEmployee.role)
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
            <section className="rounded-[18px] border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 divide-y divide-slate-200/80 dark:divide-slate-800">
              <DetailRow label="Office" value={selectedEmpOffice?.name || officeName(selectedEmployee.officeId)} />
              {selectedEmpOffice?.level && (
                <DetailRow label="Office level" value={getLevelShortLabel(selectedEmpOffice.level)} />
              )}
              {selectedEmpParentOffice && (
                <DetailRow label="Parent office" value={selectedEmpParentOffice.name} />
              )}
              {Array.isArray(selectedEmployee.additionalOfficeIds) &&
                selectedEmployee.additionalOfficeIds.filter((id) => id && id !== selectedEmployee.officeId).length > 0 && (
                  <DetailRow
                    label="Additional charge"
                    value={selectedEmployee.additionalOfficeIds
                      .filter((id) => id && id !== selectedEmployee.officeId)
                      .map((id) => officeName(id))
                      .join(', ')}
                  />
                )}
            </section>

            <section className="rounded-[18px] border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 divide-y divide-slate-200/80 dark:divide-slate-800">
              <DetailRow label="Designation" value={selectedEmployee.designation || '—'} />
              <DetailRow
                label="Mobile"
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
                label="Email"
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
                <DetailRow label="Address" value={selectedEmployee.address} />
              )}
            </section>
          </div>
        )}
      </BottomSheet>
    </AppShell>
  );
}
