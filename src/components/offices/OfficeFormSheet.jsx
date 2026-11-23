import React, { useEffect, useMemo, useState } from 'react';
import { Crosshair } from 'lucide-react';
import BottomSheet from '../users/BottomSheet.jsx';
import GeofencePreview from './GeofencePreview.jsx';
import { getHighAccuracyPosition } from '../../utils/geo.js';
import {
  INITIAL_OFFICE_FORM,
  OFFICE_LEVEL_LABELS,
  OFFICE_PRESETS,
  getEligibleParentOffices
} from './officeHelpers.js';

const INPUT_CLASS =
  'w-full min-h-[44px] px-3.5 py-2.5 rounded-[14px] border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800/90 text-base text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-[#0b6b4f] dark:focus:ring-[#4fd1a1] focus:border-transparent disabled:opacity-55 transition-colors';

const LABEL_CLASS = 'block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5';
const ERROR_CLASS = 'mt-1 text-xs text-rose-600 dark:text-rose-400';

export default function OfficeFormSheet({
  open,
  mode = 'create', // 'create' | 'edit'
  office = null,
  offices = [],
  childOnly = false,
  allowedParentOffices = [],
  submitting = false,
  onClose,
  onSubmit
}) {
  const [form, setForm] = useState(INITIAL_OFFICE_FORM);
  const [presetSelection, setPresetSelection] = useState('');
  const [gpsLoading, setGpsLoading] = useState(false);
  const [gpsError, setGpsError] = useState('');
  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState('');

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setSubmitError('');
    setGpsError('');
    setPresetSelection('');

    if (mode === 'edit' && office) {
      setForm({
        name: office.name || '',
        address: office.address || '',
        level: childOnly ? 'upazila' : office.level || 'upazila',
        parentOfficeId: office.level === 'head' ? '' : office.parentOfficeId || '',
        lat: office.lat ?? 23.8103,
        lng: office.lng ?? 90.4125,
        geofenceRadiusMeters: office.geofenceRadiusMeters ?? 100,
        startTime: office.startTime || '09:00',
        graceMinutes: office.graceMinutes ?? 15,
        endTime: office.endTime || '17:00'
      });
    } else {
      setForm({
        ...INITIAL_OFFICE_FORM,
        level: 'upazila',
        parentOfficeId: childOnly ? allowedParentOffices[0]?.id || '' : ''
      });
    }
  }, [open, mode, office, childOnly, allowedParentOffices]);

  const excludeId = mode === 'edit' && office ? office.id : null;
  const parentOptions = useMemo(() => {
    if (childOnly) return allowedParentOffices;
    return getEligibleParentOffices(offices, form.level, excludeId);
  }, [childOnly, allowedParentOffices, offices, form.level, excludeId]);

  const clearError = (field) => {
    if (errors[field]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  };

  const handleLevelChange = (nextLevel) => {
    if (childOnly) return;
    clearError('level');
    clearError('parentOfficeId');
    const nextEligible = getEligibleParentOffices(offices, nextLevel, excludeId);
    setForm((prev) => {
      const stillEligible =
        nextLevel !== 'head' && nextEligible.some((o) => o.id === prev.parentOfficeId);
      return {
        ...prev,
        level: nextLevel,
        parentOfficeId: nextLevel === 'head' ? '' : stillEligible ? prev.parentOfficeId : ''
      };
    });
  };

  const handleUseCurrentGps = async () => {
    setGpsError('');
    setGpsLoading(true);
    try {
      const pos = await getHighAccuracyPosition();
      clearError('lat');
      clearError('lng');
      setForm((prev) => ({
        ...prev,
        lat: pos.lat,
        lng: pos.lng
      }));
    } catch (err) {
      setGpsError(err?.message || 'Unable to capture GPS location.');
    } finally {
      setGpsLoading(false);
    }
  };

  const handlePresetChange = (name) => {
    setPresetSelection(name);
    const found = OFFICE_PRESETS.find((p) => p.name === name);
    if (found) {
      clearError('lat');
      clearError('lng');
      setForm((prev) => ({
        ...prev,
        lat: found.lat,
        lng: found.lng
      }));
    }
  };

  const validate = () => {
    const nextErrors = {};
    const trimmedName = (form.name || '').trim();
    const trimmedAddress = (form.address || '').trim();
    const latNum = Number(form.lat);
    const lngNum = Number(form.lng);
    const radNum = Number(form.geofenceRadiusMeters);
    const graceNum = Number(form.graceMinutes);

    if (trimmedName.length < 2) {
      nextErrors.name = 'Enter an office name (at least 2 characters).';
    } else if (trimmedName.length > 160) {
      nextErrors.name = 'Office name must be 160 characters or less.';
    }

    if (trimmedAddress.length < 2) {
      nextErrors.address = 'Enter an office address (at least 2 characters).';
    } else if (trimmedAddress.length > 300) {
      nextErrors.address = 'Office address must be 300 characters or less.';
    }

    if (form.lat === '' || Number.isNaN(latNum) || latNum < -90 || latNum > 90) {
      nextErrors.lat = 'Latitude must be between -90 and 90.';
    }
    if (form.lng === '' || Number.isNaN(lngNum) || lngNum < -180 || lngNum > 180) {
      nextErrors.lng = 'Longitude must be between -180 and 180.';
    }
    if (form.geofenceRadiusMeters === '' || Number.isNaN(radNum) || radNum < 10 || radNum > 50000) {
      nextErrors.geofenceRadiusMeters = 'Radius must be between 10 and 50,000 meters.';
    }
    if (form.graceMinutes === '' || Number.isNaN(graceNum) || graceNum < 0 || graceNum > 180) {
      nextErrors.graceMinutes = 'Enter 0 to 180 minutes.';
    }
    if (childOnly) {
      if (form.level !== 'upazila') {
        nextErrors.level = 'শুধুমাত্র উপজেলা অফিস যুক্ত বা হালনাগাদ করা যাবে।';
      }
      if (!form.parentOfficeId) {
        nextErrors.parentOfficeId = 'মূল জেলা অফিস নির্বাচন করুন।';
      }
    }

    if (!form.startTime) {
      nextErrors.startTime = 'Select a start time.';
    }
    if (!form.endTime) {
      nextErrors.endTime = 'Select an end time.';
    } else if (form.startTime && form.endTime <= form.startTime) {
      nextErrors.endTime = 'End time must be after the start time.';
    }

    return nextErrors;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitError('');

    const validationErrors = validate();
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }

    const res = await onSubmit(form, mode === 'edit' ? office?.id : null);
    if (res && !res.ok && res.error) {
      setSubmitError(res.error);
    }
  };

  const isEdit = mode === 'edit';
  const formId = `office-form-sheet-${mode}`;

  const footer = (
    <div className="flex flex-wrap items-center gap-2.5">
      <button
        type="button"
        onClick={onClose}
        disabled={submitting}
        className="min-h-[44px] px-4 py-2.5 rounded-[14px] border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/80 text-sm font-semibold transition-colors disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b6b4f] dark:focus-visible:ring-[#4fd1a1]"
      >
        Cancel
      </button>
      <button
        type="submit"
        form={formId}
        disabled={submitting}
        className="flex-1 min-w-[160px] min-h-[44px] px-5 py-2.5 rounded-[14px] bg-[#0b6b4f] hover:bg-[#095941] dark:bg-[#4fd1a1] dark:hover:bg-[#3fc090] text-white dark:text-slate-950 text-sm font-semibold transition-colors disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#0b6b4f] dark:focus-visible:ring-[#4fd1a1]"
      >
        {submitting
          ? isEdit
            ? 'Saving...'
            : 'Creating...'
          : isEdit
          ? 'Save changes'
          : 'Create office'}
      </button>
    </div>
  );

  return (
    <BottomSheet
      open={open}
      onClose={submitting ? undefined : onClose}
      title={
        childOnly
          ? isEdit
            ? 'উপজেলা অফিস সম্পাদনা'
            : 'নতুন উপজেলা অফিস'
          : isEdit
          ? 'Edit office'
          : 'Add office'
      }
      subtitle={
        isEdit
          ? 'Changes appear in the office details right away.'
          : childOnly
          ? 'আপনার জেলা অফিসের অধীন একটি উপজেলা অফিস নিবন্ধন করুন।'
          : 'Register an office with its geofence and working hours.'
      }
      maxWidthClass="sm:max-w-xl"
      footer={footer}
    >
      <form id={formId} onSubmit={handleSubmit} noValidate className="space-y-6">
        {submitError && (
          <div
            role="alert"
            className="p-3.5 rounded-[14px] bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/70 text-xs text-rose-800 dark:text-rose-200"
          >
            {submitError}
          </div>
        )}

        {/* Section 1: Basics */}
        <section aria-labelledby="office-form-basics" className="space-y-3.5">
          <h3
            id="office-form-basics"
            className="text-xs font-semibold text-slate-500 dark:text-slate-400"
          >
            Basics
          </h3>

          <div>
            <label htmlFor="office-name" className={LABEL_CLASS}>Office name</label>
            <input
              id="office-name"
              type="text"
              value={form.name}
              aria-invalid={errors.name ? 'true' : 'false'}
              onChange={(e) => {
                clearError('name');
                setForm((f) => ({ ...f, name: e.target.value }));
              }}
              placeholder="e.g. Savar Upazila Office"
              className={INPUT_CLASS}
            />
            {errors.name && <p className={ERROR_CLASS}>{errors.name}</p>}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label htmlFor="office-level" className={LABEL_CLASS}>Hierarchy level</label>
              <select
                id="office-level"
                value={form.level}
                disabled={childOnly}
                onChange={(e) => handleLevelChange(e.target.value)}
                className={INPUT_CLASS}
              >
                {Object.entries(OFFICE_LEVEL_LABELS).map(([val, label]) => (
                  <option key={val} value={val}>
                    {label}
                  </option>
                ))}
              </select>
              {errors.level && <p className={ERROR_CLASS}>{errors.level}</p>}
            </div>

            <div>
              <label htmlFor="office-parent" className={LABEL_CLASS}>
                {childOnly ? 'Parent district office' : 'Parent office'}
              </label>
              <select
                id="office-parent"
                value={form.level === 'head' ? '' : form.parentOfficeId}
                disabled={form.level === 'head' || (childOnly && isEdit)}
                aria-invalid={errors.parentOfficeId ? 'true' : 'false'}
                onChange={(e) => {
                  clearError('parentOfficeId');
                  setForm((f) => ({ ...f, parentOfficeId: e.target.value }));
                }}
                className={INPUT_CLASS}
              >
                {childOnly ? (
                  <option value="">জেলা অফিস নির্বাচন করুন...</option>
                ) : (
                  <option value="">None</option>
                )}
                {parentOptions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.level})
                  </option>
                ))}
              </select>
              {errors.parentOfficeId && <p className={ERROR_CLASS}>{errors.parentOfficeId}</p>}
            </div>
          </div>

          <div>
            <label htmlFor="office-address" className={LABEL_CLASS}>Office address</label>
            <input
              id="office-address"
              type="text"
              value={form.address}
              aria-invalid={errors.address ? 'true' : 'false'}
              onChange={(e) => {
                clearError('address');
                setForm((f) => ({ ...f, address: e.target.value }));
              }}
              placeholder="Full office address"
              className={INPUT_CLASS}
            />
            {errors.address && <p className={ERROR_CLASS}>{errors.address}</p>}
          </div>
        </section>

        {/* Section 2: Geofence */}
        <section aria-labelledby="office-form-geofence" className="space-y-3.5">
          <h3
            id="office-form-geofence"
            className="text-xs font-semibold text-slate-500 dark:text-slate-400"
          >
            Geofence
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label htmlFor="office-lat" className={LABEL_CLASS}>Center latitude</label>
              <input
                id="office-lat"
                type="number"
                inputMode="decimal"
                step="0.000001"
                value={form.lat}
                aria-invalid={errors.lat ? 'true' : 'false'}
                onChange={(e) => {
                  clearError('lat');
                  setForm((f) => ({ ...f, lat: e.target.value }));
                }}
                className={`${INPUT_CLASS} font-mono-tabular`}
              />
              {errors.lat && <p className={ERROR_CLASS}>{errors.lat}</p>}
            </div>

            <div>
              <label htmlFor="office-lng" className={LABEL_CLASS}>Center longitude</label>
              <input
                id="office-lng"
                type="number"
                inputMode="decimal"
                step="0.000001"
                value={form.lng}
                aria-invalid={errors.lng ? 'true' : 'false'}
                onChange={(e) => {
                  clearError('lng');
                  setForm((f) => ({ ...f, lng: e.target.value }));
                }}
                className={`${INPUT_CLASS} font-mono-tabular`}
              />
              {errors.lng && <p className={ERROR_CLASS}>{errors.lng}</p>}
            </div>
          </div>

          <div>
            <label htmlFor="office-radius" className={LABEL_CLASS}>Geofence radius (meters)</label>
            <input
              id="office-radius"
              type="number"
              inputMode="numeric"
              min={10}
              max={50000}
              value={form.geofenceRadiusMeters}
              aria-invalid={errors.geofenceRadiusMeters ? 'true' : 'false'}
              onChange={(e) => {
                clearError('geofenceRadiusMeters');
                setForm((f) => ({ ...f, geofenceRadiusMeters: e.target.value }));
              }}
              className={`${INPUT_CLASS} font-mono-tabular`}
            />
            {errors.geofenceRadiusMeters && (
              <p className={ERROR_CLASS}>{errors.geofenceRadiusMeters}</p>
            )}
          </div>

          <GeofencePreview
            lat={form.lat}
            lng={form.lng}
            radiusMeters={form.geofenceRadiusMeters}
            editable
            onUpdateCoords={(coords) => {
              clearError('lat');
              clearError('lng');
              setForm((f) => ({ ...f, lat: coords.lat, lng: coords.lng }));
            }}
          />

          <button
            type="button"
            onClick={handleUseCurrentGps}
            disabled={gpsLoading}
            className="w-full min-h-[44px] px-4 py-2.5 rounded-[14px] border border-[#0b6b4f]/30 dark:border-[#4fd1a1]/35 bg-[#0b6b4f]/10 dark:bg-[#4fd1a1]/15 text-[#0b6b4f] dark:text-[#4fd1a1] hover:bg-[#0b6b4f]/15 dark:hover:bg-[#4fd1a1]/25 text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b6b4f] dark:focus-visible:ring-[#4fd1a1]"
          >
            <Crosshair className="w-4 h-4 shrink-0" />
            <span>{gpsLoading ? 'Capturing GPS location...' : 'Use current GPS location'}</span>
          </button>

          {gpsError && (
            <p role="alert" className="text-xs text-rose-600 dark:text-rose-400">
              {gpsError}
            </p>
          )}

          <div>
            <label htmlFor="office-preset" className={LABEL_CLASS}>Quick Bangladesh preset</label>
            <select
              id="office-preset"
              value={presetSelection}
              onChange={(e) => handlePresetChange(e.target.value)}
              className={INPUT_CLASS}
            >
              <option value="">Choose a preset location...</option>
              {OFFICE_PRESETS.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        </section>

        {/* Section 3: Working hours */}
        <section aria-labelledby="office-form-hours" className="space-y-3.5">
          <h3
            id="office-form-hours"
            className="text-xs font-semibold text-slate-500 dark:text-slate-400"
          >
            Working hours
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
            <div>
              <label htmlFor="office-start" className={LABEL_CLASS}>Start time</label>
              <input
                id="office-start"
                type="time"
                value={form.startTime}
                aria-invalid={errors.startTime ? 'true' : 'false'}
                onChange={(e) => {
                  clearError('startTime');
                  clearError('endTime');
                  setForm((f) => ({ ...f, startTime: e.target.value }));
                }}
                className={`${INPUT_CLASS} font-mono-tabular`}
              />
              {errors.startTime && <p className={ERROR_CLASS}>{errors.startTime}</p>}
            </div>

            <div>
              <label htmlFor="office-end" className={LABEL_CLASS}>End time</label>
              <input
                id="office-end"
                type="time"
                value={form.endTime}
                aria-invalid={errors.endTime ? 'true' : 'false'}
                onChange={(e) => {
                  clearError('endTime');
                  setForm((f) => ({ ...f, endTime: e.target.value }));
                }}
                className={`${INPUT_CLASS} font-mono-tabular`}
              />
              {errors.endTime && <p className={ERROR_CLASS}>{errors.endTime}</p>}
            </div>

            <div>
              <label htmlFor="office-grace" className={LABEL_CLASS}>Grace minutes</label>
              <input
                id="office-grace"
                type="number"
                inputMode="numeric"
                min={0}
                max={180}
                value={form.graceMinutes}
                aria-invalid={errors.graceMinutes ? 'true' : 'false'}
                onChange={(e) => {
                  clearError('graceMinutes');
                  setForm((f) => ({ ...f, graceMinutes: e.target.value }));
                }}
                className={`${INPUT_CLASS} font-mono-tabular`}
              />
              {errors.graceMinutes && <p className={ERROR_CLASS}>{errors.graceMinutes}</p>}
            </div>
          </div>
        </section>
      </form>
    </BottomSheet>
  );
}
