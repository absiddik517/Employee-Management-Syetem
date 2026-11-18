import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

export default function LoginPage() {
  const navigate = useNavigate();
  const { error: authError, setError: setAuthError, login, sendPasswordReset, getRoleHomePath } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [resetEmail, setResetEmail] = useState('');
  const [resetMode, setResetMode] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState('');
  const [resetSuccess, setResetSuccess] = useState('');

  const errorMsg = localError || authError;

  const toggleResetMode = (val) => {
    setResetMode(val);
    setLocalError('');
    setResetSuccess('');
    setAuthError('');
    if (val && email) {
      setResetEmail(email);
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setLocalError('');
    setSubmitting(true);
    try {
      const result = await login(email.trim(), password);
      if (result?.needsProfileSetup) {
        navigate('/complete-profile', { replace: true });
      } else if (result?.profile) {
        navigate(getRoleHomePath(result.profile, result.resolvedActiveOfficeId), { replace: true });
      }
    } catch {
      // Error surfaced from AuthContext
    } finally {
      setSubmitting(false);
    }
  };

  const handleReset = async (e) => {
    e.preventDefault();
    setLocalError('');
    setResetSuccess('');
    setSubmitting(true);
    try {
      await sendPasswordReset(resetEmail.trim());
      setResetSuccess('আপনার ইমেইলে পাসওয়ার্ড রিসেট লিংক পাঠানো হয়েছে। ইনবক্স বা স্প্যাম ফোল্ডার দেখুন।');
    } catch {
      // Error surfaced from AuthContext
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center px-4 py-8">
      <div className="w-full max-w-md mx-auto">
        <div className="mb-6">
          <div className="text-xs font-semibold tracking-wide text-emerald-800">Government of Bangladesh</div>
          <h1 className="text-2xl font-bold text-slate-900 font-display mt-1">EMS Attendance Portal</h1>
          <p className="text-sm text-slate-600 mt-1">
            Sign in with your official email and password to record attendance or manage your office.
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-5">
          {!resetMode ? (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label htmlFor="login-email" className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Email Address
                </label>
                <input
                  id="login-email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="name@office.gov.bd"
                  className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:border-emerald-600"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label htmlFor="login-password" className="block text-xs font-semibold text-slate-700">
                    Password
                  </label>
                  <button
                    type="button"
                    onClick={() => toggleResetMode(true)}
                    className="text-xs font-medium text-emerald-700 hover:text-emerald-800"
                  >
                    Forgot password?
                  </button>
                </div>
                <input
                  id="login-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  type="password"
                  required
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:border-emerald-600"
                />
              </div>

              {errorMsg && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800 leading-relaxed">
                  {errorMsg}
                </div>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full min-h-[48px] px-4 py-3 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold transition-colors disabled:opacity-60"
              >
                {submitting ? 'লগইন হচ্ছে...' : 'Sign In'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleReset} className="space-y-4">
              <div>
                <h2 className="text-base font-bold text-slate-900 font-display">Reset Password</h2>
                <p className="text-xs text-slate-600 mt-1">
                  Enter your registered email to receive a Firebase password reset link.
                </p>
              </div>

              <div>
                <label htmlFor="reset-email" className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Email Address
                </label>
                <input
                  id="reset-email"
                  value={resetEmail}
                  onChange={(e) => setResetEmail(e.target.value)}
                  type="email"
                  required
                  placeholder="name@office.gov.bd"
                  className="w-full min-h-[44px] px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-emerald-600"
                />
              </div>

              {resetSuccess && (
                <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800">
                  {resetSuccess}
                </div>
              )}
              {errorMsg && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800">
                  {errorMsg}
                </div>
              )}

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => toggleResetMode(false)}
                  className="min-h-[44px] px-4 py-2 rounded-xl border border-slate-300 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Back
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 min-h-[44px] px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold disabled:opacity-60"
                >
                  {submitting ? 'পাঠানো হচ্ছে...' : 'Send Reset Email'}
                </button>
              </div>
            </form>
          )}

          <div className="pt-4 border-t border-slate-100 flex items-center justify-between text-xs">
            <span className="text-slate-500">New staff member?</span>
            <Link to="/register" className="font-semibold text-emerald-700 hover:text-emerald-800 py-2">
              Register Account
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
