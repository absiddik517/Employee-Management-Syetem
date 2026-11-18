import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeftRight,
  BarChart3,
  Briefcase,
  Building2,
  CalendarDays,
  CalendarOff,
  CheckSquare,
  ClipboardCheck,
  Clock,
  FileText,
  History,
  LayoutDashboard,
  LogOut,
  Moon,
  ShieldAlert,
  ShieldCheck,
  Sun,
  Users
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { getTodayDhaka, formatDisplayDate } from '../utils/dhakaTime.js';
import { useTheme } from '../utils/theme.js';

const ROUTE_TITLES = {
  '/employee': 'Daily Attendance',
  '/employee/history': 'Attendance History',
  '/employee/requests': 'Leave & Field Duty',
  '/office-head': 'Office Portal',
  '/select-office': 'অফিস নির্বাচন',
  '/district': 'Settlement Dashboard',
  '/district/approvals': 'Leave & Field Approvals',
  '/district/reports': 'Monthly Reports',
  '/head-office': 'Head Office Oversight',
  '/audit': 'Audit Trail',
  '/admin': 'Super Admin',
  '/admin/offices': 'Offices',
  '/admin/users': 'Users & Devices',
  '/admin/additional-charge': 'Additional Charge',
  '/admin/holidays': 'Holidays',
  '/admin/permissions': 'Role Permissions'
};

export default function AppShell({ title, showThemeToggle = false, children }) {
  const {
    profile,
    roleLabel,
    can,
    permissionScope,
    userOffice,
    hasMultipleOffices,
    activeChargeType,
    assignedOffices,
    logout
  } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [unauthorizedToast, setUnauthorizedToast] = useState('');
  const { isDark, toggleTheme } = useTheme();

  useEffect(() => {
    const syncOnline = () => setIsOnline(navigator.onLine);
    window.addEventListener('online', syncOnline);
    window.addEventListener('offline', syncOnline);
    return () => {
      window.removeEventListener('online', syncOnline);
      window.removeEventListener('offline', syncOnline);
    };
  }, []);

  useEffect(() => {
    const msg = location.state?.unauthorizedToast;
    if (!msg) return;
    setUnauthorizedToast(msg);
    const timer = setTimeout(() => setUnauthorizedToast(''), 4000);
    return () => clearTimeout(timer);
  }, [location.state]);

  const currentTitle = title || ROUTE_TITLES[location.pathname] || 'EMS';
  const todayDisplay = useMemo(() => formatDisplayDate(getTodayDhaka()), []);

  const navItems = useMemo(() => {
    const items = [];
    const seen = new Set();
    const pushItem = (item) => {
      if (seen.has(item.to)) return;
      seen.add(item.to);
      items.push(item);
    };

    const reportScope = permissionScope('report.view');
    const isTechnicalAdmin = can('settings.manage') || can('office.manage');
    const isOfficePortal = permissionScope('report.create') === 'office';
    const isSubtreeManager = can('attendance.settle');
    const isAllOversight = !isTechnicalAdmin && reportScope === 'all';

    if (isTechnicalAdmin) {
      pushItem({ to: '/admin', label: 'Overview', shortLabel: 'Home', Icon: LayoutDashboard });
      if (can('office.manage')) {
        pushItem({ to: '/admin/offices', label: 'Offices', shortLabel: 'Offices', Icon: Building2 });
      }
      if (can('user.view')) {
        pushItem({ to: '/admin/users', label: 'Users & Devices', shortLabel: 'Users', Icon: Users });
      }
      if (can('user.edit') && permissionScope('user.edit') === 'all') {
        pushItem({ to: '/admin/additional-charge', label: 'Additional Charge', shortLabel: 'Charge', Icon: Briefcase, desktopOnly: true });
      }
      if (can('holiday.manage')) {
        pushItem({ to: '/admin/holidays', label: 'Holidays', shortLabel: 'Holidays', Icon: CalendarOff, desktopOnly: true });
      }
      if (can('settings.manage')) {
        pushItem({ to: '/admin/permissions', label: 'Role Permissions', shortLabel: 'Perms', Icon: ShieldCheck });
      }
      if (can('audit.view')) {
        pushItem({ to: '/audit', label: 'Audit Trail', shortLabel: 'Audit', Icon: History, desktopOnly: true });
      }
    } else if (isSubtreeManager) {
      pushItem({ to: '/district', label: 'Settlement', shortLabel: 'Settle', Icon: CheckSquare });
      if (can('fieldduty.review') || can('leave.review')) {
        pushItem({ to: '/district/approvals', label: 'Approvals', shortLabel: 'Approve', Icon: ClipboardCheck });
      }
      if (can('report.create')) {
        pushItem({ to: '/district/reports', label: 'Monthly Reports', shortLabel: 'Reports', Icon: BarChart3 });
      }
      if (can('user.view')) {
        pushItem({ to: '/admin/users', label: 'Users & Devices', shortLabel: 'Users', Icon: Users });
      }
      if (can('audit.view')) {
        pushItem({ to: '/audit', label: 'Audit Trail', shortLabel: 'Audit', Icon: History });
      }
    } else if (isOfficePortal) {
      pushItem({ to: '/office-head', label: 'Office Portal', shortLabel: 'Office', Icon: Building2 });
      if (can('user.view')) {
        pushItem({ to: '/admin/users', label: 'Staff & Devices', shortLabel: 'Staff', Icon: Users });
      }
      if (can('audit.view')) {
        pushItem({ to: '/audit', label: 'Audit Trail', shortLabel: 'Audit', Icon: History, desktopOnly: true });
      }
    } else if (isAllOversight) {
      pushItem({ to: '/head-office', label: 'Oversight Portal', shortLabel: 'Oversight', Icon: BarChart3 });
      if (can('user.view')) {
        pushItem({ to: '/admin/users', label: 'Staff Directory', shortLabel: 'Users', Icon: Users });
      }
      if (can('audit.view')) {
        pushItem({ to: '/audit', label: 'Audit Trail', shortLabel: 'Audit', Icon: History });
      }
    }

    // Dynamic permission-driven extras for any role granted additional capabilities
    if (can('office.manage')) {
      pushItem({ to: '/admin/offices', label: 'Offices', shortLabel: 'Offices', Icon: Building2, desktopOnly: true });
    }
    if (can('holiday.manage')) {
      pushItem({ to: '/admin/holidays', label: 'Holidays', shortLabel: 'Holidays', Icon: CalendarOff, desktopOnly: true });
    }
    if (can('settings.manage')) {
      pushItem({ to: '/admin/permissions', label: 'Role Permissions', shortLabel: 'Perms', Icon: ShieldCheck, desktopOnly: true });
    }
    if (can('attendance.settle')) {
      pushItem({ to: '/district', label: 'Settlement', shortLabel: 'Settle', Icon: CheckSquare, desktopOnly: true });
    }
    if (can('fieldduty.review')) {
      pushItem({ to: '/district/approvals', label: 'Approvals', shortLabel: 'Approve', Icon: ClipboardCheck, desktopOnly: true });
    }
    if (can('user.view')) {
      pushItem({ to: '/admin/users', label: 'Staff Directory', shortLabel: 'Users', Icon: Users });
    }
    if (can('report.view') && !isOfficePortal && !isSubtreeManager && !isAllOversight) {
      pushItem({ to: '/head-office', label: 'Reports', shortLabel: 'Reports', Icon: BarChart3 });
    }
    if (can('audit.view')) {
      pushItem({ to: '/audit', label: 'Audit Trail', shortLabel: 'Audit', Icon: History, desktopOnly: true });
    }
    if (can('attendance.checkin')) {
      const hasPrimaryPortal = isTechnicalAdmin || isSubtreeManager || isOfficePortal || isAllOversight;
      pushItem({
        to: '/employee',
        label: hasPrimaryPortal ? 'My Attendance' : 'Attendance',
        shortLabel: hasPrimaryPortal ? 'Punch' : 'Today',
        Icon: Clock,
        desktopOnly: isTechnicalAdmin || isSubtreeManager
      });
      if (!hasPrimaryPortal) {
        pushItem({ to: '/employee/history', label: 'Monthly History', shortLabel: 'History', Icon: CalendarDays });
      }
    }
    if (can('leave.apply') || can('fieldduty.apply')) {
      const hasPrimaryPortal = isTechnicalAdmin || isSubtreeManager || isOfficePortal || isAllOversight;
      pushItem({
        to: '/employee/requests',
        label: hasPrimaryPortal ? 'My Leave / Field Duty' : 'Leave & Field Duty',
        shortLabel: 'Requests',
        Icon: FileText,
        desktopOnly: isTechnicalAdmin || isSubtreeManager || (isAllOversight && can('audit.view'))
      });
    }

    return items;
  }, [can, permissionScope]);

  const mobileNavItems = useMemo(
    () => navItems.filter((item) => !item.desktopOnly).slice(0, 5),
    [navItems]
  );

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const chargeBadgeLabel = activeChargeType === 'additional' ? 'অতিরিক্ত দায়িত্ব' : 'মূল দায়িত্ব';

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col lg:flex-row transition-colors">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:fixed lg:inset-y-0 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 z-30 pt-safe">
        <div className="px-5 py-5 border-b border-slate-100 dark:border-slate-800">
          <div className="text-lg font-bold tracking-tight text-[#0b6b4f] dark:text-[#4fd1a1] font-display">
            EMS Bangladesh
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400 mt-1 truncate">{roleLabel}</div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const active = location.pathname === item.to;
            const Icon = item.Icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`min-h-[44px] flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b6b4f] dark:focus-visible:ring-[#4fd1a1] ${
                  active
                    ? 'bg-[#0b6b4f]/10 text-[#0b6b4f] dark:bg-[#4fd1a1]/15 dark:text-[#4fd1a1]'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Icon className="w-5 h-5 shrink-0" />
                <span className="truncate">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-100 dark:border-slate-800 space-y-3 pb-safe">
          <div className="text-xs text-slate-600 dark:text-slate-300">
            <div className="font-semibold text-slate-900 dark:text-slate-100 truncate">{profile?.name}</div>
            <div className="truncate text-slate-500 dark:text-slate-400">{profile?.designation}</div>
            {userOffice && (
              <div className="mt-1.5 space-y-0.5">
                <div className="truncate font-medium text-slate-700 dark:text-slate-200">{userOffice.name}</div>
                {hasMultipleOffices && (
                  <div
                    className={`text-[11px] font-semibold ${
                      activeChargeType === 'additional'
                        ? 'text-amber-700 dark:text-amber-300'
                        : 'text-[#0b6b4f] dark:text-[#4fd1a1]'
                    }`}
                  >
                    {chargeBadgeLabel} ({assignedOffices.length}টি অফিস)
                  </div>
                )}
              </div>
            )}
          </div>

          {hasMultipleOffices && (
            <button
              type="button"
              onClick={() => navigate('/select-office')}
              className="w-full min-h-[44px] flex items-center justify-center gap-2 px-3 py-2 rounded-xl border border-[#0b6b4f]/30 dark:border-[#4fd1a1]/30 bg-[#0b6b4f]/8 dark:bg-[#4fd1a1]/10 text-xs font-semibold text-[#0b6b4f] dark:text-[#4fd1a1] hover:bg-[#0b6b4f]/15 dark:hover:bg-[#4fd1a1]/20 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b6b4f] dark:focus-visible:ring-[#4fd1a1]"
            >
              <ArrowLeftRight className="w-4 h-4 shrink-0" />
              <span>অফিস পরিবর্তন করুন</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleLogout}
            className="w-full min-h-[44px] flex items-center justify-center gap-2 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b6b4f] dark:focus-visible:ring-[#4fd1a1]"
          >
            <LogOut className="w-4 h-4" />
            <span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* Main Column */}
      <div className="flex-1 flex flex-col lg:pl-64 min-w-0">
        {/* Mobile & Tablet Top Bar */}
        <header className="sticky top-0 z-30 pt-safe bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 lg:hidden">
          <div className="h-14 px-4 flex items-center justify-between gap-2">
            <div className="min-w-0 flex items-center gap-2">
              <span className="text-base font-bold text-[#0b6b4f] dark:text-[#4fd1a1] font-display whitespace-nowrap shrink-0">
                EMS
              </span>
              <span className="text-slate-300 dark:text-slate-700" aria-hidden="true">/</span>
              <span className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">{currentTitle}</span>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {hasMultipleOffices && (
                <button
                  type="button"
                  onClick={() => navigate('/select-office')}
                  aria-label="অফিস পরিবর্তন করুন"
                  className="min-h-[44px] px-2.5 inline-flex items-center gap-1 rounded-xl text-xs font-semibold text-[#0b6b4f] dark:text-[#4fd1a1] hover:bg-[#0b6b4f]/10 dark:hover:bg-[#4fd1a1]/15 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b6b4f] dark:focus-visible:ring-[#4fd1a1]"
                >
                  <ArrowLeftRight className="w-4 h-4 shrink-0" />
                  <span>অফিস</span>
                </button>
              )}
              {showThemeToggle && (
                <button
                  type="button"
                  onClick={toggleTheme}
                  aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
                  className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b6b4f] dark:focus-visible:ring-[#4fd1a1]"
                >
                  {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                </button>
              )}
              <button
                type="button"
                onClick={handleLogout}
                aria-label="Exit"
                className="min-h-[44px] min-w-[44px] px-2 flex items-center justify-center gap-1.5 rounded-xl text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b6b4f] dark:focus-visible:ring-[#4fd1a1]"
              >
                <LogOut className="w-4 h-4" />
                <span>Exit</span>
              </button>
            </div>
          </div>
        </header>

        {/* Desktop Top Bar */}
        <header className="hidden lg:flex pt-safe bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 px-8 items-center justify-between gap-8 sticky top-0 z-20">
          <div className="h-14 w-full flex items-center justify-between gap-8">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-sm font-bold text-[#0b6b4f] dark:text-[#4fd1a1] font-display whitespace-nowrap">
                EMS
              </span>
              <span className="text-slate-300 dark:text-slate-700" aria-hidden="true">/</span>
              <h1 className="text-base font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap truncate">
                {currentTitle}
              </h1>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              {hasMultipleOffices && userOffice && (
                <button
                  type="button"
                  onClick={() => navigate('/select-office')}
                  className="min-h-[44px] px-3 inline-flex items-center gap-2 rounded-xl border border-[#0b6b4f]/30 dark:border-[#4fd1a1]/30 bg-[#0b6b4f]/8 dark:bg-[#4fd1a1]/10 text-xs font-semibold text-[#0b6b4f] dark:text-[#4fd1a1] hover:bg-[#0b6b4f]/15 dark:hover:bg-[#4fd1a1]/20 transition-colors max-w-[260px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b6b4f] dark:focus-visible:ring-[#4fd1a1]"
                >
                  <ArrowLeftRight className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">{userOffice.name}</span>
                </button>
              )}
              <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                <span>{todayDisplay}</span>
                <span aria-hidden="true">·</span>
                <span>Asia/Dhaka</span>
              </div>
              {showThemeToggle && (
                <button
                  type="button"
                  onClick={toggleTheme}
                  aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
                  className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b6b4f] dark:focus-visible:ring-[#4fd1a1]"
                >
                  {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                </button>
              )}
              <button
                type="button"
                onClick={handleLogout}
                aria-label="Exit"
                className="min-h-[44px] px-3 inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b6b4f] dark:focus-visible:ring-[#4fd1a1]"
              >
                <LogOut className="w-4 h-4" />
                <span>Exit</span>
              </button>
            </div>
          </div>
        </header>

        {/* Active Office Strip for Multi-Office Officers (Mobile & Tablet) */}
        {hasMultipleOffices && userOffice && (
          <div className="lg:hidden bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-4 py-2 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                সক্রিয় কর্মক্ষেত্র ·{' '}
                <span
                  className={
                    activeChargeType === 'additional'
                      ? 'text-amber-700 dark:text-amber-300'
                      : 'text-[#0b6b4f] dark:text-[#4fd1a1]'
                  }
                >
                  {chargeBadgeLabel}
                </span>
              </div>
              <div className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
                {userOffice.name}
              </div>
            </div>
            <button
              type="button"
              onClick={() => navigate('/select-office')}
              className="min-h-[44px] px-3 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-semibold text-[#0b6b4f] dark:text-[#4fd1a1] shrink-0 whitespace-nowrap"
            >
              পরিবর্তন করুন
            </button>
          </div>
        )}

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
      {mobileNavItems.length > 0 && (
        <nav
          className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-slate-200 dark:border-slate-800 pb-safe"
          aria-label="Primary Navigation"
        >
          <div
            className="grid items-center h-16"
            style={{ gridTemplateColumns: `repeat(${mobileNavItems.length}, minmax(0, 1fr))` }}
          >
            {mobileNavItems.map((item) => {
              const active = location.pathname === item.to;
              const Icon = item.Icon;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={`min-h-[44px] flex flex-col items-center justify-center px-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b6b4f] dark:focus-visible:ring-[#4fd1a1] ${
                    active
                      ? 'text-[#0b6b4f] dark:text-[#4fd1a1] font-semibold'
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
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

      {/* Unauthorized Route Redirect Toast */}
      {unauthorizedToast && (
        <div
          role="alert"
          className="fixed bottom-20 lg:bottom-6 left-1/2 -translate-x-1/2 z-[120] max-w-[calc(100vw-2rem)] px-4 py-3 rounded-[16px] bg-amber-950 text-amber-100 border border-amber-700 shadow-xl flex items-center gap-2.5 text-sm font-medium"
        >
          {ShieldAlert ? <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" /> : null}
          <span className="truncate">{unauthorizedToast}</span>
        </div>
      )}
    </div>
  );
}
