# EMS — Employee Management System (Bangladesh Government Offices)

Mobile-first attendance and departure monitoring web application built with **Vue 3 (Options API)**, **plain JavaScript**, **Vite**, **Vue Router (Hash History)**, **Pinia**, **Tailwind CSS**, and **Firebase Modular SDK (Auth, Firestore, Storage)**. Designed at 360px+ touch-friendly ergonomics for future Capacitor Android packaging.

---

## 1. Firebase Configuration

All Firebase configuration lives in a single centralized JS module: `src/firebase/config.js` (with `firebaseConfig` and `firestoreDatabaseId` defined directly in JavaScript so you can switch it to `import.meta.env.VITE_FIREBASE_*` from `.env.example` later if desired).

---

## 2. Step-by-Step Firebase Console Setup

1. **Enable Email/Password Authentication**
   - Open the [Firebase Console](https://console.firebase.google.com/) and select your project.
   - Go to **Build → Authentication → Get started**.
   - Under **Sign-in method**, click **Email/Password**, toggle **Enable** (passwordless email link is not required), and click **Save**.
   - Do **not** enable Google sign-in; EMS uses Email/Password only.

2. **Create Firestore Database**
   - Go to **Build → Firestore Database** (if not already provisioned).
   - Ensure the database ID matches `VITE_FIREBASE_FIRESTORE_DATABASE_ID` / `firebase-applet-config.json`.

3. **Enable Firebase Storage**
   - Go to **Build → Storage → Get started** and create your default Storage bucket.
   - Ensure `VITE_FIREBASE_STORAGE_BUCKET` matches your bucket (e.g. `<project-id>.firebasestorage.app`).

4. **Paste Security Rules**
   - **Firestore Rules**: Open **Firestore Database → Rules**, paste the full contents of `firestore.rules`, and click **Publish**.
   - **Storage Rules**: Open **Storage → Rules**, paste the full contents of `storage.rules`, and click **Publish**.
   - *Important for Storage Rules*: If your Firestore database uses `(default)` instead of a named database ID, replace `ai-studio-6b59576b-9eb4-4341-b9bd-1bed0ff2719e` inside `storage.rules` with `(default)`.

---

## 3. Creating the First Super Admin Manually

Because public registration only creates `employee` accounts with `approvalStatus: 'pending'`, create the initial `super_admin` manually once:

1. In **Firebase Console → Authentication → Users**, click **Add user**.
2. Enter the admin email (e.g. `admin@ems.gov.bd`) and a strong password, then copy the generated **User UID**.
3. Open **Firestore Database → Data** and create the global settings document:
   - Collection: `settings`, Document ID: `app`
   - Fields:
     - `registrationOpen`: `true` (boolean)
     - `updatedBy`: `<ADMIN_UID>` (string)
     - `updatedAt`: current timestamp
4. Create the Head Office document in `offices`:
   - Collection: `offices`, Document ID: `head-office` (or auto ID)
   - Fields:
     - `name`: `"Directorate of Non-Formal Education (Head Office)"`
     - `address`: `"232/1 Tejgaon Industrial Area, Dhaka 1208"`
     - `level`: `"head"`
     - `parentOfficeId`: `null`
     - `lat`: `23.7654` (number)
     - `lng`: `90.3995` (number)
     - `geofenceRadiusMeters`: `150` (number)
     - `startTime`: `"09:00"` (string)
     - `graceMinutes`: `15` (number)
     - `endTime`: `"17:00"` (string)
     - `createdAt`: timestamp
     - `updatedAt`: timestamp
5. Create the Super Admin user profile in `users`:
   - Collection: `users`, Document ID: `<ADMIN_UID>` (must match Auth UID)
   - Fields:
     - `uid`: `<ADMIN_UID>`
     - `name`: `"System Administrator"`
     - `designation`: `"System Admin"`
     - `address`: `"Dhaka"`
     - `mobile`: `"01700000000"`
     - `email`: `"admin@ems.gov.bd"`
     - `officeId`: `"head-office"`
     - `districtOfficeId`: `""`
     - `joiningDate`: `"2026-01-01"`
     - `status`: `"active"`
     - `resignationDate`: `null`
     - `profilePhotoPath`: `""`
     - `role`: `"super_admin"`
     - `approvalStatus`: `"approved"`
     - `boundDeviceId`: `null`
     - `createdAt`: timestamp
     - `updatedAt`: timestamp
6. Sign in at `#/login` with that email and password.

---

## 4. Seed Instructions (Three-Level Hierarchy)

Once signed in as `super_admin`:

1. Go to **Offices** (`#/admin/offices`) and create:
   - **Head Office**: Level `head` (if not created manually).
   - **District Office**: Level `district`, Parent Office = Head Office, coordinates & radius (default `100m`), times (`09:00`, grace `15`, `17:00`).
   - **Upazila Office**: Level `upazila`, Parent Office = District Office, coordinates & radius.
2. Go to **Holidays** (`#/admin/holidays`) and seed official government holidays (Fridays & Saturdays are automatically treated as weekly off days).
3. Go to **Users & Devices** (`#/admin/users`) to create or approve:
   - `district_officer` assigned to the District Office.
   - `office_head` assigned to an Upazila Office.
   - `head_office` (DG) assigned to the Head Office.
   - `employee` accounts (or let staff register publicly on `#/register` while `registrationOpen` is `true`, then approve them from the Super Admin dashboard).

---

## 5. Security Rules Explained

### `firestore.rules`
- **Default Deny**: Top-level `match /{document=**}` denies all reads/writes unless explicitly matched.
- **Role & Approval Gate**: Self-registration on `users/{uid}` is allowed **only** when `settings/app.registrationOpen == true`, and strictly enforces `role == 'employee'` and `approvalStatus == 'pending'`. Unapproved or resigned users cannot create attendance, leaves, or field duties.
- **Temporal & Device Integrity**: Attendance creation (`attendance/{uid}_{yyyy-mm-dd}`) enforces `checkIn.time == request.time` (Firestore server clock), `checkIn.accuracy <= 50`, and `checkIn.deviceId == users/{uid}.boundDeviceId`. Check-out enforces `checkOut.time == request.time`, requires an existing `checkIn`, and allows updating only `checkOut` and `updatedAt`.
- **Hierarchy Enforcement**:
  - `employee`: reads/creates only own attendance, leaves, and field duties.
  - `office_head`: read-only access to own `officeId`.
  - `district_officer`: reads/settles attendance and approves leaves/field duties for own `officeId` and child upazila offices (`districtOfficeId == officer.officeId`), and creates monthly `reports`.
  - `head_office`: read-only access to `reports`.
  - `super_admin`: manages `offices`, `users`, `holidays`, `settings/app`, and 15-day old photo cleanup.
- **Append-Only Audit Trail**: `auditLogs` allows `create` with `actorUid == request.auth.uid` and `timestamp == request.time`, while `update` and `delete` are unconditionally `false`.

### `storage.rules`
- **`attendance/{uid}/{fileName}`**: Employees can upload (`create`, `update`) JPEG selfies (`<= 2MB`) **only** to their own `attendance/{uid}/` folder and cannot read other users' selfies. Only the governing `district_officer` and `super_admin` can read or delete attendance selfies.
- **`profiles/{fileName}`**: Permanent profile photos (`profiles/{uid}.jpg`) are writable only by the owner (`fileName == request.auth.uid + '.jpg'`) or `super_admin`, and are never removed by settlement or 15-day cleanup.

---

## 6. Local Development & Capacitor Build

```bash
npm install
npm run dev      # Vite dev server on port 3000
npm run lint     # Validate Firestore/Storage rules & JS syntax
npm run build    # Production bundle in dist/
```

For Capacitor Android wrapping, build `dist/` and sync into your Capacitor Android project with `CAMERA`, `ACCESS_FINE_LOCATION`, and `ACCESS_COARSE_LOCATION` permissions declared in `AndroidManifest.xml`.
