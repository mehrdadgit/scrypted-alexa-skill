import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadConfig, validateDeployConfig } from '../lib/config';

test('environment configuration overrides JSON while blank skill ID preserves saved ID', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scrypted-config-'));
  try {
    const file = join(dir, 'config.json');
    const original = { skillName: 'Old', scryptedEndpoint: 'https://old.test/public/', alexaRedirectUrls: ['https://layla.amazon.com/api/skill/link/OLD'], skillId: 'amzn1.ask.skill.saved' };
    writeFileSync(file, JSON.stringify(original));
    const env = { CONFIG_FILE: file, SKILL_NAME: 'Jetson Cameras', SCRYPTED_ENDPOINT: 'https://camera.mydomain.test/endpoint/scrypted-alexa-au/public/', ALEXA_VENDOR_ID: 'NEWVENDOR', ALEXA_SKILL_ID: '' };
    const config = loadConfig(env);
    assert.equal(config.skillName, 'Jetson Cameras');
    assert.equal(config.scryptedEndpoint, env.SCRYPTED_ENDPOINT);
    assert.equal(config.skillId, original.skillId);
    assert.equal(config.alexaRedirectUrls.length, 3);
    assert.ok(config.alexaRedirectUrls.includes('https://alexa.amazon.co.jp/api/skill/link/NEWVENDOR'));
    assert.equal(loadConfig({ ...env, ALEXA_SKILL_ID: 'amzn1.ask.skill.override' }).skillId, 'amzn1.ask.skill.override');
    const callbacks = ['https://alexa.amazon.co.jp/api/skill/link/EXACT'];
    assert.deepEqual(loadConfig({ ...env, ALEXA_REDIRECT_URLS: JSON.stringify(callbacks) }).alexaRedirectUrls, callbacks);
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), original);
    assert.throws(() => loadConfig({ ...env, ALEXA_VENDOR_ID: '../bad' }));
    assert.throws(() => loadConfig({ ...env, ALEXA_REDIRECT_URLS: 'not-json' }));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('deployment configuration rejects a LAN or example endpoint and missing vendor', () => {
  const config = { skillName: 'Cameras', scryptedEndpoint: 'https://camera.mydomain.test/public/', alexaRedirectUrls: ['https://alexa.amazon.co.jp/api/skill/link/VENDOR'] };
  validateDeployConfig(config);
  for (const endpoint of ['https://192.168.1.100:10443/public/', 'https://cameras.example.com/public/', 'https://localhost/public/']) {
    assert.throws(() => validateDeployConfig({ ...config, scryptedEndpoint: endpoint }));
  }
  assert.throws(() => validateDeployConfig({ ...config, alexaRedirectUrls: ['https://alexa.amazon.co.jp/api/skill/link/YOUR_VENDOR_ID'] }));
});

test('CLI wrapper loads dotenv as data, preserves shell precedence, and forwards explicit profiles', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scrypted-runner-'));
  try {
    mkdirSync(join(dir, 'scripts'));
    mkdirSync(join(dir, 'bin'));
    copyFileSync(resolve('scripts/run.mjs'), join(dir, 'scripts/run.mjs'));
    writeFileSync(join(dir, '.env.local'), 'AWS_PROFILE=from-file\nSKILL_NAME="My Jetson Cameras"\nSCRYPTED_HOST=192.168.1.100:10443\nLITERAL="$(echo should-not-run)"\n');
    writeFileSync(join(dir, 'bin/aws'), `#!${process.execPath}\nconsole.log(JSON.stringify({args:process.argv.slice(2), profile:process.env.AWS_PROFILE, name:process.env.SKILL_NAME, literal:process.env.LITERAL}));\n`, { mode: 0o755 });
    const env = { PATH: `${join(dir, 'bin')}:${process.env.PATH}` };
    const run = (args: string[], overrides = {}) => {
      const child = spawnSync(process.execPath, [join(dir, 'scripts/run.mjs'), 'aws', ...args], { env: { ...env, ...overrides }, encoding: 'utf8' });
      assert.equal(child.status, 0, child.stderr);
      return JSON.parse(child.stdout);
    };
    const loaded = run(['sts', 'get-caller-identity']);
    assert.equal(loaded.name, 'My Jetson Cameras');
    assert.equal(loaded.profile, 'from-file');
    assert.equal(loaded.literal, '$(echo should-not-run)');
    assert.deepEqual(loaded.args, ['sts', 'get-caller-identity', '--profile', 'from-file']);
    assert.equal(run(['--version'], { AWS_PROFILE: 'from-shell' }).profile, 'from-shell');
    assert.deepEqual(run(['--version', '--profile', 'explicit']).args, ['--version', '--profile', 'explicit']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
