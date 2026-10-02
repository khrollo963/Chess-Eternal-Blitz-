import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const opaqueToken = () => randomBytes(32).toString('base64url');
export const inviteCode = () => randomBytes(9).toString('base64url').toUpperCase();
export const credentialHash = (credential: string) => createHash('sha256').update(credential).digest('hex');
export function verifyCredential(credential: unknown, hash: string): boolean {
  if (typeof credential !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(credential) || !/^[a-f0-9]{64}$/.test(hash)) return false;
  return timingSafeEqual(Buffer.from(credentialHash(credential), 'hex'), Buffer.from(hash, 'hex'));
}
export function displayName(input: unknown): string {
  if (typeof input !== 'string' || input.length < 1 || input.length > 32 || /[<>\u0000-\u001f\u007f]/.test(input) || !input.trim()) throw new Error('invalid_name');
  return input.trim();
}
