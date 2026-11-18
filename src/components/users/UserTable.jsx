import React from 'react';
import { ChevronRight, Smartphone } from 'lucide-react';
import StatusBadge, { getUserInitials } from './StatusBadge.jsx';

export default function UserTable({ users, officeName, onSelect }) {
  return (
    <div className="overflow-hidden rounded-[20px] border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-slate-200/80 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/60 text-xs font-semibold text-slate-600 dark:text-slate-300">
              <th scope="col" className="py-3.5 pl-4 pr-3">User</th>
              <th scope="col" className="py-3.5 px-3">Role</th>
              <th scope="col" className="py-3.5 px-3">Office</th>
              <th scope="col" className="py-3.5 px-3">Status</th>
              <th scope="col" className="py-3.5 pl-3 pr-4">Device</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 text-sm">
            {users.map((u) => {
              const uid = u.uid || u.id;
              const displayName = u.name || u.email || uid;
              const initials = getUserInitials(u.name, u.email);
              const resolvedOffice = officeName ? officeName(u.officeId) : '';
              const isBound = Boolean(u.boundDeviceId);

              return (
                <tr
                  key={uid}
                  tabIndex={0}
                  role="button"
                  aria-label={`Open details for ${displayName}`}
                  onClick={() => onSelect(u)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelect(u);
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
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                          {u.designation || 'No designation'}
                          {u.email ? ` · ${u.email}` : ''}
                        </div>
                      </div>
                    </div>
                  </td>

                  <td className="py-3.5 px-3 whitespace-nowrap">
                    <StatusBadge kind="role" value={u.role || 'employee'} />
                  </td>

                  <td className="py-3.5 px-3 text-xs text-slate-600 dark:text-slate-300 max-w-[190px] truncate">
                    {resolvedOffice || <span className="text-slate-400 dark:text-slate-500">No office</span>}
                  </td>

                  <td className="py-3.5 px-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <StatusBadge kind="status" value={u.status || 'active'} />
                      <StatusBadge kind="approval" value={u.approvalStatus || 'pending'} />
                    </div>
                  </td>

                  <td className="py-3.5 pl-3 pr-4">
                    <div className="flex items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1.5 text-xs font-mono-tabular text-slate-600 dark:text-slate-300 whitespace-nowrap">
                        <Smartphone
                          aria-hidden="true"
                          className={`w-3.5 h-3.5 shrink-0 ${
                            isBound
                              ? 'text-[#0b6b4f] dark:text-[#4fd1a1]'
                              : 'text-slate-400 dark:text-slate-500'
                          }`}
                        />
                        {isBound ? `${u.boundDeviceId.slice(0, 10)}…` : 'Unbound'}
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
  );
}
