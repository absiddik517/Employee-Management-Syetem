import React from 'react';
import { ChevronRight, Smartphone } from 'lucide-react';
import StatusBadge, { getUserInitials } from './StatusBadge.jsx';

export default function UserCard({ user, officeName, onSelect }) {
  const uid = user.uid || user.id;
  const displayName = user.name || user.email || uid;
  const initials = getUserInitials(user.name, user.email);
  const resolvedOffice = officeName ? officeName(user.officeId) : '';
  const isBound = Boolean(user.boundDeviceId);

  return (
    <button
      type="button"
      onClick={() => onSelect(user)}
      aria-label={`Open details for ${displayName}`}
      className="group w-full text-left min-h-[44px] rounded-[20px] border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-xs hover:border-[#0b6b4f]/40 dark:hover:border-[#4fd1a1]/40 hover:shadow-sm active:scale-[0.995] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b6b4f] dark:focus-visible:ring-[#4fd1a1]"
    >
      <div className="flex items-start gap-3.5">
        <div
          aria-hidden="true"
          className="w-11 h-11 rounded-[14px] bg-[#0b6b4f]/10 dark:bg-[#4fd1a1]/15 text-[#0b6b4f] dark:text-[#4fd1a1] font-bold text-sm flex items-center justify-center shrink-0"
        >
          {initials}
        </div>

        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[15px] font-semibold text-slate-900 dark:text-slate-100 truncate">
                {displayName}
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
                {user.designation || 'No designation'}
                {resolvedOffice ? ` · ${resolvedOffice}` : ''}
              </div>
            </div>
            <ChevronRight
              aria-hidden="true"
              className="w-4 h-4 text-slate-400 dark:text-slate-500 group-hover:text-[#0b6b4f] dark:group-hover:text-[#4fd1a1] transition-colors shrink-0 mt-1"
            />
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <StatusBadge kind="role" value={user.role || 'employee'} />
            <StatusBadge kind="status" value={user.status || 'active'} />
            <StatusBadge kind="approval" value={user.approvalStatus || 'pending'} />
          </div>

          <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-100 dark:border-slate-800/80 text-xs">
            <span className="inline-flex items-center gap-1.5 text-slate-600 dark:text-slate-300 truncate">
              <Smartphone
                aria-hidden="true"
                className={`w-3.5 h-3.5 shrink-0 ${
                  isBound
                    ? 'text-[#0b6b4f] dark:text-[#4fd1a1]'
                    : 'text-slate-400 dark:text-slate-500'
                }`}
              />
              <span className="truncate font-mono-tabular">
                {isBound ? `Bound · ${user.boundDeviceId.slice(0, 12)}…` : 'Unbound device'}
              </span>
            </span>
            {user.email && (
              <span className="text-[11px] text-slate-400 dark:text-slate-500 truncate max-w-[45%]">
                {user.email}
              </span>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}
