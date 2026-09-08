import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

test('release check excludes ignored credentials and catches copied secrets without printing them', () => {
  const dir = mkdtempSync(join(tmpdir(), 'camera-release-'));
  try {
    execFileSync('git', ['init', '-q', dir]);
    copyFileSync(resolve('scripts/release-check.mjs'), join(dir, 'release-check.mjs'));
    mkdirSync(join(dir, '.local'));
    writeFileSync(join(dir, '.gitignore'), '.local/\n');
    const secret = 'sensitive-fixture-password-123';
    writeFileSync(join(dir, '.local/camera-login.json'), JSON.stringify({ password: secret }));
    const run = () => spawnSync(process.execPath, ['release-check.mjs'], { cwd: dir, encoding: 'utf8' });
    assert.equal(run().status, 0);
    writeFileSync(join(dir, 'leak.txt'), secret);
    const bad = run();
    assert.equal(bad.status, 1);
    assert.ok(bad.stderr.includes('leak.txt'));
    assert.ok(!bad.stderr.includes(secret));
    rmSync(join(dir, 'leak.txt'));
    execFileSync('git', ['add', '-f', '.local/camera-login.json'], { cwd: dir });
    assert.equal(run().status, 1, 'tracked private files must fail even when ignored');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
