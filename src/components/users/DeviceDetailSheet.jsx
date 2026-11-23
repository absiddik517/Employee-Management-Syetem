import React, { useEffect, useState } from 'react';
import { Check, Copy, RotateCcw, ShieldAlert, Smartphone, Users } from 'lucide-react';
import BottomSheet from './BottomSheet.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { formatDeviceTimestamp, getDeviceStatusLabel } from '../../utils/deviceInfo.js';

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
          {value || 'Unknown'}
        </span>
        {action}
      </dd>
    </div>
  );
}

function statusToneClasses(derivedStatus) {
  if (derivedStatus === 'bound') {
    return 'bg-[#0b6b4f]/10 dark:bg-[#4fd1a1]/15 text-[#0b6b4f] dark:text-[#4fd1a1] border-[#0b6b4f]/25 dark:border-[#4fd1a1]/30';
  }
  if (derivedStatus === 'blocked') {
    return 'bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-900/70';
  }
  return 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700';
}

export default function DeviceDetailSheet({
  open,
  entry,
  officeName,
  busy = false,
  onClose,
  onResetDevice
}) {
  const { can } = useAuth();
  const [copiedId, setCopiedId] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  const user = entry?.user || null;
  const device = entry?.device || null;
  const uid = user ? user.uid || user.id : '';
  const deviceId = device?.deviceId || '';

  useEffect(() => {
    setCopiedId(false);
    setConfirmReset(false);
  }, [uid, deviceId, open]);

  if (!entry || !user || !device) return null;

  const derivedStatus = entry.derivedStatus || 'released';
  const isBound = Boolean(user.boundDeviceId && user.boundDeviceId === deviceId);
  const isShared = Boolean(entry.isShared);
  const sharedUserNames = Array.isArray(entry.sharedUsers)
    ? entry.sharedUsers.map((u) => u.name || u.email || u.uid || u.id).filter(Boolean)
    : [];

  const targetScopeObj = {
    uid,
    role: user.role,
    officeId: user.officeId || '',
    districtOfficeId: user.districtOfficeId || ''
  };
  const canResetBinding = isBound && Boolean(onResetDevice) && can('user.resetDevice', targetScopeObj);

  const resolvedOffice = officeName ? officeName(user.officeId) : '';
  const deviceTitle = device.name || 'Unknown device';
  const deviceSubtitle =
    device.model && device.model !== 'Unknown' ? device.model : deviceId;

  const handleCopyId = async () => {
    if (!deviceId || !navigator?.clipboard) return;
    try {
      await navigator.clipboard.writeText(deviceId);
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 1800);
    } catch {
      // ignore clipboard error
    }
  };

  const handleResetTap = async () => {
    if (!canResetBinding || busy) return;
    if (!confirmReset) {
      setConfirmReset(true);
      return;
    }
    setConfirmReset(false);
    await onResetDevice(user);
  };

  const headerLeading = (
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
  );

  const headerExtra = (
    <div className="flex flex-wrap items-center gap-1.5 mt-2">
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
          <span>Shared ({sharedUserNames.length || entry.sharedCount})</span>
        </span>
      )}
    </div>
  );

  const footer = canResetBinding ? (
    <div className="space-y-2">
      {confirmReset && (
        <p className="text-xs text-amber-700 dark:text-amber-300 px-1" role="status">
          Tap &ldquo;Tap again to confirm&rdquo; to clear this bound device binding. The user will bind a new device on next login.
        </p>
      )}
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={handleResetTap}
          aria-live="polite"
          className={`flex-1 min-h-[44px] px-4 py-2.5 rounded-[14px] border text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 ${
            confirmReset
              ? 'bg-amber-500 hover:bg-amber-600 border-amber-500 text-slate-950'
              : 'border-amber-300 dark:border-amber-700/80 bg-amber-50/70 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300 hover:bg-amber-100/80 dark:hover:bg-amber-950/50'
          }`}
        >
          <RotateCcw className="w-4 h-4 shrink-0" />
          <span>{confirmReset ? 'Tap again to confirm' : 'Reset device binding'}</span>
        </button>
        <button
          type="button"
          onClick={onClose}
          className="min-h-[44px] px-4 py-2.5 rounded-[14px] border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-semibold text-slate-700 dark:text-slate-200"
        >
          Close
        </button>
      </div>
    </div>
  ) : (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-slate-500 dark:text-slate-400">
        {isBound ? 'Binding reset requires permission' : 'Informational record'}
      </span>
      <button
        type="button"
        onClick={onClose}
        className="min-h-[44px] px-4 py-2 rounded-[14px] border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-semibold text-slate-700 dark:text-slate-200"
      >
        Close
      </button>
    </div>
  );

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={deviceTitle}
      subtitle={deviceSubtitle}
      maxWidthClass="sm:max-w-xl"
      headerLeading={headerLeading}
      headerExtra={headerExtra}
      footer={footer}
    >
      <div className="space-y-5">
        {/* User */}
        <section aria-labelledby="device-detail-user-heading" className="space-y-2">
          <h3
            id="device-detail-user-heading"
            className="text-xs font-semibold text-slate-500 dark:text-slate-400 px-1"
          >
            User
          </h3>
          <dl className="rounded-[18px] border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 divide-y divide-slate-200/80 dark:divide-slate-800">
            <DetailRow label="Name" value={user.name || user.email || uid} />
            <DetailRow label="Designation" value={user.designation || 'Unknown'} />
            <DetailRow label="Office" value={resolvedOffice || 'No office assigned'} />
            <DetailRow label="Email" value={user.email || 'Unknown'} />
            <DetailRow label="User ID" value={uid} mono />
          </dl>
        </section>

        {/* Device */}
        <section aria-labelledby="device-detail-info-heading" className="space-y-2">
          <h3
            id="device-detail-info-heading"
            className="text-xs font-semibold text-slate-500 dark:text-slate-400 px-1"
          >
            Device
          </h3>
          <dl className="rounded-[18px] border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 divide-y divide-slate-200/80 dark:divide-slate-800">
            <DetailRow label="Name" value={device.name || 'No details yet'} />
            <DetailRow label="Model" value={device.model || 'Unknown'} />
            <DetailRow label="Manufacturer" value={device.manufacturer || 'Unknown'} />
            <DetailRow label="Platform" value={device.platform || 'Unknown'} />
            <DetailRow label="System / OS" value={device.osVersion || 'Unknown'} />
            <DetailRow label="App version" value={device.appVersion || 'Unknown'} mono />
            <DetailRow label="Browser / Engine" value={device.engine || 'Unknown'} />
            <DetailRow label="Screen" value={device.screen || 'Unknown'} mono />
            <DetailRow label="Timezone" value={device.timezone || 'Unknown'} />
            <DetailRow label="Language" value={device.language || 'Unknown'} />
          </dl>
        </section>

        {/* Network */}
        <section aria-labelledby="device-detail-network-heading" className="space-y-2">
          <h3
            id="device-detail-network-heading"
            className="text-xs font-semibold text-slate-500 dark:text-slate-400 px-1"
          >
            Network
          </h3>
          <dl className="rounded-[18px] border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 divide-y divide-slate-200/80 dark:divide-slate-800">
            <DetailRow label="IP address" value={device.ip || 'Unknown'} mono />
          </dl>
          <p className="text-xs text-slate-500 dark:text-slate-400 px-1">
            IP is reported by the app and is not verified
          </p>
        </section>

        {/* Binding */}
        <section aria-labelledby="device-detail-binding-heading" className="space-y-2">
          <h3
            id="device-detail-binding-heading"
            className="text-xs font-semibold text-slate-500 dark:text-slate-400 px-1"
          >
            Binding
          </h3>
          <dl className="rounded-[18px] border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 divide-y divide-slate-200/80 dark:divide-slate-800">
            <DetailRow
              label="Device ID"
              value={deviceId}
              mono
              action={
                <button
                  type="button"
                  onClick={handleCopyId}
                  aria-label="Copy device ID"
                  className="min-h-[44px] min-w-[44px] -my-2 -mr-2 inline-flex items-center justify-center rounded-xl text-slate-500 dark:text-slate-400 hover:bg-slate-200/70 dark:hover:bg-slate-700/70 hover:text-slate-900 dark:hover:text-slate-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b6b4f] dark:focus-visible:ring-[#4fd1a1]"
                >
                  {copiedId ? (
                    <Check className="w-4 h-4 text-[#0b6b4f] dark:text-[#4fd1a1]" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </button>
              }
            />
            <DetailRow label="Status" value={getDeviceStatusLabel(derivedStatus)} />
            {isShared && (
              <DetailRow
                label="Shared with"
                value={sharedUserNames.join(', ') || `${entry.sharedCount} users`}
              />
            )}
            <DetailRow label="First seen" value={formatDeviceTimestamp(device.firstSeenAt)} mono />
            <DetailRow label="Last active" value={formatDeviceTimestamp(device.lastSeenAt)} mono />
            <DetailRow
              label="Logins"
              value={
                typeof device.loginCount === 'number' ? String(device.loginCount) : 'No details yet'
              }
              mono
            />
          </dl>
        </section>
      </div>
    </BottomSheet>
  );
}
