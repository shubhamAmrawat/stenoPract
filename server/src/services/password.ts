import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

/**
 * Password hashing with scrypt from Node's standard library (no native add-on to install).
 * N=2^14, r=8, p=5 is one of the equivalent settings OWASP lists (16 MiB of memory). The settings are stored inside each
 * hash, so they can be raised later without breaking existing passwords.
 */
const PROD = { N: 2 ** 14, r: 8, p: 5 };
const FAST = { N: 2 ** 10, r: 8, p: 1 }; // tests only: keeps the suite quick
const KEY_LENGTH = 64;

const params = () => (process.env.NODE_ENV === 'test' ? FAST : PROD);

function derive(password: string, salt: Buffer, opts: { N: number; r: number; p: number }): Promise<Buffer> {
  const options: ScryptOptions = { ...opts, maxmem: 256 * opts.N * opts.r };
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFKC'), salt, KEY_LENGTH, options, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

export async function hashPassword(password: string): Promise<string> {
  const p = params();
  const salt = randomBytes(16);
  const key = await derive(password, salt, p);
  return ['scrypt', p.N, p.r, p.p, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !n || !r || !p || !salt || !hash) return false;
  const opts = { N: Number(n), r: Number(r), p: Number(p) };
  if (![opts.N, opts.r, opts.p].every(Number.isInteger) || opts.N > 2 ** 20) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = await derive(password, Buffer.from(salt, 'base64'), opts);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

let dummy: Promise<string> | undefined;
/** Burns the same time as a real check, so "no such account" and "wrong password" take equally long to answer. */
export async function verifyAgainstDummy(password: string): Promise<void> {
  dummy ??= hashPassword('not-a-real-password');
  await verifyPassword(password, await dummy);
}

const COMMON = new Set([
  'password', 'password1', 'password12', 'password123', 'passw0rd', '12345678', '123456789', '1234567890', '11111111', '00000000',
  'qwertyui', 'qwerty123', 'qwertyuiop', 'abc12345', 'abcd1234', 'iloveyou', 'letmein1', 'welcome1', 'admin123', 'steno123', 'sscsteno',
]);

/** Returns a problem to show the user, or null when the password is acceptable. Length matters more than symbols. */
export function passwordProblem(password: string, email?: string): string | null {
  if (password.length < 8) return 'Use at least 8 characters.';
  if (password.length > 128) return 'Use at most 128 characters.';
  const lower = password.toLowerCase();
  if (COMMON.has(lower)) return 'That password is too common. Choose something harder to guess.';
  if (email && (lower === email.toLowerCase() || lower === email.split('@')[0]?.toLowerCase())) return 'Your password cannot be your email address.';
  if (/^(.)\1+$/.test(password)) return 'Your password cannot be one repeated character.';
  return null;
}
