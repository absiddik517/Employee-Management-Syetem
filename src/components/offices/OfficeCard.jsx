import React from 'react';
import { Building2, ChevronRight, Clock, Radio } from 'lucide-react';
import {
  formatRadius,
  formatTime12h,
  getLevelShortLabel
} from './officeHelpers.js';

export default function OfficeCard({ office, parentName, onSelect }) {
  const levelShort = getLevelShortLabel(office.level);
  const hasParent = Boolean(office.parentOfficeId && parentName);
  const start12 = formatTime12h(office.startTime || '09:00');
  const end12 = formatTime12h(office.endTime || '17:00');

  return (
    <button
      type="button"
      onClick={() => onSelect(office)}
      aria-label={`Open details for ${office.name}`}
      className="group w-full text-left min-h-[44px] rounded-[20px] border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-xs hover:border-[#0b6b4f]/40 dark:hover:border-[#4fd1a1]/40 hover:shadow-sm active:scale-[0.995] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b6b4f] dark:focus-visible:ring-[#4fd1a1]"
    >
      <div className="flex items-start gap-3.5">
        <div
          aria-hidden="true"
          className="w-11 h-11 rounded-[14px] bg-[#0b6b4f]/10 dark:bg-[#4fd1a1]/15 text-[#0b6b4f] dark:text-[#4fd1a1] flex items-center justify-center shrink-0"
        >
          <Building2 className="w-5 h-5" />
        </div>

        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[15px] font-semibold text-slate-900 dark:text-slate-100 truncate">
                {office.name}
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400 truncate mt-0.5">
                {office.address || 'No address set'}
              </div>
            </div>
            <ChevronRight
              aria-hidden="true"
              className="w-4 h-4 text-slate-400 dark:text-slate-500 group-hover:text-[#0b6b4f] dark:group-hover:text-[#4fd1a1] transition-colors shrink-0 mt-1"
            />
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-[14px] border border-[#0b6b4f]/20 dark:border-[#4fd1a1]/30 bg-[#0b6b4f]/10 dark:bg-[#4fd1a1]/15 text-[#0b6b4f] dark:text-[#4fd1a1] text-xs font-semibold">
              {levelShort}
            </span>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-[14px] border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-xs font-medium max-w-full truncate">
              {hasParent ? `Under ${parentName}` : 'Top level'}
            </span>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 pt-2 border-t border-slate-100 dark:border-slate-800/80 text-xs text-slate-600 dark:text-slate-300">
            <span className="inline-flex items-center gap-1.5 font-mono-tabular">
              <Radio className="w-3.5 h-3.5 text-[#0b6b4f] dark:text-[#4fd1a1] shrink-0" aria-hidden="true" />
              <span>{formatRadius(office.geofenceRadiusMeters || 100)}</span>
            </span>
            <span className="inline-flex items-center gap-1.5 tabular-nums">
              <Clock className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 shrink-0" aria-hidden="true" />
              <span>
                {start12} – {end12}
              </span>
            </span>
          </div>
        </div>
      </div>
    </button>
  );
}
