import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  Clock,
  CalendarDays,
  FileText,
  CheckSquare,
  ClipboardCheck,
  BarChart3,
  Building2,
  Users,
  CalendarOff,
  LayoutDashboard,
  LogOut,
  Eye
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { getTodayDhaka, formatDisplayDate } from '../utils/dhakaTime.js';

const ROUTE_TITLES = {
  '/employee': 'Daily Attendance',
  '/employee/history': 'Attendance History',
  '/employee/requests': 'Leave & Field Duty',
  '/office-head': 'Office Attendance',
  '/district': 'Settlement Dashboard',
  '/district/approvals': 'Leave & Field Approvals',
  '/district/reports': 'Monthly Reports',
  '/head-office': 'Submitted Reports',
  '/admin': 'Super Admin',
  '/admin/offices': 'Offices',
  '/admin/users': 'Users & Devices',
  '/admin/holidays': 'Holidays'
};

export default function AppShell({ title, children }) {
  const { profile, userOffice, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const syncOnline = () => setIsOnline(navigator.onLine);
    window.addEventListener('online', syncOnline);
    window.addEventListener('offline', syncOnline);
    return () => {
      window.removeEventListener('online', syncOnline);
      window.removeEventListener('offline', syncOnline);
    };
  }, []);

  const currentTitle = title || ROUTE_TITLES[location.pathname] || 'EMS';
  const todayDisplay = useMemo(() => formatDisplayDate(getTodayDhaka()), []);

  const roleTitle = useMemo(() => {
    const map = {
      employee: 'Employee Portal',
      office_head: 'Upazila Office Head',
      district_officer: 'District Office',
      head_office: 'Head Office (DG)',
      super_admin: 'Super Admin'
    };
    return map[profile?.role] || 'EMS Portal';
  }, [profile?.role]);

  const navItems = useMemo(() => {
    const role = profile?.role;
    if (role === 'employee') {
      return [
        { to: '/employee', label: 'Attendance', shortLabel: 'Today', Icon: Clock },
        { to: '/employee/history', label: 'Monthly History', shortLabel: 'History', Icon: CalendarDays },
        { to: '/employee/requests', label: 'Leave & Field Duty', shortLabel: 'Requests', Icon: FileText }
      ];
    }
    if (role === 'office_head') {
      return [{ to: '/office-head', label: 'Office Attendance', shortLabel: 'Attendance', Icon: Eye }];
    }
    if (role === 'district_officer') {
      return [
        { to: '/district', label: 'Settlement', shortLabel: 'Settle', Icon: CheckSquare },
        { to: '/district/approvals', label: 'Approvals', shortLabel: 'Approve', Icon: ClipboardCheck },
        { to: '/district/reports', label: 'Monthly Reports', shortLabel: 'Reports', Icon: BarChart3 }
      ];
    }
    if (role === 'head_office') {
      return [{ to: '/head-office', label: 'Submitted Reports', shortLabel: 'Reports', Icon: BarChart3 }];
    }
    if (role === 'super_admin') {
      return [
        { to: '/admin', label: 'Overview', shortLabel: 'Home', Icon: LayoutDashboard },
        { to: '/admin/offices', label: 'Offices', shortLabel: 'Offices', Icon: Building2 },
        { to: '/admin/users', label: 'Users & Devices', shortLabel: 'Users', Icon: Users },
        { to: '/admin/holidays', label: 'Holidays', shortLabel: 'Holidays', Icon: CalendarOff }
      ];
    }
    return [];
  }, [profile?.role]);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col lg:flex-row">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:fixed lg:inset-y-0 bg-white border-r border-slate-200 z-30">
        <div className="px-5 py-5 border-b border-slate-100">
          <div className="text-lg font-bold tracking-tight text-emerald-800 font-display">EMS Bangladesh</div>
          <div className="text-xs text-slate-500 mt-1 truncate">{roleTitle}</div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const active = location.pathname === item.to;
            const Icon = item.Icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                  active ? 'bg-emerald-50 text-emerald-800' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <Icon className="w-5 h-5 shrink-0" />
                <span className="truncate">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-100 space-y-3">
          <div className="text-xs text-slate-600">
            <div className="font-semibold text-slate-900 truncate">{profile?.name}</div>
            <div className="truncate text-slate-500">{profile?.designation}</div>
            {userOffice && <div className="truncate text-slate-500 mt-0.5">{userOffice.name}</div>}
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="w-full min-h-[44px] flex items-center justify-center gap-2 px-3 py-2 rounded-xl border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-100 transition-colors"
          >
            <LogOut className="w-4 h-4" />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Main Column */}
      <div className="flex-1 flex flex-col lg:pl-64 min-w-0">
        {/* Mobile & Tablet Top Bar (56px compact) */}
        <header className="sticky top-0 z-30 h-14 bg-white/95 backdrop-blur-md border-b border-slate-200 px-4 flex items-center justify-between gap-4 lg:hidden">
          <div className="min-w-0 flex items-center gap-2">
            <span className="text-base font-bold text-emerald-800 font-display whitespace-nowrap shrink-0">EMS</span>
            <span className="text-slate-300" aria-hidden="true">/</span>
            <span className="text-sm font-semibold text-slate-800 truncate">{currentTitle}</span>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            aria-label="Sign Out"
            className="min-h-[44px] min-w-[44px] flex items-center justify-end gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 shrink-0"
          >
            <LogOut className="w-4 h-4" />
            <span>Exit</span>
          </button>
        </header>

        {/* Desktop Top Bar */}
        <header className="hidden lg:flex h-14 bg-white border-b border-slate-200 px-8 items-center justify-between gap-8 sticky top-0 z-20">
          <h1 className="text-base font-semibold text-slate-900 whitespace-nowrap">{currentTitle}</h1>
          <div className="flex items-center gap-3 text-xs text-slate-500 tabular-nums">
            <span>{todayDisplay}</span>
            <span aria-hidden="true">·</span>
            <span>Asia/Dhaka</span>
          </div>
        </header>

        {/* Offline Warning Banner (Bangla) */}
        {!isOnline && (
          <div className="bg-rose-700 text-white px-4 py-2.5 text-xs font-medium text-center" role="alert">
            ইন্টারনেট সংযোগ নেই। অনলাইনে যুক্ত হয়ে পুনরায় চেষ্টা করুন।
          </div>
        )}

        {/* Content Area */}
        <main className="flex-1 w-full max-w-6xl mx-auto px-4 py-4 pb-24 lg:px-8 lg:py-6 lg:pb-10">
          {children}
        </main>
      </div>

      {/* Mobile Fixed Bottom Navigation Bar */}
      {navItems.length > 0 && (
        <nav
          className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200 pb-safe"
          aria-label="Primary Navigation"
        >
          <div
            className="grid items-center h-16"
            style={{ gridTemplateColumns: `repeat(${navItems.length}, minmax(0, 1fr))` }}
          >
            {navItems.map((item) => {
              const active = location.pathname === item.to;
              const Icon = item.Icon;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={`min-h-[44px] flex flex-col items-center justify-center px-1 transition-colors ${
                    active ? 'text-emerald-700 font-semibold' : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  <Icon className="w-5 h-5" />
                  <span className="text-[11px] leading-tight mt-1 truncate max-w-full">
                    {item.shortLabel || item.label}
                  </span>
                </Link>
              );
            })}
          </div>
        </nav>
      )}
    </div>
  );
}
