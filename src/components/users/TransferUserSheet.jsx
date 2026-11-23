import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowRightLeft, Info } from 'lucide-react';
import BottomSheet from './BottomSheet.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { addDaysDhaka, getTodayDhaka } from '../../utils/dhakaTime.js';
import {
  getAuthorityOfficeIds,
  getRoleLabel,
  normalizeRole
} from '../../lib/permissions.js';

const INPUT_CLASS =
  'w-full min-h-[44px] px-3.5 py-2.5 rounded-[14px] border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800/90 text-base sm:text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-[#0b6b4f] dark:focus:ring-[#4fd1a1] focus:border-transparent transition-colors';

const LABEL_CLASS = 'block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5';
const ERROR_CLASS = 'mt-1 text-xs text-rose-600 dark:text-rose-400';

export default function TransferUserSheet({
  open,
  user,
  offices = [],
  submitting = false,
  onClose,
  onSubmit
}) {
  const {
    effectiveAuthUser,
    roleRegistry,
    assignableRoles,
    permissionScope,
    can
  } = useAuth();

  const editScope = permissionScope('user.edit');

  const selectableOffices = useMemo(() => {
    if (!effectiveAuthUser) return [];
    if (editScope === 'all') return offices;
    const scopeIds = new Set(getAuthorityOfficeIds(effectiveAuthUser));
    if (editScope === 'subtree') {
      return offices.filter((o) => scopeIds.has(o.id) || scopeIds.has(o.parentOfficeId));
    }
    if (editScope === 'office') {
      return offices.filter((o) => scopeIds.has(o.id));
    }
    return [];
  }, [editScope, effectiveAuthUser, offices]);

  const canAssignTargetRole = useMemo(() => {
    if (!user) return false;
    return can('user.role.assign', {
      uid: user.uid || user.id,
      currentRole: user.role,
      officeId: user.officeId || '',
      districtOfficeId: user.districtOfficeId || ''
    });
  }, [can, user]);

  const roleOptions = useMemo(() => {
    if (!user) return assignableRoles;
    const currentNorm = normalizeRole(user.role, roleRegistry) || user.role || '';
    if (!currentNorm) return assignableRoles;
    if (assignableRoles.some((r) => r.key === currentNorm)) {
      return assignableRoles;
    }
    return [{ key: currentNorm, label: getRoleLabel(currentNorm, roleRegistry) }, ...assignableRoles];
  }, [assignableRoles, user, roleRegistry]);

  const officeName = (id) => offices.find((o) => o.id === id)?.name || id || '';

  const activeChargesAndAttachments = useMemo(() => {
    if (!user) return [];
    const items = [];
    if (Array.isArray(user.additionalOfficeIds)) {
      for (const oid of user.additionalOfficeIds) {
        if (oid && oid !== user.officeId) {
          items.push({ kind: 'অতিরিক্ত দায়িত্ব', officeName: officeName(oid) });
        }
      }
    }
    if (user.actingOfficeId && user.actingRoleKey) {
      items.push({
        kind: 'চলতি দায়িত্ব',
        officeName: `${officeName(user.actingOfficeId)} (${getRoleLabel(user.actingRoleKey, roleRegistry)})`
      });
    }
    if (user.attachedOfficeId) {
      items.push({ kind: 'সংযুক্তি', officeName: officeName(user.attachedOfficeId) });
    }
    return items;
  }, [user, offices, roleRegistry]);

  const [form, setForm] = useState({
    officeId: '',
    designation: '',
    role: '',
    effectiveDate: getTodayDhaka(),
    orderNo: '',
    orderDate: '',
    reason: '',
    ackOpenCharges: false
  });
  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState('');

  useEffect(() => {
    if (!open || !user) return;
    setErrors({});
    setSubmitError('');
    setForm({
      officeId: user.officeId || '',
      designation: user.designation || '',
      role: normalizeRole(user.role, roleRegistry) || user.role || '',
      effectiveDate: getTodayDhaka(),
      orderNo: '',
      orderDate: '',
      reason: '',
      ackOpenCharges: false
    });
  }, [open, user, roleRegistry]);

  if (!user) return null;

  const isOfficeChanging = form.officeId !== (user.officeId || '');
  const isRoleChanging = form.role !== (normalizeRole(user.role, roleRegistry) || user.role || '');
  const isDesignationChanging = form.designation.trim() !== (user.designation || '').trim();
  const hasAnyChange = isOfficeChanging || isRoleChanging || isDesignationChanging;
  const requiresChargeAck = activeChargesAndAttachments.length > 0 && isOfficeChanging;

  const derivedClosingDate = /^\d{4}-\d{2}-\d{2}$/.test(form.effectiveDate || '')
    ? addDaysDhaka(form.effectiveDate, -1)
    : '';

  const clearError = (field) => {
    if (errors[field]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitError('');

    const nextErrors = {};
    if (!form.officeId) {
      nextErrors.officeId = 'নতুন বা বর্তমান অফিস নির্বাচন করুন।';
    }
    if ((form.designation || '').trim().length < 2) {
      nextErrors.designation = 'পদবি কমপক্ষে ২ অক্ষরের হতে হবে।';
    }
    if (!form.role) {
      nextErrors.role = 'একটি রোল নির্বাচন করুন।';
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.effectiveDate || '')) {
      nextErrors.effectiveDate = 'কার্যকর তারিখ দিন।';
    }
    if (form.orderDate && !/^\d{4}-\d{2}-\d{2}$/.test(form.orderDate)) {
      nextErrors.orderDate = 'সঠিক আদেশের তারিখ দিন।';
    }
    if (!hasAnyChange) {
      nextErrors.general = 'বদলি বা পদায়ন পরিবর্তনের জন্য অফিস, পদবি অথবা রোলের অন্তত একটিতে পরিবর্তন আনুন।';
    }
    if (requiresChargeAck && !form.ackOpenCharges) {
      nextErrors.ackOpenCharges = 'চলমান দায়িত্ব/সংযুক্তি অপরিবর্তিত থাকার বিষয়টি নিশ্চিত করুন।';
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    const res = await onSubmit(user, form);
    if (res && !res.ok && res.error) {
      setSubmitError(res.error);
    }
  };

  const formId = 'transfer-user-sheet-form';

  const footer = (
    <div className="flex flex-wrap items-center gap-2.5">
      <button
        type="button"
        onClick={onClose}
        disabled={submitting}
        className="min-h-[44px] px-4 py-2.5 rounded-[14px] border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/80 text-sm font-semibold transition-colors disabled:opacity-60"
      >
        Cancel
      </button>
      <button
        type="submit"
        form={formId}
        disabled={submitting}
        className="flex-1 min-w-[170px] min-h-[44px] px-5 py-2.5 rounded-[14px] bg-[#0b6b4f] hover:bg-[#095941] dark:bg-[#4fd1a1] dark:hover:bg-[#3fc090] text-white dark:text-slate-950 text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors disabled:opacity-60"
      >
        <ArrowRightLeft className="w-4 h-4 shrink-0" />
        <span>{submitting ? 'সংরক্ষণ হচ্ছে...' : 'বদলি / পদায়ন নিশ্চিত করুন'}</span>
      </button>
    </div>
  );

  return (
    <BottomSheet
      open={open}
      onClose={submitting ? undefined : onClose}
      title="বদলি ও পদায়ন পরিবর্তন"
      subtitle={`${user.name || user.email || user.uid} · বর্তমান অফিস: ${officeName(user.officeId) || 'নির্ধারিত নয়'}`}
      maxWidthClass="sm:max-w-xl"
      footer={footer}
    >
      <form id={formId} onSubmit={handleSubmit} noValidate className="space-y-4">
        {(submitError || errors.general) && (
          <div
            role="alert"
            className="p-3.5 rounded-[14px] bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/70 text-xs text-rose-800 dark:text-rose-200"
          >
            {submitError || errors.general}
          </div>
        )}

        <div className="p-3.5 rounded-[16px] bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 flex items-start gap-2.5 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
          <Info className="w-4 h-4 text-[#0b6b4f] dark:text-[#4fd1a1] shrink-0 mt-0.5" aria-hidden="true" />
          <div>
            এটি একটি একক ব্যাচ লেনদেনে প্রোফাইল আপডেট করবে, চলমান মূল পদায়ন রেকর্ড বন্ধ করবে
            {derivedClosingDate && (
              <span>
                {' '}(সমাপ্তি তারিখ: <strong className="font-mono-tabular">{derivedClosingDate}</strong>)
              </span>
            )}{' '}
            এবং নতুন পদায়ন ইতিহাস যুক্ত করবে। পূর্ববর্তী অফিসের হাজিরা ও ছুটির রেকর্ড অপরিবর্তিত থাকবে।
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          <div>
            <label htmlFor="transfer-office" className={LABEL_CLASS}>নতুন / বর্তমান অফিস</label>
            <select
              id="transfer-office"
              value={form.officeId}
              onChange={(e) => {
                clearError('officeId');
                clearError('general');
                setForm((f) => ({ ...f, officeId: e.target.value }));
              }}
              className={INPUT_CLASS}
            >
              <option value="">অফিস নির্বাচন করুন...</option>
              {selectableOffices.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
            {errors.officeId && <p className={ERROR_CLASS}>{errors.officeId}</p>}
          </div>

          <div>
            <label htmlFor="transfer-effective-date" className={LABEL_CLASS}>কার্যকর তারিখ</label>
            <input
              id="transfer-effective-date"
              type="date"
              value={form.effectiveDate}
              onChange={(e) => {
                clearError('effectiveDate');
                setForm((f) => ({ ...f, effectiveDate: e.target.value }));
              }}
              className={`${INPUT_CLASS} font-mono-tabular`}
            />
            {errors.effectiveDate && <p className={ERROR_CLASS}>{errors.effectiveDate}</p>}
          </div>

          <div>
            <label htmlFor="transfer-designation" className={LABEL_CLASS}>পদবি</label>
            <input
              id="transfer-designation"
              type="text"
              value={form.designation}
              onChange={(e) => {
                clearError('designation');
                clearError('general');
                setForm((f) => ({ ...f, designation: e.target.value }));
              }}
              className={INPUT_CLASS}
            />
            {errors.designation && <p className={ERROR_CLASS}>{errors.designation}</p>}
          </div>

          <div>
            <label htmlFor="transfer-role" className={LABEL_CLASS}>রোল</label>
            <select
              id="transfer-role"
              value={form.role}
              disabled={!canAssignTargetRole}
              onChange={(e) => {
                clearError('role');
                clearError('general');
                setForm((f) => ({ ...f, role: e.target.value }));
              }}
              className={`${INPUT_CLASS} disabled:opacity-60`}
            >
              <option value="" disabled>রোল নির্বাচন করুন...</option>
              {roleOptions.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.label}
                </option>
              ))}
            </select>
            {!canAssignTargetRole && (
              <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                রোল পরিবর্তনের জন্য <code className="font-mono-tabular">user.role.assign</code> অনুমতি প্রয়োজন।
              </p>
            )}
            {errors.role && <p className={ERROR_CLASS}>{errors.role}</p>}
          </div>

          <div>
            <label htmlFor="transfer-order-no" className={LABEL_CLASS}>আদেশ নম্বর (ঐচ্ছিক)</label>
            <input
              id="transfer-order-no"
              type="text"
              maxLength={120}
              value={form.orderNo}
              onChange={(e) => setForm((f) => ({ ...f, orderNo: e.target.value }))}
              placeholder="স্মারক / অফিস আদেশ নং"
              className={INPUT_CLASS}
            />
          </div>

          <div>
            <label htmlFor="transfer-order-date" className={LABEL_CLASS}>আদেশের তারিখ (ঐচ্ছিক)</label>
            <input
              id="transfer-order-date"
              type="date"
              value={form.orderDate}
              onChange={(e) => {
                clearError('orderDate');
                setForm((f) => ({ ...f, orderDate: e.target.value }));
              }}
              className={`${INPUT_CLASS} font-mono-tabular`}
            />
            {errors.orderDate && <p className={ERROR_CLASS}>{errors.orderDate}</p>}
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="transfer-reason" className={LABEL_CLASS}>মন্তব্য / কারণ (ঐচ্ছিক)</label>
            <textarea
              id="transfer-reason"
              rows={2}
              maxLength={500}
              value={form.reason}
              onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
              placeholder="যেমন: জনস্বার্থে বদলি ও নতুন কর্মস্থলে যোগদান"
              className={`${INPUT_CLASS} min-h-[76px] py-2`}
            />
          </div>
        </div>

        {activeChargesAndAttachments.length > 0 && (
          <div className="p-3.5 rounded-[16px] bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/80 space-y-2.5">
            <div className="flex items-start gap-2.5 text-xs text-amber-900 dark:text-amber-200">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" aria-hidden="true" />
              <div className="space-y-1">
                <div className="font-semibold">
                  চলমান অতিরিক্ত/চলতি দায়িত্ব ও সংযুক্তি সতর্কতা
                </div>
                <p className="text-amber-800/90 dark:text-amber-300/90 leading-relaxed">
                  এই কর্মচারীর নিচের দায়িত্ব/সংযুক্তিগুলো এখনো চালু আছে। বদলির ফলে এগুলো{' '}
                  <strong>স্বয়ংক্রিয়ভাবে শেষ হবে না</strong> — প্রয়োজনে বদলির পর &ldquo;দায়িত্ব ও সংযুক্তি&rdquo; থেকে আলাদাভাবে পর্যালোচনা বা সমাপ্ত করুন:
                </p>
                <ul className="list-disc pl-4 space-y-0.5 text-amber-900 dark:text-amber-200">
                  {activeChargesAndAttachments.map((item, idx) => (
                    <li key={`${item.kind}-${idx}`}>
                      <span className="font-semibold">{item.kind}:</span> {item.officeName}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {requiresChargeAck && (
              <label className="flex items-start gap-2.5 pt-2 border-t border-amber-200/80 dark:border-amber-800/70 text-xs text-amber-950 dark:text-amber-100 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.ackOpenCharges}
                  onChange={(e) => {
                    clearError('ackOpenCharges');
                    setForm((f) => ({ ...f, ackOpenCharges: e.target.checked }));
                  }}
                  className="mt-0.5 w-4 h-4 accent-[#0b6b4f] dark:accent-[#4fd1a1] shrink-0"
                />
                <span>
                  আমি নিশ্চিত করছি যে চলমান দায়িত্ব/সংযুক্তিগুলো অপরিবর্তিত থাকবে এবং প্রয়োজনে আলাদাভাবে সমাপ্ত করব।
                </span>
              </label>
            )}
            {errors.ackOpenCharges && <p className={ERROR_CLASS}>{errors.ackOpenCharges}</p>}
          </div>
        )}
      </form>
    </BottomSheet>
  );
}
