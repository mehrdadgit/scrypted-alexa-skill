import { timingSafeEqual } from 'node:crypto';

export function authorized(header: string | undefined, secret: string | null) {
  if (!secret || secret.length < 32 || typeof header !== 'string') return false;
  const received = Buffer.from(header);
  const expected = Buffer.from(`Bearer ${secret}`);
  return received.length === expected.length && timingSafeEqual(received, expected);
}
