import React, { useState } from 'react';
import { HashRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';

import LoginPage from './pages/LoginPage.jsx';
import RegisterPage from './pages/RegisterPage.jsx';
import CompleteProfilePage from './pages/CompleteProfilePage.jsx';
import PendingApprovalPage from './pages/PendingApprovalPage.jsx';
import OfficeSelectPage from './pages/OfficeSelectPage.jsx';

import EmployeeHomePage from './pages/employee/EmployeeHomePage.jsx';
import EmployeeHistoryPage from './pages/employee/EmployeeHistoryPage.jsx';
import EmployeeRequestsPage from './pages/employee/EmployeeRequestsPage.jsx';

import OfficeHeadPage from './pages/officehead/OfficeHeadPage.jsx';

import DistrictSettlementPage from './pages/district/DistrictSettlementPage.jsx';
import DistrictApprovalsPage from './pages/district/DistrictApprovalsPage.jsx';
import DistrictReportsPage from './pages/district/DistrictReportsPage.jsx';

import HeadOfficeReportsPage from './pages/headoffice/HeadOfficeReportsPage.jsx';

import SuperAdminDashboardPage from './pages/admin/SuperAdminDashboardPage.jsx';
import AdminOfficesPage from './pages/admin/AdminOfficesPage.jsx';
import AdminUsersPage from './pages/admin/AdminUsersPage.jsx';
import AdminHolidaysPage from './pages/admin/AdminHolidaysPage.jsx';
import AssignmentsManagePage from './pages/AssignmentsManagePage.jsx';
import AdminRolePermissionsPage from './pages/admin/AdminRolePermissionsPage.jsx';
import ChildOfficesPage from './pages/ChildOfficesPage.jsx';
import EmployeeDirectoryPage from './pages/EmployeeDirectoryPage.jsx';
import AuditLogPage from './pages/AuditLogPage.jsx';

function UnassignedRoleScreen() {
  const { firebaseUser, profile, roles, fetchPublicBootstrap, loadUserProfile, logout } = useAuth();
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    if (!firebaseUser?.uid || refreshing) return;
    setRefreshing(true);
    try {
      await fetchPublicBootstrap();
      await loadUserProfile(firebaseUser.uid);
    } finally {
      setRefreshing(false);
    }
  };

  const rawRole = typeof profile?.role === 'string' ? profile.role.trim() : '';

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col justify-center px-4 py-8">
      <div className="w-full max-w-md mx-auto rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-5">
        <div className="space-y-2">
          <div className="text-xs font-semibold text-amber-700 dark:text-amber-300">
            Access Pending Configuration
          </div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100 font-display leading-snug">
            আপনার রোল নির্ধারিত হয়নি, প্রশাসকের সাথে যোগাযোগ করুন
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
            {roles.length === 0
              ? 'সিস্টেমে এখনো কোনো রোল তৈরি করা হয়নি। প্রশাসক রোল কনফিগার করার পর পুনরায় চেষ্টা করুন।'
              : rawRole
              ? `আপনার অ্যাকাউন্টের "${rawRole}" রোলটি বর্তমানে সক্রিয় রোল তালিকায় পাওয়া যায়নি। প্রশাসকের সাথে যোগাযোগ করুন।`
              : 'আপনার অ্যাকাউন্টে এখনো কোনো কার্যকর রোল যুক্ত করা হয়নি।'}
          </p>
        </div>

        <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700 text-xs space-y-1 text-slate-700 dark:text-slate-300">
          <div className="font-semibold text-slate-900 dark:text-slate-100 text-sm">
            {profile?.name || firebaseUser?.email || 'User'}
          </div>
          <div>{firebaseUser?.email || profile?.email || '—'}</div>
          <div className="font-mono-tabular text-slate-500 dark:text-slate-400 break-all">
            UID: {firebaseUser?.uid || profile?.uid || '—'}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={refreshing}
            onClick={handleRefresh}
            className="flex-1 min-h-[44px] px-4 py-2 rounded-xl bg-[#0b6b4f] hover:bg-[#09553f] dark:bg-[#4fd1a1] dark:text-slate-950 text-white text-sm font-semibold disabled:opacity-60 transition-colors"
          >
            {refreshing ? 'যাচাই হচ্ছে...' : 'পুনরায় যাচাই করুন'}
          </button>
          <button
            type="button"
            onClick={() => logout()}
            className="min-h-[44px] px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
          >
            Sign Out
          </button>
        </div>
      </div>
    </div>
  );
}

function GuestRoute({ children }) {
  const {
    isAuthenticated,
    isApproved,
    isBootstrapSuperAdmin,
    roleMeta,
    firebaseUser,
    needsProfileSetup,
    profile,
    getRoleHomePath
  } = useAuth();
  if (isAuthenticated) {
    if (isApproved && !isBootstrapSuperAdmin && !roleMeta) {
      return <UnassignedRoleScreen />;
    }
    return <Navigate to={getRoleHomePath(profile)} replace />;
  }
  if (firebaseUser && needsProfileSetup) {
    return <Navigate to="/complete-profile" replace />;
  }
  return children;
}

function MissingProfileRoute({ children }) {
  const {
    isAuthenticated,
    isApproved,
    isBootstrapSuperAdmin,
    roleMeta,
    firebaseUser,
    needsProfileSetup,
    profile,
    getRoleHomePath
  } = useAuth();
  if (isAuthenticated) {
    if (isApproved && !isBootstrapSuperAdmin && !roleMeta) {
      return <UnassignedRoleScreen />;
    }
    return <Navigate to={getRoleHomePath(profile)} replace />;
  }
  if (!firebaseUser || !needsProfileSetup) {
    return <Navigate to="/login" replace />;
  }
  return children;
}

function ProtectedRoute({
  permission,
  permissions,
  requiredScope,
  requireMultiOffice = false,
  allowPending = false,
  requireActiveOffice = false,
  children
}) {
  const location = useLocation();
  const {
    isAuthenticated,
    firebaseUser,
    needsProfileSetup,
    isApproved,
    isBootstrapSuperAdmin,
    roleMeta,
    profile,
    can,
    permissionScope,
    hasMultipleOffices,
    activeOfficeId,
    getRoleHomePath
  } = useAuth();

  if (firebaseUser && needsProfileSetup && !isAuthenticated) {
    return <Navigate to="/complete-profile" replace />;
  }
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  if (!isApproved) {
    if (allowPending) return children;
    return <Navigate to="/pending" replace />;
  }
  if (isApproved && !isBootstrapSuperAdmin && !roleMeta) {
    return <UnassignedRoleScreen />;
  }
  if (allowPending && isApproved) {
    return <Navigate to={getRoleHomePath(profile)} replace />;
  }

  let permitted = true;
  if (permission) {
    permitted = can(permission);
    if (permitted && requiredScope && permissionScope(permission) !== requiredScope) {
      permitted = false;
    }
  } else if (Array.isArray(permissions) && permissions.length > 0) {
    permitted = permissions.some((p) => can(p));
  }

  if (requireMultiOffice && !hasMultipleOffices) {
    permitted = false;
  }

  if (!permitted) {
    const fallbackPath = getRoleHomePath(profile);
    if (fallbackPath === location.pathname) {
      return <UnassignedRoleScreen />;
    }
    return (
      <Navigate
        to={fallbackPath}
        replace
        state={{ unauthorizedToast: 'এই পৃষ্ঠাটি দেখার অনুমতি আপনার অ্যাকাউন্টে নেই।' }}
      />
    );
  }

  if (requireActiveOffice && hasMultipleOffices && !activeOfficeId) {
    return <Navigate to="/select-office" replace />;
  }

  return children;
}

export default function App() {
  const { authReady, rolesReady, firebaseUser } = useAuth();
  const appReady = authReady && (rolesReady || !firebaseUser);

  if (!appReady) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex items-center justify-center p-6">
        <div className="text-sm font-medium text-slate-600 dark:text-slate-300">লোড হচ্ছে...</div>
      </div>
    );
  }

  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route
          path="/login"
          element={
            <GuestRoute>
              <LoginPage />
            </GuestRoute>
          }
        />
        <Route
          path="/register"
          element={
            <GuestRoute>
              <RegisterPage />
            </GuestRoute>
          }
        />
        <Route
          path="/complete-profile"
          element={
            <MissingProfileRoute>
              <CompleteProfilePage />
            </MissingProfileRoute>
          }
        />
        <Route
          path="/pending"
          element={
            <ProtectedRoute allowPending>
              <PendingApprovalPage />
            </ProtectedRoute>
          }
        />

        {/* Self Attendance & Leave / Field Duty Applications (all non-technical roles) */}
        <Route
          path="/employee"
          element={
            <ProtectedRoute permission="attendance.checkin">
              <EmployeeHomePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/employee/history"
          element={
            <ProtectedRoute permission="attendance.checkin">
              <EmployeeHistoryPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/employee/requests"
          element={
            <ProtectedRoute permissions={['leave.apply', 'fieldduty.apply']}>
              <EmployeeRequestsPage />
            </ProtectedRoute>
          }
        />

        {/* Multi-Office Selection */}
        <Route
          path="/select-office"
          element={
            <ProtectedRoute permission="report.create" requireMultiOffice>
              <OfficeSelectPage />
            </ProtectedRoute>
          }
        />

        {/* Office-scoped Portal */}
        <Route
          path="/office-head"
          element={
            <ProtectedRoute permissions={['report.create', 'leave.review', 'attendance.view']} requireActiveOffice>
              <OfficeHeadPage />
            </ProtectedRoute>
          }
        />

        {/* Subtree-scoped Settlement & Approvals */}
        <Route
          path="/district"
          element={
            <ProtectedRoute permission="attendance.settle" requireActiveOffice>
              <DistrictSettlementPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/district/approvals"
          element={
            <ProtectedRoute permissions={['fieldduty.review', 'leave.review']} requireActiveOffice>
              <DistrictApprovalsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/district/reports"
          element={
            <ProtectedRoute permission="report.create" requireActiveOffice>
              <DistrictReportsPage />
            </ProtectedRoute>
          }
        />

        {/* Oversight & Leave Review */}
        <Route
          path="/head-office"
          element={
            <ProtectedRoute permissions={['report.view', 'attendance.view', 'leave.review']}>
              <HeadOfficeReportsPage />
            </ProtectedRoute>
          }
        />

        {/* Employee Directory (permission-scoped roster) */}
        <Route
          path="/employees"
          element={
            <ProtectedRoute>
              <EmployeeDirectoryPage />
            </ProtectedRoute>
          }
        />

        {/* Users & Devices (permission-scoped user management) */}
        <Route
          path="/admin/users"
          element={
            <ProtectedRoute permission="user.view">
              <AdminUsersPage />
            </ProtectedRoute>
          }
        />

        {/* Child Upazila Office Management */}
        <Route
          path="/upazila-offices"
          element={
            <ProtectedRoute permission="office.child.manage">
              <ChildOfficesPage />
            </ProtectedRoute>
          }
        />

        {/* Audit Trail */}
        <Route
          path="/audit"
          element={
            <ProtectedRoute permission="audit.view">
              <AuditLogPage />
            </ProtectedRoute>
          }
        />

        {/* System Administration */}
        <Route
          path="/admin"
          element={
            <ProtectedRoute permissions={['settings.manage', 'attendance.photo.purge']}>
              <SuperAdminDashboardPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/offices"
          element={
            <ProtectedRoute permission="office.manage">
              <AdminOfficesPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/assignments"
          element={
            <ProtectedRoute permission="assignment.manage">
              <AssignmentsManagePage />
            </ProtectedRoute>
          }
        />
        <Route path="/admin/additional-charge" element={<Navigate to="/assignments" replace />} />
        <Route
          path="/admin/holidays"
          element={
            <ProtectedRoute permission="holiday.manage">
              <AdminHolidaysPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/permissions"
          element={
            <ProtectedRoute permission="settings.manage">
              <AdminRolePermissionsPage />
            </ProtectedRoute>
          }
        />

        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </HashRouter>
  );
}
