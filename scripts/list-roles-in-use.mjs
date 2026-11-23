#!/usr/bin/env node
/**
 * Read-only role usage audit script (Admin SDK).
 * Scans `/users` for distinct `role` values and checks whether a matching
 * `/roles/{roleKey}` document exists for each.
 *
 * Usage:
 *   node scripts/list-roles-in-use.mjs [--help]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp, cert, applicationDefault, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

function printHelp() {
  console.log(`
EMS Role Usage Inspector (Read-Only)
====================================
Scans \`/users\` to list every distinct \`role\` string currently assigned,
its user count, and whether \`/roles/{key}\` exists in Firestore.

Usage:
  node scripts/list-roles-in-use.mjs [options]

Options:
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

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    return;
  }

  const appletConfig = loadAppletConfig();
  const projectId = appletConfig.projectId;
  const databaseId = appletConfig.firestoreDatabaseId || '(default)';

  console.log(`Mode: READ-ONLY`);
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

  const [usersSnap, rolesSnap] = await Promise.all([
    db.collection('users').get(),
    db.collection('roles').get()
  ]);

  const roleDocs = new Map(rolesSnap.docs.map((d) => [d.id, d.data() || {}]));
  const counts = new Map();
  let emptyRoleCount = 0;

  for (const docSnap of usersSnap.docs) {
    const data = docSnap.data() || {};
    const rawRole = typeof data.role === 'string' ? data.role.trim() : '';
    if (!rawRole) {
      emptyRoleCount += 1;
      continue;
    }
    counts.set(rawRole, (counts.get(rawRole) || 0) + 1);
  }

  const rows = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([roleKey, userCount]) => {
      const def = roleDocs.get(roleKey);
      return {
        roleKey,
        users: userCount,
        roleDoc: def ? 'EXISTS' : 'MISSING',
        label: def?.label || '-'
      };
    });

  for (const [roleKey, def] of roleDocs.entries()) {
    if (!counts.has(roleKey)) {
      rows.push({
        roleKey,
        users: 0,
        roleDoc: 'EXISTS (unused)',
        label: def?.label || '-'
      });
    }
  }

  if (emptyRoleCount > 0) {
    rows.push({
      roleKey: '(empty / unset)',
      users: emptyRoleCount,
      roleDoc: 'N/A',
      label: 'Bootstrap or incomplete profile'
    });
  }

  console.log(`\nScanned ${usersSnap.size} user(s) and ${rolesSnap.size} role definition(s).`);
  if (rows.length > 0) {
    console.table(rows);
  } else {
    console.log('No users or roles found.');
  }

  const missingKeys = rows.filter((r) => r.roleDoc === 'MISSING');
  if (missingKeys.length > 0) {
    console.log('\nAction required before deploying new Firestore rules:');
    console.log(
      `  ${missingKeys.length} role key(s) in use lack a /roles/{key} document: ${missingKeys
        .map((m) => `${m.roleKey} (${m.users})`)
        .join(', ')}`
    );
    console.log('  Create/import those role docs or run `node scripts/remap-roles.mjs --map old=new --apply`.');
  } else {
    console.log('\nAll non-empty user role values have matching /roles/{key} documents.');
  }
}

main().catch((err) => {
  console.error('Role inspection failed:', err);
  process.exitCode = 1;
});
