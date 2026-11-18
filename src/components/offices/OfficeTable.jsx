import React from 'react';
import { Building2, ChevronRight } from 'lucide-react';
import {
  formatRadius,
  formatTime12h,
  getLevelShortLabel
} from './officeHelpers.js';

export default function OfficeTable({ offices, officeName, onSelect }) {
  return (
    <div className="overflow-hidden rounded-[20px] border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-slate-200/80 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/60 text-xs font-semibold text-slate-600 dark:text-slate-300">
              <th scope="col" className="py-3.5 pl-4 pr-3">Office</th>
              <th scope="col" className="py-3.5 px-3">Level</th>
              <th scope="col" className="py-3.5 px-3">Parent</th>
              <th scope="col" className="py-3.5 px-3">Radius</th>
              <th scope="col" className="py-3.5 pl-3 pr-4">Working hours</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 text-sm">
            {offices.map((o) => {
              const parentLabel = o.parentOfficeId ? officeName(o.parentOfficeId) : '';
              const start12 = formatTime12h(o.startTime || '09:00');
              const end12 = formatTime12h(o.endTime || '17:00');
              const grace = o.graceMinutes ?? 15;

              return (
                <tr
                  key={o.id}
                  tabIndex={0}
                  role="button"
                  aria-label={`Open details for ${o.name}`}
                  onClick={() => onSelect(o)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelect(o);
                    }
                  }}
                  className="group cursor-pointer hover:bg-slate-50/90 dark:hover:bg-slate-800/50 transition-colors focus-visible:outline-none focus-visible:bg-[#0b6b4f]/5 dark:focus-visible:bg-[#4fd1a1]/10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0b6b4f] dark:focus-visible:ring-[#4fd1a1]"
                >
                  <td className="py-3.5 pl-4 pr-3">
                    <div className="flex items-center gap-3 min-w-[220px]">
                      <div
                        aria-hidden="true"
                        className="w-10 h-10 rounded-[14px] bg-[#0b6b4f]/10 dark:bg-[#4fd1a1]/15 text-[#0b6b4f] dark:text-[#4fd1a1] flex items-center justify-center shrink-0"
                      >
                        <Building2 className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                          {o.name}
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400 truncate max-w-[260px]">
                          {o.address || 'No address set'}
                        </div>
                      </div>
                    </div>
                  </td>

                  <td className="py-3.5 px-3 whitespace-nowrap">
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-[14px] border border-[#0b6b4f]/20 dark:border-[#4fd1a1]/30 bg-[#0b6b4f]/10 dark:bg-[#4fd1a1]/15 text-[#0b6b4f] dark:text-[#4fd1a1] text-xs font-semibold">
                      {getLevelShortLabel(o.level)}
                    </span>
                  </td>

                  <td className="py-3.5 px-3 text-xs text-slate-600 dark:text-slate-300 max-w-[190px] truncate">
                    {parentLabel || <span className="text-slate-400 dark:text-slate-500">None</span>}
                  </td>

                  <td className="py-3.5 px-3 text-xs font-mono-tabular text-slate-700 dark:text-slate-200 whitespace-nowrap">
                    {formatRadius(o.geofenceRadiusMeters || 100)}
                  </td>

                  <td className="py-3.5 pl-3 pr-4">
                    <div className="flex items-center justify-between gap-2 whitespace-nowrap">
                      <span className="text-xs text-slate-700 dark:text-slate-200 tabular-nums">
                        {start12} – {end12}{' '}
                        <span className="text-slate-400 dark:text-slate-500">(+{grace} min)</span>
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
