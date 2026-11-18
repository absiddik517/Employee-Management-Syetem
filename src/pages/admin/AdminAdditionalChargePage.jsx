import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { collection, doc, getDocs, serverTimestamp, updateDoc } from 'firebase/firestore';
import {
  Briefcase,
  Building2,
  Check,
  CheckCircle2,
  Plus,
  Search,
  Trash2,
  Users,
  X
} from 'lucide-react';
import AppShell from '../../components/AppShell.jsx';
import BottomSheet from '../../components/users/BottomSheet.jsx';
import StatusBadge, { getUserInitials } from '../../components/users/StatusBadge.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useData } from '../../context/DataContext.jsx';
import { db, OperationType, handleFirestoreError, withTimeout } from '../../firebase/config.js';

export default function AdminAdditionalChargePage() {
  const { profile, offices } = useAuth();
  const { logAudit } = useData();

  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('district_officer'); // 'district_officer' | 'assigned' | 'all'
  const [errorMsg, setErrorMsg] = useState('');
  const [toastMsg, setToastMsg] = useState('');
  const toastTimerRef = useRef(null);

  // Assignment sheet state
  const [activeUser, setActiveUser] = useState(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [selectedAdditionalIds, setSelectedAdditionalIds] = useState([]);
  const [districtSearch, setDistrictSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [sheetError, setSheetError] = useState('');

  const showToast = useCallback((msg) => {
    setToastMsg(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => {
      setToastMsg('');
    }, 3400);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setErrorMsg('');
    try {
      const snap = await withTimeout(
        getDocs(collection(db, 'users')),
        15000,
        'কর্মকর্তাদের তালিকা লোড করতে সময় বেশি লাগছে।'
      );
      setUsers(
        snap.docs
          .map((d) => ({ uid: d.id, id: d.id, ...d.data() }))
          .sort((a, b) => (a.name || a.email || a.id || '').localeCompare(b.name || b.email || b.id || ''))
      );
    } catch (err) {
      setErrorMsg('কর্মকর্তাদের তালিকা লোড করা যায়নি।');
      handleFirestoreError(err, OperationType.LIST, 'users');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  const officeMap = useMemo(() => new Map(offices.map((o) => [o.id, o])), [offices]);

  const upazilaCounts = useMemo(() => {
    const counts = new Map();
    for (const o of offices) {
      if (o.parentOfficeId) {
        counts.set(o.parentOfficeId, (counts.get(o.parentOfficeId) || 0) + 1);
      }
    }
    return counts;
  }, [offices]);

  const districtOffices = useMemo(
    () => offices.filter((o) => o.level === 'district'),
    [offices]
  );

  const counts = useMemo(() => {
    let districtCount = 0;
    let assignedCount = 0;
    for (const u of users) {
      if (u.role === 'district_officer') districtCount += 1;
      if (Array.isArray(u.additionalOfficeIds) && u.additionalOfficeIds.length > 0) assignedCount += 1;
    }
    return {
      district_officer: districtCount,
      assigned: assignedCount,
      all: users.length
    };
  }, [users]);

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((u) => {
      if (roleFilter === 'district_officer' && u.role !== 'district_officer') return false;
      if (roleFilter === 'assigned' && !(Array.isArray(u.additionalOfficeIds) && u.additionalOfficeIds.length > 0)) {
        return false;
      }

      if (!q) return true;
      const primaryName = (officeMap.get(u.officeId)?.name || '').toLowerCase();
      const addNames = (Array.isArray(u.additionalOfficeIds) ? u.additionalOfficeIds : [])
        .map((id) => (officeMap.get(id)?.name || '').toLowerCase())
        .join(' ');
      return (
        (u.name || '').toLowerCase().includes(q) ||
        (u.email || '').toLowerCase().includes(q) ||
        (u.uid || u.id || '').toLowerCase().includes(q) ||
        primaryName.includes(q) ||
        addNames.includes(q)
      );
    });
  }, [users, roleFilter, search, officeMap]);

  const openManageSheet = (u) => {
    setActiveUser(u);
    const existingIds = Array.isArray(u.additionalOfficeIds)
      ? u.additionalOfficeIds.filter((id) => id && id !== u.officeId)
      : [];
    setSelectedAdditionalIds(Array.from(new Set(existingIds)));
    setDistrictSearch('');
    setSheetError('');
    setSheetOpen(true);
  };

  const toggleDistrictSelection = (officeId) => {
    if (!activeUser || officeId === activeUser.officeId) return;
    setSelectedAdditionalIds((prev) =>
      prev.includes(officeId) ? prev.filter((id) => id !== officeId) : [...prev, officeId]
    );
  };

  const candidateOffices = useMemo(() => {
    if (!activeUser) return [];
    const q = districtSearch.trim().toLowerCase();
    return districtOffices.filter((o) => {
      if (o.id === activeUser.officeId) return false;
      if (!q) return true;
      return (
        (o.name || '').toLowerCase().includes(q) ||
        (o.address || '').toLowerCase().includes(q)
      );
    });
  }, [districtOffices, activeUser, districtSearch]);

  const handleSave = async (e) => {
    e.preventDefault();
    if (!activeUser || saving) return;

    const targetUid = activeUser.uid || activeUser.id;
    const sanitized = Array.from(
      new Set(selectedAdditionalIds.filter((id) => id && id !== activeUser.officeId))
    );

    if (sanitized.length > 20) {
      setSheetError('সর্বোচ্চ ২০টি অতিরিক্ত অফিস নির্ধারণ করা যাবে।');
      return;
    }

    setSaving(true);
    setSheetError('');
    try {
      const prevIds = Array.isArray(activeUser.additionalOfficeIds) ? activeUser.additionalOfficeIds : [];
      await updateDoc(doc(db, 'users', targetUid), {
        additionalOfficeIds: sanitized,
        updatedAt: serverTimestamp()
      });

      await logAudit({
        actor: profile,
        action: 'ADDITIONAL_CHARGE_UPDATED',
        targetCollection: 'users',
        targetId: targetUid,
        oldValue: prevIds.map((id) => officeMap.get(id)?.name || id).join(', ') || 'None',
        newValue: sanitized.map((id) => officeMap.get(id)?.name || id).join(', ') || 'None',
        reason: 'Super admin updated additional charge offices'
      });

      setSheetOpen(false);
      await loadUsers();
      showToast(
        sanitized.length > 0
          ? `${activeUser.name || activeUser.email}-কে ${sanitized.length}টি অতিরিক্ত অফিসের দায়িত্ব দেওয়া হয়েছে।`
          : `${activeUser.name || activeUser.email}-এর অতিরিক্ত দায়িত্ব প্রত্যাহার করা হয়েছে।`
      );
    } catch (err) {
      setSheetError(err?.message || 'অতিরিক্ত দায়িত্ব সংরক্ষণ করা যায়নি।');
      handleFirestoreError(err, OperationType.UPDATE, `users/${targetUid}`);
    } finally {
      setSaving(false);
    }
  };

  const filterChips = [
    { key: 'district_officer', label: 'District officers', count: counts.district_officer },
    { key: 'assigned', label: 'With additional charge', count: counts.assigned },
    { key: 'all', label: 'All staff', count: counts.all }
  ];

  const sheetFooter = (
    <div className="flex flex-wrap items-center gap-2.5">
      <button
        type="button"
        onClick={() => setSelectedAdditionalIds([])}
        disabled={saving || selectedAdditionalIds.length === 0}
        className="min-h-[44px] px-3.5 py-2.5 rounded-[14px] border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/80 text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-45"
      >
        <Trash2 className="w-4 h-4" />
        <span>Clear all</span>
      </button>
      <button
        type="button"
        onClick={() => setSheetOpen(false)}
        disabled={saving}
        className="min-h-[44px] px-4 py-2.5 rounded-[14px] border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/80 text-sm font-semibold disabled:opacity-60"
      >
        Cancel
      </button>
      <button
        type="submit"
        form="additional-charge-form"
        disabled={saving}
        className="flex-1 min-w-[150px] min-h-[44px] px-5 py-2.5 rounded-[14px] bg-[#0b6b4f] hover:bg-[#095941] dark:bg-[#4fd1a1] dark:hover:bg-[#3fc090] text-white dark:text-slate-950 text-sm font-semibold disabled:opacity-60"
      >
        {saving ? 'সংরক্ষণ হচ্ছে...' : `Save (${selectedAdditionalIds.length})`}
      </button>
    </div>
  );

  return (
    <AppShell title="Additional Charge" showThemeToggle>
      <div className="space-y-5">
        {/* Header */}
        <section className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100 font-display">
              Additional Charge (অতিরিক্ত দায়িত্ব)
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
              সহকারী পরিচালকদের নিজ জেলার পাশাপাশি অতিরিক্ত জেলা কার্যালয়ের দায়িত্ব নির্ধারণ করুন · {counts.assigned} active assignments
            </p>
          </div>
        </section>

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
              aria-label="Search officers by name, email, or office"
              placeholder="Search officer name, email, or district..."
              className="w-full min-h-[44px] pl-10 pr-10 py-2 rounded-[16px] border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-base text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-[#0b6b4f] dark:focus:ring-[#4fd1a1] focus:border-transparent"
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

          <div
            role="group"
            aria-label="Filter officers"
            className="flex flex-wrap items-center gap-2"
          >
            {filterChips.map((chip) => {
              const selected = roleFilter === chip.key;
              return (
                <button
                  key={chip.key}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setRoleFilter(chip.key)}
                  className={`min-h-[44px] px-3.5 py-2 rounded-[14px] border text-xs font-semibold inline-flex items-center gap-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b6b4f] dark:focus-visible:ring-[#4fd1a1] ${
                    selected
                      ? 'bg-[#0b6b4f] dark:bg-[#4fd1a1] text-white dark:text-slate-950 border-[#0b6b4f] dark:border-[#4fd1a1]'
                      : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-800 hover:bg-slate-100/70 dark:hover:bg-slate-800'
                  }`}
                >
                  <span>{chip.label}</span>
                  <span
                    className={`px-1.5 py-0.5 rounded-[10px] text-[11px] font-mono-tabular ${
                      selected
                        ? 'bg-white/20 dark:bg-slate-950/20 text-white dark:text-slate-950'
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
          <div className="rounded-[22px] border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-10 text-center text-sm text-slate-500 dark:text-slate-400">
            লোড হচ্ছে...
          </div>
        ) : filteredUsers.length === 0 ? (
          <div className="rounded-[22px] border border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900/60 p-10 text-center space-y-3">
            <div className="w-12 h-12 rounded-[16px] bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 mx-auto flex items-center justify-center">
              <Users className="w-6 h-6" />
            </div>
            <div className="space-y-1">
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                কোনো কর্মকর্তা পাওয়া যায়নি
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto">
                ফিল্টার পরিবর্তন করে অথবা নতুন সহকারী পরিচালক তৈরি করে পুনরায় দেখুন।
              </p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
            {filteredUsers.map((u) => {
              const uid = u.uid || u.id;
              const primaryOfficeObj = officeMap.get(u.officeId);
              const additionalIds = Array.isArray(u.additionalOfficeIds)
                ? u.additionalOfficeIds.filter((id) => id && id !== u.officeId)
                : [];
              const initials = getUserInitials(u.name, u.email);

              return (
                <article
                  key={uid}
                  className="rounded-[20px] border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5 flex flex-col justify-between gap-4"
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
                            {u.designation || 'No designation'} · {u.email}
                          </p>
                        </div>
                      </div>
                      <StatusBadge kind="role" value={u.role || 'employee'} />
                    </div>

                    <div className="rounded-[14px] bg-slate-50 dark:bg-slate-800/50 border border-slate-200/70 dark:border-slate-800 p-3 space-y-2.5">
                      <div>
                        <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                          মূল দায়িত্ব (Primary Office)
                        </div>
                        <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 mt-0.5 flex items-center gap-1.5">
                          <Building2 className="w-3.5 h-3.5 text-[#0b6b4f] dark:text-[#4fd1a1] shrink-0" />
                          <span>{primaryOfficeObj?.name || 'অফিস নির্ধারিত নয়'}</span>
                        </div>
                      </div>

                      <div className="pt-2 border-t border-slate-200/70 dark:border-slate-700/60">
                        <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                          অতিরিক্ত দায়িত্ব ({additionalIds.length})
                        </div>
                        {additionalIds.length === 0 ? (
                          <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            কোনো অতিরিক্ত জেলা কার্যালয়ের দায়িত্ব নেই
                          </div>
                        ) : (
                          <ul className="mt-1.5 space-y-1">
                            {additionalIds.map((officeId) => {
                              const off = officeMap.get(officeId);
                              const subCount = upazilaCounts.get(officeId) || 0;
                              return (
                                <li
                                  key={officeId}
                                  className="text-xs font-medium text-amber-800 dark:text-amber-300 flex items-center justify-between gap-2"
                                >
                                  <span className="truncate">{off?.name || officeId}</span>
                                  <span className="text-[11px] text-slate-500 dark:text-slate-400 shrink-0 tabular-nums">
                                    {subCount} উপজেলা
                                  </span>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => openManageSheet(u)}
                    className="w-full min-h-[44px] px-4 py-2.5 rounded-[14px] bg-[#0b6b4f] hover:bg-[#095941] dark:bg-[#4fd1a1] dark:hover:bg-[#3fc090] text-white dark:text-slate-950 text-xs font-semibold inline-flex items-center justify-center gap-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b6b4f] dark:focus-visible:ring-[#4fd1a1]"
                  >
                    <Briefcase className="w-4 h-4 shrink-0" />
                    <span>
                      {additionalIds.length > 0 ? 'অতিরিক্ত দায়িত্ব পরিবর্তন করুন' : 'অতিরিক্ত দায়িত্ব দিন'}
                    </span>
                  </button>
                </article>
              );
            })}
          </div>
        )}
      </div>

      {/* Assign Additional Charge BottomSheet */}
      <BottomSheet
        open={sheetOpen && Boolean(activeUser)}
        onClose={saving ? undefined : () => setSheetOpen(false)}
        title="অতিরিক্ত দায়িত্ব নির্ধারণ"
        subtitle={activeUser ? `${activeUser.name || activeUser.email} (${activeUser.designation || activeUser.role})` : ''}
        maxWidthClass="sm:max-w-xl"
        footer={sheetFooter}
      >
        {activeUser && (
          <form id="additional-charge-form" onSubmit={handleSave} className="space-y-4">
            <div className="p-3.5 rounded-[16px] bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 space-y-1">
              <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                মূল দায়িত্ব (Primary District Office)
              </div>
              <div className="text-sm font-bold text-slate-900 dark:text-slate-100">
                {officeMap.get(activeUser.officeId)?.name || 'নির্ধারিত নয়'}
              </div>
              {activeUser.role !== 'district_officer' && (
                <p className="text-xs text-amber-700 dark:text-amber-300 pt-1">
                  দ্রষ্টব্য: এই ব্যবহারকারীর রোল বর্তমানে &ldquo;{activeUser.role}&rdquo;। অতিরিক্ত জেলা কার্যালয় পরিচালনার জন্য Users প্যানেল থেকে রোল &ldquo;District officer&rdquo; করুন।
                </p>
              )}
            </div>

            {sheetError && (
              <div
                role="alert"
                className="p-3.5 rounded-[14px] bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/70 text-xs text-rose-800 dark:text-rose-200"
              >
                {sheetError}
              </div>
            )}

            <div className="space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <label htmlFor="district-search" className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  অতিরিক্ত জেলা কার্যালয়সমূহ নির্বাচন করুন ({selectedAdditionalIds.length} selected)
                </label>
              </div>

              <div className="relative">
                <Search
                  aria-hidden="true"
                  className="w-4 h-4 text-slate-400 dark:text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                />
                <input
                  id="district-search"
                  type="search"
                  value={districtSearch}
                  onChange={(e) => setDistrictSearch(e.target.value)}
                  placeholder="জেলা কার্যালয় খুঁজুন..."
                  className="w-full min-h-[44px] pl-10 pr-4 py-2 rounded-[14px] border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800/90 text-base text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-[#0b6b4f] dark:focus:ring-[#4fd1a1]"
                />
              </div>

              {candidateOffices.length === 0 ? (
                <div className="p-6 text-center rounded-[16px] border border-dashed border-slate-300 dark:border-slate-700 text-xs text-slate-500 dark:text-slate-400">
                  অতিরিক্ত দায়িত্ব দেওয়ার মতো অন্য কোনো জেলা কার্যালয় পাওয়া যায়নি।
                </div>
              ) : (
                <div className="space-y-2 max-h-[340px] overflow-y-auto pr-1">
                  {candidateOffices.map((office) => {
                    const checked = selectedAdditionalIds.includes(office.id);
                    const subCount = upazilaCounts.get(office.id) || 0;
                    return (
                      <button
                        key={office.id}
                        type="button"
                        role="checkbox"
                        aria-checked={checked}
                        onClick={() => toggleDistrictSelection(office.id)}
                        className={`w-full min-h-[52px] px-3.5 py-3 rounded-[14px] border text-left flex items-center justify-between gap-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b6b4f] dark:focus-visible:ring-[#4fd1a1] ${
                          checked
                            ? 'bg-[#0b6b4f]/8 dark:bg-[#4fd1a1]/12 border-[#0b6b4f] dark:border-[#4fd1a1]'
                            : 'bg-white dark:bg-slate-800/40 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                            {office.name}
                          </div>
                          <div className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5 tabular-nums">
                            {office.address || 'ঠিকানা নেই'} · {subCount}টি অধীনস্থ উপজেলা
                          </div>
                        </div>

                        <div
                          className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 border transition-colors ${
                            checked
                              ? 'bg-[#0b6b4f] dark:bg-[#4fd1a1] border-[#0b6b4f] dark:border-[#4fd1a1] text-white dark:text-slate-950'
                              : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-transparent'
                          }`}
                        >
                          {checked ? <Check className="w-4 h-4" /> : <Plus className="w-3.5 h-3.5 opacity-0" />}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </form>
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
