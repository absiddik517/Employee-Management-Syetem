import React from 'react';
import { CheckCircle2, Loader2, AlertTriangle, XCircle, Circle } from 'lucide-react';

function StatusIcon({ status, className = 'w-3.5 h-3.5' }) {
  switch (status) {
    case 'running':
      return <Loader2 className={`${className} text-[#0b6b4f] dark:text-[#4fd1a1] animate-spin shrink-0`} />;
    case 'done':
      return <CheckCircle2 className={`${className} text-[#0b6b4f] dark:text-[#4fd1a1] shrink-0`} />;
    case 'skipped':
      return <AlertTriangle className={`${className} text-amber-600 dark:text-amber-400 shrink-0`} />;
    case 'error':
      return <XCircle className={`${className} text-rose-600 dark:text-rose-400 shrink-0`} />;
    default:
      return <Circle className={`${className} text-slate-300 dark:text-slate-600 shrink-0`} />;
  }
}

function statusTextColor(status) {
  switch (status) {
    case 'running':
      return 'text-slate-900 dark:text-slate-100 font-semibold';
    case 'done':
      return 'text-[#0b6b4f] dark:text-[#4fd1a1]';
    case 'skipped':
      return 'text-amber-800 dark:text-amber-300';
    case 'error':
      return 'text-rose-700 dark:text-rose-300 font-semibold';
    default:
      return 'text-slate-400 dark:text-slate-500';
  }
}

export function SubmissionTasksInline({ tasks }) {
  if (!tasks || tasks.length === 0) return null;

  const runningTask = tasks.find((t) => t.status === 'running');
  const failedTask = tasks.find((t) => t.status === 'error');
  const completedCount = tasks.filter((t) => t.status === 'done' || t.status === 'skipped').length;

  return (
    <div className="flex-1 min-w-[220px] rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/70 px-3.5 py-2.5 space-y-1.5">
      <div className="flex items-center justify-between gap-2 text-xs font-semibold text-slate-700 dark:text-slate-200">
        <span className="truncate">
          {runningTask
            ? `Processing: ${runningTask.label}`
            : failedTask
              ? `Stopped at: ${failedTask.label}`
              : 'All tasks processed'}
        </span>
        <span className="font-mono-tabular text-slate-500 dark:text-slate-400 shrink-0">
          {completedCount}/{tasks.length}
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1">
        {tasks.map((task) => (
          <div key={task.id} className="flex items-center gap-1.5 text-xs leading-tight min-w-0">
            <StatusIcon status={task.status} className="w-3.5 h-3.5" />
            <span className={`truncate ${statusTextColor(task.status)}`}>{task.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function SubmissionTasksFeedback({ tasks, summary, variant = 'info' }) {
  if (!tasks || tasks.length === 0) return null;

  const containerStyle =
    variant === 'error'
      ? 'bg-rose-50 dark:bg-rose-950/50 border-rose-200 dark:border-rose-900/70 text-rose-900 dark:text-rose-100'
      : variant === 'warning'
        ? 'bg-amber-50 dark:bg-amber-950/50 border-amber-200 dark:border-amber-900/70 text-amber-900 dark:text-amber-100'
        : variant === 'success'
          ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900/60 text-emerald-950 dark:text-emerald-100'
          : 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-100';

  return (
    <div className={`p-3.5 rounded-2xl border space-y-2 ${containerStyle}`}>
      {summary && <div className="text-xs font-semibold leading-relaxed">{summary}</div>}
      <ul className="space-y-1.5 border-t border-black/10 dark:border-white/10 pt-2">
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
