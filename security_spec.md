# EMS Security Specification

All client authorization (`src/lib/permissions.js`), router guards (`src/App.jsx`), Firestore Security Rules (`firestore.rules`), and Storage Security Rules (`storage.rules`) enforce the same **data-driven Dynamic Role + Scope + Review Map** security model. **Zero role names, keys, or ranks are hard-coded in rules or client logic.**

---

## 1. Identity, Dynamic Roles & Scopes

1. **Dynamic Role Registry (`/roles/{roleKey}`)**:
   - Every valid role is stored as a `/roles/{roleKey}` document (`^[a-z][a-z0-9_]{1,39}$`) containing `rank`, `isSuper`, `chargeEligible`, `actingEligible`, `homeRoute`, `permissions`, and `review`.
   - Rule writes to `/roles/{roleKey}` are restricted to `isSuperCaller()` (`isBootstrapSuperUser()` or a caller whose assigned role has `isSuper == true`).
   - Validation rejects unknown permission keys, scopes unsupported by a given permission key (from the `PERMISSION_DEFINITIONS` catalog), invalid review scopes (`office` | `subtree` | `all`), or any `isSuper` role without `permissions['settings.manage'] == 'all'`.
   - Only `isBootstrapSuperUser()` (verified Firebase Auth email) can delete an `isSuper` role or un-flag `isSuper: true -> false`. A role assigned to users cannot be deleted cleanly without breaking those users' access; the UI blocks deletion while users reference it.
2. **Bootstrap Super User Identity (`isBootstrapSuperUser()`)**:
   - Strictly bound to verified Firebase Auth email (`request.auth.token.email_verified == true`).
   - Always holds `SUPER_IMPLICIT_PERMISSIONS` with scope `'all'` regardless of `/roles` or `/users` state, guaranteeing zero lockout.
   - Holds **zero business workflow permissions** (`attendance.checkin`, `leave.apply`, `fieldduty.apply`, `leave.review`, `fieldduty.review`, `attendance.settle`, `report.create`) unless explicitly assigned a `/roles/{roleKey}` document on their `/users/{uid}` profile.
3. **Permission Scopes & Office Sets**:
   - `self`: `resource.uid == request.auth.uid`.
   - `office`: target office overlaps caller's authority set `A(caller) = { officeId } ∪ additionalOfficeIds` (or `actingOfficeId` for acting-eligible grants).
   - `subtree`: target `officeId` or `districtOfficeId` overlaps `A(caller)` (or `actingOfficeId`).
   - `all`: organization-wide access.
   - User roster/attendance/leave/fieldDuty/report/audit `allow list` queries enforce static dot-notation field constraints (`uid`, `officeId`, `districtOfficeId`, `homeOfficeId`, `homeDistrictOfficeId`, `checkOutOfficeId`, `checkOutDistrictOfficeId`, `additionalOfficeIds`, `attachedOfficeId`, `actingOfficeId`) so Firestore rules statically verify scoped queries without cross-collection enumeration.
4. **Acting Role Confinement (`hasValidActingCharge()`)**:
   - Evaluated only when `callerData().actingOfficeId` is non-empty and `callerData().actingRoleKey` references an existing role with `actingEligible == true`.
   - Only the 9 permissions in `isActingAllowedPerm()` (`attendance.view`, `attendance.photo.view`, `leave.view`, `report.create`, `report.view`, `user.view`, `user.approve`, `user.resetDevice`, `audit.view`) and `review.*` scopes may be elevated via acting charge, capped strictly to `'office'` or `'subtree'` over `actingOfficeId` (any `'all'` grant on the acting role is ignored for acting evaluation).

---

## 2. Core Data Invariants

1. **Self-Registration & Global Settings (`/settings/app`)**:
   - Only `settings/app` is readable/writable (`settings/permissions` is decommissioned and denied).
   - Self-registration succeeds only when `settings/app.registrationOpen == true`, `settings/app.defaultRole` points to an existing `/roles/{key}` doc, incoming `role == configuredDefaultRole()`, `approvalStatus == 'pending'`, `boundDeviceId == null`, and all charge/attachment/acting fields (`additionalOfficeIds`, `attachedOfficeId`, `actingOfficeId`, `actingRoleKey`) are empty.
2. **User Administration & Non-Super Rank Guard**:
   - `user.create`, `user.edit`, and `user.role.assign` require target visibility in scope (`office`, `subtree`, or `all`).
   - For any **non-`isSuper`** caller (even with scope `'all'`), target user's current role rank and any newly assigned role rank must be **strictly lower** than `callerRank()`.
   - Assigning a non-existent `role` key is denied (`roleDocExists(data.role)`).
   - No caller can delete self or delete a user whose role has `isSuper == true`, and an `isSuper` user cannot demote their own `isSuper` role away from an `isSuper` role.
   - `user.approve` and `user.resetDevice` updates (including via acting charge) may touch only `['approvalStatus', 'boundDeviceId', 'updatedAt']` on strictly lower-rank targets in scope.
3. **Explicit Review & Settlement Chains (Never-Self, Rank-Independent for Reviews)**:
   - Every review/settlement write (`leaves`, `fieldDuties`, `attendance` settlement, `settlements`) requires `request.auth.uid != resource.data.uid` and `isApprovedActiveUser()`.
   - Eligibility is evaluated solely from `role.review.{leave,fieldduty,settle}[applicantRoleKey]` (`office` | `subtree` | `all`), matching the caller's `A(caller)` or `actingOfficeId` (with acting role's rank strictly checked? No — review chains are governed purely by the explicit `review.*` map!).
   - Leaves and field duties created by an attached employee must set `officeId == attachedOfficeId` (`W(U)`) and `homeOfficeId == user.officeId`, preventing home-office circumvention while preserving home-office read visibility.
4. **Child Office Management (`office.child.manage`)**:
   - Grants creating and updating `level == 'upazila'` offices whose `parentOfficeId` is a `'district'` office inside `A(caller)`.
   - `level` and `parentOfficeId` are immutable on update; `delete` is denied without `office.manage == 'all'`.
5. **Charges & Attachments (`assignment.manage`)**:
   - Target user must exist and hold a role with `chargeEligible == true`.
   - `additionalOfficeIds` updates allow either removing entries in scope or **appending at most one valid office ID per write** (enforced because Firestore rules cannot loop over arbitrary dynamic lists).
   - `attachedOfficeId` cannot equal primary `officeId`.
   - `actingRoleKey` requires `roleIsActingEligible(actingRoleKey)` and strictly lower rank than caller (unless `isSuperCaller()`).
   - Scope `'subtree'` restricts target user and every added/attached/acting office to caller's district subtree; cross-district assignments require `assignment.manage == 'all'`.
6. **Multi-Office Attendance `V(U)`, Device Binding & Punch Pinning**:
   - Check-in `officeId` and check-out `checkOutOfficeId` must each belong to `V(caller)` (`{ officeId, attachedOfficeId, actingOfficeId } ∪ additionalOfficeIds`) and carry matching `districtOfficeId` / `checkOutDistrictOfficeId` plus `homeOfficeId == caller.officeId`.
   - Punches enforce `time == request.time`, `accuracy <= 50`, and `deviceId == caller.boundDeviceId`.
   - Document ID `{uid}_{YYYY-MM-DD}` prevents multiple check-ins per day.
   - During settlement, `punchDiffOnlyPhotoFlags` locks all punch fields (`time`, `lat`, `lng`, `accuracy`, `distanceMeters`, `deviceId`, `photoPath`), allowing only `photoDeleted` and `photoDeletedAt` to change.
7. **Append-Only History, Settlements, Reports & Audit Logs**:
   - `/users/{uid}/assignments/{id}`: written only by `assignment.manage`, `user.create`, `user.edit`, or `isSuperCaller()`; after creation only a single closing update (`endDate`, `closedBy`, `closedAt`) is permitted; `delete` is denied.
   - `/settlements/{id}`, `/reports/{id}`, and `/auditLogs/{id}`: immutable after creation (`update`, `delete` denied). `auditLogs` pins `actorUid == request.auth.uid`, `timestamp == request.time`, and `actorRole` matching `callerRoleKey()` (or `'bootstrap'` for role-less bootstrap identity).
8. **Storage Security Rules (`storage.rules`)**:
   - `profiles/{fileName}`: writable only by owner (`{uid}.jpg`) or `user.edit == 'all'` (`<= 3MB`, `image/*`).
   - `attendance/{uid}/{fileName}`: owner upload only (`<= 2MB`, `image/jpeg`) when `attendance.checkin == 'self'`; readable by `attendance.photo.view` scope (including acting role); deletable by `review.settle` (never self) or `attendance.photo.purge == 'all'`.
   - `orders/{uid}/{fileName}`: PDF or image `<= 5MB`, uploadable by authorized `assignment.manage`/`user.edit`/`user.create` callers (non-self), readable by target user or `user.view` callers, delete denied.

---

## 3. Known Security Limitations

1. **Client-Written Audit Logs**: Without Cloud Functions, `auditLogs` entries are committed by clients (pinning `actorUid`, `actorRole`, and server `timestamp`, and rejecting updates/deletes).
2. **Expired-But-Open Charges**: Firestore rules do not parse `YYYY-MM-DD` strings against `request.time` for `assignments.endDate`. Entries with `endDate < today` are excluded on the client UI and flagged with a warning badge until manually closed by a manager.
3. **Rule List Enumeration Limits**: Firestore rules cannot iterate over dynamic `additionalOfficeIds` arrays of arbitrary length; `assignment.manage` therefore enforces adding at most one office ID per write so each office ID's district ancestry is verified deterministically.

---

## 4. Dirty Dozen Adversarial Payloads

1. **Self-Privilege Escalation on Signup**: Unapproved registrant creates `/users/{uid}` with a non-default role or `approvalStatus: 'approved'` or pre-populated `additionalOfficeIds`/`actingRoleKey` -> **DENIED**.
2. **Closed Registration Bypass**: Creating `/users/{uid}` when `settings/app.registrationOpen == false` or `defaultRole` is unset -> **DENIED**.
3. **Device Spoofing / Clock Manipulation Check-In**: Check-in with `deviceId != boundDeviceId`, `time != request.time`, or `accuracy > 50` -> **DENIED**.
4. **Attendance Punch Tampering on Settlement**: Reviewer alters `checkIn.distanceMeters`, `checkIn.lat`, or `checkIn.time` alongside setting `settled: true` -> **DENIED** (`punchDiffOnlyPhotoFlags`).
5. **Bootstrap Super Business Action**: Bootstrap user without an assigned role attempts to check in, submit leave, approve leave, settle attendance, or create a report -> **DENIED**.
6. **Head-Office Directory Enumeration / Sibling Roster Read**: Staff member in Head Office or Office A queries `users`, `attendance`, or `leaves` across Office B or unscoped collection -> **DENIED**.
7. **Self-Review / Out-of-Map Review**: Any reviewer approves own leave/field duty/settlement, approves peer same-role leave, or skips review map hierarchy -> **DENIED**.
8. **Non-Super Rank Escalation**: Non-`isSuper` role holding `user.edit: 'all'` and `user.role.assign: 'all'` attempts to edit or assign an equal/higher-rank role -> **DENIED**.
9. **Super Role Lockout / Unauthorized Super Deletion**: Non-bootstrap user deletes an `isSuper` role, un-flags `isSuper: false`, deletes an `isSuper` user doc, or clears `settings.manage` from an `isSuper` role -> **DENIED**.
10. **Acting Role Privilege Creep**: User with `actingOfficeId: Z` and `actingRoleKey` attempts to edit profiles (`user.edit`), delete users (`user.delete`), or review/approve at their home office instead of `Z` -> **DENIED**.
11. **Out-of-Scope / Multi-Office / Non-Eligible Charge Tampering**: Subtree manager appends 2 `additionalOfficeIds` at once, assigns cross-district attachment, attaches user to own primary `officeId`, assigns `chargeEligible: false` user, or grants non-`actingEligible` acting role -> **DENIED**.
12. **Upazila Escalation via `office.child.manage`**: Manager with `office.child.manage` attempts to create a `district` office, create an `upazila` under another district, mutate `parentOfficeId`, or delete an office -> **DENIED**.
13. **History / Order / Audit Tampering**: Non-privileged user creates assignment history, anyone deletes `assignments`/`auditLogs`/`orders/{uid}/{file}`, or caller spoofs `actorRole` in `auditLogs` -> **DENIED**.
