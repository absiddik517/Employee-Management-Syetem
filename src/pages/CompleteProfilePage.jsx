import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Copy, Check, LogOut, RefreshCw } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { SubmissionTasksInline, SubmissionTasksFeedback } from '../components/SubmissionTasks.jsx';
import { getTodayDhaka } from '../utils/dhakaTime.js';

function buildCompleteProfileTasks() {
  return [
    { id: 'settings', label: 'Verify permissions & settings', status: 'pending', detail: '' },
    { id: 'profile', label: 'Save Firestore profile', status: 'pending', detail: '' },
    { id: 'photo', label: 'Upload optional photo', status: 'pending', detail: '' },
    { id: 'session', label: 'Load staff session', status: 'pending', detail: '' }
  ];
}

export default function CompleteProfilePage() {
  const navigate = useNavigate();
  const {
    firebaseUser,
    isBootstrapSuperAdmin,
    registrationOpen,
    defaultRoleKey,
    offices,
    error: authError,
    fetchPublicBootstrap,
    loadUserProfile,
    completeMissingProfile,
    getRoleHomePath,
    logout
  } = useAuth();

  const previewUrlRef = useRef('');
  const [loadingInit, setLoadingInit] = useState(true);
  const [checking, setChecking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [copiedUid, setCopiedUid] = useState(false);
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreview, setPhotoPreview] = useState('');
  const [localError, setLocalError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [tasks, setTasks] = useState([]);
  const [feedbackVariant, setFeedbackVariant] = useState('info');
  const [feedbackSummary, setFeedbackSummary] = useState('');
  const [form, setForm] = useState(() => ({
    name: '',
    designation: '',
    address: '',
    mobile: '',
    officeId: '',
    joiningDate: getTodayDhaka(),
    status: 'active',
    resignationDate: ''
  }));

  useEffect(() => {
    let active = true;
    (async () => {
      setLoadingInit(true);
      await fetchPublicBootstrap();
      if (active) setLoadingInit(false);
    })();
    return () => {
      active = false;
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, [fetchPublicBootstrap]);

  const selectedOffice = useMemo(
    () => offices.find((o) => o.id === form.officeId) || null,
    [offices, form.officeId]
  );

  const canSelfCreate = (registrationOpen && Boolean(defaultRoleKey)) || isBootstrapSuperAdmin;
  const errorMsg = localError || authError;

  const updateField = (key, val) => {
    setForm((prev) => ({ ...prev, [key]: val }));
  };

  const copyUid = async () => {
    if (!firebaseUser?.uid) return;
    try {
      await navigator.clipboard.writeText(firebaseUser.uid);
      setCopiedUid(true);
      setTimeout(() => setCopiedUid(false), 2000);
    } catch {
      // Fallback ignored if clipboard permission unavailable
    }
  };

  const handleCheckAgain = async () => {
    if (!firebaseUser?.uid) return;
    setChecking(true);
    setLocalError('');
    try {
      const loaded = await loadUserProfile(firebaseUser.uid);
      if (loaded) {
        navigate(getRoleHomePath(loaded), { replace: true });
      } else {
        setLocalError('এখনো users কালেকশনে আপনার প্রোফাইল তৈরি হয়নি।');
      }
    } finally {
      setChecking(false);
    }
  };

  const onFileChange = (e) => {
    const file = e.target.files?.[0];
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = '';
    }
    if (!file) {
      setPhotoFile(null);
      setPhotoPreview('');
      return;
    }
    const url = URL.createObjectURL(file);
    previewUrlRef.current = url;
    setPhotoFile(file);
    setPhotoPreview(url);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (submitting) return;

    setLocalError('');
    setSuccessMsg('');
    if (form.status === 'resigned' && !form.resignationDate) {
      setLocalError('পদত্যাগের তারিখ প্রদান করুন।');
      return;
    }

    let currentTasks = buildCompleteProfileTasks();
    setTasks(currentTasks);
    setFeedbackVariant('info');
    setFeedbackSummary('Submitting staff profile tasks...');
    setSubmitting(true);

    const onTaskUpdate = (id, status, detail = '') => {
      currentTasks = currentTasks.map((t) => (t.id === id ? { ...t, status, detail } : t));
      setTasks(currentTasks);
    };

    try {
      const res = await completeMissingProfile(form, photoFile, onTaskUpdate);
      if (res.resigned) {
        const msg = 'প্রোফাইল সংরক্ষিত হয়েছে। পদত্যাগকৃত ব্যবহারকারী লগইন করতে পারবেন না।';
        setFeedbackVariant('success');
        setFeedbackSummary(msg);
        setSuccessMsg(msg);
      } else if (res.profile) {
        setFeedbackVariant('success');
        setFeedbackSummary('প্রোফাইল সফলভাবে সংরক্ষিত হয়েছে।');
        navigate(getRoleHomePath(res.profile), { replace: true });
      } else {
        navigate('/pending', { replace: true });
      }
    } catch (err) {
      const msg = err.message || authError || 'প্রোফাইল তৈরি করা যায়নি।';
      setFeedbackVariant('error');
      setFeedbackSummary(msg);
      if (!authError) {
        setLocalError(msg);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-6 sm:py-10">
      <div className="w-full max-w-lg mx-auto space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-semibold text-amber-700">Auth Account Active · Profile Missing</div>
            <h1 className="text-xl font-bold text-slate-900 font-display mt-0.5">Complete Your Staff Profile</h1>
            <p className="text-xs text-slate-600 mt-1">
              আপনার লগইন অ্যাকাউন্ট (Firebase Auth) সক্রিয় আছে, কিন্তু ডাটাবেজে প্রোফাইল তথ্য তৈরি করা নেই।
            </p>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="inline-flex items-center gap-1.5 min-h-[40px] px-3 py-1.5 rounded-xl border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-100 shrink-0"
          >
            <LogOut className="w-3.5 h-3.5" />
            Sign Out
          </button>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-2">
          <div className="text-xs text-slate-500">Signed-in Auth Account</div>
          <div className="text-sm font-semibold text-slate-900">{firebaseUser?.email || '—'}</div>
          <div className="flex items-center justify-between gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
            <div className="text-[11px] font-mono-tabular text-slate-700 truncate">
              UID: {firebaseUser?.uid || '—'}
            </div>
            <button
              type="button"
              onClick={copyUid}
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 hover:text-emerald-800 shrink-0"
            >
              {copiedUid ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copiedUid ? 'Copied' : 'Copy UID'}
            </button>
          </div>
          <div className="flex justify-end pt-1">
            <button
              type="button"
              disabled={checking}
              onClick={handleCheckAgain}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 hover:text-slate-900 py-1"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${checking ? 'animate-spin' : ''}`} />
              {checking ? 'যাচাই হচ্ছে...' : 'Check if Admin Created Profile'}
            </button>
          </div>
        </div>

        {loadingInit ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-sm text-slate-600">
            লোড হচ্ছে...
          </div>
        ) : !canSelfCreate ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-3">
            <div className="text-base font-bold text-rose-700 font-display">পাবলিক রেজিস্ট্রেশন বন্ধ আছে</div>
            <p className="text-xs text-slate-600 leading-relaxed">
              Public self-registration is currently closed. Please copy your Auth UID above and share it with an authorized user manager so they can create your profile from Admin → Users → Create Profile for Existing Auth User.
            </p>
            {errorMsg && (
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800">{errorMsg}</div>
            )}
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 space-y-4">
            <div className="text-xs text-slate-600">
              {isBootstrapSuperAdmin
                ? 'Bootstrap super user account detected — completing this form will create your active profile immediately.'
                : 'Fill in your official staff information to create your Firestore profile (account approval will still be required).'}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-slate-700 mb-1">Full Name</label>
                <input
                  value={form.name}
                  onChange={(e) => updateField('name', e.target.value)}
                  type="text"
                  required
                  minLength={2}
                  placeholder="e.g. Md. Rafiqul Islam"
                  className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Designation</label>
                <input
                  value={form.designation}
                  onChange={(e) => updateField('designation', e.target.value)}
                  type="text"
                  required
                  minLength={2}
                  placeholder="e.g. Office Assistant"
                  className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Mobile Number</label>
                <input
                  value={form.mobile}
                  onChange={(e) => updateField('mobile', e.target.value)}
                  type="tel"
                  required
                  minLength={6}
                  placeholder="01XXXXXXXXX"
                  className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-300 text-sm font-mono-tabular focus:outline-none focus:ring-2 focus:ring-emerald-600"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-slate-700 mb-1">Personal Address</label>
                <input
                  value={form.address}
                  onChange={(e) => updateField('address', e.target.value)}
                  type="text"
                  required
                  minLength={2}
                  placeholder="Village / Road, Upazila, District"
                  className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-slate-700 mb-1">Assigned Office (Optional)</label>
                <select
                  value={form.officeId}
                  onChange={(e) => updateField('officeId', e.target.value)}
                  className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-300 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-600"
                >
                  <option value="">Select an office later / Assign on approval</option>
                  {offices.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name} ({o.level.toUpperCase()})
                    </option>
                  ))}
                </select>
              </div>

              {selectedOffice && (
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Office Address (Read-only)</label>
                  <input
                    type="text"
                    readOnly
                    value={selectedOffice.address}
                    className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-600"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Joining Date</label>
                <input
                  value={form.joiningDate}
                  onChange={(e) => updateField('joiningDate', e.target.value)}
                  type="date"
                  required
                  className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-300 text-sm font-mono-tabular focus:outline-none focus:ring-2 focus:ring-emerald-600"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Employment Status</label>
                <select
                  value={form.status}
                  onChange={(e) => updateField('status', e.target.value)}
                  required
                  className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-300 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-600"
                >
                  <option value="active">Active</option>
                  <option value="resigned">Resigned</option>
                </select>
              </div>

              {form.status === 'resigned' && (
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Resignation Date</label>
                  <input
                    value={form.resignationDate}
                    onChange={(e) => updateField('resignationDate', e.target.value)}
                    type="date"
                    required
                    className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-300 text-sm font-mono-tabular focus:outline-none focus:ring-2 focus:ring-emerald-600"
                  />
                </div>
              )}

              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Profile Photo (Optional)
                </label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={onFileChange}
                  className="block w-full text-xs text-slate-600 file:mr-3 file:py-2.5 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-emerald-50 file:text-emerald-800 hover:file:bg-emerald-100"
                />
                {photoPreview && (
                  <div className="mt-2 flex items-center gap-3">
                    <img src={photoPreview} alt="Profile preview" className="w-14 h-14 rounded-xl object-cover border border-slate-200" />
                    <span className="text-xs text-slate-500">Profile photo selected</span>
                  </div>
                )}
              </div>
            </div>

            {tasks.length > 0 ? (
              <SubmissionTasksFeedback
                tasks={tasks}
                summary={feedbackSummary}
                variant={feedbackVariant}
              />
            ) : (
              <>
                {errorMsg && (
                  <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800">{errorMsg}</div>
                )}
                {successMsg && (
                  <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800">{successMsg}</div>
                )}
              </>
            )}

            <div className="flex flex-wrap items-start gap-3">
              <button
                type="submit"
                disabled={submitting}
                className="min-h-[48px] px-5 py-3 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold transition-colors disabled:opacity-60 shrink-0"
              >
                {submitting ? 'সংরক্ষণ হচ্ছে...' : 'Save Staff Profile'}
              </button>
              <SubmissionTasksInline tasks={tasks} />
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
