# EMS — Employee Management System (Bangladesh Government Offices)

Mobile-first attendance, leave, field duty, and monthly reporting web/Android application built with **React 19**, **JavaScript / JSX**, **Vite**, **React Router (`HashRouter`)**, **React Context (`AuthContext`, `DataContext`)**, **Tailwind CSS v4**, and **Firebase Modular SDK (Auth, Firestore, Storage)**. Designed at 360px+ touch-friendly ergonomics (`>= 44px` touch targets, light/dark mode, safe-area padding) for Capacitor Android packaging.

---

## 1. Firebase Configuration

Firebase client configuration lives in `src/firebase/config.js` (and `firebase-applet-config.json`), targeting:
- **Project ID**: `iron-ivy-jvc14`
- **Firestore Database ID**: `ai-studio-6b59576b-9eb4-4341-b9bd-1bed0ff2719e`

---

## 2. Step-by-Step Firebase Console Setup

1. **Enable Email/Password Authentication**
   - Open the [Firebase Console](https://console.firebase.google.com/) and select your project.
   - Go to **Build → Authentication → Sign-in method**, enable **Email/Password**, and click **Save**.

2. **Firestore Database & Storage**
   - Ensure Firestore database `ai-studio-6b59576b-9eb4-4341-b9bd-1bed0ff2719e` and Firebase Storage bucket `iron-ivy-jvc14.firebasestorage.app` are active.

3. **Deploy Security Rules**
   - Using Firebase CLI:
     ```bash
     firebase deploy --only firestore:rules,storage
     ```
   - Or paste `firestore.rules` into **Firestore Database → Rules** and `storage.rules` into **Storage → Rules** and publish.
   - *Note for Storage Rules*: `storage.rules` references the named database `ai-studio-6b59576b-9eb4-4341-b9bd-1bed0ff2719e`. If you switch to `(default)`, update that path in `storage.rules`.

---

## 3. Roles & Permission Model

All UI checks, router guards, Firestore rules, and Storage rules share the same **Role + Permission + Scope** model defined in `src/lib/permissions.js` and mirrored in `firestore.rules` and `storage.rules`.

### Canonical Roles (`ROLES`)

| Key (`users/{uid}.role`) | Label | Rank | Default Scope | Notes |
| --- | --- | --- | --- | --- |
| `super_admin` | Super Admin | `100` | `all` | Technical administrator (`offices`, `users`, `holidays`, `settings`, `audit`, photo purge). **Read-only on business workflows** (cannot check in, settle attendance, apply/review leave/field duty, or create reports). |
| `director_general` | Director General | `90` | `all` | Read-only oversight on attendance, reports, users, and audit logs. Reviews leave requests of `assistant_director` accounts. |
| `head_office_officer` | Head Office Officer | `80` | `all` | Read-only oversight on attendance, reports, and users. |
| `assistant_director` | Assistant Director | `60` | `subtree` | Heads a district office + child upazila offices + `additionalOfficeIds`. Settles attendance, reviews `employee`/`unfeo` leave & field duty, manages lower-rank staff in subtree, creates monthly reports, views subtree audit logs. |
| `unfeo` | UNFEO | `40` | `office` | Heads an upazila office (`officeId` + `additionalOfficeIds`). Views office attendance & selfies, approves `employee` leaves only, approves/resets device for `employee` staff in office, creates office monthly reports. |
| `employee` | Employee | `10` | `self` | Self attendance check-in/out, self attendance history, self leave & field duty applications. |

### Legacy Compatibility (`LEGACY_ROLE_MAP`)

Legacy role keys remain mapped during migration via `normalizeRole()` in `src/lib/permissions.js` and `firestore.rules` / `storage.rules`:
- `head_office` → `director_general`
- `district_officer` → `assistant_director`
- `office_head` → `unfeo`

### Permissions Matrix (`PERMISSIONS`)

| Permission | `employee` | `unfeo` | `assistant_director` | `head_office_officer` | `director_general` | `super_admin` |
| --- | --- | --- | --- | --- | --- | --- |
| `attendance.checkin` | `self` | `self` | `self` | `self` | `self` | — |
| `attendance.view` | `self` | `office` | `subtree` | `all` | `all` | `all` |
| `attendance.settle` | — | — | `subtree` | — | — | — |
| `attendance.photo.view` | — | `office` | `subtree` | — | — | `all` |
| `attendance.photo.purge` | — | — | — | — | — | `all` |
| `leave.apply` | `self` | `self` | `self` | `self` | `self` | — |
| `fieldduty.apply` | `self` | `self` | `self` | `self` | `self` | — |
| `leave.review` | — | `office` (`employee` only) | `subtree` (`employee`/`unfeo`) | — | `all` (`assistant_director` only) | — |
| `fieldduty.review` | — | — | `subtree` (`employee`/`unfeo`) | — | — | — |
| `report.create` | — | `office` | `subtree` | — | — | — |
| `report.view` | — | `office` | `subtree` | `all` | `all` | `all` |
| `user.view` | — | `office` | `subtree` | `all` | `all` | `all` |
| `user.approve` | — | `office` | `subtree` | — | — | `all` |
| `user.resetDevice` | — | `office` | `subtree` | — | — | `all` |
| `user.edit` | — | — | `subtree` | — | — | `all` |
| `user.role.assign` | — | — | `subtree` (lower rank only) | — | — | `all` |
| `user.delete` | — | — | — | — | — | `all` (non-`super_admin` only) |
| `office.manage` | — | — | — | — | — | `all` |
| `holiday.manage` | — | — | — | — | — | `all` |
| `settings.manage` | — | — | — | — | — | `all` |
| `audit.view` | — | — | `subtree` | — | `all` | `all` |

### How to Edit Role Permissions at Runtime or Add a New Role

1. **Runtime Role Permission Manager (`#/admin/permissions`)**:
   - Super Admins can customize any role's permission grants and scopes (`Denied`, `Self`, `Office`, `Subtree`, `All`) directly inside the app via **Admin → Role Permissions** (`#/admin/permissions`).
   - Changes are saved to `settings/permissions` in Firestore, synced live to all signed-in clients via `onSnapshot`, audited in `auditLogs` (`ROLE_PERMISSIONS_UPDATED`), and enforced immediately by `firestore.rules` and `storage.rules`.
   - `super_admin`'s `settings.manage` grant is locked to `all` in both the UI and Firestore rules to prevent accidental admin lockout.
2. **Edit Built-in Defaults**: Change the single role line inside `DEFAULT_PERMISSIONS` in `src/lib/permissions.js`, then mirror the same fallback in `defaultPermScope()` inside `firestore.rules` (and `defaultStoragePermScope()` in `storage.rules` for photo/profile permissions).
3. **Add a Role**:
   - Add the role object (`key`, `label`, `rank`, `defaultScope`) to `ROLES` in `src/lib/permissions.js` and grant desired entries in `DEFAULT_PERMISSIONS`.
   - Add its rank to `rankOf()` and allowed role enum in `isValidUser()` / `isValidPermissionConfig()` inside `firestore.rules` (and `storage.rules` if needed), plus `firebase-blueprint.json`.
4. **Run tests & lint** (`npm test && npm run lint`) and deploy updated rules.

---

## 4. Migrating Legacy Roles in Existing Firestore Data

Run the idempotent migration script (`scripts/migrate-roles.mjs`) with a service account:

```bash
# 1. Preview changes safely (dry-run mode, no writes)
GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccount.json node scripts/migrate-roles.mjs

# 2. Apply migrations and append auditLogs entries
GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccount.json node scripts/migrate-roles.mjs --apply
```

Alternatively, pass inline JSON via `FIREBASE_SERVICE_ACCOUNT_JSON`.

---

## 5. Local Development, Testing & Capacitor Build

```bash
npm install
npm run dev         # Vite dev server on port 3000
npm run lint        # Validate firestore.rules, storage.rules & JS syntax
npm test            # Unit tests for permissions, scopes & hierarchy chains
npm run test:rules  # Firestore & Storage rules tests (requires Java 17+ & Firebase Emulator)
npm run build       # Production bundle in dist/
```

For Capacitor Android wrapping, build `dist/` and sync into your Capacitor Android project with `CAMERA`, `ACCESS_FINE_LOCATION`, and `ACCESS_COARSE_LOCATION` permissions declared in `AndroidManifest.xml`.
