#!/usr/bin/env node
/**
 * Idempotent assignment history backfill script (Admin SDK).
 *
 * For every user document in Firestore:
 *   1. Creates an open `primary` assignment if no `primary` assignment exists yet
 *      (`officeId` = user's officeId, `startDate` = joiningDate or today, `reason` = 'backfilled').
 *      If user.status === 'resigned', marks endDate = resignationDate (or today).
 *   2. Creates one open `additional_charge` assignment per `additionalOfficeIds` entry
 *      that does not already have an open `additional_charge` record
 *      (`startDate` = today, `reason` = 'backfilled').
 *
 * Usage:
 *   node scripts/backfill-assignments.mjs [--apply] [--help]
 *
 * Defaults to safe read-only DRY-RUN mode unless `--apply` is passed.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp, cert, applicationDefault, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

function printHelp() {
  console.log(`
EMS Assignment History Backfill Script
======================================
Creates initial \`primary\` and \`additional_charge\` documents under
\`/users/{uid}/assignments/{assignmentId}\` from current \`/users\` records.

Usage:
  node scripts/backfill-assignments.mjs [options]

Options:
  --apply       Write backfilled assignment documents to Firestore.
                Without --apply, runs in safe read-only DRY-RUN mode.
  --help, -h    Show this help message.

Credentials:
  Provide a Google Cloud / Firebase service account via one of:
    1. GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccount.json
    2. FIREBASE_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}'
`);
}

function loadAppletConfig() {
  const configPath = path.join(ROOT_DIR, 'firebase-applet-config.json');
  const raw = fs.readFileSync(configPath, 'utf8');
  return JSON.parse(raw);
}

function resolveCredential() {
  const inline = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (inline) {
    const trimmed = inline.trim();
    if (trimmed.startsWith('{')) {
      return cert(JSON.parse(trimmed));
    }
    const fileContent = fs.readFileSync(path.resolve(trimmed), 'utf8');
    return cert(JSON.parse(fileContent));
  }

  const gac = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (gac) {
    if (!fs.existsSync(gac)) {
      throw new Error(`GOOGLE_APPLICATION_CREDENTIALS file not found: ${gac}`);
    }
    const fileContent = fs.readFileSync(gac, 'utf8');
    return cert(JSON.parse(fileContent));
  }

  return applicationDefault();
}

function getTodayDhaka() {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const parts = {};
  for (const p of formatter.formatToParts(new Date())) {
    parts[p.type] = p.value;
  }
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function normalizeDateStr(val, fallback) {
  if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(val.trim())) {
    return val.trim();
  }
  if (val && typeof val.toDate === 'function') {
    return val.toDate().toISOString().slice(0, 10);
  }
  return fallback;
}

function safeDocIdPart(val) {
  return String(val || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 96);
}

function computeDistrictOfficeId(officeId, officeMap) {
  if (!officeId) return '';
  let curr = officeMap.get(officeId);
  const seen = new Set();
  while (curr && !seen.has(curr.id)) {
    seen.add(curr.id);
    if (curr.level === 'district') return curr.id;
    curr = curr.parentOfficeId ? officeMap.get(curr.parentOfficeId) : null;
  }
  return '';
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    return;
  }

  const apply = args.includes('--apply');
  const appletConfig = loadAppletConfig();
  const projectId = appletConfig.projectId;
  const databaseId = appletConfig.firestoreDatabaseId || '(default)';

  console.log(`Mode: ${apply ? 'APPLY (writes enabled)' : 'DRY RUN (no writes)'}`);
  console.log(`Project: ${projectId} | Database: ${databaseId}`);

  let credential;
  try {
    credential = resolveCredential();
  } catch (err) {
    console.error(`\nCredential error: ${err.message}`);
    console.error('Set GOOGLE_APPLICATION_CREDENTIALS or FIREBASE_SERVICE_ACCOUNT_JSON before running.');
    process.exitCode = 1;
    return;
  }

  const app =
    getApps().length > 0
      ? getApps()[0]
      : initializeApp({
          credential,
          projectId
        });

  const db = databaseId && databaseId !== '(default)' ? getFirestore(app, databaseId) : getFirestore(app);

  const [usersSnap, officesSnap, rolesSnap] = await Promise.all([
    db.collection('users').get(),
    db.collection('offices').get(),
    db.collection('roles').get()
  ]);

  const officeMap = new Map(officesSnap.docs.map((d) => [d.id, { id: d.id, ...d.data() }]));
  const roleMap = new Map(rolesSnap.docs.map((d) => [d.id, { key: d.id, ...d.data() }]));
  const todayStr = getTodayDhaka();
  const now = Timestamp.now();

  const plannedWrites = [];
  let skippedUsers = 0;

  for (const userDoc of usersSnap.docs) {
    const uid = userDoc.id;
    const u = userDoc.data() || {};
    const roleKey = typeof u.role === 'string' ? u.role.trim() : '';
    const primaryOfficeId = typeof u.officeId === 'string' ? u.officeId.trim() : '';

    if (!roleKey) {
      skippedUsers += 1;
      continue;
    }

    const existingSnap = await db.collection('users').doc(uid).collection('assignments').get();
    const existingList = existingSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const roleLabel = String(roleMap.get(roleKey)?.label || roleKey).slice(0, 80);
    const designation = String(u.designation || '').slice(0, 120);

    // 1. Primary assignment backfill (if no primary assignment exists yet)
    if (primaryOfficeId) {
      const hasPrimary = existingList.some((a) => a.kind === 'primary');
      if (!hasPrimary) {
        const docId = `backfill_primary_${safeDocIdPart(primaryOfficeId)}`;
        const isResigned = u.status === 'resigned';
        const endDate = isResigned ? normalizeDateStr(u.resignationDate, todayStr) : null;
        const payload = {
          kind: 'primary',
          officeId: primaryOfficeId,
          districtOfficeId:
            (typeof u.districtOfficeId === 'string' && u.districtOfficeId) ||
            computeDistrictOfficeId(primaryOfficeId, officeMap),
          officeName: String(officeMap.get(primaryOfficeId)?.name || primaryOfficeId).slice(0, 160),
          designation,
          roleKey,
          roleLabel,
          startDate: normalizeDateStr(u.joiningDate, todayStr),
          endDate,
          type: 'joined',
          reason: 'backfilled',
          createdBy: 'backfill-assignments-script',
          createdByName: 'Migration Script',
          createdAt: now,
          ...(isResigned ? { closedBy: 'backfill-assignments-script', closedAt: now } : {})
        };
        plannedWrites.push({ uid, docId, payload });
      }
    }

    // 2. Additional charge assignments backfill
    const additionalIds = Array.isArray(u.additionalOfficeIds)
      ? Array.from(
          new Set(
            u.additionalOfficeIds
              .map((id) => (typeof id === 'string' ? id.trim() : ''))
              .filter((id) => id && id !== primaryOfficeId)
          )
        )
      : [];

    for (const addOfficeId of additionalIds) {
      const docId = `backfill_additional_${safeDocIdPart(addOfficeId)}`;
      const alreadyTracked = existingList.some(
        (a) => a.id === docId || (a.kind === 'additional_charge' && a.officeId === addOfficeId && !a.endDate)
      );
      if (alreadyTracked) continue;

      const payload = {
        kind: 'additional_charge',
        officeId: addOfficeId,
        districtOfficeId: computeDistrictOfficeId(addOfficeId, officeMap),
        officeName: String(officeMap.get(addOfficeId)?.name || addOfficeId).slice(0, 160),
        designation,
        roleKey,
        roleLabel,
        startDate: todayStr,
        endDate: null,
        type: 'charge_started',
        reason: 'backfilled',
        createdBy: 'backfill-assignments-script',
        createdByName: 'Migration Script',
        createdAt: now
      };
      plannedWrites.push({ uid, docId, payload });
    }
  }

  console.log(
    `Scanned ${usersSnap.size} user(s) (skipped ${skippedUsers} without role). Planned ${plannedWrites.length} assignment write(s).`
  );

  if (plannedWrites.length > 0) {
    console.table(
      plannedWrites.map(({ uid, docId, payload }) => ({
        uid,
        docId,
        kind: payload.kind,
        officeId: payload.officeId,
        roleKey: payload.roleKey,
        startDate: payload.startDate,
        endDate: payload.endDate || 'OPEN',
        reason: payload.reason
      }))
    );
  }

  if (!apply) {
    console.log('\nDry run complete. Re-run with --apply to commit changes.');
    return;
  }

  let written = 0;
  for (let i = 0; i < plannedWrites.length; i += 400) {
    const chunk = plannedWrites.slice(i, i + 400);
    const batch = db.batch();
    for (const item of chunk) {
      const ref = db.collection('users').doc(item.uid).collection('assignments').doc(item.docId);
      batch.set(ref, item.payload, { merge: false });
    }
    await batch.commit();
    written += chunk.length;
  }

  console.log(`\nBackfill complete. Wrote ${written} assignment record(s).`);
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exitCode = 1;
});
