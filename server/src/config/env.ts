import dotenv from 'dotenv';
import { parseOrigins, parseTrustProxy } from './parsers.js';
dotenv.config({ quiet: true });

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function list(name: string): string[] {
  return (process.env[name] ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

const nodeEnv = process.env.NODE_ENV ?? 'development';
const isProd = nodeEnv === 'production';

const sameSite = (process.env.COOKIE_SAMESITE ?? 'lax').toLowerCase();
if (!['lax', 'strict', 'none'].includes(sameSite)) {
  throw new Error('COOKIE_SAMESITE must be one of: lax, strict, none');
}

export const env = {
  nodeEnv,
  isProd,
  port: Number(process.env.PORT ?? 4000),
  dbUrl: required('DB_URL'),
  /** Browser origins allowed to call the API (CORS and the CSRF Origin check). CLIENT_ORIGIN may list several, comma-separated. */
  clientOrigins: parseOrigins(process.env.CLIENT_ORIGIN, 'http://localhost:5173'),
  /** Reverse proxies in front of the API. See parseTrustProxy. */
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY, isProd),
  logLevel: process.env.LOG_LEVEL ?? 'info',

  /** Signs the session cookie. Required in production; a fixed dev value is used locally. */
  sessionSecret: isProd ? required('SESSION_SECRET') : (process.env.SESSION_SECRET ?? 'dev-only-secret-change-me'),
  /** Use 'none' only when the client and API are on different sites (needs HTTPS). */
  cookieSameSite: sameSite as 'lax' | 'strict' | 'none',

  /** Google OAuth client id (Google Identity Services). Sign-in is disabled until this is set. */
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? '',
  /** Emails that become admins on sign-in. */
  adminEmails: list('ADMIN_EMAILS'),
  /** If non-empty, only these emails (plus admins) may sign in: keeps the app invite-only. */
  allowedEmails: list('ALLOWED_EMAILS'),
  /** Local testing helper: POST /auth/dev-login. Ignored in production. */
  devLogin: !isProd && process.env.AUTH_DEV_LOGIN === 'true',

  /** Only needed for the admin playlist import. */
  youtubeApiKey: process.env.YOUTUBE_API_KEY ?? '',
  /** Only needed for "Import from a Drive folder" on the admin Resources page. Falls back to the YouTube key if that key also has the Drive API enabled. */
  googleDriveApiKey: process.env.GOOGLE_DRIVE_API_KEY || process.env.YOUTUBE_API_KEY || '',
};
