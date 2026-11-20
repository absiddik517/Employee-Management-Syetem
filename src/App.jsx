import React from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
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
import AdminAdditionalChargePage from './pages/admin/AdminAdditionalChargePage.jsx';
import AdminRolePermissionsPage from './pages/admin/AdminRolePermissionsPage.jsx';
import EmployeeDirectoryPage from './pages/EmployeeDirectoryPage.jsx';
import AuditLogPage from './pages/AuditLogPage.jsx';

function GuestRoute({ children }) {
  const { isAuthenticated, firebaseUser, needsProfileSetup, profile, getRoleHomePath } = useAuth();
  if (isAuthenticated) {
    return <Navigate to={getRoleHomePath(profile)} replace />;
  }
  if (firebaseUser && needsProfileSetup) {
    return <Navigate to="/complete-profile" replace />;
  }
  return children;
}

function MissingProfileRoute({ children }) {
  const { isAuthenticated, firebaseUser, needsProfileSetup, profile, getRoleHomePath } = useAuth();
  if (isAuthenticated) {
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
  const {
    isAuthenticated,
    firebaseUser,
    needsProfileSetup,
    isApproved,
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
    return (
      <Navigate
        to={getRoleHomePath(profile)}
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
  const { authReady } = useAuth();

  if (!authReady) {
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

        {/* Multi-Office Selection (Assistant Director & UNFEO with additional charges) */}
        <Route
          path="/select-office"
          element={
            <ProtectedRoute permission="report.create" requireMultiOffice>
              <OfficeSelectPage />
            </ProtectedRoute>
          }
        />

        {/* Office-scoped Portal (UNFEO) */}
        <Route
          path="/office-head"
          element={
            <ProtectedRoute permissions={['report.create', 'leave.review', 'attendance.view']} requireActiveOffice>
              <OfficeHeadPage />
            </ProtectedRoute>
          }
        />

        {/* Subtree-scoped Portal (Assistant Director) */}
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

        {/* Oversight & DG AD Leave Review (DG & Head Office Officer) */}
        <Route
          path="/head-office"
          element={
            <ProtectedRoute permissions={['report.view', 'attendance.view', 'leave.review']}>
              <HeadOfficeReportsPage />
            </ProtectedRoute>
          }
        />

        {/* Employee Directory (own office & subordinate offices — not user management) */}
        <Route
          path="/employees"
          element={
            <ProtectedRoute>
              <EmployeeDirectoryPage />
            </ProtectedRoute>
          }
        />

        {/* Users & Devices (user management across Super Admin, AD, UNFEO) */}
        <Route
          path="/admin/users"
          element={
            <ProtectedRoute permission="user.view">
              <AdminUsersPage />
            </ProtectedRoute>
          }
        />

        {/* Audit Trail (Super Admin all, DG all, AD subtree) */}
        <Route
          path="/audit"
          element={
            <ProtectedRoute permission="audit.view">
              <AuditLogPage />
            </ProtectedRoute>
          }
        />

        {/* Technical Administration (Super Admin) */}
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
          path="/admin/additional-charge"
          element={
            <ProtectedRoute permission="user.edit" requiredScope="all">
              <AdminAdditionalChargePage />
            </ProtectedRoute>
          }
        />
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
