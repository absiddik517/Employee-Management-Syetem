import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { SubmissionTasksInline, SubmissionTasksFeedback } from '../components/SubmissionTasks.jsx';
import { getTodayDhaka } from '../utils/dhakaTime.js';

function buildRegisterTasks() {
  return [
    { id: 'settings', label: 'Verify registration status', status: 'pending', detail: '' },
    { id: 'auth', label: 'Create Auth account', status: 'pending', detail: '' },
    { id: 'profile', label: 'Save Firestore profile', status: 'pending', detail: '' },
    { id: 'photo', label: 'Upload optional photo', status: 'pending', detail: '' },
    { id: 'session', label: 'Finalize session', status: 'pending', detail: '' }
  ];
}

export default function RegisterPage() {
  const navigate = useNavigate();
  const { registrationOpen, defaultRoleKey, offices, error: authError, fetchPublicBootstrap, registerEmployee } = useAuth();
  const previewUrlRef = useRef('');

  const [loadingInit, setLoadingInit] = useState(true);
  const [submitting, setSubmitting] = useState(false);
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
    email: '',
    password: '',
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

  const errorMsg = localError || authError;

  const updateField = (key, val) => {
    setForm((prev) => ({ ...prev, [key]: val }));
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

    let currentTasks = buildRegisterTasks();
    setTasks(currentTasks);
    setFeedbackVariant('info');
    setFeedbackSummary('Submitting employee registration tasks...');
    setSubmitting(true);

    const onTaskUpdate = (id, status, detail = '') => {
      currentTasks = currentTasks.map((t) => (t.id === id ? { ...t, status, detail } : t));
      setTasks(currentTasks);
    };

    try {
      const res = await registerEmployee(form, photoFile, onTaskUpdate);
      if (res.resigned) {
        const msg = 'অ্যাকাউন্ট সংরক্ষিত হয়েছে। পদত্যাগকৃত ব্যবহারকারী লগইন করতে পারবেন না।';
        setFeedbackVariant('success');
        setFeedbackSummary(msg);
        setSuccessMsg(msg);
      } else {
        setFeedbackVariant('success');
        setFeedbackSummary('রেজিস্ট্রেশন সম্পন্ন হয়েছে।');
        navigate('/pending', { replace: true });
      }
    } catch (err) {
      const msg = err.message || authError || 'রেজিস্ট্রেশন ব্যর্থ হয়েছে।';
      setFeedbackVariant('error');
      setFeedbackSummary(msg);
      if (!authError) {
        setLocalError(msg);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-6 sm:py-10">
      <div className="w-full max-w-lg mx-auto">
        <div className="mb-5 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-slate-900 font-display">Staff Registration</h1>
            <p className="text-xs text-slate-500 mt-0.5">Accounts require approval before check-in.</p>
          </div>
          <Link to="/login" className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 whitespace-nowrap py-2">
            Back to Sign In
          </Link>
        </div>

        {loadingInit ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-sm text-slate-600">
            লোড হচ্ছে...
          </div>
        ) : !registrationOpen || !defaultRoleKey ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center space-y-4">
            <div className="text-lg font-bold text-rose-700 font-display">রেজিস্ট্রেশন বন্ধ আছে</div>
            <p className="text-sm text-slate-600">
              {!registrationOpen
                ? 'New public registrations are currently closed. Please contact your authorizing office.'
                : 'পাবলিক রেজিস্ট্রেশনের জন্য এখনো কোনো ডিফল্ট রোল নির্ধারণ করা হয়নি। অনুগ্রহ করে প্রশাসকের সাথে যোগাযোগ করুন।'}
            </p>
            <Link
              to="/login"
              className="inline-flex items-center justify-center min-h-[44px] px-5 py-2.5 rounded-xl bg-slate-900 text-white text-sm font-semibold"
            >
              Go to Sign In
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 space-y-4">
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

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Email (Login ID)</label>
                <input
                  value={form.email}
                  onChange={(e) => updateField('email', e.target.value)}
                  type="email"
                  required
                  placeholder="name@office.gov.bd"
                  className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Password</label>
                <input
                  value={form.password}
                  onChange={(e) => updateField('password', e.target.value)}
                  type="password"
                  required
                  minLength={6}
                  placeholder="Minimum 6 characters"
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
                {!offices.length && (
                  <p className="mt-1 text-xs text-slate-500">
                    কোনো অফিস এখনো তালিকাভুক্ত নেই। অনুমোদনের সময় সুপার অ্যাডমিন অফিস নির্ধারণ করে দেবেন।
                  </p>
                )}
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
                  Permanent Profile Photo (for Officer Verification)
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
                    <span className="text-xs text-slate-500">Permanent profile photo selected</span>
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
                {submitting ? 'রেজিস্ট্রেশন সম্পন্ন হচ্ছে...' : 'Submit Registration'}
              </button>
              <SubmissionTasksInline tasks={tasks} />
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
