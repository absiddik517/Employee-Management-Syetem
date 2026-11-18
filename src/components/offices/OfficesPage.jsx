import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { collection, doc, addDoc, updateDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import {
  Building2,
  CheckCircle2,
  LayoutGrid,
  Plus,
  Search,
  Table2,
  X
} from 'lucide-react';
import AppShell from '../AppShell.jsx';
import OfficeCard from './OfficeCard.jsx';
import OfficeTable from './OfficeTable.jsx';
import OfficeDetailSheet from './OfficeDetailSheet.jsx';
import OfficeFormSheet from './OfficeFormSheet.jsx';
import { getSubOffices } from './officeHelpers.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useData } from '../../context/DataContext.jsx';
import { db, OperationType, handleFirestoreError } from '../../firebase/config.js';

export default function OfficesPage() {
  const { profile, offices, fetchPublicBootstrap } = useAuth();
  const { logAudit } = useData();

  const [search, setSearch] = useState('');
  const [levelFilter, setLevelFilter] = useState('all'); // 'all' | 'head' | 'district' | 'upazila'
  const [viewMode, setViewMode] = useState('cards'); // 'cards' | 'table' (applies >= 720px)

  const [selectedOfficeId, setSelectedOfficeId] = useState(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const [formSheetOpen, setFormSheetOpen] = useState(false);
  const [formMode, setFormMode] = useState('create'); // 'create' | 'edit'
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [errorMsg, setErrorMsg] = useState('');
  const [toastMsg, setToastMsg] = useState('');
  const toastTimerRef = useRef(null);

  const showToast = useCallback((msg) => {
    setToastMsg(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => {
      setToastMsg('');
    }, 3000);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  const officeName = useCallback(
    (id) => (id ? offices.find((o) => o.id === id)?.name || id : ''),
    [offices]
  );

  const filterCounts = useMemo(() => {
    const counts = { all: offices.length, head: 0, district: 0, upazila: 0 };
    offices.forEach((o) => {
      if (o.level === 'head') counts.head += 1;
      else if (o.level === 'district') counts.district += 1;
      else if (o.level === 'upazila') counts.upazila += 1;
    });
    return counts;
  }, [offices]);

  const filteredOffices = useMemo(() => {
    const q = search.trim().toLowerCase();
    return offices.filter((o) => {
      if (levelFilter !== 'all' && o.level !== levelFilter) return false;
      if (!q) return true;
      return (
        (o.name || '').toLowerCase().includes(q) ||
        (o.address || '').toLowerCase().includes(q)
      );
    });
  }, [offices, search, levelFilter]);

  const selectedOffice = useMemo(
    () => offices.find((o) => o.id === selectedOfficeId) || null,
    [offices, selectedOfficeId]
  );

  const selectedSubOffices = useMemo(
    () => getSubOffices(offices, selectedOffice?.id),
    [offices, selectedOffice?.id]
  );

  const saveOffice = async (form, editingId = null) => {
    setSaving(true);
    setErrorMsg('');
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
        await fetchPublicBootstrap();
        setFormSheetOpen(false);
        showToast('Changes saved');
        return { ok: true };
      }

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
      await fetchPublicBootstrap();
      setFormSheetOpen(false);
      setSelectedOfficeId(refDoc.id);
      setDetailOpen(true);
      showToast('Office created');
      return { ok: true };
    } catch (err) {
      setErrorMsg('অফিস সংরক্ষণ করা যায়নি।');
      handleFirestoreError(err, OperationType.WRITE, 'offices');
      return { ok: false, error: err?.message || 'Failed to save office.' };
    } finally {
      setSaving(false);
    }
  };

  const deleteOffice = async (target) => {
    if (!target || deleting) return;
    setDeleting(true);
    setErrorMsg('');
    try {
      await deleteDoc(doc(db, 'offices', target.id));
      await fetchPublicBootstrap();
      setDetailOpen(false);
      setSelectedOfficeId(null);
      showToast('Office deleted');
    } catch (err) {
      setErrorMsg('অফিস মুছে ফেলা যায়নি।');
      handleFirestoreError(err, OperationType.DELETE, `offices/${target.id}`);
    } finally {
      setDeleting(false);
    }
  };

  const openCreateSheet = () => {
    setFormMode('create');
    setFormSheetOpen(true);
  };

  const openEditSheet = () => {
    setFormMode('edit');
    setFormSheetOpen(true);
  };

  const openDetail = (office) => {
    setSelectedOfficeId(office.id);
    setDetailOpen(true);
  };

  const filterChips = [
    { key: 'all', label: 'All', count: filterCounts.all },
    { key: 'head', label: 'Head', count: filterCounts.head },
    { key: 'district', label: 'District', count: filterCounts.district },
    { key: 'upazila', label: 'Upazila', count: filterCounts.upazila }
  ];

  return (
    <AppShell title="Offices" showThemeToggle>
      <div className="space-y-5">
        {/* Title & Primary Action */}
        <section className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100 font-display">
              Offices
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
              {offices.length} registered offices
            </p>
          </div>

          <button
            type="button"
            onClick={openCreateSheet}
            className="min-h-[44px] px-4 py-2.5 rounded-[14px] bg-[#0b6b4f] hover:bg-[#095941] dark:bg-[#4fd1a1] dark:hover:bg-[#3fc090] text-white dark:text-slate-950 text-sm font-semibold inline-flex items-center justify-center gap-2 shadow-xs transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#0b6b4f] dark:focus-visible:ring-[#4fd1a1]"
          >
            <Plus className="w-4 h-4 shrink-0" />
            <span>Add office</span>
          </button>
        </section>

        {/* Search, 720px+ Cards/Table Switch & Filter Chips */}
        <section className="space-y-3">
          <div className="flex flex-col min-[720px]:flex-row min-[720px]:items-center justify-between gap-3">
            <div className="relative flex-1 min-[720px]:max-w-md">
              <Search
                aria-hidden="true"
                className="w-4 h-4 text-slate-400 dark:text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
              />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                type="search"
                aria-label="Search offices by name or address"
                placeholder="Search by name or address..."
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

            <div
              role="group"
              aria-label="List view switch"
              className="hidden min-[720px]:inline-flex items-center p-1 rounded-[16px] bg-slate-200/70 dark:bg-slate-800/80 border border-slate-200/80 dark:border-slate-700/80 self-start"
            >
              <button
                type="button"
                aria-pressed={viewMode === 'cards'}
                onClick={() => setViewMode('cards')}
                className={`min-h-[44px] px-3.5 py-2 rounded-[12px] text-xs font-semibold inline-flex items-center gap-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b6b4f] dark:focus-visible:ring-[#4fd1a1] ${
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
                className={`min-h-[44px] px-3.5 py-2 rounded-[12px] text-xs font-semibold inline-flex items-center gap-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b6b4f] dark:focus-visible:ring-[#4fd1a1] ${
                  viewMode === 'table'
                    ? 'bg-white dark:bg-slate-900 text-[#0b6b4f] dark:text-[#4fd1a1] shadow-xs'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Table2 className="w-4 h-4" />
                <span>Table</span>
              </button>
            </div>
          </div>

          <div
            role="group"
            aria-label="Filter offices by hierarchy level"
            className="flex flex-wrap items-center gap-2"
          >
            {filterChips.map((chip) => {
              const selected = levelFilter === chip.key;
              return (
                <button
                  key={chip.key}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setLevelFilter(chip.key)}
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

        {/* Offices List */}
        {filteredOffices.length === 0 ? (
          <div className="rounded-[22px] border border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900/60 p-10 text-center space-y-3">
            <div className="w-12 h-12 rounded-[16px] bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 mx-auto flex items-center justify-center">
              <Building2 className="w-6 h-6" />
            </div>
            <div className="space-y-1">
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                {offices.length === 0 ? 'No registered offices' : 'No matching offices'}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto">
                {offices.length === 0
                  ? 'Add your first office with coordinates, geofence radius, and working hours.'
                  : 'No offices match your current search or level filter.'}
              </p>
            </div>
            {(search || levelFilter !== 'all') && (
              <button
                type="button"
                onClick={() => {
                  setSearch('');
                  setLevelFilter('all');
                }}
                className="min-h-[44px] px-4 py-2 rounded-[14px] border border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b6b4f] dark:focus-visible:ring-[#4fd1a1]"
              >
                Clear search and filters
              </button>
            )}
          </div>
        ) : (
          <>
            <div
              className={
                viewMode === 'cards'
                  ? 'grid grid-cols-1 min-[720px]:grid-cols-2 gap-3'
                  : 'grid grid-cols-1 gap-3 min-[720px]:hidden'
              }
            >
              {filteredOffices.map((o) => (
                <OfficeCard
                  key={o.id}
                  office={o}
                  parentName={officeName(o.parentOfficeId)}
                  onSelect={openDetail}
                />
              ))}
            </div>

            {viewMode === 'table' && (
              <div className="hidden min-[720px]:block">
                <OfficeTable
                  offices={filteredOffices}
                  officeName={officeName}
                  onSelect={openDetail}
                />
              </div>
            )}
          </>
        )}
      </div>

      {/* Office Detail Bottom Sheet */}
      <OfficeDetailSheet
        open={detailOpen && Boolean(selectedOffice)}
        office={selectedOffice}
        parentName={officeName(selectedOffice?.parentOfficeId)}
        subOffices={selectedSubOffices}
        busy={saving || deleting}
        onClose={() => setDetailOpen(false)}
        onEdit={openEditSheet}
        onDelete={deleteOffice}
        onCopiedCoords={() => showToast('Coordinates copied')}
      />

      {/* Add / Stacked Edit Office Bottom Sheet */}
      <OfficeFormSheet
        open={formSheetOpen}
        mode={formMode}
        office={formMode === 'edit' ? selectedOffice : null}
        offices={offices}
        submitting={saving}
        onClose={() => setFormSheetOpen(false)}
        onSubmit={saveOffice}
      />

      {/* Toast Notification */}
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
