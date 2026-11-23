import React from 'react';
import { Briefcase, FileText } from 'lucide-react';
import { getRoleLabel } from '../../lib/permissions.js';
import { getTodayDhaka } from '../../utils/dhakaTime.js';

export const ASSIGNMENT_KIND_LABELS = {
  primary: 'মূল পদায়ন',
  additional_charge: 'অতিরিক্ত দায়িত্ব',
  acting_charge: 'চলতি দায়িত্ব',
  attachment: 'সংযুক্তি'
};

export const ASSIGNMENT_TYPE_LABELS = {
  joined: 'যোগদান',
  transfer: 'বদলি / পদায়ন',
  role_change: 'দায়িত্ব / ভূমিকা পরিবর্তন',
  designation_change: 'পদবি পরিবর্তন',
  charge_started: 'দায়িত্ব / সংযুক্তি শুরু',
  charge_ended: 'দায়িত্ব / সংযুক্তি সমাপ্ত',
  resigned: 'পদত্যাগ / অব্যাহতি'
};

export default function AssignmentsTimeline({
  assignments = [],
  loading = false,
  error = '',
  officeName,
  roleRegistry,
  emptyText = 'এখনো কোনো পদায়ন বা দায়িত্বের ইতিহাস লিপিবদ্ধ হয়নি।'
}) {
  if (error) {
    return (
      <div className="p-3 rounded-[14px] bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/70 text-xs text-rose-700 dark:text-rose-200">
        {error}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="rounded-[16px] border border-slate-200 dark:border-slate-800 p-6 text-center text-xs text-slate-500 dark:text-slate-400">
        কর্মজীবনের ইতিহাস লোড হচ্ছে...
      </div>
    );
  }

  if (!assignments || assignments.length === 0) {
    return (
      <div className="rounded-[16px] border border-dashed border-slate-300 dark:border-slate-700 p-6 text-center space-y-1.5">
        <Briefcase className="w-5 h-5 text-slate-400 dark:text-slate-500 mx-auto" aria-hidden="true" />
        <p className="text-xs text-slate-500 dark:text-slate-400">{emptyText}</p>
      </div>
    );
  }

  const todayStr = getTodayDhaka();

  return (
    <ol className="relative pl-5 space-y-3 before:content-[''] before:absolute before:left-[7px] before:top-2 before:bottom-2 before:w-px before:bg-slate-200 dark:before:bg-slate-700">
      {assignments.map((rec) => {
        const isClosed = Boolean(rec.closedAt) || (rec.kind === 'primary' && Boolean(rec.endDate));
        const isExpiredOpen = !rec.closedAt && Boolean(rec.endDate) && rec.endDate < todayStr;
        const isOpen = !isClosed;
        const resolvedOfficeName = rec.officeName || (officeName ? officeName(rec.officeId) : rec.officeId) || '—';
        const resolvedRoleLabel = rec.roleLabel || getRoleLabel(rec.roleKey, roleRegistry);

        return (
          <li key={rec.id} className="relative">
            <span
              aria-hidden="true"
              className={`absolute -left-5 top-4 w-3.5 h-3.5 rounded-full border-2 ${
                isExpiredOpen
                  ? 'bg-amber-500 border-white dark:border-slate-900 ring-2 ring-amber-500/30'
                  : isOpen
                  ? 'bg-[#0b6b4f] dark:bg-[#4fd1a1] border-white dark:border-slate-900 ring-2 ring-[#0b6b4f]/25 dark:ring-[#4fd1a1]/25'
                  : 'bg-slate-300 dark:bg-slate-600 border-white dark:border-slate-900'
              }`}
            />

            <div
              className={`rounded-[16px] border p-3.5 space-y-1.5 ${
                isExpiredOpen
                  ? 'border-amber-300 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20'
                  : isOpen
                  ? 'border-[#0b6b4f]/30 dark:border-[#4fd1a1]/30 bg-emerald-50/40 dark:bg-emerald-950/20'
                  : 'border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                    {resolvedOfficeName}
                  </div>
                  <div className="text-[11.5px] text-slate-600 dark:text-slate-300 mt-0.5">
                    {rec.designation ? `${rec.designation} · ` : ''}
                    {resolvedRoleLabel}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span
                    className={`px-2 py-0.5 rounded-[8px] border text-[10.5px] font-semibold ${
                      isOpen
                        ? 'border-[#0b6b4f]/30 dark:border-[#4fd1a1]/40 bg-white dark:bg-slate-900 text-[#0b6b4f] dark:text-[#4fd1a1]'
                        : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200'
                    }`}
                  >
                    {ASSIGNMENT_KIND_LABELS[rec.kind] || rec.kind}
                  </span>
                  {isExpiredOpen && (
                    <span className="px-2 py-0.5 rounded-[8px] bg-amber-100 dark:bg-amber-900/70 text-amber-900 dark:text-amber-100 text-[10px] font-semibold">
                      মেয়াদ শেষ – এখনো চালু
                    </span>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                <span>{ASSIGNMENT_TYPE_LABELS[rec.type] || rec.type}</span>
                <span className="font-mono-tabular font-medium">
                  {rec.startDate} → {rec.endDate || 'চলমান'}
                </span>
              </div>

              {(rec.orderNo || rec.orderDate || rec.reason) && (
                <div className="text-[11px] text-slate-500 dark:text-slate-400 pt-1.5 border-t border-slate-200/70 dark:border-slate-700/70 space-y-0.5">
                  {(rec.orderNo || rec.orderDate) && (
                    <div className="inline-flex flex-wrap items-center gap-1.5">
                      <FileText className="w-3 h-3 shrink-0 text-slate-400" aria-hidden="true" />
                      {rec.orderNo && <span>আদেশ নং: {rec.orderNo}</span>}
                      {rec.orderDate && (
                        <span className="font-mono-tabular">
                          {rec.orderNo ? '· ' : ''}তারিখ: {rec.orderDate}
                        </span>
                      )}
                    </div>
                  )}
                  {rec.reason && <div>কারণ: {rec.reason}</div>}
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
