import React, { useEffect, useMemo, useState } from 'react';
import { Info } from 'lucide-react';
import BottomSheet from './BottomSheet.jsx';
import { SubmissionTasksInline, SubmissionTasksFeedback } from '../SubmissionTasks.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { getTodayDhaka } from '../../utils/dhakaTime.js';
import {
  ROLES,
  getPermissionScope,
  getRoleLabel,
  getUserOfficeScopeIds,
  normalizeRole
} from '../../lib/permissions.js';

function toDateInputValue(val, fallback = '') {
  if (!val) return fallback;
  if (typeof val === 'string') return val.slice(0, 10);
  if (typeof val?.toDate === 'function') {
    return val.toDate().toISOString().slice(0, 10);
  }
  return fallback;
}

const INPUT_CLASS =
  'w-full min-h-[44px] px-3.5 py-2.5 rounded-[14px] border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800/90 text-base text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-[#0b6b4f] dark:focus:ring-[#4fd1a1] focus:border-transparent transition-colors';

const LABEL_CLASS = 'block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5';
const ERROR_CLASS = 'mt-1 text-xs text-rose-600 dark:text-rose-400';

function roleSupportsAdditionalCharge(role) {
  const scope = getPermissionScope({ role, approvalStatus: 'approved', status: 'active' }, 'report.create');
  return scope === 'subtree' || scope === 'office';
}

function getCandidateOfficesForRole(offices, role, primaryOfficeId) {
  const scope = getPermissionScope({ role, approvalStatus: 'approved', status: 'active' }, 'report.create');
  const level = scope === 'office' ? 'upazila' : 'district';
  return offices.filter((o) => o.level === level && o.id !== primaryOfficeId);
}

function AdditionalChargePicker({ offices, role, primaryOfficeId, selectedIds = [], onToggle, idPrefix }) {
  const candidateOffices = getCandidateOfficesForRole(offices, role, primaryOfficeId);
  return (
    <div className="sm:col-span-2 space-y-2">
      <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">
        Additional charge offices (অতিরিক্ত দায়িত্ব · optional)
      </div>
      {candidateOffices.length === 0 ? (
        <div className="p-3 rounded-[14px] border border-dashed border-slate-300 dark:border-slate-700 text-xs text-slate-500 dark:text-slate-400">
          No additional offices available to assign for this role.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-44 overflow-y-auto p-2.5 rounded-[14px] border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/40">
          {candidateOffices.map((o) => {
            const checked = selectedIds.includes(o.id);
            return (
              <label
                key={`${idPrefix}-${o.id}`}
                className={`min-h-[44px] px-3 py-2 rounded-[12px] border flex items-center gap-2.5 cursor-pointer text-xs font-medium transition-colors ${
                  checked
                    ? 'bg-[#0b6b4f]/10 dark:bg-[#4fd1a1]/15 border-[#0b6b4f] dark:border-[#4fd1a1] text-[#0b6b4f] dark:text-[#4fd1a1]'
                    : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200'
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggle(o.id)}
                  className="w-4 h-4 accent-[#0b6b4f] dark:accent-[#4fd1a1] shrink-0"
                />
                <span className="truncate">{o.name}</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function UserFormSheet({
  open,
  mode, // 'create' | 'link' | 'edit'
  offices = [],
  user = null, // present when mode === 'edit'
  submitting = false,
  tasks = [],
  feedbackSummary = '',
  feedbackVariant = 'info',
  onClose,
  onCreateSubmit,
  onLinkSubmit,
  onEditSubmit
}) {
  const { effectiveAuthUser, assignableRoles, permissionScope, can } = useAuth();
  const editScope = permissionScope('user.edit');
  const canManageAdditionalCharge = editScope === 'all';

  const selectableOffices = useMemo(() => {
    if (editScope !== 'subtree' || !effectiveAuthUser) return offices;
    const scopeIds = new Set(getUserOfficeScopeIds(effectiveAuthUser));
    return offices.filter((o) => scopeIds.has(o.id) || scopeIds.has(o.parentOfficeId));
  }, [editScope, effectiveAuthUser, offices]);

  const roleOptionsForEdit = useMemo(() => {
    if (!user) return assignableRoles;
    const currentNorm = normalizeRole(user.role) || user.role;
    if (assignableRoles.some((r) => r.key === currentNorm)) {
      return assignableRoles;
    }
    return [{ key: currentNorm, label: getRoleLabel(currentNorm) }, ...assignableRoles];
  }, [assignableRoles, user]);

  const canAssignTargetRole = useMemo(() => {
    if (!user) return assignableRoles.length > 0;
    return can('user.role.assign', {
      uid: user.uid || user.id,
      currentRole: user.role,
      officeId: user.officeId || '',
      districtOfficeId: user.districtOfficeId || ''
    });
  }, [assignableRoles.length, can, user]);

  // Create form state
  const [createForm, setCreateForm] = useState({
    name: '',
    designation: '',
    mobile: '',
    address: '',
    email: '',
    password: '',
    officeId: '',
    additionalOfficeIds: [],
    role: ROLES.employee.key,
    joiningDate: getTodayDhaka()
  });
  const [createPhotoFile, setCreatePhotoFile] = useState(null);

  // Link form state
  const [linkForm, setLinkForm] = useState({
    linkMethod: 'credentials', // 'credentials' | 'uid'
    uid: '',
    email: '',
    password: '',
    name: '',
    designation: '',
    mobile: '',
    address: '',
    officeId: '',
    additionalOfficeIds: [],
    role: ROLES.employee.key,
    approvalStatus: 'approved',
    status: 'active',
    joiningDate: getTodayDhaka()
  });
  const [linkPhotoFile, setLinkPhotoFile] = useState(null);

  // Edit form state
  const [editForm, setEditForm] = useState({
    name: '',
    designation: '',
    mobile: '',
    officeId: '',
    additionalOfficeIds: [],
    address: '',
    joiningDate: getTodayDhaka(),
    role: ROLES.employee.key,
    status: 'active',
    resignationDate: '',
    approvalStatus: 'approved'
  });

  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState('');

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setSubmitError('');

    if (mode === 'create') {
      setCreateForm({
        name: '',
        designation: '',
        mobile: '',
        address: '',
        email: '',
        password: '',
        officeId: '',
        additionalOfficeIds: [],
        role: ROLES.employee.key,
        joiningDate: getTodayDhaka()
      });
      setCreatePhotoFile(null);
    } else if (mode === 'link') {
      setLinkForm({
        linkMethod: 'credentials',
        uid: '',
        email: '',
        password: '',
        name: '',
        designation: '',
        mobile: '',
        address: '',
        officeId: '',
        additionalOfficeIds: [],
        role: ROLES.employee.key,
        approvalStatus: 'approved',
        status: 'active',
        joiningDate: getTodayDhaka()
      });
      setLinkPhotoFile(null);
    } else if (mode === 'edit' && user) {
      setEditForm({
        name: user.name || '',
        designation: user.designation || '',
        mobile: user.mobile || '',
        officeId: user.officeId || '',
        additionalOfficeIds: Array.isArray(user.additionalOfficeIds)
          ? user.additionalOfficeIds.filter((id) => id && id !== user.officeId)
          : [],
        address: user.address || '',
        joiningDate: toDateInputValue(user.joiningDate, getTodayDhaka()),
        role: normalizeRole(user.role) || ROLES.employee.key,
        status: user.status || 'active',
        resignationDate: toDateInputValue(user.resignationDate, ''),
        approvalStatus: user.approvalStatus || 'pending'
      });
    }
  }, [open, mode, user]);

  const clearFieldError = (field) => {
    if (errors[field]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  };

  const validateCommonStaffFields = (data) => {
    const nextErrors = {};
    if ((data.name || '').trim().length < 2) {
      nextErrors.name = 'Enter at least 2 characters.';
    }
    if ((data.designation || '').trim().length < 2) {
      nextErrors.designation = 'Enter at least 2 characters.';
    }
    if ((data.mobile || '').trim().length < 6) {
      nextErrors.mobile = 'Enter a valid mobile number (min 6 digits).';
    }
    if ((data.address || '').trim().length < 2) {
      nextErrors.address = 'Enter at least 2 characters.';
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data.joiningDate || '')) {
      nextErrors.joiningDate = 'Select a valid joining date.';
    }
    return nextErrors;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitError('');

    if (mode === 'create') {
      const nextErrors = validateCommonStaffFields(createForm);
      if (!createForm.email.trim() || !createForm.email.includes('@')) {
        nextErrors.email = 'Enter a valid email address.';
      }
      if (!createForm.password || createForm.password.length < 6) {
        nextErrors.password = 'Password must be at least 6 characters.';
      }
      if (Object.keys(nextErrors).length > 0) {
        setErrors(nextErrors);
        return;
      }
      const res = await onCreateSubmit(createForm, createPhotoFile);
      if (res && !res.ok && res.error) {
        setSubmitError(res.error);
      }
      return;
    }

    if (mode === 'link') {
      const nextErrors = validateCommonStaffFields(linkForm);
      if (!linkForm.email.trim() || !linkForm.email.includes('@')) {
        nextErrors.email = 'Enter a valid Auth email.';
      }
      if (linkForm.linkMethod === 'credentials') {
        if (!linkForm.password) {
          nextErrors.password = 'Enter the Auth account password.';
        }
      } else {
        if (!/^[a-zA-Z0-9_-]{1,128}$/.test(linkForm.uid.trim())) {
          nextErrors.uid = 'Enter a valid Firebase Auth UID (letters, numbers, _ or -).';
        }
      }
      if (Object.keys(nextErrors).length > 0) {
        setErrors(nextErrors);
        return;
      }
      const res = await onLinkSubmit(linkForm, linkPhotoFile);
      if (res && !res.ok && res.error) {
        setSubmitError(res.error);
      }
      return;
    }

    if (mode === 'edit' && user) {
      const nextErrors = validateCommonStaffFields(editForm);
      if (
        editForm.status === 'resigned' &&
        editForm.resignationDate &&
        !/^\d{4}-\d{2}-\d{2}$/.test(editForm.resignationDate)
      ) {
        nextErrors.resignationDate = 'Select a valid resignation date.';
      }
      if (Object.keys(nextErrors).length > 0) {
        setErrors(nextErrors);
        return;
      }
      const res = await onEditSubmit(user, editForm);
      if (res && !res.ok && res.error) {
        setSubmitError(res.error);
      }
    }
  };

  const title =
    mode === 'edit'
      ? 'Edit user'
      : mode === 'link'
      ? 'Link Auth user'
      : 'New user';

  const subtitle =
    mode === 'edit'
      ? user?.name || user?.email || user?.uid || ''
      : mode === 'link'
      ? 'Generate a missing Firestore users profile'
      : 'Create a Firebase Auth account and Firestore profile';

  const formId = `user-form-sheet-${mode || 'none'}`;

  const footer = (
    <div className="space-y-2.5">
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
            ? mode === 'edit'
              ? 'Saving...'
              : mode === 'link'
              ? 'Creating profile...'
              : 'Creating user...'
            : mode === 'edit'
            ? 'Save changes'
            : mode === 'link'
            ? 'Create missing Firestore profile'
            : 'Create approved user'}
        </button>
      </div>
      {tasks.length > 0 && <SubmissionTasksInline tasks={tasks} />}
    </div>
  );

  return (
    <BottomSheet
      open={open}
      onClose={submitting ? undefined : onClose}
      title={title}
      subtitle={subtitle}
      maxWidthClass="sm:max-w-2xl"
      footer={footer}
    >
      <form id={formId} onSubmit={handleSubmit} noValidate className="space-y-4">
        {submitError && (
          <div
            role="alert"
            className="p-3.5 rounded-[14px] bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/70 text-xs text-rose-800 dark:text-rose-200"
          >
            {submitError}
          </div>
        )}

        {tasks.length > 0 && (
          <SubmissionTasksFeedback
            tasks={tasks}
            summary={feedbackSummary}
            variant={feedbackVariant}
          />
        )}

        {mode === 'link' && (
          <>
            <div className="p-3.5 rounded-[16px] bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 flex items-start gap-2.5 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              <Info className="w-4 h-4 text-[#0b6b4f] dark:text-[#4fd1a1] shrink-0 mt-0.5" aria-hidden="true" />
              <span>
                For users that exist in Firebase Authentication but have no Firestore{' '}
                <code className="font-mono-tabular font-semibold text-slate-800 dark:text-slate-100">
                  users/{'{uid}'}
                </code>{' '}
                document.
              </span>
            </div>

            <div
              role="group"
              aria-label="UID resolution method"
              className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-1 rounded-[16px] bg-slate-100 dark:bg-slate-800/80 border border-slate-200/70 dark:border-slate-700/70"
            >
              <button
                type="button"
                onClick={() => setLinkForm((f) => ({ ...f, linkMethod: 'credentials' }))}
                className={`min-h-[44px] px-3 py-2 rounded-[12px] text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b6b4f] dark:focus-visible:ring-[#4fd1a1] ${
                  linkForm.linkMethod === 'credentials'
                    ? 'bg-white dark:bg-slate-900 text-[#0b6b4f] dark:text-[#4fd1a1] shadow-xs'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                Look up UID by email and password
              </button>
              <button
                type="button"
                onClick={() => setLinkForm((f) => ({ ...f, linkMethod: 'uid' }))}
                className={`min-h-[44px] px-3 py-2 rounded-[12px] text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b6b4f] dark:focus-visible:ring-[#4fd1a1] ${
                  linkForm.linkMethod === 'uid'
                    ? 'bg-white dark:bg-slate-900 text-[#0b6b4f] dark:text-[#4fd1a1] shadow-xs'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                Enter Auth UID directly
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label htmlFor="link-email" className={LABEL_CLASS}>Auth email</label>
                <input
                  id="link-email"
                  type="email"
                  autoComplete="off"
                  value={linkForm.email}
                  onChange={(e) => {
                    clearFieldError('email');
                    setLinkForm((f) => ({ ...f, email: e.target.value }));
                  }}
                  placeholder="existing@office.gov.bd"
                  className={INPUT_CLASS}
                />
                {errors.email && <p className={ERROR_CLASS}>{errors.email}</p>}
              </div>

              {linkForm.linkMethod === 'credentials' ? (
                <div>
                  <label htmlFor="link-password" className={LABEL_CLASS}>Auth password</label>
                  <input
                    id="link-password"
                    type="password"
                    autoComplete="new-password"
                    value={linkForm.password}
                    onChange={(e) => {
                      clearFieldError('password');
                      setLinkForm((f) => ({ ...f, password: e.target.value }));
                    }}
                    placeholder="User's Auth password"
                    className={INPUT_CLASS}
                  />
                  {errors.password && <p className={ERROR_CLASS}>{errors.password}</p>}
                </div>
              ) : (
                <div>
                  <label htmlFor="link-uid" className={LABEL_CLASS}>Auth UID</label>
                  <input
                    id="link-uid"
                    type="text"
                    value={linkForm.uid}
                    onChange={(e) => {
                      clearFieldError('uid');
                      setLinkForm((f) => ({ ...f, uid: e.target.value }));
                    }}
                    placeholder="Paste Firebase Auth UID"
                    className={`${INPUT_CLASS} font-mono-tabular`}
                  />
                  {errors.uid && <p className={ERROR_CLASS}>{errors.uid}</p>}
                </div>
              )}

              <div>
                <label htmlFor="link-name" className={LABEL_CLASS}>Full name</label>
                <input
                  id="link-name"
                  type="text"
                  value={linkForm.name}
                  onChange={(e) => {
                    clearFieldError('name');
                    setLinkForm((f) => ({ ...f, name: e.target.value }));
                  }}
                  className={INPUT_CLASS}
                />
                {errors.name && <p className={ERROR_CLASS}>{errors.name}</p>}
              </div>

              <div>
                <label htmlFor="link-designation" className={LABEL_CLASS}>Designation</label>
                <input
                  id="link-designation"
                  type="text"
                  value={linkForm.designation}
                  onChange={(e) => {
                    clearFieldError('designation');
                    setLinkForm((f) => ({ ...f, designation: e.target.value }));
                  }}
                  className={INPUT_CLASS}
                />
                {errors.designation && <p className={ERROR_CLASS}>{errors.designation}</p>}
              </div>

              <div>
                <label htmlFor="link-mobile" className={LABEL_CLASS}>Mobile</label>
                <input
                  id="link-mobile"
                  type="tel"
                  value={linkForm.mobile}
                  onChange={(e) => {
                    clearFieldError('mobile');
                    setLinkForm((f) => ({ ...f, mobile: e.target.value }));
                  }}
                  className={`${INPUT_CLASS} font-mono-tabular`}
                />
                {errors.mobile && <p className={ERROR_CLASS}>{errors.mobile}</p>}
              </div>

              <div>
                <label htmlFor="link-office" className={LABEL_CLASS}>Office (optional)</label>
                <select
                  id="link-office"
                  value={linkForm.officeId}
                  onChange={(e) =>
                    setLinkForm((f) => ({
                      ...f,
                      officeId: e.target.value,
                      additionalOfficeIds: f.additionalOfficeIds.filter((id) => id !== e.target.value)
                    }))
                  }
                  className={INPUT_CLASS}
                >
                  <option value="">Assign office later / None</option>
                  {selectableOffices.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="sm:col-span-2">
                <label htmlFor="link-address" className={LABEL_CLASS}>Address</label>
                <input
                  id="link-address"
                  type="text"
                  value={linkForm.address}
                  onChange={(e) => {
                    clearFieldError('address');
                    setLinkForm((f) => ({ ...f, address: e.target.value }));
                  }}
                  className={INPUT_CLASS}
                />
                {errors.address && <p className={ERROR_CLASS}>{errors.address}</p>}
              </div>

              <div>
                <label htmlFor="link-role" className={LABEL_CLASS}>Role</label>
                <select
                  id="link-role"
                  value={linkForm.role}
                  onChange={(e) => setLinkForm((f) => ({ ...f, role: e.target.value, additionalOfficeIds: [] }))}
                  className={INPUT_CLASS}
                >
                  {assignableRoles.map((r) => (
                    <option key={r.key} value={r.key}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="link-approval" className={LABEL_CLASS}>Approval status</label>
                <select
                  id="link-approval"
                  value={linkForm.approvalStatus}
                  onChange={(e) => setLinkForm((f) => ({ ...f, approvalStatus: e.target.value }))}
                  className={INPUT_CLASS}
                >
                  <option value="approved">Approved</option>
                  <option value="pending">Pending</option>
                </select>
              </div>

              <div>
                <label htmlFor="link-status" className={LABEL_CLASS}>Account status</label>
                <select
                  id="link-status"
                  value={linkForm.status}
                  onChange={(e) => setLinkForm((f) => ({ ...f, status: e.target.value }))}
                  className={INPUT_CLASS}
                >
                  <option value="active">Active</option>
                  <option value="resigned">Inactive (Resigned)</option>
                </select>
              </div>

              <div>
                <label htmlFor="link-joining" className={LABEL_CLASS}>Joining date</label>
                <input
                  id="link-joining"
                  type="date"
                  value={linkForm.joiningDate}
                  onChange={(e) => {
                    clearFieldError('joiningDate');
                    setLinkForm((f) => ({ ...f, joiningDate: e.target.value }));
                  }}
                  className={`${INPUT_CLASS} font-mono-tabular`}
                />
                {errors.joiningDate && <p className={ERROR_CLASS}>{errors.joiningDate}</p>}
              </div>

              {canManageAdditionalCharge && roleSupportsAdditionalCharge(linkForm.role) && (
                <AdditionalChargePicker
                  offices={offices}
                  role={linkForm.role}
                  primaryOfficeId={linkForm.officeId}
                  selectedIds={linkForm.additionalOfficeIds}
                  idPrefix="link"
                  onToggle={(id) =>
                    setLinkForm((f) => ({
                      ...f,
                      additionalOfficeIds: f.additionalOfficeIds.includes(id)
                        ? f.additionalOfficeIds.filter((x) => x !== id)
                        : [...f.additionalOfficeIds, id]
                    }))
                  }
                />
              )}

              <div className="sm:col-span-2">
                <label htmlFor="link-photo" className={LABEL_CLASS}>Profile photo (optional)</label>
                <input
                  id="link-photo"
                  type="file"
                  accept="image/*"
                  onChange={(e) => setLinkPhotoFile(e.target.files?.[0] || null)}
                  className="block w-full min-h-[44px] text-sm text-slate-600 dark:text-slate-300 file:mr-3 file:py-2.5 file:px-4 file:rounded-[12px] file:border-0 file:bg-slate-100 dark:file:bg-slate-800 file:text-slate-700 dark:file:text-slate-200 file:font-semibold"
                />
              </div>
            </div>
          </>
        )}

        {mode === 'create' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label htmlFor="create-name" className={LABEL_CLASS}>Full name</label>
              <input
                id="create-name"
                type="text"
                value={createForm.name}
                onChange={(e) => {
                  clearFieldError('name');
                  setCreateForm((f) => ({ ...f, name: e.target.value }));
                }}
                className={INPUT_CLASS}
              />
              {errors.name && <p className={ERROR_CLASS}>{errors.name}</p>}
            </div>

            <div>
              <label htmlFor="create-designation" className={LABEL_CLASS}>Designation</label>
              <input
                id="create-designation"
                type="text"
                value={createForm.designation}
                onChange={(e) => {
                  clearFieldError('designation');
                  setCreateForm((f) => ({ ...f, designation: e.target.value }));
                }}
                className={INPUT_CLASS}
              />
              {errors.designation && <p className={ERROR_CLASS}>{errors.designation}</p>}
            </div>

            <div>
              <label htmlFor="create-mobile" className={LABEL_CLASS}>Mobile</label>
              <input
                id="create-mobile"
                type="tel"
                value={createForm.mobile}
                onChange={(e) => {
                  clearFieldError('mobile');
                  setCreateForm((f) => ({ ...f, mobile: e.target.value }));
                }}
                className={`${INPUT_CLASS} font-mono-tabular`}
              />
              {errors.mobile && <p className={ERROR_CLASS}>{errors.mobile}</p>}
            </div>

            <div>
              <label htmlFor="create-office" className={LABEL_CLASS}>Office (optional)</label>
              <select
                id="create-office"
                value={createForm.officeId}
                onChange={(e) =>
                  setCreateForm((f) => ({
                    ...f,
                    officeId: e.target.value,
                    additionalOfficeIds: f.additionalOfficeIds.filter((id) => id !== e.target.value)
                  }))
                }
                className={INPUT_CLASS}
              >
                <option value="">Assign office later / None</option>
                {selectableOffices.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="sm:col-span-2">
              <label htmlFor="create-address" className={LABEL_CLASS}>Address</label>
              <input
                id="create-address"
                type="text"
                value={createForm.address}
                onChange={(e) => {
                  clearFieldError('address');
                  setCreateForm((f) => ({ ...f, address: e.target.value }));
                }}
                className={INPUT_CLASS}
              />
              {errors.address && <p className={ERROR_CLASS}>{errors.address}</p>}
            </div>

            <div>
              <label htmlFor="create-email" className={LABEL_CLASS}>Email</label>
              <input
                id="create-email"
                type="email"
                autoComplete="off"
                value={createForm.email}
                onChange={(e) => {
                  clearFieldError('email');
                  setCreateForm((f) => ({ ...f, email: e.target.value }));
                }}
                className={INPUT_CLASS}
              />
              {errors.email && <p className={ERROR_CLASS}>{errors.email}</p>}
            </div>

            <div>
              <label htmlFor="create-password" className={LABEL_CLASS}>Initial password</label>
              <input
                id="create-password"
                type="password"
                autoComplete="new-password"
                value={createForm.password}
                onChange={(e) => {
                  clearFieldError('password');
                  setCreateForm((f) => ({ ...f, password: e.target.value }));
                }}
                className={INPUT_CLASS}
              />
              {errors.password && <p className={ERROR_CLASS}>{errors.password}</p>}
            </div>

            <div>
              <label htmlFor="create-role" className={LABEL_CLASS}>Role</label>
              <select
                id="create-role"
                value={createForm.role}
                onChange={(e) => setCreateForm((f) => ({ ...f, role: e.target.value, additionalOfficeIds: [] }))}
                className={INPUT_CLASS}
              >
                {assignableRoles.map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="create-joining" className={LABEL_CLASS}>Joining date</label>
              <input
                id="create-joining"
                type="date"
                value={createForm.joiningDate}
                onChange={(e) => {
                  clearFieldError('joiningDate');
                  setCreateForm((f) => ({ ...f, joiningDate: e.target.value }));
                }}
                className={`${INPUT_CLASS} font-mono-tabular`}
              />
              {errors.joiningDate && <p className={ERROR_CLASS}>{errors.joiningDate}</p>}
            </div>

            {canManageAdditionalCharge && roleSupportsAdditionalCharge(createForm.role) && (
              <AdditionalChargePicker
                offices={offices}
                role={createForm.role}
                primaryOfficeId={createForm.officeId}
                selectedIds={createForm.additionalOfficeIds}
                idPrefix="create"
                onToggle={(id) =>
                  setCreateForm((f) => ({
                    ...f,
                    additionalOfficeIds: f.additionalOfficeIds.includes(id)
                      ? f.additionalOfficeIds.filter((x) => x !== id)
                      : [...f.additionalOfficeIds, id]
                  }))
                }
              />
            )}

            <div className="sm:col-span-2">
              <label htmlFor="create-photo" className={LABEL_CLASS}>Profile photo (optional)</label>
              <input
                id="create-photo"
                type="file"
                accept="image/*"
                onChange={(e) => setCreatePhotoFile(e.target.files?.[0] || null)}
                className="block w-full min-h-[44px] text-sm text-slate-600 dark:text-slate-300 file:mr-3 file:py-2.5 file:px-4 file:rounded-[12px] file:border-0 file:bg-slate-100 dark:file:bg-slate-800 file:text-slate-700 dark:file:text-slate-200 file:font-semibold"
              />
            </div>
          </div>
        )}

        {mode === 'edit' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label htmlFor="edit-name" className={LABEL_CLASS}>Full name</label>
              <input
                id="edit-name"
                type="text"
                value={editForm.name}
                onChange={(e) => {
                  clearFieldError('name');
                  setEditForm((f) => ({ ...f, name: e.target.value }));
                }}
                className={INPUT_CLASS}
              />
              {errors.name && <p className={ERROR_CLASS}>{errors.name}</p>}
            </div>

            <div>
              <label htmlFor="edit-designation" className={LABEL_CLASS}>Designation</label>
              <input
                id="edit-designation"
                type="text"
                value={editForm.designation}
                onChange={(e) => {
                  clearFieldError('designation');
                  setEditForm((f) => ({ ...f, designation: e.target.value }));
                }}
                className={INPUT_CLASS}
              />
              {errors.designation && <p className={ERROR_CLASS}>{errors.designation}</p>}
            </div>

            <div>
              <label htmlFor="edit-mobile" className={LABEL_CLASS}>Mobile</label>
              <input
                id="edit-mobile"
                type="tel"
                value={editForm.mobile}
                onChange={(e) => {
                  clearFieldError('mobile');
                  setEditForm((f) => ({ ...f, mobile: e.target.value }));
                }}
                className={`${INPUT_CLASS} font-mono-tabular`}
              />
              {errors.mobile && <p className={ERROR_CLASS}>{errors.mobile}</p>}
            </div>

            <div>
              <label htmlFor="edit-office" className={LABEL_CLASS}>Office (optional)</label>
              <select
                id="edit-office"
                value={editForm.officeId}
                onChange={(e) =>
                  setEditForm((f) => ({
                    ...f,
                    officeId: e.target.value,
                    additionalOfficeIds: f.additionalOfficeIds.filter((id) => id !== e.target.value)
                  }))
                }
                className={INPUT_CLASS}
              >
                {editScope === 'all' && <option value="">Assign office later / None</option>}
                {selectableOffices.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="sm:col-span-2">
              <label htmlFor="edit-address" className={LABEL_CLASS}>Address</label>
              <input
                id="edit-address"
                type="text"
                value={editForm.address}
                onChange={(e) => {
                  clearFieldError('address');
                  setEditForm((f) => ({ ...f, address: e.target.value }));
                }}
                className={INPUT_CLASS}
              />
              {errors.address && <p className={ERROR_CLASS}>{errors.address}</p>}
            </div>

            <div>
              <label htmlFor="edit-joining" className={LABEL_CLASS}>Joining date</label>
              <input
                id="edit-joining"
                type="date"
                value={editForm.joiningDate}
                onChange={(e) => {
                  clearFieldError('joiningDate');
                  setEditForm((f) => ({ ...f, joiningDate: e.target.value }));
                }}
                className={`${INPUT_CLASS} font-mono-tabular`}
              />
              {errors.joiningDate && <p className={ERROR_CLASS}>{errors.joiningDate}</p>}
            </div>

            <div>
              <label htmlFor="edit-role" className={LABEL_CLASS}>Role</label>
              <select
                id="edit-role"
                value={editForm.role}
                disabled={!canAssignTargetRole}
                onChange={(e) => setEditForm((f) => ({ ...f, role: e.target.value }))}
                className={`${INPUT_CLASS} disabled:opacity-60`}
              >
                {roleOptionsForEdit.map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="edit-status" className={LABEL_CLASS}>Status</label>
              <select
                id="edit-status"
                value={editForm.status}
                onChange={(e) => setEditForm((f) => ({ ...f, status: e.target.value }))}
                className={INPUT_CLASS}
              >
                <option value="active">Active</option>
                <option value="resigned">Inactive (Resigned)</option>
              </select>
            </div>

            <div>
              <label htmlFor="edit-approval" className={LABEL_CLASS}>Approval status</label>
              <select
                id="edit-approval"
                value={editForm.approvalStatus}
                onChange={(e) => setEditForm((f) => ({ ...f, approvalStatus: e.target.value }))}
                className={INPUT_CLASS}
              >
                <option value="approved">Approved</option>
                <option value="pending">Pending</option>
                <option value="rejected">Rejected</option>
              </select>
            </div>

            {canManageAdditionalCharge && roleSupportsAdditionalCharge(editForm.role) && (
              <AdditionalChargePicker
                offices={offices}
                role={editForm.role}
                primaryOfficeId={editForm.officeId}
                selectedIds={editForm.additionalOfficeIds}
                idPrefix="edit"
                onToggle={(id) =>
                  setEditForm((f) => ({
                    ...f,
                    additionalOfficeIds: f.additionalOfficeIds.includes(id)
                      ? f.additionalOfficeIds.filter((x) => x !== id)
                      : [...f.additionalOfficeIds, id]
                  }))
                }
              />
            )}

            {editForm.status === 'resigned' && (
              <div className="sm:col-span-2">
                <label htmlFor="edit-resignation" className={LABEL_CLASS}>Resignation date</label>
                <input
                  id="edit-resignation"
                  type="date"
                  value={editForm.resignationDate || getTodayDhaka()}
                  onChange={(e) => {
                    clearFieldError('resignationDate');
                    setEditForm((f) => ({ ...f, resignationDate: e.target.value }));
                  }}
                  className={`${INPUT_CLASS} font-mono-tabular`}
                />
                {errors.resignationDate && <p className={ERROR_CLASS}>{errors.resignationDate}</p>}
              </div>
            )}
          </div>
        )}
      </form>
    </BottomSheet>
  );
}
