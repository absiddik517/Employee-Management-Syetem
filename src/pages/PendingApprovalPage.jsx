import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

export default function PendingApprovalPage() {
  const navigate = useNavigate();
  const { firebaseUser, profile, userOffice, loadUserProfile, getRoleHomePath, logout } = useAuth();
  const [checking, setChecking] = useState(false);

  const isRejected = profile?.approvalStatus === 'rejected';

  const refreshStatus = async () => {
    if (!firebaseUser) return;
    setChecking(true);
    try {
      const p = await loadUserProfile(firebaseUser.uid);
      if (p && p.approvalStatus === 'approved') {
        navigate(getRoleHomePath(p), { replace: true });
      }
    } finally {
      setChecking(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center px-4 py-8">
      <div className="w-full max-w-md mx-auto bg-white rounded-2xl border border-slate-200 p-6 space-y-5">
        <div>
          <div className="text-xs font-semibold text-amber-700">Account Verification</div>
          <h1 className="text-xl font-bold text-slate-900 font-display mt-1">
            {isRejected ? 'Registration Rejected' : 'Pending Super Admin Approval'}
          </h1>
          <p className="text-sm text-slate-600 mt-2 leading-relaxed">
            {isRejected
              ? 'আপনার রেজিস্ট্রেশনটি অনুমোদন করা হয়নি। বিস্তারিত জানতে সুপার অ্যাডমিনের সাথে যোগাযোগ করুন।'
              : 'আপনার অ্যাকাউন্টটি তৈরি হয়েছে এবং সুপার অ্যাডমিনের অনুমোদনের অপেক্ষায় রয়েছে। অনুমোদনের আগে হাজিরা দেওয়া যাবে না।'}
          </p>
        </div>

        {profile && (
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200/80 text-xs space-y-1.5 text-slate-700">
            <div className="font-semibold text-slate-900 text-sm">{profile.name}</div>
            <div>
              {profile.designation} · {userOffice?.name || profile.officeId || 'Office Pending Assignment'}
            </div>
            <div className="font-mono-tabular text-slate-500">
              {profile.email} · {profile.mobile}
            </div>
          </div>
        )}

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={refreshStatus}
            disabled={checking}
            className="flex-1 min-h-[44px] px-4 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold disabled:opacity-60"
          >
            {checking ? 'যাচাই হচ্ছে...' : 'Refresh Status'}
          </button>
          <button
            type="button"
            onClick={handleLogout}
            className="min-h-[44px] px-4 py-2 rounded-xl border border-slate-300 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Sign Out
          </button>
        </div>
      </div>
    </div>
  );
}
