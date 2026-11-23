import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const SCRIPTS_DIR = path.resolve(process.cwd(), 'scripts');
const EXPECTED_SCRIPTS = [
  'list-roles-in-use.mjs',
  'import-roles.mjs',
  'remap-roles.mjs',
  'backfill-assignments.mjs',
  'backfill-attendance-home-office.mjs'
];

test('All Section 9 migration scripts exist, pass syntax check, and display --help', () => {
  for (const file of EXPECTED_SCRIPTS) {
    const fullPath = path.join(SCRIPTS_DIR, file);
    assert.equal(fs.existsSync(fullPath), true, `Missing script: ${file}`);

    // Syntax check
    execFileSync(process.execPath, ['--check', fullPath], { encoding: 'utf8' });

    // --help exits 0 and prints usage
    const helpOut = execFileSync(process.execPath, [fullPath, '--help'], { encoding: 'utf8' });
    assert.match(helpOut, /Usage:/i, `${file} --help should print Usage`);
  }
});

test('Migration scripts contain zero hard-coded role names or built-in mappings', () => {
  const forbidden = /\b(super_admin|director_general|head_office_officer|assistant_director|unfeo|head_office|district_officer|office_head|employee)\b|LEGACY_ROLE_MAP|DEFAULT_PERMISSIONS/i;
  for (const file of EXPECTED_SCRIPTS) {
    const content = fs.readFileSync(path.join(SCRIPTS_DIR, file), 'utf8');
    assert.equal(
      forbidden.test(content),
      false,
      `${file} must not contain hard-coded role names or legacy mappings`
    );
  }
});

test('import-roles.mjs and remap-roles.mjs validate required CLI arguments cleanly', () => {
  const importRes = spawnSync(process.execPath, [path.join(SCRIPTS_DIR, 'import-roles.mjs')], {
    encoding: 'utf8'
  });
  assert.notEqual(importRes.status, 0);
  assert.match(importRes.stderr, /missing <file\.json>/i);

  const remapMissing = spawnSync(process.execPath, [path.join(SCRIPTS_DIR, 'remap-roles.mjs')], {
    encoding: 'utf8'
  });
  assert.notEqual(remapMissing.status, 0);
  assert.match(remapMissing.stderr, /at least one distinct --map/i);

  const remapBadKey = spawnSync(
    process.execPath,
    [path.join(SCRIPTS_DIR, 'remap-roles.mjs'), '--map', 'old_key=Invalid-Role!'],
    { encoding: 'utf8' }
  );
  assert.notEqual(remapBadKey.status, 0);
  assert.match(remapBadKey.stderr, /Invalid target role key/i);
});
