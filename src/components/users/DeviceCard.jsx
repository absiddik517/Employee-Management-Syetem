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

export default function DeviceCard({ entry, officeName, onSelect }) {
  const { user, device, derivedStatus, isShared, sharedCount } = entry;
  const uid = user?.uid || user?.id || '';
  const userName = user?.name || user?.email || uid || 'Unknown';
  const resolvedOffice = officeName ? officeName(user?.officeId) : '';
  const deviceName = device?.name || 'Unknown device';
  const modelLine =
    device?.model && device.model !== 'Unknown'
      ? `${device.model}${device?.manufacturer && device.manufacturer !== 'Unknown' ? ` · ${device.manufacturer}` : ''}`
      : 'No details yet';
  const systemLine = [
    device?.platform && device.platform !== 'Unknown' ? device.platform : '',
    device?.osVersion && device.osVersion !== 'Unknown' ? device.osVersion : ''
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <button
      type="button"
      onClick={() => onSelect(entry)}
      aria-label={`Open device details for ${deviceName} (${userName})`}
      className="group w-full text-left min-h-[44px] rounded-[20px] border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-xs hover:border-[#0b6b4f]/40 dark:hover:border-[#4fd1a1]/40 hover:shadow-sm active:scale-[0.995] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b6b4f] dark:focus-visible:ring-[#4fd1a1]"
    >
      <div className="flex items-start gap-3.5">
        <div
          aria-hidden="true"
          className={`w-11 h-11 rounded-[14px] flex items-center justify-center shrink-0 ${
            derivedStatus === 'bound'
              ? 'bg-[#0b6b4f]/10 dark:bg-[#4fd1a1]/15 text-[#0b6b4f] dark:text-[#4fd1a1]'
              : derivedStatus === 'blocked'
              ? 'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300'
              : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
          }`}
        >
          {derivedStatus === 'blocked' ? (
            <ShieldAlert className="w-5 h-5" />
          ) : (
            <Smartphone className="w-5 h-5" />
          )}
        </div>

        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[15px] font-semibold text-slate-900 dark:text-slate-100 truncate">
                {deviceName}
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
                {modelLine}
              </div>
            </div>
            <ChevronRight
              aria-hidden="true"
              className="w-4 h-4 text-slate-400 dark:text-slate-500 group-hover:text-[#0b6b4f] dark:group-hover:text-[#4fd1a1] transition-colors shrink-0 mt-1"
            />
          </div>

          <div className="text-xs text-slate-700 dark:text-slate-300 truncate">
            <span className="font-medium">{userName}</span>
            {resolvedOffice ? <span className="text-slate-500 dark:text-slate-400"> · {resolvedOffice}</span> : null}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={`inline-flex items-center px-2.5 py-0.5 rounded-[12px] border text-xs font-medium whitespace-nowrap ${statusToneClasses(
                derivedStatus
              )}`}
            >
              {getDeviceStatusLabel(derivedStatus)}
            </span>
            {isShared && (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-[12px] border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 text-xs font-medium whitespace-nowrap">
                <Users className="w-3 h-3 shrink-0" aria-hidden="true" />
                <span>Shared ({sharedCount})</span>
              </span>
            )}
          </div>

          <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-slate-100 dark:border-slate-800/80 text-xs text-slate-500 dark:text-slate-400">
            <span className="truncate font-mono-tabular">
              {systemLine || 'Unknown'} · {device?.ip || 'Unknown IP'}
            </span>
            <span className="text-[11px] font-mono-tabular shrink-0">
              {formatDeviceTimestamp(device?.lastSeenAt)}
            </span>
          </div>
        </div>
      </div>
    </button>
  );
}
