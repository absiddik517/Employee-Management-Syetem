import React from 'react';
import {
  CheckCircle2,
  Clock3,
  XCircle,
  ShieldCheck,
  UserCog,
  UserCheck,
  UserX
} from 'lucide-react';
import { getRoleLabel as resolveRoleLabel, getRoleList, getRoleMeta, rankOf } from '../../lib/permissions.js';

const STATUS_LABELS = {
  active: 'Active',
  resigned: 'Inactive'
};

const APPROVAL_LABELS = {
  approved: 'Approved',
  pending: 'Pending',
  rejected: 'Rejected'
};

export function getRoleLabel(role) {
  return resolveRoleLabel(role);
}

export function getUserInitials(name, email) {
  const source = (name || email || 'U').trim();
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

export default function StatusBadge({ kind = 'status', value }) {
  const normalized = String(value || '').toLowerCase();

  let label = value || '—';
  let classes =
    'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700';
  let Icon = null;

  if (kind === 'role') {
    label = getRoleLabel(value);
    const meta = getRoleMeta(value);
    const rank = rankOf(value);
    const allRoles = getRoleList();
    const maxRank = allRoles.reduce((m, r) => Math.max(m, r.rank || 0), 0);
    const midThreshold = maxRank > 0 ? Math.max(20, Math.round(maxRank * 0.4)) : 40;
    if (meta?.isSuper || (maxRank > 0 && rank >= maxRank)) {
      classes =
        'bg-[#0b6b4f]/10 dark:bg-[#4fd1a1]/15 text-[#0b6b4f] dark:text-[#4fd1a1] border-[#0b6b4f]/20 dark:border-[#4fd1a1]/30';
      Icon = ShieldCheck;
    } else if (rank >= midThreshold) {
      classes =
        'bg-slate-100 dark:bg-slate-800/90 text-slate-800 dark:text-slate-200 border-slate-200 dark:border-slate-700';
      Icon = UserCog;
    } else {
      classes =
        'bg-slate-100 dark:bg-slate-800/70 text-slate-600 dark:text-slate-300 border-slate-200/80 dark:border-slate-700/80';
    }
  } else if (kind === 'status') {
    label = STATUS_LABELS[normalized] || (normalized === 'active' ? 'Active' : 'Inactive');
    if (normalized === 'active') {
      classes =
        'bg-[#0b6b4f]/10 dark:bg-[#4fd1a1]/15 text-[#0b6b4f] dark:text-[#4fd1a1] border-[#0b6b4f]/20 dark:border-[#4fd1a1]/30';
      Icon = UserCheck;
    } else {
      classes =
        'bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-900/70';
      Icon = UserX;
    }
  } else if (kind === 'approval') {
    label = APPROVAL_LABELS[normalized] || 'Pending';
    if (normalized === 'approved') {
      classes =
        'bg-emerald-50 dark:bg-emerald-950/40 text-[#0b6b4f] dark:text-[#4fd1a1] border-emerald-200/80 dark:border-emerald-900/60';
      Icon = CheckCircle2;
    } else if (normalized === 'pending') {
      classes =
        'bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-900/70';
      Icon = Clock3;
    } else {
      classes =
        'bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-900/70';
      Icon = XCircle;
    }
  }

  return (
    <span
      className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-[14px] border text-xs font-medium whitespace-nowrap ${classes}`}
    >
      {Icon && <Icon className="w-3 h-3 shrink-0" aria-hidden="true" />}
      <span>{label}</span>
    </span>
  );
}
