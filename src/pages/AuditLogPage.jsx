import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, getDocs, limit, orderBy, query, where } from 'firebase/firestore';
import { History, Search, X } from 'lucide-react';
import AppShell from '../components/AppShell.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { db, OperationType, handleFirestoreError } from '../firebase/config.js';
import { formatDhakaDateTime } from '../utils/dhakaTime.js';
import { getRoleLabel, getUserOfficeScopeIds } from '../lib/permissions.js';

function timestampMillis(ts) {
  if (!ts) return 0;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (typeof ts.seconds === 'number') return ts.seconds * 1000;
  return 0;
}

export default function AuditLogPage() {
  const { effectiveAuthUser, offices, permissionScope } = useAuth();
  const [loading, setLoading] = useState(true);
  const [logs, setLogs] = useState([]);
  const [search, setSearch] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const scope = permissionScope('audit.view');
  const officeMap = useMemo(() => new Map(offices.map((o) => [o.id, o])), [offices]);

  const loadLogs = useCallback(async () => {
    if (!scope || !effectiveAuthUser) return;
    setLoading(true);
    setErrorMsg('');
    try {
      let items = [];
      if (scope === 'all') {
        const snap = await getDocs(
          query(collection(db, 'auditLogs'), orderBy('timestamp', 'desc'), limit(200))
        );
        items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      } else if (scope === 'subtree' || scope === 'office') {
        const scopeIds = getUserOfficeScopeIds(effectiveAuthUser);
        if (scopeIds.length > 0) {
          const queries = [];
          for (const oid of scopeIds) {
            queries.push(
              getDocs(query(collection(db, 'auditLogs'), where('officeId', '==', oid), limit(100)))
            );
            if (scope === 'subtree') {
              queries.push(
                getDocs(query(collection(db, 'auditLogs'), where('districtOfficeId', '==', oid), limit(100)))
              );
            }
          }
          const snaps = await Promise.all(queries);
          const map = new Map();
          for (const snap of snaps) {
            for (const d of snap.docs) {
              map.set(d.id, { id: d.id, ...d.data() });
            }
          }
          items = Array.from(map.values()).sort(
            (a, b) => timestampMillis(b.timestamp) - timestampMillis(a.timestamp)
          );
        }
      }
      setLogs(items);
    } catch (err) {
      setErrorMsg('অডিট লগ লোড করা যায়নি।');
      handleFirestoreError(err, OperationType.LIST, 'auditLogs');
    } finally {
      setLoading(false);
    }
  }, [scope, effectiveAuthUser]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  const filteredLogs = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return logs;
    return logs.filter((l) => {
      const offName = (officeMap.get(l.officeId)?.name || '').toLowerCase();
      return (
        (l.action || '').toLowerCase().includes(q) ||
        (l.actorName || '').toLowerCase().includes(q) ||
        (l.targetCollection || '').toLowerCase().includes(q) ||
        (l.targetId || '').toLowerCase().includes(q) ||
        (l.reason || '').toLowerCase().includes(q) ||
        offName.includes(q)
      );
    });
  }, [logs, search, officeMap]);

  return (
    <AppShell title="Audit Trail" showThemeToggle>
      <div className="space-y-4">
        <section className="rounded-[20px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 font-display flex items-center gap-2">
              <History className="w-5 h-5 text-[#0b6b4f] dark:text-[#4fd1a1]" />
              <span>Audit Trail (অডিট লগ)</span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Scope: {scope === 'all' ? 'All offices (Read-only)' : 'District subtree (Read-only)'} · {filteredLogs.length} entries
            </p>
          </div>

          <div className="relative w-full sm:w-72">
            <Search
              aria-hidden="true"
              className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
            />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search action, actor, target..."
              className="w-full min-h-[44px] pl-10 pr-9 py-2 rounded-[14px] border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-base sm:text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#0b6b4f] dark:focus:ring-[#4fd1a1]"
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
        </section>

        {errorMsg && (
          <div className="p-3.5 rounded-[14px] bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/70 text-xs text-rose-800 dark:text-rose-200">
            {errorMsg}
          </div>
        )}

        {loading ? (
          <div className="rounded-[20px] border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-10 text-center text-sm text-slate-500">
            লোড হচ্ছে...
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="rounded-[20px] border border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-10 text-center text-sm text-slate-500">
            কোনো অডিট লগ পাওয়া যায়নি।
          </div>
        ) : (
          <div className="rounded-[20px] border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 divide-y divide-slate-100 dark:divide-slate-800">
            {filteredLogs.map((log) => (
              <div key={log.id} className="p-4 space-y-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-[10px] bg-slate-100 dark:bg-slate-800 text-xs font-semibold text-slate-800 dark:text-slate-200 font-mono-tabular">
                    {log.action}
                  </span>
                  <span className="text-xs text-slate-500 dark:text-slate-400 font-mono-tabular">
                    {formatDhakaDateTime(log.timestamp)}
                  </span>
                </div>
                <div className="text-xs text-slate-700 dark:text-slate-300">
                  <span className="font-semibold text-slate-900 dark:text-slate-100">{log.actorName}</span>{' '}
                  <span className="text-slate-500">({getRoleLabel(log.actorRole)})</span>
                  {log.officeId && (
                    <span className="text-slate-500"> · {officeMap.get(log.officeId)?.name || log.officeId}</span>
                  )}
                </div>
                <div className="text-xs text-slate-600 dark:text-slate-400 break-words">
                  <span className="font-mono-tabular text-slate-500">
                    {log.targetCollection}/{log.targetId}
                  </span>
                  {log.oldValue || log.newValue ? (
                    <span>
                      {' · '}
                      {log.oldValue ? `${log.oldValue} -> ` : ''}
                      {log.newValue}
                    </span>
                  ) : null}
                </div>
                {log.reason && (
                  <div className="text-xs text-slate-500 dark:text-slate-400">Reason: {log.reason}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
