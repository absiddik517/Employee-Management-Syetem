import React, { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  LogOut,
  MapPin,
  Moon,
  Sun
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useTheme } from '../utils/theme.js';

function formatOfficeLevel(level) {
  if (level === 'head') return 'Head Office';
  if (level === 'district') return 'District Office';
  if (level === 'upazila') return 'Upazila Office';
  return 'Office';
}

export default function OfficeSelectPage() {
  const navigate = useNavigate();
  const {
    profile,
    roleLabel,
    offices,
    assignedOffices,
    hasMultipleOffices,
    activeOfficeId,
    selectActiveOffice,
    getRoleHomePath,
    logout
  } = useAuth();
  const { isDark, toggleTheme } = useTheme();

  useEffect(() => {
    if (!profile) {
      navigate('/login', { replace: true });
      return;
    }
    if (profile.approvalStatus !== 'approved') {
      navigate('/pending', { replace: true });
      return;
    }
    if (!hasMultipleOffices) {
      navigate(getRoleHomePath(profile), { replace: true });
    }
  }, [profile, hasMultipleOffices, getRoleHomePath, navigate]);

  const upazilaCounts = useMemo(() => {
    const counts = new Map();
    for (const o of offices) {
      if (o.parentOfficeId) {
        counts.set(o.parentOfficeId, (counts.get(o.parentOfficeId) || 0) + 1);
      }
    }
    return counts;
  }, [offices]);

  const handleSelect = (officeId) => {
    const ok = selectActiveOffice(officeId);
    if (ok) {
      navigate(getRoleHomePath(profile, officeId), { replace: true });
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col transition-colors">
      {/* Top Bar */}
      <header className="sticky top-0 z-20 pt-safe bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-b border-slate-200 dark:border-slate-800">
        <div className="max-w-4xl mx-auto h-14 px-4 sm:px-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-base font-bold text-[#0b6b4f] dark:text-[#4fd1a1] font-display whitespace-nowrap shrink-0">
              EMS
            </span>
            <span className="text-slate-300 dark:text-slate-700" aria-hidden="true">/</span>
            <span className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">
              অফিস নির্বাচন
            </span>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={toggleTheme}
              aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
              className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b6b4f] dark:focus-visible:ring-[#4fd1a1]"
            >
              {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="min-h-[44px] px-3 inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b6b4f] dark:focus-visible:ring-[#4fd1a1]"
            >
              <LogOut className="w-4 h-4" />
              <span>Sign Out</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 w-full max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-10 pb-safe space-y-6">
        <section className="rounded-[22px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 sm:p-6 space-y-2">
          <div className="text-xs font-semibold text-[#0b6b4f] dark:text-[#4fd1a1]">
            {roleLabel}
          </div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100 font-display">
            কাজের জন্য অফিস নির্বাচন করুন
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
            স্বাগতম, <span className="font-semibold text-slate-900 dark:text-white">{profile?.name}</span>
            {profile?.designation ? ` (${profile.designation})` : ''}। আপনার মূল ও অতিরিক্ত দায়িত্বপ্রাপ্ত অফিসগুলোর মধ্যে যেটিতে কাজ করতে চান সেটি নির্বাচন করুন।
          </p>
        </section>

        <section aria-label="Assigned offices" className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {assignedOffices.map((item) => {
            const { office, isPrimary } = item;
            const subCount = upazilaCounts.get(office.id) || 0;
            const isCurrentlyActive = activeOfficeId === office.id;

            return (
              <button
                key={office.id}
                type="button"
                onClick={() => handleSelect(office.id)}
                className={`group text-left rounded-[20px] border p-5 flex flex-col justify-between gap-4 transition-all min-h-[168px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b6b4f] dark:focus-visible:ring-[#4fd1a1] ${
                  isCurrentlyActive
                    ? 'bg-[#0b6b4f]/5 dark:bg-[#4fd1a1]/10 border-[#0b6b4f] dark:border-[#4fd1a1] shadow-xs'
                    : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-[#0b6b4f]/60 dark:hover:border-[#4fd1a1]/60 hover:shadow-xs'
                }`}
              >
                <div className="space-y-3 w-full">
                  <div className="flex items-start justify-between gap-3">
                    <div
                      className={`w-11 h-11 rounded-[14px] flex items-center justify-center shrink-0 ${
                        isPrimary
                          ? 'bg-[#0b6b4f]/10 dark:bg-[#4fd1a1]/15 text-[#0b6b4f] dark:text-[#4fd1a1]'
                          : 'bg-amber-500/10 dark:bg-amber-400/15 text-amber-700 dark:text-amber-300'
                      }`}
                    >
                      <Building2 className="w-5 h-5" />
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {isCurrentlyActive && (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#0b6b4f] dark:text-[#4fd1a1]">
                          <CheckCircle2 className="w-4 h-4" />
                          <span>বর্তমান অফিস</span>
                        </span>
                      )}
                      <span
                        className={`text-xs font-semibold px-2.5 py-1 rounded-[10px] ${
                          isPrimary
                            ? 'bg-[#0b6b4f]/10 dark:bg-[#4fd1a1]/15 text-[#0b6b4f] dark:text-[#4fd1a1]'
                            : 'bg-amber-100/80 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300'
                        }`}
                      >
                        {isPrimary ? 'মূল দায়িত্ব' : 'অতিরিক্ত দায়িত্ব'}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 leading-snug group-hover:text-[#0b6b4f] dark:group-hover:text-[#4fd1a1] transition-colors">
                      {office.name}
                    </h2>
                    <div className="text-xs text-slate-500 dark:text-slate-400 flex items-start gap-1.5">
                      <MapPin className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
                      <span>{office.address || 'ঠিকানা নির্ধারিত নয়'}</span>
                    </div>
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-100 dark:border-slate-800 w-full flex items-center justify-between gap-2 text-xs">
                  <div className="text-slate-500 dark:text-slate-400 tabular-nums">
                    <span>{formatOfficeLevel(office.level)}</span>
                    <span aria-hidden="true"> · </span>
                    <span>
                      {subCount > 0 ? `${subCount}টি অধীনস্থ অফিস` : 'শুধুমাত্র নিজ অফিস'}
                    </span>
                  </div>
                  <span className="inline-flex items-center gap-1 font-semibold text-[#0b6b4f] dark:text-[#4fd1a1] shrink-0">
                    <span>প্রবেশ করুন</span>
                    <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
                  </span>
                </div>
              </button>
            );
          })}
        </section>
      </main>
    </div>
  );
}
