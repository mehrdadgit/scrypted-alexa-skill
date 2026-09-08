import { test } from 'node:test';
import assert from 'node:assert/strict';
import { provisionUser, UserOperations } from '../scripts/user-operation';
const login = { username: 'person@example.com', password: 'private-password', userPoolId: 'test-pool' };
test('credentials survive interruption and resume finishes pending password setup', () => {
  let status = 'missing'; let saved = false; let creates = 0; let fail = true;
  const ops: UserOperations = {
    find: () => status,
    save: () => { saved = true; },
    create: () => { assert.ok(saved); status = 'FORCE_CHANGE_PASSWORD'; creates++; },
    setPassword: p => { assert.equal(p, login.password); if (fail) throw new Error('network'); status = 'CONFIRMED'; },
  };
  assert.throws(() => provisionUser('create', login, ops), /network/);
  fail = false;
  assert.equal(provisionUser('resume', login, ops), 'completed');
  assert.equal(creates, 1);
  ops.setPassword = () => assert.fail('must not reset confirmed account');
  assert.equal(provisionUser('resume', login, ops), 'already-confirmed');
});
test('existing accounts require explicit reset; unexpected states fail closed', () => {
  const calls: string[] = [];
  const ops: UserOperations = { find: () => 'CONFIRMED', save: () => { calls.push('save'); }, create: () => assert.fail(), setPassword: () => { calls.push('password'); } };
  assert.throws(() => provisionUser('create', login, ops), /already exists/);
  assert.deepEqual(calls, []);
  provisionUser('reset', login, ops);
  assert.deepEqual(calls, ['save', 'password']);
  ops.find = () => 'RESET_REQUIRED';
  assert.throws(() => provisionUser('resume', login, ops), /resumable/);
  ops.find = () => 'missing';
  assert.throws(() => provisionUser('reset', login, ops), /does not exist/);
});
