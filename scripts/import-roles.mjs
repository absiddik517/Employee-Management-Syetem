#!/usr/bin/env node
/**
 * Generic role definition importer (Admin SDK).
 * Reads a JSON array of role definitions, validates every entry using
 * `parseRolesImport` from `src/lib/permissions.js`, and writes to `roles/{key}`.
 *
 * Usage:
 *   node scripts/import-roles.mjs <path-to-roles.json> [--apply] [--overwrite] [--default-role=<key>]
 *
 * Defaults to read-only DRY-RUN mode unless `--apply` is passed.
 * Never overwrites existing `roles/{key}` documents unless `--overwrite` is passed.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp, cert, applicationDefault, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { parseRolesImport } from '../src/lib/permissions.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

function printHelp() {
  console.log(`
EMS Role Importer Script
========================
Imports role definitions from a JSON file into Firestore \`roles/{key}\`.

Usage:
  node scripts/import-roles.mjs <file.json> [options]

Options:
  --apply                 Write validated role documents to Firestore.
                          Without --apply, runs in safe read-only DRY-RUN mode.
  --overwrite             Allow updating existing \`roles/{key}\` documents.
  --default-role=<key>    Also set \`settings/app.defaultRole\` to <key> (must exist in file or DB).
  --help, -h              Show this help message.

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

  const fileArg = args.find((a) => !a.startsWith('--'));
  if (!fileArg) {
    console.error('Error: missing <file.json> argument.');
    printHelp();
    process.exitCode = 1;
    return;
  }

  const apply = args.includes('--apply');
  const overwrite = args.includes('--overwrite');
  const defaultRoleFlag = args.find((a) => a.startsWith('--default-role='));
  const defaultRoleKey = defaultRoleFlag ? defaultRoleFlag.split('=')[1].trim() : '';

  const resolvedFile = path.resolve(process.cwd(), fileArg);
  if (!fs.existsSync(resolvedFile)) {
    console.error(`Error: file not found: ${resolvedFile}`);
    process.exitCode = 1;
    return;
  }

  const jsonText = fs.readFileSync(resolvedFile, 'utf8');
  const parsed = parseRolesImport(jsonText);
  if (!parsed.valid) {
    console.error('Role JSON validation failed:');
    for (const err of parsed.errors) {
      console.error(`  - ${err}`);
    }
    process.exitCode = 1;
    return;
  }

  const appletConfig = loadAppletConfig();
  const projectId = appletConfig.projectId;
  const databaseId = appletConfig.firestoreDatabaseId || '(default)';

  console.log(`Mode: ${apply ? 'APPLY (writes enabled)' : 'DRY RUN (no writes)'}`);
  console.log(`Overwrite existing: ${overwrite ? 'YES' : 'NO'}`);
  console.log(`Project: ${projectId} | Database: ${databaseId}`);
  console.log(`Validated ${parsed.roles.length} role definition(s) from ${resolvedFile}`);

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

  const existingSnap = await db.collection('roles').get();
  const existingMap = new Map(existingSnap.docs.map((d) => [d.id, d.data()]));

  const plan = [];
  for (const roleDef of parsed.roles) {
    const exists = existingMap.has(roleDef.key);
    let action = 'CREATE';
    if (exists) {
      action = overwrite ? 'OVERWRITE' : 'SKIP_EXISTS';
    }
    plan.push({ key: roleDef.key, label: roleDef.label, rank: roleDef.rank, action, roleDef });
  }

  console.table(plan.map(({ key, label, rank, action }) => ({ key, label, rank, action })));

  if (defaultRoleKey) {
    const inImport = parsed.roles.some((r) => r.key === defaultRoleKey);
    const inDb = existingMap.has(defaultRoleKey);
    if (!inImport && !inDb) {
      console.error(`Error: --default-role="${defaultRoleKey}" does not exist in imported roles or Firestore.`);
      process.exitCode = 1;
      return;
    }
    console.log(`Planned settings/app.defaultRole -> "${defaultRoleKey}"`);
  }

  if (!apply) {
    console.log('\nDry run complete. Re-run with --apply to commit changes.');
    return;
  }

  const now = Timestamp.now();
  let written = 0;

  for (const item of plan) {
    if (item.action === 'SKIP_EXISTS') continue;
    const ref = db.collection('roles').doc(item.key);
    const prev = existingMap.get(item.key);
    const docPayload = {
      ...item.roleDef,
      createdAt: prev?.createdAt || now,
      updatedAt: now,
      updatedBy: 'import-roles-script'
    };
    await ref.set(docPayload);
    written += 1;
  }

  if (defaultRoleKey) {
    await db.collection('settings').doc('app').set(
      {
        defaultRole: defaultRoleKey,
        updatedAt: now,
        updatedBy: 'import-roles-script'
      },
      { merge: true }
    );
  }

  console.log(`\nImport complete. Wrote ${written} role(s).`);
}

main().catch((err) => {
  console.error('Import failed:', err);
  process.exitCode = 1;
});
