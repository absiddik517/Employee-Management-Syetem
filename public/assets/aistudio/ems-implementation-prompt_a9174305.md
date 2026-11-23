# EMS: Dynamic Roles, Office-Scoped Visibility, Work History, Additional Charge / Acting Charge / Attachment

> Paste this whole document into Google AI Studio (Build mode) as one message, or paste Section 0–9 first and then each Phase (Section 10) one at a time. Work **phase by phase**. After each phase, stop and report (see Section 11).

---

## 0. Your role and ground rules

You are modifying an **existing, working** React + Vite + Firebase (Firestore named database + Storage) attendance and leave management app for a Bangladesh government office hierarchy (Head Office → District Office → Upazila Office). The UI language is Bangla with some English labels. Keep that.

**Hard rules**
1. **Do not remove or break existing features.** Self-registration, pending approval, device binding, selfie + GPS geofence attendance, field duty, leave, settlement, monthly reports, audit log, holidays, Super Admin dashboard, additional-charge page, CSV export, dark mode, mobile bottom navigation must all keep working. Extend, do not rewrite, unless this document says "replace".
2. **Security rules are the source of truth.** Every permission check in the UI must be mirrored by `firestore.rules` and `storage.rules`. Never weaken an existing rule to make a feature easier. If a requirement cannot be expressed within Firestore rules limits (no loops; `get()/exists()` limits of 10 per single-document/query request and 20 per batched write/transaction), **stop and propose an alternative in your report. Do not silently skip or loosen the rule.**
3. Keep the existing Firestore database ID (`ai-studio-6b59576b-9eb4-4341-b9bd-1bed0ff2719e`) in `src/firebase/config.js` and `storage.rules`.
4. Keep existing code style (Tailwind classes, `AppShell`, `BottomSheet`, Bangla error strings). No new npm dependencies unless unavoidable. If you add one, say why.
5. **No role name, role key or role rank may appear anywhere in application code, security rules, scripts or seeds.** Not the old six roles, and not `super_admin`. The system ships with **zero roles**. Roles exist only as data that the Super user creates (Section 3.6). All user-facing text that names a role must come from role data (`roles/{key}.label`).
6. Existing data must remain valid. Every new field is optional for old documents, and old documents must keep working until migrated.
7. Write clear comments in `firestore.rules` for each new helper. Mirror the logic in `src/lib/permissions.js` so UI and rules agree.
8. Before coding, output a short implementation plan: requirement → files to change. Then implement.

---

## 1. Existing behaviour you must understand first (read the code, do not assume)

Read at least: `src/lib/permissions.js`, `src/context/AuthContext.jsx`, `src/context/DataContext.jsx`, `src/App.jsx`, `src/components/AppShell.jsx`, `firestore.rules`, `storage.rules`, `security_spec.md`, `README.md`, `tests/*.mjs`, `scripts/migrate-roles.mjs`, `src/components/users/*`, `src/components/offices/*`, `src/pages/**`.

Today:
- Six roles are hard-coded with ranks: `super_admin` 100, `director_general` 90, `head_office_officer` 80, `assistant_director` 60, `unfeo` 40, `employee` 10. Permissions are a hard-coded matrix `DEFAULT_PERMISSIONS` plus optional overrides in Firestore `settings/permissions`. The same matrix is duplicated in `firestore.rules` and `storage.rules`.
- Scopes: `self`, `office` (user's `officeId` + `additionalOfficeIds`), `subtree` (office or `districtOfficeId` match), `all`.
- Review chain is hard-coded: UNFEO → employee leave; Assistant Director (AD) → employee/unfeo leave, field duty, attendance settlement; Director General → AD leave.
- Bootstrap super admin = two hard-coded emails (verified email) in client + both rules files.
- `users.additionalOfficeIds` exists (Super Admin edits it on `/admin/additional-charge`). Only roles with `report.create` can have it.
- Attendance doc id is `{uid}_{yyyy-mm-dd}`; one doc per user per day; check-in at one office, check-out must be same office (`officeId` immutable).
- `UsersPage` already creates Auth accounts via a **secondary Firebase app** (so the creator stays signed in). This is gated to scope `all`.
- `canViewOfficeDirectoryDoc` in `firestore.rules` currently lets **any employee whose primary office is of level `head` read every user document**. **This is a bug to remove** (see 4.1).

---

## 2. Business requirements (final, from the product owner)

R1. **Every employee** can see, for **their own office**: the employee list, each employee's profile, attendance history, and leave applications with their status.
R2. At an **upazila office**, leave applications are approved by the **UNFEO** (of that office).
R3. The **Assistant Director** approves leave of **employees of his/her own (district) office** and of the **UNFEOs of the upazila offices under him/her**.
R4. The **Assistant Director** can **create upazila offices under his/her own district office**, **use them**, and **add employees** to them.
R5. Employees are transferred often. **Their work history must be preserved** (every posting, designation, role change, transfer, additional charge, acting charge, attachment, with dates).
R6. **No role is hard-coded, not even the default six and not `super_admin`.** The system starts with an empty `roles` collection. **The Super user creates every role** (name, rank, permissions, approval chain) from the UI. Permissions are dynamic per role.
R7. **Additional charge (অতিরিক্ত দায়িত্ব):** officers and employees can hold additional charge of another office **in the same role** they already have.
R8. **Acting charge (চলতি দায়িত্ব):** a person keeps his/her own role **and additionally** gets a **new (acting) role** at another office.
R9. **Attachment (সংযুক্তি):** a person is temporarily attached to another office.
R10. **Attendance for people with additional charge, acting charge or attachment:** the person may give attendance (check-in **and** check-out, independently) at **any one of his/her valid offices** (home office or any charge/attachment office). One attendance record per day still holds.
R11. The **attached office** approves the leave of an attached person.
R12. **Expiry of charge/attachment is closed manually** (no scheduled job / no Cloud Function). The system must show warnings for entries whose end date has passed but are still open.
R13. Roles/permissions for **Super user–only** areas (offices, holidays, settings, role management) keep working as today.

### Design decisions already made (do not change)
- Authority (permissions) and workplace are **different** things:
  - **Additional charge** (same role): extends the holder's **authority offices** (`A(U)` below) to the extra office.
  - **Acting charge**: extends authority to **one** office using an **acting role** (see 3.4).
  - **Attachment**: does **not** extend any permission scope. It only changes where the person works (attendance, roster, leave routing).
- **At most ONE active attachment** and **at most ONE active acting charge** per person at a time (scalar fields). Additional charge may be many (list).
- Cross-district charge/attachment can only be given by a role that holds `assignment.manage` with scope `all`.

---

## 3. Data model (exact)

### 3.1 `roles/{roleKey}` (new collection, the single source of truth)
Document ID = `key`. Fields:

| field | type | notes |
|---|---|---|
| `key` | string | `^[a-z][a-z0-9_]{1,39}$`, equals doc id |
| `label` | string 2–80 | display name (Bangla or English) |
| `description` | string ≤ 300, optional | |
| `rank` | integer 1–100 | higher outranks lower; used for "strictly lower rank" checks |
| `isSuper` | bool | marks a Super-user role (a role created by the Super user for additional administrators). Always holds `settings.manage = all` (locked). A role with `isSuper == true` can only be deleted or un-flagged by the **bootstrap super user** (see 3.6) |
| `chargeEligible` | bool | users of this role may receive additional charge / attachment / acting charge |
| `actingEligible` | bool | this role may be assigned as an **acting role** |
| `homeRoute` | string, optional | one of `admin`, `district`, `office-head`, `head-office`, `employee`; if absent, derive from permissions (see 6.3) |
| `permissions` | map `permissionKey → scope` | scope ∈ `none, self, office, subtree, all`, only values allowed for that permission (see 3.3) |
| `review` | map `{ leave, fieldduty, settle }` each a map `applicantRoleKey → scope` (`office`, `subtree`, `all`) | explicit "who can approve whom, and within what scope" |
| `createdAt`, `updatedAt`, `updatedBy` | timestamp / timestamp / uid | server timestamps |

The three review-type permissions (`leave.review`, `fieldduty.review`, `attendance.settle`) are **derived** from the `review` map. A role "has" `leave.review` iff `review.leave` is non-empty. Do not duplicate them in `permissions`.

### 3.2 `settings/app`
Add optional `defaultRole` (string, role key used for self-registration, chosen by the Super user). **There is no fallback role.** If `defaultRole` is unset, or its `roles/{key}` document does not exist, self-registration is closed (UI shows a clear message, rules deny). Keep `registrationOpen`, `updatedAt`, `updatedBy`.

### 3.3 Permission catalogue (keys stay in code; assignment is data)
Keep all existing keys and add these. `allowedScopes` per key:

| key | allowedScopes |
|---|---|
| attendance.checkin | none, self |
| attendance.view | none, self, office, subtree, all |
| attendance.photo.view | none, office, subtree, all |
| attendance.photo.purge | none, all |
| leave.apply, fieldduty.apply | none, self |
| **leave.view (new)** | none, self, office, subtree, all |
| report.create | none, office, subtree, all |
| report.view | none, office, subtree, all |
| user.view | none, self, office, subtree, all |
| user.approve, user.resetDevice, user.edit | none, office, subtree, all |
| user.role.assign | none, office, subtree, all |
| **user.create (new)** | none, office, subtree, all |
| user.delete | none, all |
| office.manage | none, all |
| **office.child.manage (new)** | none, subtree |
| **assignment.manage (new)** | none, subtree, all |
| holiday.manage | none, all |
| settings.manage | none, all (locked to `all` for `isSuper` roles) |
| audit.view | none, office, subtree, all |
| (derived) leave.review, fieldduty.review, attendance.settle | from `review` map |

`PERMISSION_DEFINITIONS` (label, category, description, allowedScopes, `actingAllowed` flag) stays in `permissions.js`.

### 3.4 Acting roles: which permissions an acting role may contribute
An acting role contributes **only** these, and only with scope `office` or `subtree` evaluated **relative to the acting office** (a stored `all`/`self` is capped/ignored):
`attendance.view, attendance.photo.view, leave.view, report.create, report.view, user.view, user.approve, user.resetDevice, audit.view` and the three review kinds (`leave`, `fieldduty`, `settle`).
Acting roles **never** contribute: `user.edit, user.role.assign, user.create, user.delete, office.*, assignment.manage, holiday.manage, settings.manage, attendance.photo.purge, attendance.checkin, *.apply`.
Effective permission = **union** of own-role grant (over `A(U)`) and acting-role grant (over the acting office only).

### 3.5 `users/{uid}` additions (all optional)
- `additionalOfficeIds` (existing list ≤ 20): offices of **additional charge, same role**.
- `attachedOfficeId` (string or null): the one active **attachment** office.
- `actingOfficeId` (string or null) and `actingRoleKey` (string or null): the one active **acting charge**; both set together or both null.
- Define in code and rules:
  - `A(U)` (authority offices) = `officeId` ∪ `additionalOfficeIds`. For acting-role permissions, authority = `{actingOfficeId}`.
  - `V(U)` (valid attendance offices) = `officeId` ∪ `additionalOfficeIds` ∪ `{attachedOfficeId}` ∪ `{actingOfficeId}`.
  - `W(U)` (leave/field-duty working office) = `attachedOfficeId` if set, else `officeId`.

### 3.6 No hard-coded roles; the bootstrap super user is an identity, not a role
- **No role key, name or rank appears in app code, `firestore.rules`, `storage.rules`, scripts or seeds.** This includes `super_admin`, `employee`, `unfeo`, `assistant_director`, `director_general`, `head_office_officer`, and the legacy `head_office`, `district_officer`, `office_head`.
- The existing **two bootstrap emails** (verified email) remain in code and rules as an **identity**, not a role. This **bootstrap super user has no role** (`role` may be absent on his own `users` document; this is the only case where `role` is optional). He has an implicit, fixed capability set (`SUPER_IMPLICIT_PERMISSIONS`, a list of **permission keys**, all with scope `all`): `settings.manage, office.manage, holiday.manage, user.view, user.create, user.edit, user.approve, user.resetDevice, user.role.assign, user.delete, assignment.manage, audit.view, attendance.photo.purge`. Plus exclusive power to create/edit/delete **roles**. He has **no** business permissions (check-in, apply, review, settle, report.create) unless he gives himself a role.
- This bootstrap identity is the permanent root. It guarantees the Super user can never be locked out, and it is the only way to create the first role.
- Any user whose `role` value has no matching `roles/{key}` document has **no privileges at all** (treated as no role).
- Test fixtures (`tests/`) may define roles inline as test data, and `docs/examples/roles.example.json` may contain an example role set (Section 7). They are never imported by app code or scripts automatically.
- Acceptance check: grep the whole repo for the role names above. Allowed hits: only inside `tests/` fixtures, `docs/`, and `README.md` examples. Everything else must be fixed.

### 3.7 `users/{uid}/assignments/{assignmentId}` (new, append-only history)
| field | notes |
|---|---|
| `kind` | `primary` \| `additional_charge` \| `acting_charge` \| `attachment` |
| `officeId`, `districtOfficeId`, `officeName` | snapshot at the time |
| `designation` | snapshot |
| `roleKey`, `roleLabel` | role at that time; for `acting_charge` this is the acting role |
| `startDate` (YYYY-MM-DD), `endDate` (YYYY-MM-DD or null = open) | |
| `type` | `joined` \| `transfer` \| `role_change` \| `designation_change` \| `charge_started` \| `charge_ended` \| `resigned` |
| `orderNo`, `orderDate`, `reason` | optional text (আদেশ নম্বর/তারিখ/কারণ) |
| `createdBy`, `createdByName`, `createdAt` | server timestamp |
No deletes. Updates only to close an open record (`endDate`, plus `closedBy`, `closedAt`).

### 3.8 Document changes in other collections
- `attendance/{uid}_{date}`: keep `officeId`, `districtOfficeId` (= **check-in office**). Add optional `homeOfficeId`, `homeDistrictOfficeId` (user's primary office at the time), `checkOutOfficeId`, `checkOutDistrictOfficeId` (set when the check-out happens, may differ from check-in office).
- `leaves/{id}` and `fieldDuties/{id}`: `officeId`/`districtOfficeId` = **working office** `W(U)` at application time (this is how the attached office becomes the approver). Add optional `homeOfficeId`, `homeDistrictOfficeId`.
- `settlements/{id}`: unchanged.
- `offices/{id}`: add optional `createdBy` (uid).

---

## 4. Rules specification (`firestore.rules` and `storage.rules`)

Replace the hard-coded `defaultPermScope`, `rankOf`, `normalizeRole` and `canReviewLeaveRole` with data-driven helpers reading `roles/{callerRole}`. Keep the existing validation blueprints, server-timestamp checks, device-binding checks, append-only settlements/audit logs, and the default-deny structure.

### 4.0 Caller identity in rules (no role names)
- `isBootstrapSuperUser()`: signed in, verified email in the two bootstrap emails.
- `callerRoleDoc()`: `get(roles/{callerData().role})` if the caller is approved + active and that role doc exists, else none. The role key is only ever **data** read from `users/{uid}.role`.
- `isSuperCaller()`: `isBootstrapSuperUser()` OR `callerRoleDoc().isSuper == true`.
- `permScope(perm)`: for the bootstrap super user, `all` for every key in `SUPER_IMPLICIT_PERMISSIONS`, otherwise the caller role's `permissions[perm]` (`''` if absent or `none`). Union with the role's grant if the bootstrap user also holds a role.
- No rule may compare a role to a literal role key. Rank comes from `roles/{key}.rank` (0 if the role doc does not exist).

### 4.1 Reads
- **Delete `canViewOfficeDirectoryDoc` and `callerOfficeIsHead()`.** Visibility of other users' documents is `owner OR (hasPerm('user.view') AND matchesDocScope('user.view', …))` only.
- `user.view` match for a user document D by caller C:
  - `self`: D is C.
  - `office`: D.`officeId` ∈ `A(C)` **or** `D.additionalOfficeIds.hasAny(A(C))` **or** D.`attachedOfficeId` ∈ `A(C)` **or** D.`actingOfficeId` ∈ `A(C)` (so charge holders and attached staff appear in the office roster).
  - `subtree`: the above, plus D.`districtOfficeId` ∈ `A(C)`.
  - `all`: always.
  - Plus acting-role grants of C evaluated at C's acting office.
- `attendance` visibility: `own OR (hasPerm('attendance.view') AND scope match)`, where scope match considers `officeId`, `homeOfficeId`, `checkOutOfficeId` for `office`, and also `districtOfficeId`, `homeDistrictOfficeId`, `checkOutDistrictOfficeId` for `subtree`.
- `leaves` / `fieldDuties` visibility: owner, or `leave.view`/`attendance.view` scope match (on `officeId` or `homeOfficeId`), or review permission scope match (on `officeId` only).
- `roles`: any signed-in user can read. `settings/app` readable as today (public `get`).
- `offices`: unchanged (public directory).

### 4.2 Review and settlement (R2, R3, R8, R11)
- `leave.review` / `fieldduty.review` / `attendance.settle` writes are allowed iff **all**:
  1. caller ≠ applicant (never self);
  2. the **applicant's current role key** is a key of the caller's `review.<kind>` map (own role) **or** of the acting role's `review.<kind>` map;
  3. the map's scope matches the document's `officeId`/`districtOfficeId`: `office` ⇒ `officeId ∈ A(caller)` (own) or `officeId == actingOfficeId` (acting); `subtree` ⇒ also `districtOfficeId`; `all` ⇒ any;
  4. existing field-diff restrictions, `status == 'pending'`, `reviewedBy == auth.uid`, `reviewedAt == request.time` remain.
- **Rank check is no longer used for review.** It is replaced by the explicit map. Rank is still used for user administration (4.3).
- The **example role set** in Section 7 (a documentation/import file, never code) must be expressible with these maps and must produce exactly R2 and R3 when the Super user creates/imports it:
  - unfeo: `review.leave = { employee: office }`
  - assistant_director: `review.leave = { employee: office, unfeo: subtree }`, `review.fieldduty = { employee: subtree, unfeo: subtree }`, `review.settle = { employee: subtree, unfeo: subtree }`
  - director_general: `review.leave = { assistant_director: all }`
  Note `employee: office` for the AD means upazila employees are approved by the upazila UNFEO, not by the AD (R2/R3).

### 4.3 Users
- Self-registration unchanged, except `incoming().role == get(settings/app).defaultRole`, `exists(/roles/$(that role))`, and `registrationOpen == true`. If `defaultRole` is unset or missing, registration is denied. `approvalStatus == 'pending'`.
- Any write that sets `role` must check `exists(/roles/$(role))`. `role` is required on every user document **except the bootstrap super user's own document**, where it may be absent (`isValidUser` must allow this only when `isBootstrapSuperUser()` and `userId == request.auth.uid`).
- `user.create`: caller creates `users/{uid}` for **another** person when: `hasPerm('user.create')`, scope match against the **incoming** `officeId/districtOfficeId`, `rank(caller) > rank(incoming.role)` unless caller is `isSuper`, incoming `approvalStatus` may be `approved`, `isCompleteUserCreate` holds, `incoming.uid == userId`, and `createdAt/updatedAt == request.time`.
- `user.edit`, `user.approve`, `user.resetDevice`, `user.role.assign`: keep the current semantics (never self; strictly lower rank than caller for non-super; `role` change only with `user.role.assign` and new role rank < caller rank), but driven by role data instead of `if subtree … if office`. **Unsupported scope values must be rejected by the rule, not silently ignored.** The UI must only offer scopes that the rules honour.
- A role with `user.edit = all` must **not** thereby bypass rank checks. Only `isSuper` roles skip rank checks. (This closes a privilege-escalation path in the current rules.)
- `assignment.manage` governs changes to `additionalOfficeIds`, `attachedOfficeId`, `actingOfficeId`, `actingRoleKey`:
  - caller ≠ target; `rank(caller) > rank(target.role)` unless `isSuper`; target's role must be `chargeEligible`;
  - `assignment.manage = all`: any valid office;
  - `assignment.manage = subtree`: target's primary `officeId` must be inside caller's subtree **and** the new office must be inside caller's subtree. "New office inside subtree" means `officeId ∈ A(caller)` or `get(offices/X).parentOfficeId ∈ A(caller)`;
  - `additionalOfficeIds`: the new list must be either the old list with **exactly one** office appended (`incoming == existing.concat([last])`, validate `last`), or a pure **removal** (every element of the new list already in the old list; size smaller). No other shape for non-`all` callers;
  - `attachedOfficeId`: set to a valid in-scope office or cleared (null). Cannot equal the target's own `officeId`;
  - acting: `actingOfficeId` and `actingRoleKey` change together; `actingRoleKey` must exist, have `actingEligible == true`, and (unless caller `isSuper`) have rank < caller's rank; `actingOfficeId` follows the same scope rule; both cleared together.
- A transfer (change of `officeId`) keeps the current AD behaviour: both old and new office must be in the caller's scope for non-`all` callers.
- `user.delete`: unchanged (never self, never a user whose role `isSuper`).

### 4.4 Offices (R4)
- `office.manage = all`: unchanged full control.
- `office.child.manage = subtree`: may **create** an office only if `incoming.level == 'upazila'`, `incoming.parentOfficeId ∈ A(caller)`, `get(offices/parent).level == 'district'`, `createdBy == auth.uid`, plus existing `isValidOffice`. May **update** an office only if `existing.createdBy == auth.uid` **or** `existing.parentOfficeId ∈ A(caller)`, with `level` and `parentOfficeId` unchanged. **No delete** for this permission.

### 4.5 Attendance (R10 + decision: any valid office for check-in and check-out)
- Create (check-in): `incoming.officeId ∈ V(caller)` **and** `incoming.districtOfficeId == districtOf(officeId)` (derive from `get(offices/officeId)`: district-level ⇒ its own id, upazila ⇒ `parentOfficeId`, head ⇒ ''), **and** `incoming.homeOfficeId == callerData().officeId`. Keep existing device, accuracy, timestamp and `settled == false` checks.
- Update (check-out): `affectedKeys.hasOnly(['checkOut','checkOutOfficeId','checkOutDistrictOfficeId','updatedAt'])`; `checkOutOfficeId ∈ V(caller)`; `checkOutDistrictOfficeId` derived as above. `officeId` and `date` remain immutable.
- Settlement path: settler creates/updates by the review rules (4.2); the doc's `officeId` must be in `V(target user)`. Also **pin punch data**: in the settle and purge branches, the diff of `checkIn`/`checkOut` may change only `photoDeleted` and `photoDeletedAt` inside the punch (time, lat, lng, accuracy, distanceMeters, deviceId, photoPath must be unchanged). This closes a data-tampering hole.
- Photo access (`storage.rules`) follows the same scope matching using `attendance.photo.view` and the doc's attended offices.

### 4.6 Leave and field duty application (R11)
- Create: `incoming.officeId == W(caller)` (attachment office if set, else primary office), `incoming.homeOfficeId == callerData().officeId`, `isOwner(uid)`, `status == 'pending'`.

### 4.7 Roles collection
- Read: signed-in. Write: only `isSuperCaller()`. Validate shape strictly. Invariants: **only the bootstrap super user** may delete a role with `isSuper == true` or change its `isSuper` from true to false; non-bootstrap super callers cannot touch an existing `isSuper` role's `isSuper` flag, and cannot create or promote a role to a higher `rank` than their own role (bootstrap has no limit); any `isSuper` role must keep `permissions['settings.manage'] == 'all'`; `permissions` keys ⊆ the permission catalogue; scope values ⊆ the key's allowed scopes; `review` kinds ⊆ `{leave, fieldduty, settle}`, scope values ⊆ `{office, subtree, all}`; `rank` integer 1–100.
- Deleting a role is blocked in the UI if any user still has it; rules cannot check this, so the UI must.

### 4.8 Assignments history
- Read: owner, or `user.view` scope match against the parent user doc, or the assignment's own office ∈ caller's `A` (so a past office still sees its own period).
- Create: caller ≠ the user, and has `user.edit`, `user.create`, `user.approve` or `assignment.manage` in scope of the target (match on the parent user doc's current office or the assignment's office). Server timestamp `createdAt`.
- Update: only to close an open record. Delete: never.

### 4.9 Audit log hardening (small, included)
`auditLogs` create must additionally require `incoming.actorRole == callerData().role` (the caller's actual role key from his user document) and `incoming.actorName` ≤ 120 chars as today. The bootstrap super user with no role writes the literal marker `bootstrap` as `actorRole`; this is a marker string, not a role. (Audit logs are still client-written; note this limitation in the report.)

### 4.10 Storage
Mirror: roles/permissions lookup through `firestore.get`, `attendance.photo.view` / `attendance.photo.purge` / `attendance.settle` scopes with the same office matching. Profile photo: owner or `user.edit = all` writes; keep existing sizes. (Optional) `orders/{uid}/{file}`: write by `assignment.manage`/`user.edit`/`user.create` holders in scope, read by owner or `user.view` scope; ≤ 5 MB, `application/pdf` or `image/*`.

---

## 5. Client library: `src/lib/permissions.js` (replace the static model)

Keep export names where possible so callers keep working:
`can(user, permission, target, registry?)`, `canReview(reviewer, applicant, kind, registry?)`, `assignableRoles(user, registry?)`, `getRoleLabel`, `getRoleMeta`, `rankOf`, `normalizeRole`, `getHomePathForUser`, `canSelectMultipleOffices`, `getApproverHint`, `getUserOfficeScopeIds`, `PERMISSION_DEFINITIONS`, `PERMISSION_KEYS`.

New:
- `setRoleRegistry(rolesArray, { defaultRoleKey })`, `getRoleRegistry()`, `getRoleList()` (rank desc), `getDefaultRoleKey()`.
- **No built-in roles.** Instead: `validateRoleDefinition(def)`, `parseRolesImport(jsonText)` (validates a JSON array of role definitions, rejects unknown permission keys / bad scopes / duplicate keys) and `exportRoles(registry)`. These power the Role Manager's Import/Export (6.4).
- `SUPER_IMPLICIT_PERMISSIONS` (permission keys only, see 3.6) for the bootstrap super user. `isBootstrapSuperUser(firebaseUser)` helper.
- `getAuthorityOfficeIds(user)` = `A(U)`, `getValidAttendanceOfficeIds(user)` = `V(U)`, `getWorkingOfficeId(user)` = `W(U)`, `getActingGrant(user)`.
- `getReviewerRoles(applicantRoleKey, kind)` → role labels that can review that applicant (drives approver hint text; replaces the hard-coded Bangla hint switch).
- `matchesScope` evaluates scope with `A(U)`, plus acting-role grants at the acting office for the allowed set in 3.4.
- Remove **all** role names, `ROLES`, `ROLE_KEYS`, `DEFAULT_PERMISSIONS`, `LEGACY_ROLE_MAP` and legacy normalisation from runtime code. When `roles` is empty, `can()` is false for everyone except the bootstrap super user's implicit set.
- `getHomePathForUser`: use `homeRoute` if set; else derive: `settings.manage` ⇒ `/admin`; has settle review ⇒ `/district`; has `report.create` ⇒ `/office-head`; has `report.view` with scope `all`/`subtree` and no `report.create` ⇒ `/head-office`; else `/employee`. Keep the multi-office selection flow.
- Pure JS, no Firebase dependency, so it stays unit-testable.

---

## 6. UI work

### 6.1 `AuthContext` / `App`
- Subscribe to `roles` with `onSnapshot` after sign-in; call `setRoleRegistry`. Expose `rolesReady`. **Do not render route guards until roles are loaded** (otherwise guards redirect to login). Final `authReady = authReady && (rolesReady || !firebaseUser)`.
- `settings/app.defaultRole` loaded with registration settings and used by registration/complete-profile.
- The bootstrap super user is treated as `approved/active` on the client as now, with **no role** and the implicit capability set (3.6). His home route is `/admin`.
- If `roles` is empty, show the bootstrap super user a clear empty state on the Role Manager: "কোনো রোল তৈরি করা হয়নি", with buttons **"নতুন রোল তৈরি"** and **"JSON থেকে রোল আমদানি"**. Normal users (with no valid role) see a "আপনার রোল নির্ধারিত হয়নি, প্রশাসকের সাথে যোগাযোগ করুন" screen instead of redirect loops.

### 6.2 `AppShell`
Remove every `ROLES.*` comparison. Navigation and mobile primary tabs must be derived **only** from `can(...)`/scopes, so any role the Super user creates gets a sensible menu automatically. Preserve the current menu structure (groups, icons, mobile primary-tab logic) as the layout for permission combinations. Add menu items: "দায়িত্ব ও সংযুক্তি" (`assignment.manage`), "উপজেলা অফিস" for `office.child.manage`, and the roles page for `settings.manage`.

### 6.3 Replace hard-coded role literals
`ROLES.employee.key` in `UsersPage`, `UserFormSheet`, `UserTable`, `UserCard`, `UserDetailSheet`, `SuperAdminDashboardPage`, `AdminAdditionalChargePage`, `DataContext.logAudit`, `StatusBadge` ⇒ use `getDefaultRoleKey()` (returns `settings/app.defaultRole` or `''` if unset; forms then require an explicit role selection) and role data. `StatusBadge` colour tiers must use rank thresholds relative to the registry (top rank / isSuper, mid, low), not named roles.

### 6.4 New / changed pages and sheets
1. **Role Manager** (replaces `/admin/permissions`, permission `settings.manage`):
   - list/create/edit/delete roles (label, key on create only, description, rank, `isSuper`, `chargeEligible`, `actingEligible`, `homeRoute`);
   - permission grid grouped by category, scope dropdown showing **only allowed scopes per permission**;
   - **Approval chain editor** for leave / field duty / attendance settlement: "this role can act on these roles, in this scope" (multi-select of existing roles + scope);
   - registration default role selector (writes `settings/app.defaultRole`);
   - warnings: cannot remove `settings.manage` from a super role; cannot delete a role still assigned to users (query `users` where `role == key` first); warn when two roles share a rank;
   - every save writes an audit log `ROLE_UPDATED` with old/new JSON;
   - **Import / Export JSON**: export all roles as a JSON file; import a JSON array of role definitions (validated by `parseRolesImport`, shown as a preview diff, never overwrites an existing key without explicit confirmation). This is how the Super user can load the example set from Section 7 if he wants it;
   - **"অমীমাংসিত রোল" panel**: scan `users` for distinct `role` values that have no `roles/{key}` document (this is the case for existing data that still uses the old role strings) and show counts. For each, offer **"এই key দিয়ে রোল তৈরি করুন"** (opens the create form prefilled with that key) or **"ব্যবহারকারীদের অন্য রোলে সরান"** (batch update `role` for those users; rules must allow this only for super callers; write one audit log per batch);
   - only the bootstrap super user sees delete/un-flag controls for `isSuper` roles.
2. **Employee directory (R1)** (`/employees`, open to any approved user, data limited by rules): office roster including charge holders and attached staff with chips "অতিরিক্ত দায়িত্ব", "চলতি দায়িত্ব", "সংযুক্ত"; employee detail with tabs **প্রোফাইল / হাজিরা / ছুটি / কর্মজীবন**:
   - হাজিরা: month picker, per-day status with the office where attendance was given (home or other) and check-in/out times;
   - ছুটি: leave and field-duty applications with status, dates, reviewer;
   - কর্মজীবন: the assignments timeline (3.7).
   Use scoped queries only (several queries merged on the client; do not read all users). Respect `user.view`, `attendance.view`, `leave.view` scopes; hide tabs the user cannot read.
3. **Upazila offices for AD (R4)**: a page reusing `OfficesPage`/`OfficeFormSheet`, limited by `office.child.manage`. Level fixed to `upazila`, parent fixed to one of the caller's own district offices. Map pin / geofence / hours as in the existing form. After creation the office is immediately usable (users can be added to it, UNFEO can be assigned).
4. **Add employee (R4)**: `UsersPage` create mode (existing secondary-auth creation) gated by `user.create` scope instead of `user.edit == all`. Restrict the office dropdown to offices inside the caller's scope and the role dropdown to `assignableRoles` (strictly lower rank). New profile is `approved`, writes a first assignment record `joined`. The "Link existing Auth UID" mode stays `all`-scope only.
5. **Transfer / change posting sheet** on the user detail: new office (in scope), new designation, new role (only with `user.role.assign`), effective date, order no./date, reason. One batched write: update user doc, close the open `primary` assignment (`endDate = effective date − 1 day`), create the new one. Warn and ask what to do with open charges/attachments at the old office (do not auto-end them).
6. **দায়িত্ব ও সংযুক্তি management** (`assignment.manage`): for a selected person (in scope) add / close **অতিরিক্ত দায়িত্ব** (office list), **চলতি দায়িত্ব** (office + acting role from roles where `actingEligible`), **সংযুক্তি** (one office); start date, optional end date, order no./date, reason. Writes user doc fields + assignment records in one batch. A **"শেষ করুন"** button closes an entry (clears the field, closes the assignment record). Show an **"মেয়াদ শেষ – এখনো চালু"** warning badge for open entries whose `endDate` < today, also on the manager's dashboard. Replace `/admin/additional-charge` with this page; keep the route as a redirect.
7. **Employee home (attendance)**: when `V(U)` has more than one office, show an office selector. Auto-select the office whose geofence contains the current GPS fix; if several, let the user choose; if none, behave as today (outside geofence / field duty flow). Check-in uses the selected office's geofence, start time and grace to compute the status. Check-out may be done at any office in `V(U)` (independent of the check-in office), geofence-checked against that office. Write `homeOfficeId`, `checkOutOfficeId` fields (4.5). Expired-but-open entries are **excluded from the selector on the client** (rules still allow them until closed manually; document this).
8. **Leave / field duty form**: `officeId = W(U)` (shows "অনুমোদনকারী অফিস: …"), `homeOfficeId` = primary. Approver hint comes from `getReviewerRoles`.
9. **Review pages** (`OfficeHeadPage`, `DistrictApprovalsPage`, `HeadOfficeReportsPage`, settlement page): drive eligibility from `canReview` (review maps); use the person's acting role/office when applicable. Replace hard-coded approver text.
10. **Settlement page**: "Absent (প্রস্তাবিত)" must be computed per person as **no attendance document at all for that date** across all of the person's valid offices. Load attendance by `officeId`, `homeOfficeId` and `checkOutOfficeId` (separate queries per office in scope, merged). A person who gave attendance at any valid office is **not absent**; show "অন্য অফিসে উপস্থিত: …". People currently attached elsewhere appear in their **attached** office's list, not as absent at home.
11. **Monthly reports**: each attendance day is counted in the office where **check-in** happened; the home office report shows a note "অন্য অফিসে হাজিরা: N দিন" for its staff; never double count a day.
12. **Office selector flow** (`OfficeSelectPage`, `activeOfficeId`) keeps working for any role with `report.create` and several `A(U)` offices (not only AD/UNFEO).

---

## 7. Example role set (DOCUMENTATION ONLY, not seeded, not in code)
Save this matrix as `docs/examples/roles.example.json` (valid import format for `parseRolesImport`) and describe it in the README. **Nothing in the app, rules or scripts may read or depend on it.** The Super user may import it from the Role Manager or create completely different roles. Its purpose is to show the exact settings that reproduce the old behaviour plus requirements R1–R11.
Scopes: S=self, O=office, T=subtree, A=all. Example keys: `employee`, `unfeo`, `assistant_director`, `head_office_officer`, `director_general`, `administrator` (ranks 10, 40, 60, 80, 90, 100). `administrator` has `isSuper: true`. (Note there is no `super_admin` anywhere: the bootstrap super user is an identity, see 3.6.)

| permission | employee | unfeo | assistant_director | head_office_officer | director_general | super_admin |
|---|---|---|---|---|---|---|
| attendance.checkin | S | S | S | S | S | none |
| attendance.view | **O** | O | T | A | A | A |
| attendance.photo.view | none | O | T | none | none | A |
| attendance.photo.purge | none | none | none | none | none | A |
| leave.apply / fieldduty.apply | S | S | S | S | S | none |
| **leave.view** | O | O | T | A | A | A |
| report.create | none | O | T | none | none | none |
| report.view | none | O | T | A | A | A |
| user.view | **O** | O | T | A | A | A |
| user.approve / user.resetDevice | none | O | T | none | none | A |
| user.edit | none | none | T | none | none | A |
| user.role.assign | none | none | T | none | none | A |
| **user.create** | none | none | T | none | none | A |
| user.delete | none | none | none | none | none | A |
| office.manage | none | none | none | none | none | A |
| **office.child.manage** | none | none | T | none | none | none |
| **assignment.manage** | none | none | T | none | none | A |
| holiday.manage | none | none | none | none | none | A |
| settings.manage | none | none | none | none | none | A (locked) |
| audit.view | none | none | T | none | A | A |

(In the table above, read the last column as `administrator`.) Review maps: see 4.2. `chargeEligible = true` for all roles except `administrator`. `actingEligible = true` for `unfeo`, `assistant_director`. The Super user can change all of this, or ignore the example entirely.

---

## 8. Invariants that must still hold (regression guard)
- Never self-approve / self-settle; no self role change; no deleting a user whose role is `isSuper`; the bootstrap super user can never be locked out (identity-based, independent of any role data), and nobody but him can delete or un-flag an `isSuper` role.
- Self-registration only creates `pending` users with the Super-user-chosen default role; if none is set, registration is closed. No privilege escalation on signup.
- Device binding: check-in/out `deviceId == users/{uid}.boundDeviceId`; server timestamps for punches; `accuracy ≤ 50`.
- `settlements` and `auditLogs` are append-only. `assignments` are append-only (except closing).
- Resigned or unapproved users have no privileges.
- Reports are immutable once created.
- The bootstrap super user has no business permissions (check-in, apply, review, settle, report.create) unless he deliberately gives himself a role in the Role Manager.

---

## 9. Migration and deployment (write the scripts and a checklist)

1. `scripts/list-roles-in-use.mjs` (Admin SDK, read-only): print the distinct `users.role` values with counts and whether a `roles/{key}` document exists for each.
2. `scripts/import-roles.mjs <file.json>` (dry-run by default, `--apply`): generic importer of role definitions from a JSON file (same validation as `parseRolesImport`); never overwrites an existing role without `--overwrite`. **No role names inside the script.**
3. Replace `scripts/migrate-roles.mjs` with a generic `scripts/remap-roles.mjs --map old=new [--map old2=new2] [--apply]` (dry-run by default). **No built-in mapping**; it only applies the mappings given on the command line, and writes an audit log per change. (Existing data still carries the old strings `head_office`, `district_officer`, `office_head` and the six default keys; the Super user decides what they become.)
4. `scripts/backfill-assignments.mjs` (dry-run/`--apply`): for every user create an open `primary` assignment (office from `officeId`, `startDate = joiningDate`), and one open `additional_charge` assignment per `additionalOfficeIds` entry (`startDate` unknown ⇒ today, note "backfilled"). Idempotent.
5. Optional `scripts/backfill-attendance-home-office.mjs`: set `homeOfficeId` where missing (= user's `officeId`).
6. Deployment order: (a) run `list-roles-in-use` to see which role strings existing users carry; (b) **before deploying the new rules**, make sure matching `roles/{key}` documents exist (the Super user creates/imports them, or run `remap-roles`), otherwise those users lose all access; (c) backfill assignments; (d) deploy new rules + app together; (e) the bootstrap super user signs in, creates/reviews roles, sets the registration default role, and smoke-tests one account per role. Document this in `README.md` and update `security_spec.md`.
7. Update `firebase-blueprint.json` for the new collections and fields.

---

## 10. Phases (implement in order; stop after each)

**Phase 1: Dynamic roles core.** `roles` schema, `permissions.js` registry rewrite (Sections 3.1–3.5, 5), seed script, unit tests. No UI change besides keeping the app working with seeded roles.
*Done when:* `node --test tests/permissions.test.mjs` passes with tests for: dynamic registry; review maps (employee→unfeo leave, AD→employee/unfeo, DG→AD); never-self; rank checks for user admin; `assignableRoles`; acting-role union with the allowed subset; `A/V/W` office sets; home-route derivation; sanitise/validate role definitions.

**Phase 2: Rules.** `firestore.rules` and `storage.rules` per Section 4 (without assignments/charges yet if you prefer to split, but include roles, users, offices, review chain, attendance basics, audit hardening, removal of the head-office directory hole).
*Done when:* rules compile logically, every helper is commented, and `tests/rules.test.mjs` is updated: seed roles in test setup; keep all existing scenarios meaningful; add scenarios listed in Section 12.

**Phase 3: App wiring and Role Manager.** 6.1–6.3 and 6.4(1).
*Done when:* all six default roles behave and navigate exactly as before; a Super user can create a new role, give it permissions and a review chain, assign it to a user, and that user immediately gets the right menu and access.

**Phase 4: R1 + R4.** 6.4(2)(3)(4).
*Done when:* an employee sees only own-office roster/profile/attendance/leave; an AD can create an upazila office under his district, add an employee into it and assign a UNFEO; the UNFEO of that office approves that office's employee leave; the AD approves district-office employee leave and upazila UNFEO leave.

**Phase 5: History and transfer.** 3.7, 4.8, 6.4(5), backfill script, timeline in the directory/detail.
*Done when:* transferring a person closes the old record, opens a new one, old attendance/leave remain attributed to the old office, and the timeline shows the full history.

**Phase 6: Additional charge, acting charge, attachment.** 3.5, 3.8, 4.3 (assignment.manage), 4.5, 4.6, 6.4(6)(7)(8)(10)(11)(12).
*Done when:* all Section 12 scenarios for charges/attachments pass.

**Phase 7: Migration, docs, regression.** Section 9, README, `security_spec.md`, final grep for hard-coded roles, manual regression checklist for every existing page.

---

## 11. What to report after each phase
1. Files changed/added, each with a one-line reason.
2. Rules helpers added/changed (names).
3. Any requirement you could **not** implement exactly, and why (especially rules-limit issues), with a concrete alternative. Do not guess silently.
4. Assumptions you made.
5. A manual test checklist (accounts needed, steps, expected result).
6. Known limitations (for example: audit logs are client-written; expired charges stay valid on the server until closed manually; rules cannot enumerate lists).

---

## 12. Test scenarios to write (rules tests and/or unit tests)

**Roles & permissions**
- Non-super cannot write `roles`; super can; `system` role cannot be deleted; super role cannot lose `settings.manage`; unknown permission key / invalid scope for a key is rejected.
- A role with `user.edit = all` that is not `isSuper` is still blocked from editing equal/higher rank users and from assigning an equal/higher rank role.
- User write with a non-existent role key is rejected.

**Visibility (R1)**
- Employee in office X reads users/attendance/leaves of X; cannot read office Y; a **head-office employee cannot read other offices' users** (regression for the removed hole).
- Charge holder / attached staff appear in the other office's roster query.

**Review chain (R2, R3, R11)**
- UNFEO of upazila U approves leave of employee in U; denied for employee in another upazila; denied for UNFEO peer.
- AD approves leave of employee in his district office and of UNFEO of his upazila; **denied** for employee of an upazila (R2); denied for self; denied for another district.
- DG approves AD leave only.
- Attached employee's leave has `officeId` = attached office; the attached office's UNFEO can approve; the home office's UNFEO cannot approve but can view.
- Acting charge: employee with acting role `unfeo` at office Z can approve employees' leave at Z only; cannot at own home office; cannot use acting role for `user.edit`/`user.delete`.

**Offices & users (R4)**
- AD creates upazila office under own district: allowed. Under another district / as `district` level / with `parentOfficeId` pointing to a district he does not hold: denied. Delete: denied.
- AD creates an employee into own subtree: allowed; into another district: denied; with an equal/higher role: denied.
- `assignment.manage` (subtree): append exactly one in-scope additional office: allowed; append two at once, or out of scope: denied; removal: allowed. Attachment to out-of-scope office: denied; same as primary office: denied. Acting role that is not `actingEligible` or whose rank ≥ caller: denied. Target not `chargeEligible`: denied. Cross-district only with scope `all`.

**Attendance (R10)**
- Check-in at primary / additional / attached / acting office: allowed. At an unrelated office: denied. Wrong `districtOfficeId` for the office: denied.
- Check-out at a different valid office than check-in: allowed; at an invalid office: denied. Second attendance doc same day: denied (doc id).
- After the person gives attendance at office B, the home office A does **not** list him as "Absent (প্রস্তাবিত)".
- Settler cannot alter punch time/coords/device (only photo flags).

**History (R5)**
- Transfer batch creates new assignment, closes old one; non-privileged user cannot write assignments; nobody can delete; owner can read own history.

**Migration**
- Dry-run of each script prints changes and writes nothing; `--apply` is idempotent.

---

## 13. Definition of done
- Roles are fully dynamic: a Super user can add a role named anything, grant permissions, define who it can approve, and it works end-to-end in UI and rules without code changes.
- R1–R13 pass the manual checklist; all default-role behaviours from the old system still work.
- No unexplained hard-coded role name remains (Section 3.6 grep).
- `README.md`, `security_spec.md`, `firebase-blueprint.json`, tests and scripts are updated and consistent with the rules.
