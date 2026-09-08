export interface Login { username: string; password: string; userPoolId: string }
export interface UserOperations {
  find(): 'missing' | 'CONFIRMED' | 'FORCE_CHANGE_PASSWORD' | string;
  save(login: Login): void;
  create(): void;
  setPassword(password: string): void;
}
// Persist recovery credentials before mutating AWS. Resume never resets a confirmed user.
export function provisionUser(mode: 'create' | 'resume' | 'reset', login: Login, ops: UserOperations) {
  const status = ops.find();
  if (mode === 'create' && status !== 'missing') throw new Error('User already exists. Use user --reset only to intentionally replace its password.');
  if (mode === 'reset' && status === 'missing') throw new Error('User does not exist. Run user without --reset.');
  if (mode === 'resume' && status === 'CONFIRMED') return 'already-confirmed';
  if (mode === 'resume' && !['missing', 'FORCE_CHANGE_PASSWORD'].includes(status))
    throw new Error('User is not in a resumable state. Inspect it in Cognito before proceeding.');
  ops.save(login);
  if (status === 'missing') ops.create();
  ops.setPassword(login.password);
  return 'completed';
}
