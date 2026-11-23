import React, { useEffect, useRef, useState } from 'react';
import {
  Building2,
  Check,
  Copy,
  Edit3,
  MapPin,
  Trash2
} from 'lucide-react';
import BottomSheet from '../users/BottomSheet.jsx';
import GeofencePreview from './GeofencePreview.jsx';
import {
  formatRadius,
  formatTime12h,
  getLevelLabel,
  getLevelShortLabel
} from './officeHelpers.js';

function DetailRow({ label, value, mono = false, action = null }) {
  return (
    <div className="flex items-start justify-between gap-3 px-4 py-3">
      <dt className="text-xs font-medium text-slate-500 dark:text-slate-400 shrink-0 pt-0.5">{label}</dt>
      <dd className="min-w-0 flex items-center justify-end gap-2 text-right">
        <span
          className={`text-sm text-slate-900 dark:text-slate-100 break-words ${
            mono ? 'font-mono-tabular text-xs' : 'font-medium'
          }`}
        >
          {value}
        </span>
        {action}
      </dd>
    </div>
  );
}

export default function OfficeDetailSheet({
  open,
  office,
  parentName = '',
  subOffices = [],
  busy = false,
  canEdit = true,
  canDelete = true,
  onClose,
  onEdit,
  onDelete,
  onCopiedCoords
}) {
  const [copiedCoords, setCopiedCoords] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const confirmTimerRef = useRef(null);

  useEffect(() => {
    setCopiedCoords(false);
    setConfirmDelete(false);
    if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
  }, [office?.id, open]);

  useEffect(() => {
    return () => {
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    };
  }, []);

  if (!office) return null;

  const hasSubOffices = subOffices.length > 0;
  const hasParent = Boolean(office.parentOfficeId && parentName);
  const coordsText = `${office.lat}, ${office.lng}`;
  const mapsHref = `https://www.google.com/maps?q=${encodeURIComponent(`${office.lat},${office.lng}`)}`;

  const handleCopyCoords = async () => {
    if (!navigator?.clipboard) return;
    try {
      await navigator.clipboard.writeText(coordsText);
      setCopiedCoords(true);
      if (onCopiedCoords) onCopiedCoords();
      setTimeout(() => setCopiedCoords(false), 1800);
    } catch {
      // ignore clipboard errors
    }
  };

  const handleDeleteTap = async () => {
    if (!canDelete || hasSubOffices || busy) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
      confirmTimerRef.current = setTimeout(() => {
        setConfirmDelete(false);
      }, 3500);
      return;
    }
    if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    setConfirmDelete(false);
    await onDelete(office);
  };

  const headerLeading = (
    <div
      aria-hidden="true"
      className="w-12 h-12 rounded-[16px] bg-[#0b6b4f]/10 dark:bg-[#4fd1a1]/15 text-[#0b6b4f] dark:text-[#4fd1a1] flex items-center justify-center shrink-0"
    >
      <Building2 className="w-6 h-6" />
    </div>
  );

  const headerExtra = (
    <div className="flex flex-wrap items-center gap-1.5 mt-2">
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-[14px] border border-[#0b6b4f]/20 dark:border-[#4fd1a1]/30 bg-[#0b6b4f]/10 dark:bg-[#4fd1a1]/15 text-[#0b6b4f] dark:text-[#4fd1a1] text-xs font-semibold">
        {getLevelShortLabel(office.level)}
      </span>
      <span className="inline-flex items-center px-2.5 py-0.5 rounded-[14px] border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-xs font-medium max-w-full truncate">
        {hasParent ? `Under ${parentName}` : 'Top level'}
      </span>
    </div>
  );

  const footer = (
    <div className="space-y-2.5">
      {canEdit && (
        <button
          type="button"
          disabled={busy}
          onClick={() => onEdit(office)}
          className="w-full min-h-[44px] px-4 py-2.5 rounded-[14px] bg-[#0b6b4f] hover:bg-[#095941] dark:bg-[#4fd1a1] dark:hover:bg-[#3fc090] text-white dark:text-slate-950 text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#0b6b4f] dark:focus-visible:ring-[#4fd1a1]"
        >
          <Edit3 className="w-4 h-4 shrink-0" />
          <span>Edit office</span>
        </button>
      )}

      <div className={`grid gap-2.5 ${canDelete ? 'grid-cols-2' : 'grid-cols-1'}`}>
        <a
          href={mapsHref}
          target="_blank"
          rel="noopener noreferrer"
          className="min-h-[44px] px-3.5 py-2.5 rounded-[14px] border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/80 text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b6b4f] dark:focus-visible:ring-[#4fd1a1]"
        >
          <MapPin className="w-4 h-4 shrink-0" />
          <span>View on map</span>
        </a>

        {canDelete && (
          <button
            type="button"
            disabled={hasSubOffices || busy}
            onClick={handleDeleteTap}
            aria-live="polite"
            className={`min-h-[44px] px-3.5 py-2.5 rounded-[14px] border text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors disabled:opacity-45 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 ${
              confirmDelete
                ? 'bg-rose-600 hover:bg-rose-700 border-rose-600 text-white'
                : 'border-rose-200 dark:border-rose-900/70 bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 hover:bg-rose-100/80 dark:hover:bg-rose-950/60'
            }`}
          >
            <Trash2 className="w-4 h-4 shrink-0" />
            <span>{confirmDelete ? 'Tap again to confirm' : 'Delete'}</span>
          </button>
        )}
      </div>

      {canDelete && hasSubOffices && (
        <p className="text-xs text-amber-700 dark:text-amber-300 text-center" role="note">
          Remove or move its sub-offices before deleting.
        </p>
      )}
    </div>
  );

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={office.name}
      subtitle={getLevelLabel(office.level)}
      maxWidthClass="sm:max-w-xl"
      headerLeading={headerLeading}
      headerExtra={headerExtra}
      footer={footer}
    >
      <div className="space-y-5">
        {/* Location */}
        <section aria-labelledby="office-detail-location" className="space-y-2.5">
          <h3
            id="office-detail-location"
            className="text-xs font-semibold text-slate-500 dark:text-slate-400 px-1"
          >
            Location
          </h3>
          <dl className="rounded-[18px] border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 divide-y divide-slate-200/80 dark:divide-slate-800">
            <DetailRow label="Address" value={office.address || 'Not set'} />
            <DetailRow
              label="Coordinates"
              value={coordsText}
              mono
              action={
                <button
                  type="button"
                  onClick={handleCopyCoords}
                  aria-label="Copy coordinates"
                  className="min-h-[44px] min-w-[44px] -my-2 -mr-2 inline-flex items-center justify-center rounded-xl text-slate-500 dark:text-slate-400 hover:bg-slate-200/70 dark:hover:bg-slate-700/70 hover:text-slate-900 dark:hover:text-slate-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b6b4f] dark:focus-visible:ring-[#4fd1a1]"
                >
                  {copiedCoords ? (
                    <Check className="w-4 h-4 text-[#0b6b4f] dark:text-[#4fd1a1]" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </button>
              }
            />
            <DetailRow
              label="Geofence"
              value={`${formatRadius(office.geofenceRadiusMeters || 100)} radius`}
            />
          </dl>

          <GeofencePreview
            lat={office.lat}
            lng={office.lng}
            radiusMeters={office.geofenceRadiusMeters || 100}
          />
        </section>

        {/* Working hours */}
        <section aria-labelledby="office-detail-hours" className="space-y-2">
          <h3
            id="office-detail-hours"
            className="text-xs font-semibold text-slate-500 dark:text-slate-400 px-1"
          >
            Working hours
          </h3>
          <dl className="rounded-[18px] border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 divide-y divide-slate-200/80 dark:divide-slate-800">
            <DetailRow label="Start time" value={formatTime12h(office.startTime || '09:00')} />
            <DetailRow label="Grace period" value={`${office.graceMinutes ?? 15} minutes`} />
            <DetailRow label="End time" value={formatTime12h(office.endTime || '17:00')} />
          </dl>
        </section>

        {/* Hierarchy */}
        <section aria-labelledby="office-detail-hierarchy" className="space-y-2">
          <h3
            id="office-detail-hierarchy"
            className="text-xs font-semibold text-slate-500 dark:text-slate-400 px-1"
          >
            Hierarchy
          </h3>
          <dl className="rounded-[18px] border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 divide-y divide-slate-200/80 dark:divide-slate-800">
            <DetailRow label="Level" value={getLevelLabel(office.level)} />
            <DetailRow label="Parent office" value={hasParent ? parentName : 'None'} />
            <div className="flex items-start justify-between gap-3 px-4 py-3">
              <dt className="text-xs font-medium text-slate-500 dark:text-slate-400 shrink-0 pt-0.5">
                Sub-offices
              </dt>
              <dd className="min-w-0 text-right text-sm font-medium text-slate-900 dark:text-slate-100">
                {subOffices.length > 0 ? (
                  <ul className="space-y-1">
                    {subOffices.map((child) => (
                      <li key={child.id}>{child.name}</li>
                    ))}
                  </ul>
                ) : (
                  <span className="text-slate-500 dark:text-slate-400">None</span>
                )}
              </dd>
            </div>
          </dl>
        </section>
      </div>
    </BottomSheet>
  );
}
