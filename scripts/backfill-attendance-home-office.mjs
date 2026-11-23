#!/usr/bin/env node
/**
 * Idempotent attendance `homeOfficeId` / `homeDistrictOfficeId` backfill script (Admin SDK).
 * For any `/attendance/{docId}` record missing `homeOfficeId` (or `homeDistrictOfficeId`),
 * derives `homeOfficeId` from `/users/{rec.uid}.officeId` and its district ancestor from `/offices`.
 *
 * Usage:
 *   node scripts/backfill-attendance-home-office.mjs [--apply] [--help]
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
EMS Attendance Home-Office Backfill Script
==========================================
Sets \`homeOfficeId\` (from \`/users/{uid}.officeId\`) and \`homeDistrictOfficeId\`
on \`/attendance\` documents where missing. Idempotent and safe by default.

Usage:
  node scripts/backfill-attendance-home-office.mjs [options]

Options:
  --apply       Write backfilled fields to Firestore.
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

  const [attSnap, usersSnap, officesSnap] = await Promise.all([
    db.collection('attendance').get(),
    db.collection('users').get(),
    db.collection('offices').get()
  ]);

  const userMap = new Map(usersSnap.docs.map((d) => [d.id, d.data() || {}]));
  const officeMap = new Map(officesSnap.docs.map((d) => [d.id, { id: d.id, ...d.data() }]));

  const planned = [];
  let missingUserOrOffice = 0;

  for (const attDoc of attSnap.docs) {
    const rec = attDoc.data() || {};
    const existingHome = typeof rec.homeOfficeId === 'string' ? rec.homeOfficeId.trim() : '';
    const existingHomeDist = typeof rec.homeDistrictOfficeId === 'string' ? rec.homeDistrictOfficeId.trim() : '';

    const user = rec.uid ? userMap.get(rec.uid) : null;
    const derivedHome = existingHome || (typeof user?.officeId === 'string' ? user.officeId.trim() : '');
    if (!derivedHome) {
      missingUserOrOffice += 1;
      continue;
    }

    const derivedHomeDist =
      existingHomeDist ||
      (typeof user?.districtOfficeId === 'string' && derivedHome === user.officeId
        ? user.districtOfficeId.trim()
        : '') ||
      computeDistrictOfficeId(derivedHome, officeMap);

    const needsHomeOffice = !existingHome;
    const needsHomeDist = !existingHomeDist && derivedHomeDist !== '';
    if (!needsHomeOffice && !needsHomeDist) continue;

    planned.push({
      docId: attDoc.id,
      uid: rec.uid || '',
      date: rec.date || '',
      homeOfficeId: derivedHome,
      homeDistrictOfficeId: derivedHomeDist
    });
  }

  console.log(
    `Scanned ${attSnap.size} attendance doc(s) (${missingUserOrOffice} without resolvable home office). Planned ${planned.length} update(s).`
  );

  if (planned.length > 0) {
    console.table(planned.slice(0, 50));
    if (planned.length > 50) {
      console.log(`... showing first 50 of ${planned.length} planned update(s).`);
    }
  }

  if (!apply) {
    console.log('\nDry run complete. Re-run with --apply to commit changes.');
    return;
  }

  const now = Timestamp.now();
  let updated = 0;

  for (let i = 0; i < planned.length; i += 400) {
    const chunk = planned.slice(i, i + 400);
    const batch = db.batch();
    for (const item of chunk) {
      const ref = db.collection('attendance').doc(item.docId);
      batch.update(ref, {
        homeOfficeId: item.homeOfficeId,
        homeDistrictOfficeId: item.homeDistrictOfficeId,
        updatedAt: now
      });
    }
    await batch.commit();
    updated += chunk.length;
  }

  console.log(`\nBackfill complete. Updated ${updated} attendance record(s).`);
}

main().catch((err) => {
  console.error('Attendance home-office backfill failed:', err);
  process.exitCode = 1;
});
