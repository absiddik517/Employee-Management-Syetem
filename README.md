# EMS — Employee Management System (Bangladesh Government Offices)

Mobile-first attendance, leave, field duty, assignment tracking, and monthly reporting web/Android application built with **React 19**, **JavaScript / JSX**, **Vite**, **React Router (`HashRouter`)**, **React Context (`AuthContext`, `DataContext`)**, **Tailwind CSS v4**, and **Firebase Modular SDK (Auth, Firestore, Storage)**. Designed at 360px+ touch-friendly ergonomics (`>= 44px` touch targets, light/dark mode, safe-area padding) for Capacitor Android packaging.

---

## 1. Firebase Configuration

Firebase client configuration lives in `src/firebase/config.js` and `firebase-applet-config.json`:
- **Project ID**: `iron-ivy-jvc14`
- **Firestore Database ID**: `ai-studio-6b59576b-9eb4-4341-b9bd-1bed0ff2719e`
- **Storage Bucket**: `iron-ivy-jvc14.firebasestorage.app`

---

## 2. Step-by-Step Firebase Console Setup

1. **Enable Email/Password Authentication**
   - Open the [Firebase Console](https://console.firebase.google.com/) and select project `iron-ivy-jvc14`.
   - Go to **Build -> Authentication -> Sign-in method**, enable **Email/Password**, and click **Save**.
2. **Firestore Database & Storage**
   - Ensure named Firestore database `ai-studio-6b59576b-9eb4-4341-b9bd-1bed0ff2719e` and Storage bucket `iron-ivy-jvc14.firebasestorage.app` are active.
3. **Deploy Security Rules**
   - Using Firebase CLI:
     ```bash
     firebase deploy --only firestore:rules,storage
     ```
   - *Note*: `storage.rules` references `/databases/ai-studio-6b59576b-9eb4-4341-b9bd-1bed0ff2719e/documents/...`. Keep that database ID matched if cloning environments.

---

## 3. Dynamic Role & Permission Architecture

EMS contains **zero hard-coded role names, role keys, or ranks** in application code (`src/`), security rules (`firestore.rules`, `storage.rules`), `firebase-blueprint.json`, or migration scripts.

### 3.1 Single Source of Truth (`/roles/{roleKey}`)
All roles live as Firestore documents in `/roles/{roleKey}` and are edited live by Super users in **Admin -> Roles & Permissions (`#/admin/roles`)**:
- `key`: `^[a-z][a-z0-9_]{1,39}$`
- `label`, `description`, `rank` (integer hierarchy used for user management)
- `isSuper`: boolean (grants super capabilities; locked `settings.manage = 'all'`)
- `chargeEligible`: boolean (whether holders can receive additional charge, acting charge, or attachments)
- `actingEligible`: boolean (whether this role can be granted as an acting role)
- `homeRoute`: optional UI landing layout (`admin` | `district` | `office-head` | `head-office` | `employee`)
- `permissions`: map of `permissionKey -> scope` (`none` | `self` | `office` | `subtree` | `all`)
- `review`: explicit approval maps `{ leave: { [applicantRoleKey]: scope }, fieldduty: { [applicantRoleKey]: scope }, settle: { [applicantRoleKey]: scope } }` where scope is `office` | `subtree` | `all`

### 3.2 Bootstrap Super User Identity
To guarantee the system can never be locked out—even when `/roles` is empty on a fresh install—verified Firebase Auth email `absiddik5177@gmail.com` (and alias `absiddik517@gmail.com`) is recognized as the **Bootstrap Super User**:
- Always holds `SUPER_IMPLICIT_PERMISSIONS` (`settings.manage`, `office.manage`, `holiday.manage`, `user.view`, `user.create`, `user.edit`, `user.approve`, `user.resetDevice`, `user.role.assign`, `user.delete`, `assignment.manage`, `audit.view`, `attendance.photo.purge`) with scope `all`.
- Only the bootstrap super user can delete or un-flag an `isSuper` role.
- Holds **no business workflow permissions** (`attendance.checkin`, `leave.apply`, `fieldduty.apply`, `leave.review`, `fieldduty.review`, `attendance.settle`, `report.create`) unless explicitly assigned a role document in Role Manager.

### 3.3 Permission Catalog & Review Maps (`src/lib/permissions.js`)
| Key | Allowed Scopes | Acting Allowed | Notes |
| --- | --- | --- | --- |
| `attendance.checkin` | `none`, `self` | No | Daily GPS + selfie punch at valid offices `V(U)` |
| `attendance.view` | `none`, `self`, `office`, `subtree`, `all` | Yes | View attendance logs |
| `attendance.photo.view` | `none`, `office`, `subtree`, `all` | Yes | View check-in/out selfies in Storage |
| `attendance.photo.purge` | `none`, `all` | No | Purge unsettled photos older than 15 days |
| `leave.apply` | `none`, `self` | No | Submit leave applications (routed to `W(U)`) |
| `leave.view` | `none`, `self`, `office`, `subtree`, `all` | Yes | View leave applications |
| `fieldduty.apply` | `none`, `self` | No | Submit field duty requests |
| `report.create` | `none`, `office`, `subtree`, `all` | Yes | Generate & submit immutable monthly office reports |
| `report.view` | `none`, `office`, `subtree`, `all` | Yes | Read monthly reports & export CSV |
| `user.view` | `none`, `self`, `office`, `subtree`, `all` | Yes | Staff directory roster & profiles |
| `user.create` | `none`, `office`, `subtree`, `all` | No | Direct account creation (lower rank unless `isSuper`) |
| `user.approve` | `none`, `office`, `subtree`, `all` | Yes | Approve/reject pending registrations |
| `user.resetDevice` | `none`, `office`, `subtree`, `all` | Yes | Clear bound device ID |
| `user.edit` | `none`, `office`, `subtree`, `all` | No | Edit profiles, transfers, status (rank-guarded) |
| `user.role.assign` | `none`, `office`, `subtree`, `all` | No | Assign roles (strictly lower rank for non-super) |
| `user.delete` | `none`, `all` | No | Delete non-`isSuper`, non-self user documents |
| `office.manage` | `none`, `all` | No | Full office hierarchy CRUD |
| `office.child.manage` | `none`, `subtree` | No | Create/update child `upazila` offices under own districts |
| `assignment.manage` | `none`, `subtree`, `all` | No | Manage additional charge, acting charge, attachments |
| `holiday.manage` | `none`, `all` | No | Manage official holidays |
| `settings.manage` | `none`, `all` | No | Global settings (`settings/app`) & `/roles` CRUD |
| `audit.view` | `none`, `office`, `subtree`, `all` | Yes | View immutable audit logs |

Derived review permissions (`leave.review`, `fieldduty.review`, `attendance.settle`) are computed exclusively from `role.review.{leave,fieldduty,settle}[applicantRoleKey]` (with never-self enforcement and independent of numeric rank). Acting roles (`actingOfficeId` + `actingRoleKey`) only add permissions listed in `ACTING_ALLOWED_PERMISSIONS` (plus acting `review.*` scopes) strictly over `actingOfficeId`.

### 3.4 Multi-Office Authority, Attendance & Career History
- **Authority Set `A(U)`**: `{ user.officeId } ∪ user.additionalOfficeIds`. Governs management, directory leadership, and approvals.
- **Valid Attendance Offices `V(U)`**: `A(U) ∪ { attachedOfficeId, actingOfficeId }`. Staff can check in at one valid office and check out at another valid office on the same day.
- **Leave/Field Duty Routing `W(U)`**: `attachedOfficeId` if currently attached, else primary `officeId`. Records retain `homeOfficeId` and `homeDistrictOfficeId` so home offices retain read visibility without stealing approval authority.
- **Assignment History (`/users/{uid}/assignments`)**: Append-only timeline (`primary`, `additional_charge`, `acting_charge`, `attachment`) recording transfers, role/designation changes, charges, and attachments (with optional order PDF/image upload under `orders/{uid}/{file}`). Open entries with `endDate < today` trigger an in-app `"মেয়াদ শেষ – এখনো চালু"` warning and are excluded from the client attendance office picker until closed manually.

---

## 4. Example Role Set (Documentation & Optional Import Only)

`docs/examples/roles.example.json` provides a ready-to-import reference configuration modeling a standard 6-tier hierarchy (`employee`, `unfeo`, `assistant_director`, `head_office_officer`, `director_general`, `administrator`). **Nothing in the app, rules, or scripts reads or depends on this file.**

Scopes: `S` = `self`, `O` = `office`, `T` = `subtree`, `A` = `all`.

| Permission / Flag | `employee` (10) | `unfeo` (40) | `assistant_director` (60) | `head_office_officer` (80) | `director_general` (90) | `administrator` (100, `isSuper`) |
| --- | --- | --- | --- | --- | --- | --- |
| `attendance.checkin` | S | S | S | S | S | — |
| `attendance.view` | O | O | T | A | A | A |
| `attendance.photo.view` | — | O | T | — | — | A |
| `attendance.photo.purge` | — | — | — | — | — | A |
| `leave.apply` / `fieldduty.apply` | S | S | S | S | S | — |
| `leave.view` | O | O | T | A | A | A |
| `report.create` | — | O | T | — | — | — |
| `report.view` | — | O | T | A | A | A |
| `user.view` | O | O | T | A | A | A |
| `user.approve` / `user.resetDevice` | — | O | T | — | — | A |
| `user.create` / `user.edit` / `user.role.assign` | — | — | T | — | — | A |
| `user.delete` | — | — | — | — | — | A |
| `office.manage` / `holiday.manage` | — | — | — | — | — | A |
| `office.child.manage` | — | — | T | — | — | — |
| `assignment.manage` | — | — | T | — | — | A |
| `settings.manage` | — | — | — | — | — | A (locked) |
| `audit.view` | — | — | T | — | A | A |
| `chargeEligible` / `actingEligible` | Yes / No | Yes / Yes | Yes / Yes | Yes / No | Yes / No | No / No |
| Review Maps (`leave` / `fieldduty` / `settle`) | — | `leave: { employee: O }` | `leave: { employee: O, unfeo: T }`, `fieldduty/settle: { employee: T, unfeo: T }` | — | `leave: { assistant_director: A }` | — |

You can load this example JSON from `#/admin/roles` (**Import JSON**) or via CLI:
```bash
GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccount.json \
  node scripts/import-roles.mjs docs/examples/roles.example.json --apply --default-role=employee
```

---

## 5. Migration & Deployment Runbook

All migration CLI scripts use Firebase Admin SDK against database `ai-studio-6b59576b-9eb4-4341-b9bd-1bed0ff2719e` and default to **safe read-only dry-run mode** unless `--apply` is passed. Supply credentials via `GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccount.json` or `FIREBASE_SERVICE_ACCOUNT_JSON`.

Follow this exact deployment order on existing databases:

1. **Inspect existing user role values (read-only)**:
   ```bash
   node scripts/list-roles-in-use.mjs
   ```
   Prints every distinct `users.role` value, user count, and whether `/roles/{key}` exists.

2. **Ensure `/roles/{key}` documents exist BEFORE deploying rules** (users whose role string lacks a `/roles/{key}` document lose all permissions once new rules are active):
   - Either import/create role definitions (`import-roles.mjs` or via `#/admin/roles`):
     ```bash
     # Dry-run preview
     node scripts/import-roles.mjs <your-roles.json>
     # Commit new roles (never overwrites existing unless --overwrite is passed)
     node scripts/import-roles.mjs <your-roles.json> --apply --default-role=<defaultKey>
     ```
   - And/or remap legacy role strings using explicit CLI `--map old=new` pairs (`remap-roles.mjs` contains zero built-in mappings and writes one `auditLogs` entry per user updated):
     ```bash
     # Dry-run preview
     node scripts/remap-roles.mjs --map old_key=new_key --map another_old=new_key
     # Commit updates and write auditLogs
     node scripts/remap-roles.mjs --map old_key=new_key --map another_old=new_key --apply
     ```

3. **Backfill assignment career history** (idempotent: creates open `primary` and `additional_charge` records under `/users/{uid}/assignments`):
   ```bash
   node scripts/backfill-assignments.mjs
   node scripts/backfill-assignments.mjs --apply
   ```

4. **Backfill attendance `homeOfficeId` / `homeDistrictOfficeId`** (optional, idempotent):
   ```bash
   node scripts/backfill-attendance-home-office.mjs
   node scripts/backfill-attendance-home-office.mjs --apply
   ```

5. **Deploy Firestore & Storage rules + Web App together**:
   ```bash
   npm run lint
   npm test
   npm run build
   firebase deploy --only firestore:rules,storage
   ```

6. **Bootstrap Super User Smoke Test**:
   - Sign in with the bootstrap email (`absiddik5177@gmail.com`).
   - Open `#/admin/roles`, resolve any items in the **"অমীমাংসিত রোল"** panel, verify `settings/app.defaultRole` and registration toggle, and smoke-test one account per role.

---

## 6. Local Development, Testing & Capacitor Build

```bash
npm install
npm run dev         # Vite dev server on port 3000
npm run lint        # Validate firestore.rules, storage.rules & core JS syntax
npm test            # Unit tests (permissions, dynamic roles, A/V/W, CLI script checks)
npm run test:rules  # Firestore & Storage emulator security tests (requires Java 17+ & Firebase CLI)
npm run build       # Production bundle in dist/
```

For Capacitor Android wrapping, build `dist/` and sync into your Capacitor Android project with `CAMERA`, `ACCESS_FINE_LOCATION`, and `ACCESS_COARSE_LOCATION` permissions declared in `AndroidManifest.xml`.
