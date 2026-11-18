import React, { useEffect, useMemo, useState } from 'react';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { Lock, RotateCcw, Save, Search, ShieldCheck, X } from 'lucide-react';
import AppShell from '../../components/AppShell.jsx';
import ConfirmSheet from '../../components/ConfirmSheet.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { useData } from '../../context/DataContext.jsx';
import { db, OperationType, handleFirestoreError } from '../../firebase/config.js';
import { formatDhakaDateTime } from '../../utils/dhakaTime.js';
import {
  PERMISSION_DEFINITIONS,
  ROLES,
  ROLE_LIST,
  getDefaultPermissionScope,
  getEffectiveRoleScope,
  sanitizePermissionOverrides
} from '../../lib/permissions.js';

const SCOPE_LABELS = {
  none: 'Denied',
  self: 'Self',
  office: 'Office',
  subtree: 'Subtree',
  all: 'All'
};

const CATEGORIES = ['All', 'Attendance', 'Leave & Field Duty', 'Reports', 'Users & Devices', 'System & Audit'];

export default function AdminRolePermissionsPage() {
  const { profile, normalizedRole, permissionOverrides, permissionsMeta } = useAuth();
  const { logAudit } = useData();

  const [selectedRole, setSelectedRole] = useState(() => ROLE_LIST[ROLE_LIST.length - 1]?.key || ROLES.employee.key);
  const [draftOverrides, setDraftOverrides] = useState(() => sanitizePermissionOverrides(permissionOverrides));
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');
  const [saving, setSaving] = useState(false);
  const [confirmResetAll, setConfirmResetAll] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const isSuperAdminActor = normalizedRole === ROLES.super_admin.key;

  useEffect(() => {
    setDraftOverrides(sanitizePermissionOverrides(permissionOverrides));
  }, [permissionOverrides]);

  const savedJson = useMemo(() => JSON.stringify(sanitizePermissionOverrides(permissionOverrides)), [permissionOverrides]);
  const draftJson = useMemo(() => JSON.stringify(sanitizePermissionOverrides(draftOverrides)), [draftOverrides]);
  const isDirty = savedJson !== draftJson;

  const selectedRoleMeta = useMemo(
    () => ROLE_LIST.find((r) => r.key === selectedRole) || ROLE_LIST[0],
    [selectedRole]
  );

  const roleStats = useMemo(() => {
    const map = {};
    for (const r of ROLE_LIST) {
      let grantedCount = 0;
      let overrideCount = 0;
      for (const def of PERMISSION_DEFINITIONS) {
        const eff = getEffectiveRoleScope(r.key, def.key, draftOverrides);
        if (eff) grantedCount += 1;
        if (draftOverrides?.[r.key]?.[def.key]) overrideCount += 1;
      }
      map[r.key] = { grantedCount, overrideCount };
    }
    return map;
  }, [draftOverrides]);

  const totalOverridesCount = useMemo(
    () => Object.values(draftOverrides).reduce((sum, m) => sum + Object.keys(m || {}).length, 0),
    [draftOverrides]
  );

  const filteredDefinitions = useMemo(() => {
    const q = search.trim().toLowerCase();
    return PERMISSION_DEFINITIONS.filter((def) => {
      if (category !== 'All' && def.category !== category) return false;
      if (!q) return true;
      return (
        def.key.toLowerCase().includes(q) ||
        def.label.toLowerCase().includes(q) ||
        def.description.toLowerCase().includes(q) ||
        def.category.toLowerCase().includes(q)
      );
    });
  }, [search, category]);

  const setRolePermissionScope = (roleKey, permKey, nextScope) => {
    setFeedbackMsg('');
    setErrorMsg('');
    setDraftOverrides((prev) => {
      const next = { ...prev };
      const roleMap = { ...(next[roleKey] || {}) };
      const defScope = getDefaultPermissionScope(roleKey, permKey) || 'none';
      if (nextScope === defScope) {
        delete roleMap[permKey];
      } else {
        roleMap[permKey] = nextScope;
      }
      if (Object.keys(roleMap).length === 0) {
        delete next[roleKey];
      } else {
        next[roleKey] = roleMap;
      }
      return sanitizePermissionOverrides(next);
    });
  };

  const resetSelectedRoleToDefaults = () => {
    setFeedbackMsg('');
    setErrorMsg('');
    setDraftOverrides((prev) => {
      const next = { ...prev };
      delete next[selectedRole];
      return sanitizePermissionOverrides(next);
    });
  };

  const resetAllToDefaults = async () => {
    setConfirmResetAll(false);
    await persistOverrides({}, 'Reset all role permissions to built-in defaults');
  };

  const persistOverrides = async (overridesToSave, auditReason) => {
    if (!isSuperAdminActor || !profile?.uid) {
      setErrorMsg('শুধুমাত্র Super Admin রোল পারমিশন পরিবর্তন করতে পারবেন।');
      return;
    }
    setSaving(true);
    setErrorMsg('');
    setFeedbackMsg('');
    const cleaned = sanitizePermissionOverrides(overridesToSave);
    try {
      await setDoc(doc(db, 'settings', 'permissions'), {
        overrides: cleaned,
        updatedAt: serverTimestamp(),
        updatedBy: profile.uid,
        updatedByName: profile.name || profile.email || 'Super Admin'
      });

      await logAudit({
        actor: profile,
        action: 'ROLE_PERMISSIONS_UPDATED',
        targetCollection: 'settings',
        targetId: 'permissions',
        oldValue: savedJson,
        newValue: JSON.stringify(cleaned),
        reason: auditReason || 'Updated role permission configuration'
      });

      setFeedbackMsg('রোলের পারমিশন সফলভাবে সংরক্ষণ ও কার্যকর করা হয়েছে।');
    } catch (err) {
      setErrorMsg('পারমিশন সংরক্ষণ করা যায়নি। অনুগ্রহ করে আবার চেষ্টা করুন।');
      handleFirestoreError(err, OperationType.WRITE, 'settings/permissions');
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    await persistOverrides(draftOverrides, `Updated permissions (${totalOverridesCount} custom overrides active)`);
  };

  const handleDiscard = () => {
    setFeedbackMsg('');
    setErrorMsg('');
    setDraftOverrides(sanitizePermissionOverrides(permissionOverrides));
  };

  return (
    <AppShell title="Role Permissions" showThemeToggle>
      <div className="space-y-5 pb-12">
        {/* Header */}
        <section className="rounded-[20px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100 font-display flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-[#0b6b4f] dark:text-[#4fd1a1]" />
              <span>Role Permissions Manager</span>
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              যেকোনো রোলের অনুমতি (Permission) এবং তার সীমা (Self / Office / Subtree / All) এখান থেকে পরিবর্তন করা যাবে; পরিবর্তনটি সাথে সাথে UI ও Security Rules-এ কার্যকর হবে।
            </p>
            {permissionsMeta?.updatedAt && (
              <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">
                Last updated by {permissionsMeta.updatedByName || 'Super Admin'} · {formatDhakaDateTime(permissionsMeta.updatedAt)}
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {totalOverridesCount > 0 && (
              <button
                type="button"
                disabled={saving || !isSuperAdminActor}
                onClick={() => setConfirmResetAll(true)}
                className="min-h-[44px] px-3.5 py-2 rounded-[14px] border border-amber-300 dark:border-amber-800 text-amber-800 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/40 text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-50"
              >
                <RotateCcw className="w-4 h-4" />
                <span>Reset all defaults</span>
              </button>
            )}
            <button
              type="button"
              disabled={!isDirty || saving || !isSuperAdminActor}
              onClick={handleSave}
              className="min-h-[44px] px-4 py-2 rounded-[14px] bg-[#0b6b4f] hover:bg-[#09553f] dark:bg-[#4fd1a1] dark:hover:bg-[#3fc090] text-white dark:text-slate-950 text-xs font-semibold inline-flex items-center gap-2 disabled:opacity-50 transition-colors"
            >
              <Save className="w-4 h-4" />
              <span>{saving ? 'Saving...' : 'Save Permissions'}</span>
            </button>
          </div>
        </section>

        {!isSuperAdminActor && (
          <div className="p-3.5 rounded-[14px] bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-200">
            শুধুমাত্র Super Admin রোলের পারমিশন পরিবর্তন ও সংরক্ষণ করতে পারেন। আপনি শুধুমাত্র প্রিভিউ দেখতে পাচ্ছেন।
          </div>
        )}

        {isDirty && (
          <div className="p-3.5 rounded-[16px] bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs font-medium text-amber-900 dark:text-amber-200">
              আপনার কিছু পরিবর্তন এখনো সংরক্ষণ করা হয়নি। কার্যকর করতে &ldquo;Save Permissions&rdquo; চাপুন।
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleDiscard}
                disabled={saving}
                className="min-h-[44px] px-3.5 py-1.5 rounded-[12px] border border-amber-300 dark:border-amber-700 text-xs font-semibold text-amber-900 dark:text-amber-200 hover:bg-amber-100/70 dark:hover:bg-amber-900/40"
              >
                Discard
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || !isSuperAdminActor}
                className="min-h-[44px] px-4 py-1.5 rounded-[12px] bg-[#0b6b4f] text-white text-xs font-semibold hover:bg-[#09553f] disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save now'}
              </button>
            </div>
          </div>
        )}

        {feedbackMsg && (
          <div className="p-3.5 rounded-[14px] bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-800 dark:text-emerald-200">
            {feedbackMsg}
          </div>
        )}
        {errorMsg && (
          <div className="p-3.5 rounded-[14px] bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-xs text-rose-800 dark:text-rose-200">
            {errorMsg}
          </div>
        )}

        {/* Role Selector */}
        <section aria-label="Select role to configure" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
          {ROLE_LIST.map((role) => {
            const active = selectedRole === role.key;
            const stats = roleStats[role.key] || { grantedCount: 0, overrideCount: 0 };
            return (
              <button
                key={role.key}
                type="button"
                onClick={() => setSelectedRole(role.key)}
                className={`min-h-[44px] text-left rounded-[16px] border p-3.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b6b4f] dark:focus-visible:ring-[#4fd1a1] ${
                  active
                    ? 'bg-[#0b6b4f]/10 dark:bg-[#4fd1a1]/15 border-[#0b6b4f] dark:border-[#4fd1a1]'
                    : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/70'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={`text-sm font-bold ${
                      active ? 'text-[#0b6b4f] dark:text-[#4fd1a1]' : 'text-slate-900 dark:text-slate-100'
                    }`}
                  >
                    {role.label}
                  </span>
                  <span className="text-[11px] font-mono-tabular px-2 py-0.5 rounded-[8px] bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                    Rank {role.rank}
                  </span>
                </div>
                <div className="mt-1.5 flex items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
                  <span>{stats.grantedCount} active permissions</span>
                  {stats.overrideCount > 0 && (
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-[8px] bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300">
                      {stats.overrideCount} modified
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </section>

        {/* Search & Category Filters */}
        <section className="space-y-3">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="relative flex-1 md:max-w-md">
              <Search
                aria-hidden="true"
                className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
              />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search permission by name or key..."
                className="w-full min-h-[44px] pl-10 pr-10 py-2 rounded-[14px] border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-base sm:text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#0b6b4f] dark:focus:ring-[#4fd1a1]"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  aria-label="Clear search"
                  className="min-h-[44px] min-w-[44px] absolute right-0 top-1/2 -translate-y-1/2 inline-flex items-center justify-center text-slate-400"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {roleStats[selectedRole]?.overrideCount > 0 && (
              <button
                type="button"
                onClick={resetSelectedRoleToDefaults}
                disabled={saving || !isSuperAdminActor}
                className="min-h-[44px] px-3.5 py-2 rounded-[14px] border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 inline-flex items-center gap-1.5 self-start disabled:opacity-50"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset {selectedRoleMeta?.label} to defaults</span>
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {CATEGORIES.map((cat) => {
              const active = category === cat;
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setCategory(cat)}
                  className={`min-h-[44px] px-3.5 py-2 rounded-[14px] border text-xs font-semibold transition-colors ${
                    active
                      ? 'bg-[#0b6b4f] dark:bg-[#4fd1a1] text-white dark:text-slate-950 border-[#0b6b4f] dark:border-[#4fd1a1]'
                      : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                >
                  {cat}
                </button>
              );
            })}
          </div>
        </section>

        {/* Permissions List for Selected Role */}
        <section className="rounded-[20px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800">
          <div className="p-4 sm:p-5 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 font-display">
                {selectedRoleMeta?.label} — Permissions
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Default scope: <span className="font-semibold">{selectedRoleMeta?.defaultScope}</span> · Key:{' '}
                <code className="font-mono-tabular">{selectedRoleMeta?.key}</code>
              </p>
            </div>
            <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
              Showing {filteredDefinitions.length} of {PERMISSION_DEFINITIONS.length}
            </span>
          </div>

          {filteredDefinitions.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">
              কোনো পারমিশন খুঁজে পাওয়া যায়নি।
            </div>
          ) : (
            filteredDefinitions.map((def) => {
              const currentScope = getEffectiveRoleScope(selectedRole, def.key, draftOverrides) || 'none';
              const defaultScope = getDefaultPermissionScope(selectedRole, def.key) || 'none';
              const isModified = currentScope !== defaultScope;
              const isLocked = selectedRole === ROLES.super_admin.key && Boolean(def.lockedForSuperAdmin);

              return (
                <div
                  key={def.key}
                  className="p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4"
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold text-slate-900 dark:text-slate-100">{def.label}</span>
                      <code className="text-[11px] font-mono-tabular px-2 py-0.5 rounded-[8px] bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                        {def.key}
                      </code>
                      <span className="text-[11px] px-2 py-0.5 rounded-[8px] bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
                        {def.category}
                      </span>
                      {isModified && (
                        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-[8px] bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300">
                          Modified (Default: {SCOPE_LABELS[defaultScope]})
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{def.description}</p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {isLocked ? (
                      <div className="min-h-[44px] px-3.5 py-2 rounded-[14px] bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs font-semibold text-[#0b6b4f] dark:text-[#4fd1a1] inline-flex items-center gap-1.5">
                        <Lock className="w-3.5 h-3.5" />
                        <span>Always All (Locked)</span>
                      </div>
                    ) : (
                      <div
                        role="group"
                        aria-label={`${def.label} scope for ${selectedRoleMeta?.label}`}
                        className="inline-flex flex-wrap items-center gap-1 p-1 rounded-[14px] bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700"
                      >
                        {def.allowedScopes.map((scopeVal) => {
                          const selected = currentScope === scopeVal;
                          const isDeniedChoice = scopeVal === 'none';
                          return (
                            <button
                              key={scopeVal}
                              type="button"
                              disabled={!isSuperAdminActor || saving}
                              aria-pressed={selected}
                              onClick={() => setRolePermissionScope(selectedRole, def.key, scopeVal)}
                              className={`min-h-[44px] px-3 py-1.5 rounded-[10px] text-xs font-semibold transition-colors disabled:opacity-60 ${
                                selected
                                  ? isDeniedChoice
                                    ? 'bg-rose-700 text-white shadow-xs'
                                    : 'bg-[#0b6b4f] dark:bg-[#4fd1a1] text-white dark:text-slate-950 shadow-xs'
                                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                              }`}
                            >
                              {SCOPE_LABELS[scopeVal]}
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {isModified && !isLocked && (
                      <button
                        type="button"
                        disabled={!isSuperAdminActor || saving}
                        onClick={() => setRolePermissionScope(selectedRole, def.key, defaultScope)}
                        title="Restore default for this permission"
                        className="min-h-[44px] px-3 py-2 rounded-[12px] border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        Reset
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </section>

        <ConfirmSheet
          open={confirmResetAll}
          title="Reset All Role Permissions"
          message="This will remove all custom role-permission overrides and restore built-in defaults across every role. Continue?"
          confirmLabel="Reset All Defaults"
          danger={true}
          onConfirm={resetAllToDefaults}
          onCancel={() => setConfirmResetAll(false)}
        />
      </div>
    </AppShell>
  );
}
