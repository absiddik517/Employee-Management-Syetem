# EMS Security Specification

## 1. Roles, Scopes & Authorization Model
All client UI (`src/lib/permissions.js`), router guards (`src/App.jsx`), Firestore Security Rules (`firestore.rules`), and Storage Security Rules (`storage.rules`) enforce the same **Role + Permission + Scope** model:

- **Roles & Ranks**: `super_admin` (`100`, `all`), `director_general` (`90`, `all`), `head_office_officer` (`80`, `all`), `assistant_director` (`60`, `subtree`), `unfeo` (`40`, `office`), `employee` (`10`, `self`).
- **Legacy Compatibility (`MIGRATION_COMPAT`)**: `head_office` → `director_general`, `district_officer` → `assistant_director`, `office_head` → `unfeo`.
- **Scopes**:
  - `self`: resource belongs to `request.auth.uid`.
  - `office`: resource `officeId` is in caller's `officeId` or `additionalOfficeIds`.
  - `subtree`: resource `officeId` or `districtOfficeId` is in caller's `officeId` or `additionalOfficeIds`.
  - `all`: organization-wide access.

## 2. Data Invariants
1. **Role & Approval Integrity**: Self-registered users may only create their own `users/{uid}` document when `settings/app.registrationOpen == true`, strictly with `role == 'employee'` and `approvalStatus == 'pending'`. Role assignment requires `user.role.assign` (`super_admin` all; `assistant_director` subtree strictly lower rank).
2. **Last-Super-Admin & Privilege Escalation Protection**:
   - No client can delete any `super_admin` document (`allow delete` rejects `normalizeRole(existing().role) == 'super_admin'` and `userId == request.auth.uid`).
   - A `super_admin` cannot demote their own `role` away from `super_admin`.
   - `assistant_director` cannot modify `additionalOfficeIds` (`affectedKeys().hasOnly(...)` excludes `additionalOfficeIds`), cannot edit self or equal/higher ranks, and cannot assign a role `>=` their own rank (`60`).
   - `unfeo` can only update `['approvalStatus', 'boundDeviceId', 'updatedAt']` on lower-rank (`employee`) staff within their own `officeId` / `additionalOfficeIds`.
3. **Strict Approval & Settlement Hierarchy**:
   - **Never-self & strictly higher rank** on all review/settlement writes (`leave.review`, `fieldduty.review`, `attendance.settle`).
   - **Leave chain**: `employee` → `unfeo` (`office`) or `assistant_director` (`subtree`); `unfeo` → `assistant_director` (`subtree`); `assistant_director` → `director_general` (`all`).
   - **Field duty & Attendance settlement**: `employee` and `unfeo` → `assistant_director` (`subtree`) only. `unfeo`, `head_office_officer`, `director_general`, and `super_admin` are denied settlement and field duty review.
4. **Super Admin Read-Only Business Boundary**: `super_admin` is denied `attendance.checkin`, `attendance.settle`, `leave.apply`, `leave.review`, `fieldduty.apply`, `fieldduty.review`, and `report.create`.
5. **Temporal & Device Integrity**: Attendance `checkIn.time` and `checkOut.time` must equal `request.time` (Firestore server clock), `accuracy <= 50`, and `deviceId == users/{uid}.boundDeviceId`.
6. **Resigned & Unapproved Blocking**: Users with `approvalStatus != 'approved'` or `status != 'active'` fail `callerRole()` / `isApprovedActiveUser()` and cannot perform privileged reads/writes or punch attendance.
7. **Append-Only Scoped Audit Trail**: `auditLogs` requires `actorUid == request.auth.uid` and `timestamp == request.time`; `update` and `delete` are denied for everyone. Reads are granted only to `super_admin` (`all`), `director_general` (`all`), and `assistant_director` (`subtree`).
8. **Storage Isolation**: Employees may upload attendance selfies (`<= 2MB`, `image/jpeg`) only to `attendance/{uid}/...` and cannot read others' selfies. Read follows `attendance.photo.view` (`unfeo` `office`, `assistant_director` `subtree`, `super_admin` `all`); delete follows `attendance.settle` (`assistant_director` `subtree`) and `attendance.photo.purge` (`super_admin` `all`). `profiles/{uid}.jpg` is writable only by owner or `user.edit` (`all`).
9. **Runtime Permission Overrides (`settings/permissions`)**: Only `callerRole() == 'super_admin'` with `settings.manage` may write `settings/permissions`, strictly validated against canonical role keys, known permission keys, and scopes `['none', 'self', 'office', 'subtree', 'all']`. `super_admin['settings.manage']` cannot be downgraded from `'all'`, and hierarchy invariants (never-self and strictly higher rank on review/settlement) remain enforced even when review permissions are customized.

## 3. Dirty Dozen Adversarial Payloads
1. **Self-Privilege Escalation on Signup**: `users/u1` create with `{ role: 'super_admin', approvalStatus: 'approved' }` → **DENIED**.
2. **Closed Registration Bypass**: `users/u2` create when `settings/app.registrationOpen == false` → **DENIED**.
3. **Device Spoofing Check-In**: `attendance/u1_2026-11-15` create with `checkIn.deviceId: 'other-device'` → **DENIED**.
4. **Clock Manipulation Check-In**: `attendance/u1_2026-11-15` create with `checkIn.time != request.time` → **DENIED**.
5. **Unapproved or Resigned User Check-In**: `attendance/u3_2026-11-15` create when `approvalStatus == 'pending'` or `status == 'resigned'` → **DENIED**.
6. **Super Admin Business Action**: `super_admin` settling attendance, approving leave, creating a report, or checking in → **DENIED**.
7. **UNFEO Settling Attendance or Reviewing Field Duty / Peer UNFEO Leave**: `unfeo` writing `attendance.settled = true`, updating `fieldDuties`, or approving self/peer `unfeo` leave → **DENIED**.
8. **Assistant Director Self-Approval / Cross-District / Additional-Charge Tampering**: `assistant_director` approving own leave, settling District B attendance, editing `additionalOfficeIds`, or promoting user to `assistant_director`+ → **DENIED**.
9. **Head Office Officer Mutation Attempt**: `head_office_officer` approving leaves, editing users, or creating reports → **DENIED**.
10. **Director General Reviewing Non-AD Leave or Settling Attendance**: `director_general` approving `employee`/`unfeo` leave or settling attendance → **DENIED**.
11. **Last Super Admin Deletion / Self-Demotion**: Deleting any `super_admin` user doc or self-demoting `super_admin` → **DENIED**.
12. **Audit Log Tampering & Unauthorized Audit Read**: Any `update`/`delete` on `auditLogs`, or `unfeo`/`employee`/`head_office_officer` reading `auditLogs` (under defaults) → **DENIED**.
13. **Permission Override Tampering & Admin Lockout**: Non-`super_admin` writing `settings/permissions`, injecting unknown roles/permissions/scopes, or setting `super_admin['settings.manage'] = 'none'` → **DENIED**.
