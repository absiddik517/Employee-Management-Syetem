import React from 'react';
import { CheckCircle2, Clock3, Calendar, XCircle, HelpCircle } from 'lucide-react';

export default function StatusText({ status }) {
  const normalized = String(status || '').toLowerCase();

  let textClass = 'text-slate-600';
  let IconComponent = HelpCircle;

  if (normalized.includes('on time') || status === 'সময়মতো' || normalized === 'approved') {
    textClass = 'text-emerald-700';
    IconComponent = CheckCircle2;
  } else if (normalized.includes('late') || status === 'বিলম্বিত' || normalized === 'pending') {
    textClass = 'text-amber-700';
    IconComponent = Clock3;
  } else if (normalized.includes('leave')) {
    textClass = 'text-sky-700';
    IconComponent = Calendar;
  } else if (normalized.includes('absent') || normalized === 'rejected') {
    textClass = 'text-rose-700';
    IconComponent = XCircle;
  }

  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold whitespace-nowrap ${textClass}`}>
      <IconComponent className="w-3.5 h-3.5 shrink-0" />
      <span>{status}</span>
    </span>
  );
}
