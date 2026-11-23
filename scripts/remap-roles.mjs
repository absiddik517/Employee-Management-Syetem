#!/usr/bin/env node
/**
 * Generic CLI role remapping script (Admin SDK).
 * Replaces legacy `migrate-roles.mjs` with zero built-in mappings.
 * Applies only explicit `--map old=new` pairs provided on the command line,
 * validates that every target `new` role exists in `/roles/{new}`,
 * and writes one `/auditLogs` entry per modified user when `--apply` is set.
 *
 * Usage:
 *   node scripts/remap-roles.mjs --map oldRole=newRole [--map otherOld=otherNew] [--apply]
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
const ROLE_KEY_PATTERN = /^[a-z][a-z0-9_]{1,39}$/;

function printHelp() {
  console.log(`
EMS Generic Role Remap Script
=============================
Reassigns \`users/{uid}.role\` from <old> to <new> using explicit command-line
mappings. Contains NO hard-coded role names or built-in default mappings.

Usage:
  node scripts/remap-roles.mjs --map <old>=<new> [--map <old2>=<new2>] [--apply]

Options:
  --map <old>=<new>    Role mapping pair (repeatable; or comma-separated).
                       Target <new> must match ^[a-z][a-z0-9_]{1,39}$ and exist in /roles/{new}.
  --apply              Commit user role updates and append one \`auditLogs\` record per user.
                       Without --apply, runs in safe read-only DRY-RUN mode.
  --help, -h           Show this help message.

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

function parseMapArgs(args) {
  const pairs = [];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--map') {
      const next = args[i + 1];
      if (!next || next.startsWith('--')) {
        throw new Error('Expected <old>=<new> value after --map.');
      }
      pairs.push(...next.split(',').map((s) => s.trim()).filter(Boolean));
      i += 1;
    } else if (arg.startsWith('--map=')) {
      const val = arg.slice('--map='.length).trim();
      if (!val) {
        throw new Error('Expected <old>=<new> value in --map=<old>=<new>.');
      }
      pairs.push(...val.split(',').map((s) => s.trim()).filter(Boolean));
    }
  }

  const mapping = new Map();
  for (const pair of pairs) {
    const eqIndex = pair.indexOf('=');
    if (eqIndex <= 0 || eqIndex === pair.length - 1) {
      throw new Error(`Invalid mapping "${pair}". Expected format <old>=<new>.`);
    }
    const oldRole = pair.slice(0, eqIndex).trim();
    const newRole = pair.slice(eqIndex + 1).trim();
    if (!oldRole || !newRole) {
      throw new Error(`Invalid mapping "${pair}". Both source and target role keys must be non-empty.`);
    }
    if (!ROLE_KEY_PATTERN.test(newRole)) {
      throw new Error(`Invalid target role key "${newRole}". Must match ${ROLE_KEY_PATTERN}.`);
    }
    if (mapping.has(oldRole) && mapping.get(oldRole) !== newRole) {
      throw new Error(`Conflicting mappings for source role "${oldRole}".`);
    }
    if (oldRole !== newRole) {
      mapping.set(oldRole, newRole);
    }
  }
  return mapping;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    return;
  }

  let mapping;
  try {
    mapping = parseMapArgs(args);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    printHelp();
    process.exitCode = 1;
    return;
  }

  if (mapping.size === 0) {
    console.error('Error: at least one distinct --map <old>=<new> argument is required.');
    printHelp();
    process.exitCode = 1;
    return;
  }

  const apply = args.includes('--apply');
  const appletConfig = loadAppletConfig();
  const projectId = appletConfig.projectId;
  const databaseId = appletConfig.firestoreDatabaseId || '(default)';

  console.log(`Mode: ${apply ? 'APPLY (writes enabled)' : 'DRY RUN (no writes)'}`);
  console.log(`Project: ${projectId} | Database: ${databaseId}`);
  console.log(
    `Requested mappings: ${Array.from(mapping.entries())
      .map(([o, n]) => `${o} -> ${n}`)
      .join(', ')}`
  );

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

  const [rolesSnap, usersSnap] = await Promise.all([
    db.collection('roles').get(),
    db.collection('users').get()
  ]);

  const existingRoleKeys = new Set(rolesSnap.docs.map((d) => d.id));
  const missingTargets = Array.from(new Set(mapping.values())).filter((k) => !existingRoleKeys.has(k));
  if (missingTargets.length > 0) {
    console.error(
      `Error: target role(s) do not exist in /roles: ${missingTargets.join(', ')}. Create/import them first.`
    );
    process.exitCode = 1;
    return;
  }

  const planned = [];
  for (const userDoc of usersSnap.docs) {
    const uid = userDoc.id;
    const data = userDoc.data() || {};
    const currentRole = typeof data.role === 'string' ? data.role.trim() : '';
    if (!currentRole || !mapping.has(currentRole)) continue;
    const nextRole = mapping.get(currentRole);
    if (currentRole === nextRole) continue;
    planned.push({
      uid,
      name: data.name || uid,
      officeId: typeof data.officeId === 'string' ? data.officeId : '',
      districtOfficeId: typeof data.districtOfficeId === 'string' ? data.districtOfficeId : '',
      oldRole: currentRole,
      newRole: nextRole
    });
  }

  console.log(`\nScanned ${usersSnap.size} user(s). Matched ${planned.length} user(s) to remap.`);
  if (planned.length > 0) {
    console.table(planned.map(({ uid, name, oldRole, newRole }) => ({ uid, name, oldRole, newRole })));
  }

  if (!apply) {
    console.log('\nDry run complete. Re-run with --apply to commit changes and write auditLogs.');
    return;
  }

  const now = Timestamp.now();
  let updatedCount = 0;

  // Each change writes 2 ops (users update + auditLogs set) -> 200 users per 400-op batch
  for (let i = 0; i < planned.length; i += 200) {
    const chunk = planned.slice(i, i + 200);
    const batch = db.batch();
    for (const item of chunk) {
      const userRef = db.collection('users').doc(item.uid);
      batch.update(userRef, {
        role: item.newRole,
        updatedAt: now
      });

      const auditRef = db.collection('auditLogs').doc();
      batch.set(auditRef, {
        actorUid: 'remap-roles-script',
        actorName: 'Migration Script',
        actorRole: 'system',
        officeId: item.officeId,
        districtOfficeId: item.districtOfficeId,
        action: 'ROLE_REMAPPED',
        targetCollection: 'users',
        targetId: item.uid,
        oldValue: item.oldRole,
        newValue: item.newRole,
        reason: `CLI role remap (${item.oldRole} -> ${item.newRole})`,
        timestamp: now
      });
    }
    await batch.commit();
    updatedCount += chunk.length;
  }

  console.log(`\nRemap complete. Updated ${updatedCount} user(s) and wrote ${updatedCount} audit log(s).`);
}

main().catch((err) => {
  console.error('Role remap failed:', err);
  process.exitCode = 1;
});
