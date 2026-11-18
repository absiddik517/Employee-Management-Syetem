import React, { useEffect, useState } from 'react';
import {
  Check,
  CheckCircle2,
  Copy,
  Edit3,
  Power,
  RotateCcw,
  Smartphone
} from 'lucide-react';
import BottomSheet from './BottomSheet.jsx';
import StatusBadge, { getRoleLabel, getUserInitials } from './StatusBadge.jsx';

function formatJoiningDate(val) {
  if (!val) return 'Not set';
  if (typeof val === 'string') return val;
  if (typeof val?.toDate === 'function') {
    return val.toDate().toISOString().slice(0, 10);
  }
  return String(val);
}

function DetailRow({ label, value, mono = false, action = null }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      <dt className="text-xs font-medium text-slate-500 dark:text-slate-400 shrink-0">{label}</dt>
      <dd className="min-w-0 flex items-center justify-end gap-2 text-right">
        <span
          className={`text-sm text-slate-900 dark:text-slate-100 break-all ${
            mono ? 'font-mono-tabular text-xs' : 'font-medium'
          }`}
        >
          {value || '—'}
        </span>
        {action}
      </dd>
    </div>
  );
}

export default function UserDetailSheet({
  open,
  user,
  officeName,
  busy = false,
  onClose,
  onEdit,
  onResetDevice,
  onToggleStatus,
  onApprove
}) {
  const [copiedUid, setCopiedUid] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  const uid = user ? user.uid || user.id : '';

  useEffect(() => {
    setCopiedUid(false);
    setConfirmReset(false);
  }, [uid, open]);

  if (!user) return null;

  const displayName = user.name || user.email || uid;
  const initials = getUserInitials(user.name, user.email);
  const isActive = (user.status || 'active') === 'active';
  const isPending = user.approvalStatus === 'pending';
  const hasDevice = Boolean(user.boundDeviceId);
  const resolvedOffice = officeName ? officeName(user.officeId) : '';

  const handleCopyUid = async () => {
    if (!uid || !navigator?.clipboard) return;
    try {
      await navigator.clipboard.writeText(uid);
      setCopiedUid(true);
      setTimeout(() => setCopiedUid(false), 1800);
    } catch {
      // ignore clipboard errors
    }
  };

  const handleResetTap = async () => {
    if (!hasDevice || busy) return;
    if (!confirmReset) {
      setConfirmReset(true);
      return;
    }
    setConfirmReset(false);
    await onResetDevice(user);
  };

  const headerExtra = (
    <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
      <StatusBadge kind="role" value={user.role || 'employee'} />
      <StatusBadge kind="status" value={user.status || 'active'} />
      <StatusBadge kind="approval" value={user.approvalStatus || 'pending'} />
    </div>
  );

  const footer = (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={() => onEdit(user)}
        className="flex-1 min-w-[130px] min-h-[44px] px-4 py-2.5 rounded-[14px] bg-[#0b6b4f] hover:bg-[#095941] dark:bg-[#4fd1a1] dark:hover:bg-[#3fc090] text-white dark:text-slate-950 text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#0b6b4f] dark:focus-visible:ring-[#4fd1a1]"
      >
        <Edit3 className="w-4 h-4 shrink-0" />
        <span>Edit user</span>
      </button>

      {isPending && (
        <button
          type="button"
          disabled={busy}
          onClick={() => onApprove(user)}
          className="min-h-[44px] px-4 py-2.5 rounded-[14px] border border-[#0b6b4f]/30 dark:border-[#4fd1a1]/40 bg-[#0b6b4f]/10 dark:bg-[#4fd1a1]/15 text-[#0b6b4f] dark:text-[#4fd1a1] hover:bg-[#0b6b4f]/15 dark:hover:bg-[#4fd1a1]/25 text-sm font-semibold inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b6b4f] dark:focus-visible:ring-[#4fd1a1]"
        >
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>Approve user</span>
        </button>
      )}

      <button
        type="button"
        disabled={busy}
        onClick={() => onToggleStatus(user, isActive ? 'resigned' : 'active')}
        className="min-h-[44px] px-3.5 py-2.5 rounded-[14px] border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/80 text-sm font-semibold inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b6b4f] dark:focus-visible:ring-[#4fd1a1]"
      >
        <Power className="w-4 h-4 shrink-0" />
        <span>{isActive ? 'Deactivate' : 'Activate'}</span>
      </button>

      <button
        type="button"
        disabled={!hasDevice || busy}
        onClick={handleResetTap}
        aria-live="polite"
        className={`min-h-[44px] px-3.5 py-2.5 rounded-[14px] border text-sm font-semibold inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-45 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${
          confirmReset
            ? 'bg-amber-500 hover:bg-amber-600 border-amber-500 text-slate-950'
            : 'border-amber-300 dark:border-amber-700/80 bg-amber-50/70 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300 hover:bg-amber-100/80 dark:hover:bg-amber-950/50'
        }`}
      >
        <RotateCcw className="w-4 h-4 shrink-0" />
        <span>
          {!hasDevice
            ? 'No device bound'
            : confirmReset
            ? 'Tap again to confirm'
            : 'Reset bound device'}
        </span>
      </button>
    </div>
  );

  const avatar = (
    <div
      aria-hidden="true"
      className="w-11 h-11 rounded-[14px] bg-[#0b6b4f]/10 dark:bg-[#4fd1a1]/15 text-[#0b6b4f] dark:text-[#4fd1a1] font-bold text-sm flex items-center justify-center shrink-0"
    >
      {initials}
    </div>
  );

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={displayName}
      subtitle={user.designation || 'No designation'}
      maxWidthClass="sm:max-w-xl"
      headerLeading={avatar}
      headerExtra={headerExtra}
      footer={footer}
    >
      <div className="space-y-5">
        {/* Account */}
        <section aria-labelledby="detail-account-heading" className="space-y-2">
          <h3
            id="detail-account-heading"
            className="text-xs font-semibold text-slate-500 dark:text-slate-400 px-1"
          >
            Account
          </h3>
          <dl className="rounded-[18px] border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 divide-y divide-slate-200/80 dark:divide-slate-800">
            <DetailRow label="Email" value={user.email || '—'} />
            <DetailRow label="Mobile" value={user.mobile || '—'} mono />
            <DetailRow
              label="User ID"
              value={uid}
              mono
              action={
                <button
                  type="button"
                  onClick={handleCopyUid}
                  aria-label="Copy UID"
                  className="min-h-[44px] min-w-[44px] -my-2 -mr-2 inline-flex items-center justify-center rounded-xl text-slate-500 dark:text-slate-400 hover:bg-slate-200/70 dark:hover:bg-slate-700/70 hover:text-slate-900 dark:hover:text-slate-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b6b4f] dark:focus-visible:ring-[#4fd1a1]"
                >
                  {copiedUid ? (
                    <Check className="w-4 h-4 text-[#0b6b4f] dark:text-[#4fd1a1]" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </button>
              }
            />
            <DetailRow label="Office" value={resolvedOffice || 'No office assigned'} />
            <DetailRow label="Address" value={user.address || '—'} />
            <DetailRow label="Joining date" value={formatJoiningDate(user.joiningDate)} mono />
          </dl>
        </section>

        {/* Access */}
        <section aria-labelledby="detail-access-heading" className="space-y-2">
          <h3
            id="detail-access-heading"
            className="text-xs font-semibold text-slate-500 dark:text-slate-400 px-1"
          >
            Access
          </h3>
          <dl className="rounded-[18px] border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 divide-y divide-slate-200/80 dark:divide-slate-800">
            <DetailRow label="Role" value={getRoleLabel(user.role)} />
            <DetailRow
              label="Status"
              value={isActive ? 'Active' : 'Inactive (Resigned)'}
            />
            {!isActive && user.resignationDate && (
              <DetailRow label="Resignation date" value={formatJoiningDate(user.resignationDate)} mono />
            )}
            <DetailRow
              label="Approval"
              value={
                user.approvalStatus === 'approved'
                  ? 'Approved'
                  : user.approvalStatus === 'rejected'
                  ? 'Rejected'
                  : 'Pending approval'
              }
            />
          </dl>
        </section>

        {/* Device */}
        <section aria-labelledby="detail-device-heading" className="space-y-2">
          <h3
            id="detail-device-heading"
            className="text-xs font-semibold text-slate-500 dark:text-slate-400 px-1"
          >
            Device
          </h3>
          <div className="rounded-[18px] border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 px-4 py-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <Smartphone
                aria-hidden="true"
                className={`w-4 h-4 shrink-0 ${
                  hasDevice
                    ? 'text-[#0b6b4f] dark:text-[#4fd1a1]'
                    : 'text-slate-400 dark:text-slate-500'
                }`}
              />
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Bound device ID
              </span>
            </div>
            <span className="text-xs font-mono-tabular text-slate-900 dark:text-slate-100 break-all text-right">
              {user.boundDeviceId || 'Unbound'}
            </span>
          </div>
          {confirmReset && hasDevice && (
            <p className="text-xs text-amber-700 dark:text-amber-300 px-1" role="status">
              Tap &ldquo;Tap again to confirm&rdquo; below to clear this bound device. The staff member will bind a new device on next login.
            </p>
          )}
        </section>
      </div>
    </BottomSheet>
  );
}
