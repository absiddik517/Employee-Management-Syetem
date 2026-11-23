import React from 'react';
import { ChevronRight, ShieldAlert, Smartphone, Users } from 'lucide-react';
import { formatDeviceTimestamp, getDeviceStatusLabel } from '../../utils/deviceInfo.js';

function statusToneClasses(derivedStatus) {
  if (derivedStatus === 'bound') {
    return 'bg-[#0b6b4f]/10 dark:bg-[#4fd1a1]/15 text-[#0b6b4f] dark:text-[#4fd1a1] border-[#0b6b4f]/25 dark:border-[#4fd1a1]/30';
  }
  if (derivedStatus === 'blocked') {
    return 'bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-900/70';
  }
  return 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700';
}

export default function DevicesTable({ entries, officeName, onSelect }) {
  return (
    <div className="overflow-hidden rounded-[20px] border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-slate-200/80 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/60 text-xs font-semibold text-slate-600 dark:text-slate-300">
              <th scope="col" className="py-3.5 pl-4 pr-3">Device</th>
              <th scope="col" className="py-3.5 px-3">User</th>
              <th scope="col" className="py-3.5 px-3">System</th>
              <th scope="col" className="py-3.5 px-3">IP address</th>
              <th scope="col" className="py-3.5 px-3">Status</th>
              <th scope="col" className="py-3.5 pl-3 pr-4">Last active</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 text-sm">
            {entries.map((entry) => {
              const { user, device, derivedStatus, isShared, sharedCount } = entry;
              const uid = user?.uid || user?.id || '';
              const userName = user?.name || user?.email || uid || 'Unknown';
              const resolvedOffice = officeName ? officeName(user?.officeId) : '';
              const deviceName = device?.name || 'Unknown device';
              const modelText =
                device?.model && device.model !== 'Unknown'
                  ? `${device.model}${device?.manufacturer && device.manufacturer !== 'Unknown' ? ` · ${device.manufacturer}` : ''}`
                  : 'No details yet';
              const systemTop =
                [device?.platform, device?.osVersion]
                  .filter((v) => v && v !== 'Unknown')
                  .join(' · ') || 'Unknown';
              const systemSub =
                [device?.engine, device?.appVersion]
                  .filter((v) => v && v !== 'Unknown')
                  .join(' · ') || 'No details yet';

              return (
                <tr
                  key={`${uid}_${device.deviceId}`}
                  tabIndex={0}
                  role="button"
                  aria-label={`Open device details for ${deviceName} (${userName})`}
                  onClick={() => onSelect(entry)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelect(entry);
                    }
                  }}
                  className="group cursor-pointer hover:bg-slate-50/90 dark:hover:bg-slate-800/50 transition-colors focus-visible:outline-none focus-visible:bg-[#0b6b4f]/5 dark:focus-visible:bg-[#4fd1a1]/10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0b6b4f] dark:focus-visible:ring-[#4fd1a1]"
                >
                  <td className="py-3.5 pl-4 pr-3">
                    <div className="flex items-center gap-3 min-w-[190px]">
                      <div
                        aria-hidden="true"
                        className={`w-9 h-9 rounded-[12px] flex items-center justify-center shrink-0 ${
                          derivedStatus === 'bound'
                            ? 'bg-[#0b6b4f]/10 dark:bg-[#4fd1a1]/15 text-[#0b6b4f] dark:text-[#4fd1a1]'
                            : derivedStatus === 'blocked'
                            ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                        }`}
                      >
                        {derivedStatus === 'blocked' ? (
                          <ShieldAlert className="w-4 h-4" />
                        ) : (
                          <Smartphone className="w-4 h-4" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                          {deviceName}
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                          {modelText} · <span className="font-mono-tabular">{device.deviceId.slice(0, 12)}…</span>
                        </div>
                      </div>
                    </div>
                  </td>

                  <td className="py-3.5 px-3">
                    <div className="min-w-[150px] max-w-[200px]">
                      <div className="font-medium text-slate-900 dark:text-slate-100 truncate">
                        {userName}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                        {resolvedOffice || user?.designation || '—'}
                      </div>
                    </div>
                  </td>

                  <td className="py-3.5 px-3">
                    <div className="min-w-[140px] max-w-[190px]">
                      <div className="text-xs font-medium text-slate-800 dark:text-slate-200 truncate">
                        {systemTop}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                        {systemSub}
                      </div>
                    </div>
                  </td>

                  <td className="py-3.5 px-3 whitespace-nowrap text-xs font-mono-tabular text-slate-700 dark:text-slate-300">
                    {device?.ip || 'Unknown'}
                  </td>

                  <td className="py-3.5 px-3 whitespace-nowrap">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-[12px] border text-xs font-medium ${statusToneClasses(
                          derivedStatus
                        )}`}
                      >
                        {getDeviceStatusLabel(derivedStatus)}
                      </span>
                      {isShared && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[12px] border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 text-xs font-medium">
                          <Users className="w-3 h-3 shrink-0" aria-hidden="true" />
                          <span>Shared ({sharedCount})</span>
                        </span>
                      )}
                    </div>
                  </td>

                  <td className="py-3.5 pl-3 pr-4">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-mono-tabular text-slate-600 dark:text-slate-300 whitespace-nowrap">
                        {formatDeviceTimestamp(device?.lastSeenAt)}
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
