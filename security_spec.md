# EMS Security Specification

## 1. Data Invariants
1. **Role & Approval Integrity**: Self-registered users can only create their own `users/{uid}` document while `settings/app.registrationOpen == true`, with `role == 'employee'` and `approvalStatus == 'pending'`. Only `super_admin` may approve users or assign roles.
2. **Temporal Integrity**: All attendance `checkIn.time` and `checkOut.time` values must equal `request.time` (Firestore server timestamp). Client clocks are never trusted.
3. **Device Binding Integrity**: Attendance `create` and `update` (check-out) require `deviceId == users/{uid}.boundDeviceId`. Employees cannot overwrite an already-bound `boundDeviceId`.
4. **Resigned & Unapproved Blocking**: Users with `approvalStatus != 'approved'` or `status != 'active'` cannot create or update attendance, leaves, or field duties.
5. **Hierarchy Isolation**: `office_head` can read only their own `officeId`; `district_officer` can read/settle only their own `officeId` and child upazila offices (`districtOfficeId == officer.officeId`); `head_office` can read only `reports`; `auditLogs` are strictly append-only (`update` and `delete` denied).
6. **Storage Isolation**: Employees can upload attendance selfies only to `attendance/{uid}/...` and cannot read others' attendance selfies. Only `district_officer` (for their scope) and `super_admin` can read/delete attendance selfies. Profile photos under `profiles/{uid}.jpg` are writable only by the owner or `super_admin`.

## 2. Dirty Dozen Adversarial Payloads
1. **Self-Privilege Escalation on Signup**: `users/u1` create with `{ role: 'super_admin', approvalStatus: 'approved' }` -> **DENIED**.
2. **Closed Registration Bypass**: `users/u2` create when `settings/app.registrationOpen == false` -> **DENIED**.
3. **Device Spoofing Check-In**: `attendance/u1_2026-11-15` create with `checkIn.deviceId: 'other-device'` -> **DENIED**.
4. **Clock Manipulation Check-In**: `attendance/u1_2026-11-15` create with `checkIn.time: <client timestamp != request.time>` -> **DENIED**.
5. **Unapproved User Check-In**: `attendance/u3_2026-11-15` create when `users/u3.approvalStatus == 'pending'` -> **DENIED**.
6. **Cross-User Attendance Read**: Employee `u1` reading `attendance/u2_2026-11-15` -> **DENIED**.
7. **Shadow Ghost Field Injection**: `attendance/u1_2026-11-15` create with extra field `isBypass: true` -> **DENIED**.
8. **Office Head Attempting Settlement**: `office_head` updating `attendance/u1_2026-11-15.finalStatus = 'On Time'` -> **DENIED**.
9. **Cross-District Settlement**: `district_officer` of District A settling an employee in District B -> **DENIED**.
10. **Audit Log Tampering**: Any user (even `super_admin`) updating or deleting `auditLogs/log1` -> **DENIED**.
11. **Self-Approving Leave**: Employee creating `leaves/l1` with `status: 'approved'` -> **DENIED**.
12. **Head Office Modifying Reports**: `head_office` creating or updating `reports/r1` -> **DENIED**.
