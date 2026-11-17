import React from 'react';
import { CheckCircle2, Loader2, AlertTriangle, XCircle, Circle } from 'lucide-react';

function StatusIcon({ status, className = 'w-3.5 h-3.5' }) {
  switch (status) {
    case 'running':
      return <Loader2 className={`${className} text-emerald-700 animate-spin shrink-0`} />;
    case 'done':
      return <CheckCircle2 className={`${className} text-emerald-700 shrink-0`} />;
    case 'skipped':
      return <AlertTriangle className={`${className} text-amber-600 shrink-0`} />;
    case 'error':
      return <XCircle className={`${className} text-rose-600 shrink-0`} />;
    default:
      return <Circle className={`${className} text-slate-300 shrink-0`} />;
  }
}

function statusTextColor(status) {
  switch (status) {
    case 'running':
      return 'text-slate-900 font-semibold';
    case 'done':
      return 'text-emerald-800';
    case 'skipped':
      return 'text-amber-800';
    case 'error':
      return 'text-rose-700 font-semibold';
    default:
      return 'text-slate-400';
  }
}

/**
 * Compact live task list rendered right beside the form submit button.
 */
export function SubmissionTasksInline({ tasks }) {
  if (!tasks || tasks.length === 0) return null;

  const runningTask = tasks.find((t) => t.status === 'running');
  const failedTask = tasks.find((t) => t.status === 'error');
  const completedCount = tasks.filter((t) => t.status === 'done' || t.status === 'skipped').length;

  return (
    <div className="flex-1 min-w-[220px] rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 space-y-1.5">
      <div className="flex items-center justify-between gap-2 text-[11px] font-semibold text-slate-700">
        <span>
          {runningTask
            ? `Processing: ${runningTask.label}`
            : failedTask
              ? `Stopped at: ${failedTask.label}`
              : 'All tasks processed'}
        </span>
        <span className="font-mono-tabular text-slate-500">
          {completedCount}/{tasks.length}
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1">
        {tasks.map((task) => (
          <div key={task.id} className="flex items-center gap-1.5 text-[11px] leading-tight min-w-0">
            <StatusIcon status={task.status} className="w-3 h-3" />
            <span className={`truncate ${statusTextColor(task.status)}`}>{task.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Detailed task breakdown rendered inside the form/page feedback banner.
 */
export function SubmissionTasksFeedback({ tasks, summary, variant = 'info' }) {
  if (!tasks || tasks.length === 0) return null;

  const containerStyle =
    variant === 'error'
      ? 'bg-rose-50 border-rose-200 text-rose-900'
      : variant === 'warning'
        ? 'bg-amber-50 border-amber-200 text-amber-900'
        : variant === 'success'
          ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
          : 'bg-slate-50 border-slate-200 text-slate-800';

  return (
    <div className={`p-3.5 rounded-xl border space-y-2 ${containerStyle}`}>
      {summary && <div className="text-xs font-semibold leading-relaxed">{summary}</div>}
      <ul className="space-y-1.5 border-t border-black/10 pt-2">
        {tasks.map((task) => (
          <li key={task.id} className="flex items-start gap-2 text-xs">
            <StatusIcon status={task.status} className="w-3.5 h-3.5 mt-0.5" />
            <div className="min-w-0 flex-1">
              <span className="font-medium">{task.label}</span>
              {task.detail && <span className="opacity-80"> — {task.detail}</span>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
