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
  ChevronRight,
  ClipboardCheck,
  Clock,
  FileText,
  History,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  MoreHorizontal,
  ShieldAlert,
  ShieldCheck,
  Sun,
  Users
} from 'lucide-react';
import BottomSheet from './users/BottomSheet.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { getTodayDhaka, formatDisplayDate } from '../utils/dhakaTime.js';
import { useTheme } from '../utils/theme.js';

const ROUTE_TITLES = {
  '/employee': 'Daily Attendance',
  '/employee/history': 'Attendance History',
  '/employee/requests': 'Leave & Field Duty',
  '/employees': 'Employees',
  '/office-head': 'Office Portal',
  '/select-office': 'অফিস নির্বাচন',
  '/district': 'Settlement Dashboard',
  '/district/approvals': 'Leave & Field Approvals',
  '/district/reports': 'Monthly Reports',
  '/head-office': 'Head Office Oversight',
  '/audit': 'Audit Trail',
  '/admin': 'Admin',
  '/admin/offices': 'Offices',
  '/upazila-offices': 'উপজেলা অফিস',
  '/admin/users': 'Users & Devices',
  '/assignments': 'দায়িত্ব ও সংযুক্তি',
  '/admin/additional-charge': 'দায়িত্ব ও সংযুক্তি',
  '/admin/holidays': 'Holidays',
  '/admin/permissions': 'Role Manager'
};

export default function AppShell({ title, showThemeToggle = false, children }) {
  const {
    profile,
    isBootstrapSuperAdmin,
    roleMeta,
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
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
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
    setMobileMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const mq = window.matchMedia('(min-width: 1024px)');
    const handleChange = (e) => {
      if (e.matches) setMobileMenuOpen(false);
    };
    mq.addEventListener('change', handleChange);
    return () => mq.removeEventListener('change', handleChange);
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

  const navRoleFlags = useMemo(() => {
    const reportScope = permissionScope('report.view');
    const reportCreateScope = permissionScope('report.create');
    const isTechnicalAdmin =
      isBootstrapSuperAdmin ||
      Boolean(roleMeta?.isSuper) ||
      can('settings.manage') ||
      can('office.manage');
    const isSubtreeManager = !isTechnicalAdmin && can('attendance.settle');
    const isOfficePortal =
      !isTechnicalAdmin &&
      !isSubtreeManager &&
      (reportCreateScope === 'office' || (can('leave.review') && reportScope === 'office'));
    const isAllOversight =
      !isTechnicalAdmin &&
      !isSubtreeManager &&
      !isOfficePortal &&
      (reportScope === 'all' || permissionScope('attendance.view') === 'all');
    const hasUserManagementPerm =
      can('user.create') ||
      can('user.approve') ||
      can('user.resetDevice') ||
      can('user.edit') ||
      can('user.role.assign') ||
      can('user.delete');
    const isDirectoryRole = !isTechnicalAdmin || can('user.view');
    return {
      isTechnicalAdmin,
      isSubtreeManager,
      isOfficePortal,
      isAllOversight,
      hasUserManagementPerm,
      isDirectoryRole
    };
  }, [isBootstrapSuperAdmin, roleMeta, can, permissionScope]);

  const navItems = useMemo(() => {
    const items = [];
    const seen = new Set();
    const pushItem = (item) => {
      if (seen.has(item.to)) return;
      seen.add(item.to);
      items.push(item);
    };

    const {
      isTechnicalAdmin,
      isSubtreeManager,
      isOfficePortal,
      isAllOversight,
      hasUserManagementPerm,
      isDirectoryRole
    } = navRoleFlags;

    if (isTechnicalAdmin) {
      if (can('settings.manage') || can('attendance.photo.purge')) {
        pushItem({ to: '/admin', label: 'Overview', shortLabel: 'Home', Icon: LayoutDashboard });
      }
      if (can('office.manage')) {
        pushItem({ to: '/admin/offices', label: 'Offices', shortLabel: 'Office', Icon: Building2 });
      }
      if (can('user.view')) {
        pushItem({ to: '/admin/users', label: 'Users & Devices', shortLabel: 'User', Icon: Users });
      }
      if (can('assignment.manage')) {
        pushItem({ to: '/assignments', label: 'দায়িত্ব ও সংযুক্তি', shortLabel: 'Charge', Icon: Briefcase });
      }
      if (can('holiday.manage')) {
        pushItem({ to: '/admin/holidays', label: 'Holidays', shortLabel: 'Holidays', Icon: CalendarOff });
      }
      if (can('settings.manage')) {
        pushItem({ to: '/admin/permissions', label: 'Role Manager', shortLabel: 'Permission', Icon: ShieldCheck });
      }
      if (can('audit.view')) {
        pushItem({ to: '/audit', label: 'Audit Trail', shortLabel: 'Audit', Icon: History });
      }
    } else if (isSubtreeManager) {
      if (can('attendance.settle')) {
        pushItem({ to: '/district', label: 'Settlement', shortLabel: 'Settle', Icon: CheckSquare });
      }
      if (can('fieldduty.review') || can('leave.review')) {
        pushItem({ to: '/district/approvals', label: 'Approvals', shortLabel: 'Application', Icon: ClipboardCheck });
      }
      if (can('report.create')) {
        pushItem({ to: '/district/reports', label: 'Monthly Reports', shortLabel: 'Dashboard', Icon: BarChart3 });
      }
      pushItem({ to: '/employees', label: 'Employees', shortLabel: 'Employee', Icon: Users });
      if (can('user.view') && hasUserManagementPerm) {
        pushItem({ to: '/admin/users', label: 'Users & Devices', shortLabel: 'Users', Icon: Users });
      }
      if (can('audit.view')) {
        pushItem({ to: '/audit', label: 'Audit Trail', shortLabel: 'Audit', Icon: History });
      }
    } else if (isOfficePortal) {
      if (can('report.create') || can('leave.review') || can('attendance.view')) {
        pushItem({ to: '/office-head', label: 'Office Portal', shortLabel: 'Dashboard', Icon: LayoutDashboard });
      }
      pushItem({ to: '/employees', label: 'Employees', shortLabel: 'Employee', Icon: Users });
      if (can('leave.review') || can('fieldduty.review')) {
        pushItem({ to: '/district/approvals', label: 'Approvals', shortLabel: 'Application', Icon: ClipboardCheck });
      }
      if (can('report.create')) {
        pushItem({ to: '/district/reports', label: 'Monthly Reports', shortLabel: 'Reports', Icon: BarChart3 });
      }
      if (can('user.view') && hasUserManagementPerm) {
        pushItem({ to: '/admin/users', label: 'Users & Devices', shortLabel: 'Users', Icon: Users });
      }
      if (can('audit.view')) {
        pushItem({ to: '/audit', label: 'Audit Trail', shortLabel: 'Audit', Icon: History });
      }
    } else if (isAllOversight) {
      pushItem({ to: '/head-office', label: 'Oversight Portal', shortLabel: 'Dashboard', Icon: BarChart3 });
      pushItem({ to: '/employees', label: 'Employees', shortLabel: 'Employee', Icon: Users });
      if (can('user.view') && hasUserManagementPerm) {
        pushItem({ to: '/admin/users', label: 'Users & Devices', shortLabel: 'Users', Icon: Users });
      }
      if (can('audit.view')) {
        pushItem({ to: '/audit', label: 'Audit Trail', shortLabel: 'Audit', Icon: History });
      }
    }

    // Dynamic permission-driven extras for any role
    if (can('office.manage')) {
      pushItem({ to: '/admin/offices', label: 'Offices', shortLabel: 'Office', Icon: Building2 });
    } else if (can('office.child.manage')) {
      pushItem({ to: '/upazila-offices', label: 'উপজেলা অফিস', shortLabel: 'Upazila', Icon: Building2 });
    }
    if (can('assignment.manage')) {
      pushItem({ to: '/assignments', label: 'দায়িত্ব ও সংযুক্তি', shortLabel: 'Charge', Icon: Briefcase });
    }
    if (can('holiday.manage')) {
      pushItem({ to: '/admin/holidays', label: 'Holidays', shortLabel: 'Holidays', Icon: CalendarOff });
    }
    if (can('settings.manage')) {
      pushItem({ to: '/admin/permissions', label: 'Role Manager', shortLabel: 'Permission', Icon: ShieldCheck });
    }
    if (can('attendance.settle')) {
      pushItem({ to: '/district', label: 'Settlement', shortLabel: 'Settle', Icon: CheckSquare });
    }
    if (can('fieldduty.review') || can('leave.review')) {
      pushItem({ to: '/district/approvals', label: 'Approvals', shortLabel: 'Application', Icon: ClipboardCheck });
    }
    if (isDirectoryRole) {
      pushItem({ to: '/employees', label: 'Employees', shortLabel: 'Employee', Icon: Users });
    }
    if (can('user.view') && (isTechnicalAdmin || hasUserManagementPerm)) {
      pushItem({ to: '/admin/users', label: 'Users & Devices', shortLabel: 'Users', Icon: Users });
    }
    if (can('report.view') && !isOfficePortal && !isSubtreeManager && !isAllOversight) {
      pushItem({ to: '/head-office', label: 'Reports', shortLabel: 'Reports', Icon: BarChart3 });
    }
    if (can('audit.view')) {
      pushItem({ to: '/audit', label: 'Audit Trail', shortLabel: 'Audit', Icon: History });
    }
    if (can('attendance.checkin')) {
      const hasPrimaryPortal = isTechnicalAdmin || isSubtreeManager || isOfficePortal || isAllOversight;
      pushItem({
        to: '/employee',
        label: hasPrimaryPortal ? 'My Attendance' : 'Attendance',
        shortLabel: 'Today',
        Icon: Clock
      });
      pushItem({
        to: '/employee/history',
        label: 'Monthly History',
        shortLabel: 'History',
        Icon: CalendarDays
      });
    }
    if (can('leave.apply') || can('fieldduty.apply')) {
      const hasPrimaryPortal = isTechnicalAdmin || isSubtreeManager || isOfficePortal || isAllOversight;
      pushItem({
        to: '/employee/requests',
        label: hasPrimaryPortal ? 'My Leave / Field Duty' : 'Leave & Field Duty',
        shortLabel: 'Application',
        Icon: FileText
      });
    }

    return items;
  }, [navRoleFlags, can, permissionScope]);

  const { mobilePrimaryItems, overflowNavItems, isOverflowRouteActive } = useMemo(() => {
    const byPath = new Map(navItems.map((item) => [item.to, item]));
    const picked = [];
    const pick = (to, shortLabelOverride, IconOverride) => {
      const base = byPath.get(to);
      if (!base || picked.some((p) => p.to === to)) return;
      picked.push({
        ...base,
        shortLabel: shortLabelOverride || base.shortLabel || base.label,
        Icon: IconOverride || base.Icon
      });
    };

    const { isTechnicalAdmin, isSubtreeManager, isOfficePortal, isAllOversight } = navRoleFlags;

    if (isTechnicalAdmin) {
      pick('/admin/offices', 'Office', Building2);
      pick('/admin/users', 'User', Users);
      pick('/admin', 'Home', LayoutDashboard);
      pick('/admin/permissions', 'Permission', ShieldCheck);
    } else if (isSubtreeManager || isOfficePortal) {
      pick('/employees', 'Employee', Users);
      if (byPath.has('/district/approvals')) {
        pick('/district/approvals', 'Application', ClipboardCheck);
      } else {
        pick('/employee/requests', 'Application', FileText);
      }

      if (isOfficePortal) {
        if (byPath.has('/office-head')) {
          pick('/office-head', 'Dashboard', LayoutDashboard);
        } else if (byPath.has('/district/reports')) {
          pick('/district/reports', 'Dashboard', BarChart3);
        }
      } else {
        if (byPath.has('/district/reports')) {
          pick('/district/reports', 'Dashboard', BarChart3);
        } else if (byPath.has('/office-head')) {
          pick('/office-head', 'Dashboard', LayoutDashboard);
        }
      }

      if (can('attendance.settle')) {
        pick('/district', 'Settle', CheckSquare);
      }
    } else if (isAllOversight) {
      pick('/employees', 'Employee', Users);
      pick('/head-office', 'Dashboard', BarChart3);
      pick('/audit', 'Audit', History);
      pick('/employee', 'Today', Clock);
    } else {
      pick('/employees', 'Employee', Users);
      pick('/employee/history', 'History', CalendarDays);
      pick('/employee', 'Today', Clock);
      pick('/employee/requests', 'Application', FileText);
    }

    if (picked.length < 2) {
      for (const item of navItems) {
        if (picked.length >= 4) break;
        if (!picked.some((p) => p.to === item.to)) {
          picked.push(item);
        }
      }
    }

    const pickedPaths = new Set(picked.map((p) => p.to));
    const overflow = navItems.filter((item) => !pickedPaths.has(item.to));
    const overflowActive = overflow.some((item) => item.to === location.pathname);

    return {
      mobilePrimaryItems: picked,
      overflowNavItems: overflow,
      isOverflowRouteActive: overflowActive
    };
  }, [navItems, navRoleFlags, can, location.pathname]);

  const handleLogout = async () => {
    setMobileMenuOpen(false);
    await logout();
    navigate('/login');
  };

  const chargeBadgeLabel =
    activeChargeType === 'acting'
      ? 'চলতি দায়িত্ব'
      : activeChargeType === 'additional'
      ? 'অতিরিক্ত দায়িত্ব'
      : 'মূল দায়িত্ব';
  const chargeBadgeTextClass =
    activeChargeType === 'acting'
      ? 'text-sky-700 dark:text-sky-300'
      : activeChargeType === 'additional'
      ? 'text-amber-700 dark:text-amber-300'
      : 'text-[#0b6b4f] dark:text-[#4fd1a1]';

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
                  <div className={`text-[11px] font-semibold ${chargeBadgeTextClass}`}>
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
          <div className="h-14 px-3 sm:px-4 flex items-center justify-between gap-2">
            <div className="min-w-0 flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setMobileMenuOpen(true)}
                aria-label="Open navigation menu"
                aria-expanded={mobileMenuOpen}
                aria-controls="mobile-navigation-menu"
                className="min-h-[44px] min-w-[44px] -ml-1 inline-flex items-center justify-center rounded-xl text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b6b4f] dark:focus-visible:ring-[#4fd1a1]"
              >
                <Menu className="w-5 h-5" />
              </button>
              <span className="text-base font-bold text-[#0b6b4f] dark:text-[#4fd1a1] font-display whitespace-nowrap shrink-0">
                EMS
              </span>
              <span className="text-slate-300 dark:text-slate-700 shrink-0" aria-hidden="true">/</span>
              <span className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">{currentTitle}</span>
            </div>
            <div className="flex items-center gap-1 shrink-0">
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
                className="min-h-[44px] min-w-[44px] px-2.5 flex items-center justify-center gap-1.5 rounded-xl text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b6b4f] dark:focus-visible:ring-[#4fd1a1]"
              >
                <LogOut className="w-4 h-4 shrink-0" />
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
                <span className={chargeBadgeTextClass}>
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
      {(mobilePrimaryItems.length > 0 || navItems.length > 0) && (
        <nav
          className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-slate-200 dark:border-slate-800 pb-safe"
          aria-label="Primary Navigation"
        >
          <div
            className="grid items-center h-16"
            style={{
              gridTemplateColumns: `repeat(${mobilePrimaryItems.length + 1}, minmax(0, 1fr))`
            }}
          >
            {mobilePrimaryItems.map((item) => {
              const active = location.pathname === item.to;
              const Icon = item.Icon;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  aria-current={active ? 'page' : undefined}
                  className={`relative min-h-[44px] h-full flex flex-col items-center justify-center px-1 sm:px-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0b6b4f] dark:focus-visible:ring-[#4fd1a1] ${
                    active
                      ? 'text-[#0b6b4f] dark:text-[#4fd1a1] font-semibold'
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                  }`}
                >
                  {active && (
                    <span
                      aria-hidden="true"
                      className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full bg-[#0b6b4f] dark:bg-[#4fd1a1]"
                    />
                  )}
                  <Icon className="w-5 h-5 shrink-0" />
                  <span className="text-[10.5px] sm:text-[11px] leading-tight mt-1 truncate max-w-full whitespace-nowrap">
                    {item.shortLabel || item.label}
                  </span>
                </Link>
              );
            })}

            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="More navigation links"
              aria-expanded={mobileMenuOpen}
              aria-controls="mobile-navigation-menu"
              className={`relative min-h-[44px] h-full flex flex-col items-center justify-center px-1 sm:px-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0b6b4f] dark:focus-visible:ring-[#4fd1a1] ${
                mobileMenuOpen || isOverflowRouteActive
                  ? 'text-[#0b6b4f] dark:text-[#4fd1a1] font-semibold'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              {(mobileMenuOpen || isOverflowRouteActive) && (
                <span
                  aria-hidden="true"
                  className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full bg-[#0b6b4f] dark:bg-[#4fd1a1]"
                />
              )}
              <MoreHorizontal className="w-5 h-5 shrink-0" />
              <span className="text-[10.5px] sm:text-[11px] leading-tight mt-1 truncate max-w-full whitespace-nowrap">
                More
              </span>
            </button>
          </div>
        </nav>
      )}

      {/* Full Mobile Navigation Drawer Sheet */}
      <BottomSheet
        open={mobileMenuOpen}
        onClose={() => setMobileMenuOpen(false)}
        title={profile?.name || 'EMS Menu'}
        subtitle={[roleLabel, profile?.designation].filter(Boolean).join(' · ')}
        maxWidthClass="sm:max-w-lg"
        footer={
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={toggleTheme}
              className="flex-1 min-h-[44px] px-3.5 py-2.5 rounded-[14px] border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/80 inline-flex items-center justify-center gap-2 transition-colors whitespace-nowrap"
            >
              {isDark ? <Sun className="w-4 h-4 shrink-0" /> : <Moon className="w-4 h-4 shrink-0" />}
              <span>{isDark ? 'Light mode' : 'Dark mode'}</span>
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="flex-1 min-h-[44px] px-3.5 py-2.5 rounded-[14px] border border-rose-200 dark:border-rose-900/60 bg-rose-50/70 dark:bg-rose-950/30 text-sm font-semibold text-rose-700 dark:text-rose-300 hover:bg-rose-100/80 dark:hover:bg-rose-950/50 inline-flex items-center justify-center gap-2 transition-colors whitespace-nowrap"
            >
              <LogOut className="w-4 h-4 shrink-0" />
              <span>Sign Out</span>
            </button>
          </div>
        }
      >
        <div id="mobile-navigation-menu" className="space-y-4">
          {(userOffice || hasMultipleOffices) && (
            <div className="rounded-[18px] border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/50 px-4 py-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  {hasMultipleOffices ? `${chargeBadgeLabel} · ${assignedOffices.length}টি অফিস` : 'Assigned office'}
                </div>
                <div className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate mt-0.5">
                  {userOffice?.name || 'অফিস নির্বাচন করুন'}
                </div>
              </div>
              {hasMultipleOffices && (
                <button
                  type="button"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    navigate('/select-office');
                  }}
                  className="min-h-[44px] px-3.5 rounded-[14px] bg-[#0b6b4f]/10 dark:bg-[#4fd1a1]/15 text-xs font-semibold text-[#0b6b4f] dark:text-[#4fd1a1] hover:bg-[#0b6b4f]/15 dark:hover:bg-[#4fd1a1]/25 inline-flex items-center gap-1.5 shrink-0 whitespace-nowrap transition-colors"
                >
                  <ArrowLeftRight className="w-3.5 h-3.5 shrink-0" />
                  <span>পরিবর্তন</span>
                </button>
              )}
            </div>
          )}

          {overflowNavItems.length > 0 && (
            <div className="space-y-1.5">
              <div className="px-1 text-xs font-medium text-slate-500 dark:text-slate-400">
                More links
              </div>
              <nav aria-label="More mobile pages" className="space-y-1.5">
                {overflowNavItems.map((item) => {
                  const active = location.pathname === item.to;
                  const Icon = item.Icon;
                  return (
                    <Link
                      key={item.to}
                      to={item.to}
                      onClick={() => setMobileMenuOpen(false)}
                      aria-current={active ? 'page' : undefined}
                      className={`min-h-[48px] px-3.5 py-2.5 rounded-[14px] flex items-center justify-between gap-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b6b4f] dark:focus-visible:ring-[#4fd1a1] ${
                        active
                          ? 'bg-[#0b6b4f]/10 text-[#0b6b4f] dark:bg-[#4fd1a1]/15 dark:text-[#4fd1a1] font-semibold'
                          : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800/80'
                      }`}
                    >
                      <span className="flex items-center gap-3 min-w-0">
                        <Icon className="w-5 h-5 shrink-0" />
                        <span className="truncate">{item.label}</span>
                      </span>
                      <ChevronRight className="w-4 h-4 shrink-0 opacity-60" aria-hidden="true" />
                    </Link>
                  );
                })}
              </nav>
            </div>
          )}

          {mobilePrimaryItems.length > 0 && (
            <div className="space-y-1.5">
              {overflowNavItems.length > 0 && (
                <div className="px-1 pt-1 text-xs font-medium text-slate-500 dark:text-slate-400">
                  Quick navigation
                </div>
              )}
              <nav aria-label="Primary mobile pages" className="space-y-1.5">
                {mobilePrimaryItems.map((item) => {
                  const active = location.pathname === item.to;
                  const Icon = item.Icon;
                  return (
                    <Link
                      key={item.to}
                      to={item.to}
                      onClick={() => setMobileMenuOpen(false)}
                      aria-current={active ? 'page' : undefined}
                      className={`min-h-[48px] px-3.5 py-2.5 rounded-[14px] flex items-center justify-between gap-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0b6b4f] dark:focus-visible:ring-[#4fd1a1] ${
                        active
                          ? 'bg-[#0b6b4f]/10 text-[#0b6b4f] dark:bg-[#4fd1a1]/15 dark:text-[#4fd1a1] font-semibold'
                          : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800/80'
                      }`}
                    >
                      <span className="flex items-center gap-3 min-w-0">
                        <Icon className="w-5 h-5 shrink-0" />
                        <span className="truncate">{item.label}</span>
                      </span>
                      <ChevronRight className="w-4 h-4 shrink-0 opacity-60" aria-hidden="true" />
                    </Link>
                  );
                })}
              </nav>
            </div>
          )}
        </div>
      </BottomSheet>

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
