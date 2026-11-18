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

function ProtectedRoute({ roles, allowPending = false, requireActiveOffice = false, children }) {
  const {
    isAuthenticated,
    firebaseUser,
    needsProfileSetup,
    isApproved,
    profile,
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
  if (roles && !roles.includes(profile.role)) {
    return <Navigate to={getRoleHomePath(profile)} replace />;
  }
  if (requireActiveOffice && profile.role === 'district_officer' && hasMultipleOffices && !activeOfficeId) {
    return <Navigate to="/select-office" replace />;
  }
  return children;
}

export default function App() {
  const { authReady } = useAuth();

  if (!authReady) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="text-sm font-medium text-slate-600">লোড হচ্ছে...</div>
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

        {/* Employee */}
        <Route
          path="/employee"
          element={
            <ProtectedRoute roles={['employee']}>
              <EmployeeHomePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/employee/history"
          element={
            <ProtectedRoute roles={['employee']}>
              <EmployeeHistoryPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/employee/requests"
          element={
            <ProtectedRoute roles={['employee']}>
              <EmployeeRequestsPage />
            </ProtectedRoute>
          }
        />

        {/* Office Head (Upazila - View Only) */}
        <Route
          path="/office-head"
          element={
            <ProtectedRoute roles={['office_head']}>
              <OfficeHeadPage />
            </ProtectedRoute>
          }
        />

        <Route
          path="/select-office"
          element={
            <ProtectedRoute roles={['district_officer']}>
              <OfficeSelectPage />
            </ProtectedRoute>
          }
        />

        {/* District Officer */}
        <Route
          path="/district"
          element={
            <ProtectedRoute roles={['district_officer']} requireActiveOffice>
              <DistrictSettlementPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/district/approvals"
          element={
            <ProtectedRoute roles={['district_officer']} requireActiveOffice>
              <DistrictApprovalsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/district/reports"
          element={
            <ProtectedRoute roles={['district_officer']} requireActiveOffice>
              <DistrictReportsPage />
            </ProtectedRoute>
          }
        />

        {/* Head Office (DG - Read-only Reports) */}
        <Route
          path="/head-office"
          element={
            <ProtectedRoute roles={['head_office']}>
              <HeadOfficeReportsPage />
            </ProtectedRoute>
          }
        />

        {/* Super Admin */}
        <Route
          path="/admin"
          element={
            <ProtectedRoute roles={['super_admin']}>
              <SuperAdminDashboardPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/offices"
          element={
            <ProtectedRoute roles={['super_admin']}>
              <AdminOfficesPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/users"
          element={
            <ProtectedRoute roles={['super_admin']}>
              <AdminUsersPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/additional-charge"
          element={
            <ProtectedRoute roles={['super_admin']}>
              <AdminAdditionalChargePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/holidays"
          element={
            <ProtectedRoute roles={['super_admin']}>
              <AdminHolidaysPage />
            </ProtectedRoute>
          }
        />

        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </HashRouter>
  );
}
