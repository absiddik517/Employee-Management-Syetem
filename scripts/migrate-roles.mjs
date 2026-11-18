#!/usr/bin/env node
/**
 * Idempotent migration script: maps legacy role keys in Firestore `users/{uid}`
 * (`head_office` -> `director_general`, `district_officer` -> `assistant_director`,
 * `office_head` -> `unfeo`) using `LEGACY_ROLE_MAP` from `src/lib/permissions.js`.
 *
 * Usage:
 *   node scripts/migrate-roles.mjs           # Dry run (default, reads only)
 *   node scripts/migrate-roles.mjs --apply   # Apply updates & append auditLogs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp, cert, applicationDefault, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { LEGACY_ROLE_MAP, normalizeRole } from '../src/lib/permissions.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

function printHelp() {
  console.log(`
EMS Role Migration Script
=========================
Migrates legacy role values in Firestore \`users\` to canonical keys:
  - head_office      -> director_general
  - district_officer -> assistant_director
  - office_head      -> unfeo

Options:
  --apply    Commit updates to Firestore and write auditLogs entries.
             Without --apply, runs in safe read-only DRY-RUN mode.
  --help     Show this help message.

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
  console.log('Legacy map:', LEGACY_ROLE_MAP);

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

  let snapshot;
  try {
    snapshot = await db.collection('users').get();
  } catch (err) {
    console.error(`\nFailed to read Firestore \`users\` collection: ${err.message}`);
    console.error('Verify service account credentials and Firestore permissions.');
    process.exitCode = 1;
    return;
  }

  const summary = {
    scanned: snapshot.size,
    migrations: [],
    alreadyCanonical: 0,
    unknown: []
  };

  for (const docSnap of snapshot.docs) {
    const data = docSnap.data() || {};
    const rawRole = typeof data.role === 'string' ? data.role.trim() : '';

    if (Object.prototype.hasOwnProperty.call(LEGACY_ROLE_MAP, rawRole)) {
      const targetRole = LEGACY_ROLE_MAP[rawRole];
      summary.migrations.push({
        uid: docSnap.id,
        email: data.email || '',
        from: rawRole,
        to: targetRole,
        officeId: data.officeId || '',
        districtOfficeId: data.districtOfficeId || ''
      });
    } else if (normalizeRole(rawRole)) {
      summary.alreadyCanonical += 1;
    } else {
      summary.unknown.push({ uid: docSnap.id, email: data.email || '', role: rawRole || '(missing)' });
    }
  }

  if (summary.migrations.length > 0) {
    console.log('\nPlanned role migrations:');
    console.table(
      summary.migrations.map((m) => ({
        uid: m.uid,
        email: m.email,
        from: m.from,
        to: m.to
      }))
    );
  } else {
    console.log('\nNo legacy roles found. Everything is already canonical.');
  }

  if (summary.unknown.length > 0) {
    console.warn('\nDocuments with unrecognized roles (skipped):');
    console.table(summary.unknown);
  }

  let appliedCount = 0;
  if (apply && summary.migrations.length > 0) {
    const now = Timestamp.now();
    for (const item of summary.migrations) {
      await db.collection('users').doc(item.uid).update({
        role: item.to,
        updatedAt: now
      });

      await db.collection('auditLogs').add({
        actorUid: 'migration-script',
        actorName: 'Role Migration Script',
        actorRole: 'super_admin',
        officeId: item.officeId,
        districtOfficeId: item.districtOfficeId,
        action: 'ROLE_MIGRATED',
        targetCollection: 'users',
        targetId: item.uid,
        oldValue: item.from,
        newValue: item.to,
        reason: 'Migrated legacy role key to canonical permission model',
        timestamp: now
      });

      appliedCount += 1;
    }
  }

  console.log('\nMigration Summary:');
  console.table([
    {
      scanned: summary.scanned,
      legacyFound: summary.migrations.length,
      migrated: apply ? appliedCount : 0,
      alreadyCanonical: summary.alreadyCanonical,
      unknownSkipped: summary.unknown.length
    }
  ]);
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exitCode = 1;
});
