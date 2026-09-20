import { Router, type Request } from 'express';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { requireAuth } from '../../middleware/auth.js';
import { ApiError } from '../../middleware/errors.js';
import { authLimiter } from '../../middleware/security.js';
import { parse } from '../../middleware/validate.js';
import { ExamProfile, User } from '../../models/index.js';
import { canSignIn } from '../../services/access.js';
import { verifyGoogleIdToken } from '../../services/googleAuth.js';
import { getStorage } from '../../services/storage.js';
import { hashPassword, passwordProblem, verifyAgainstDummy, verifyPassword } from '../../services/password.js';

export const SESSION_COOKIE = 'steno.sid';

interface UserLike {
  _id: unknown;
  email: string;
  name: string;
  picture?: string | null;
  avatarKey?: string | null;
  googleId?: string | null;
  phone?: string | null;
  gender?: string | null;
  bio?: string | null;
  createdAt?: Date | null;
  role?: string | null;
  settings?: { examProfile?: string | null; category?: string | null } | null;
}

/** The picture to show: the student's own upload when there is one, otherwise their Google picture. */
export function pictureOf(u: Pick<UserLike, 'picture' | 'avatarKey'>): string | null {
  const storage = getStorage();
  return u.avatarKey && storage ? storage.urlFor(u.avatarKey) : (u.picture ?? null);
}

export function publicUser(u: UserLike) {
  return {
    id: String(u._id),
    email: u.email,
    name: u.name,
    picture: pictureOf(u),
    role: u.role === 'admin' ? 'admin' : 'user',
    settings: {
      examProfile: u.settings?.examProfile ?? 'SSC_C',
      category: u.settings?.category === 'reserved' ? 'reserved' : 'general',
    },
    phone: u.phone ?? null,
    gender: u.gender ?? null,
    bio: u.bio ?? null,
    signInMethod: u.googleId ? 'google' : 'password',
    memberSince: u.createdAt ? u.createdAt.toISOString() : null,
    /** Whether the student has a photo of their own (so "Remove photo" makes sense). */
    hasCustomPhoto: Boolean(u.avatarKey && getStorage()),
    /** Whether this server can accept photo uploads at all. */
    canUploadPhoto: getStorage() !== null,
  };
}

/** New session id on every sign-in (prevents session fixation). */
function startSession(req: Request, userId: string, sessionVersion: number): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) return reject(err);
      req.session.userId = userId;
      req.session.sv = sessionVersion;
      req.session.save((err2) => (err2 ? reject(err2) : resolve()));
    });
  });
}

async function signInWithGoogle(req: Request, identity: { sub: string; email: string; name: string; picture?: string }) {
  if (!(await canSignIn(identity.email))) {
    throw new ApiError(403, `${identity.email} has not been invited to this app yet. Ask the owner to add it, or sign in with another Google account.`, 'NOT_INVITED');
  }
  let user = await User.findOne({ googleId: identity.sub });
  if (!user) {
    const sameEmail = await User.findOne({ email: identity.email });
    if (sameEmail) {
      // Someone made an account with this email and a password, but nobody proved the address is theirs. Google has, so the
      // Google identity takes the account over. The password is dropped (it may belong to someone else) and any session opened
      // with it is ended.
      user = sameEmail;
      user.googleId = identity.sub;
      user.passwordHash = undefined;
      user.failedLogins = 0;
      user.lockedUntil = undefined;
      user.sessionVersion = (user.sessionVersion ?? 0) + 1;
    } else {
      user = new User({ googleId: identity.sub, email: identity.email, name: identity.name });
    }
  }
  if (!user.active) throw new ApiError(403, 'This account has been disabled', 'ACCOUNT_DISABLED');
  user.email = identity.email;
  if (!user.nameCustomised) user.name = identity.name;
  if (identity.picture) user.picture = identity.picture;
  user.lastLoginAt = new Date();
  // Only a Google sign-in (a verified email) can make someone an admin.
  if (env.adminEmails.includes(identity.email)) user.role = 'admin';
  await user.save();
  await startSession(req, String(user._id), user.sessionVersion ?? 0);
  return publicUser(user);
}

const MAX_FAILED_LOGINS = 8;
const LOCK_MINUTES = 15;
const emailSchema = z.string().trim().toLowerCase().email().max(254);
/** Owner accounts sign in with Google only, because their email is what proves they own the app. */
const isOwner = (u: { role?: string | null; email: string }) => u.role === 'admin' || env.adminEmails.includes(u.email);

export const authRouter = Router();

authRouter.post('/auth/google', authLimiter, async (req, res) => {
  const { credential } = parse(z.object({ credential: z.string().min(20).max(4000) }), req.body);
  const identity = await verifyGoogleIdToken(credential);
  res.json({ user: await signInWithGoogle(req, identity) });
});

authRouter.post('/auth/signup', authLimiter, async (req, res) => {
  const { name, email, password } = parse(z.object({ name: z.string().trim().min(1).max(80), email: emailSchema, password: z.string().max(200) }), req.body);
  if (!(await canSignIn(email))) {
    throw new ApiError(403, `${email} has not been invited to this app yet. Ask the owner to add it.`, 'NOT_INVITED');
  }
  if (env.adminEmails.includes(email)) throw new ApiError(409, 'This email signs in with Google. Use "Continue with Google".', 'USE_GOOGLE');
  const problem = passwordProblem(password, email);
  if (problem) throw ApiError.badRequest(problem);
  const existing = await User.findOne({ email }).lean();
  if (existing) {
    throw new ApiError(409, existing.googleId ? 'This email already signs in with Google. Use "Continue with Google".' : 'An account with this email already exists. Sign in instead.', 'EMAIL_TAKEN');
  }
  let user;
  try {
    user = await User.create({ email, name, passwordHash: await hashPassword(password), lastLoginAt: new Date() });
  } catch (err) {
    if ((err as { code?: number }).code === 11000) throw new ApiError(409, 'An account with this email already exists. Sign in instead.', 'EMAIL_TAKEN');
    throw err;
  }
  await startSession(req, String(user._id), user.sessionVersion ?? 0);
  res.status(201).json({ user: publicUser(user) });
});

authRouter.post('/auth/login', authLimiter, async (req, res) => {
  const { email, password } = parse(z.object({ email: emailSchema, password: z.string().min(1).max(200) }), req.body);
  const user = await User.findOne({ email });
  const now = new Date();
  if (user?.lockedUntil && user.lockedUntil > now) {
    const minutes = Math.ceil((user.lockedUntil.getTime() - now.getTime()) / 60_000);
    throw new ApiError(429, `Too many wrong passwords. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`, 'ACCOUNT_LOCKED');
  }
  let ok = false;
  if (user?.passwordHash && !isOwner(user)) ok = await verifyPassword(password, user.passwordHash);
  else await verifyAgainstDummy(password);
  if (!user || !ok) {
    if (user?.passwordHash) {
      const after = await User.findByIdAndUpdate(user._id, { $inc: { failedLogins: 1 } }, { returnDocument: 'after' }).lean();
      if ((after?.failedLogins ?? 0) >= MAX_FAILED_LOGINS) {
        await User.updateOne({ _id: user._id }, { $set: { failedLogins: 0, lockedUntil: new Date(now.getTime() + LOCK_MINUTES * 60_000) } });
      }
    }
    // Same answer whether the account exists, has no password, or the password is wrong.
    throw new ApiError(401, 'Incorrect email or password. If you normally use Google, choose "Continue with Google".', 'INVALID_CREDENTIALS');
  }
  if (!user.active) throw new ApiError(403, 'This account has been disabled', 'ACCOUNT_DISABLED');
  if (!(await canSignIn(email))) {
    throw new ApiError(403, `${email} has not been invited to this app yet. Ask the owner to add it.`, 'NOT_INVITED');
  }
  await User.updateOne({ _id: user._id }, { $set: { failedLogins: 0, lastLoginAt: now }, $unset: { lockedUntil: 1 } });
  await startSession(req, String(user._id), user.sessionVersion ?? 0);
  res.json({ user: publicUser(user) });
});

if (env.devLogin) {
  // Local testing only (AUTH_DEV_LOGIN=true, never in production): sign in without Google.
  authRouter.post('/auth/dev-login', authLimiter, async (req, res) => {
    const body = parse(z.object({ email: z.string().email(), name: z.string().min(1).max(80).optional() }), req.body);
    const email = body.email.toLowerCase();
    res.json({ user: await signInWithGoogle(req, { sub: `dev:${email}`, email, name: body.name ?? email.split('@')[0]! }) });
  });
}

authRouter.get('/auth/me', requireAuth, async (req, res) => {
  const user = await User.findById(req.user!.id).lean();
  res.json({ user: publicUser(user!) });
});

authRouter.post('/auth/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie(SESSION_COOKIE);
    res.json({ ok: true });
  });
});

authRouter.patch('/me/settings', requireAuth, async (req, res) => {
  const body = parse(
    z.object({ examProfile: z.string().min(1).max(20).optional(), category: z.enum(['general', 'reserved']).optional() }),
    req.body,
  );
  const set: Record<string, string> = {};
  if (body.examProfile) {
    const code = body.examProfile.toUpperCase();
    if (!(await ExamProfile.exists({ code, active: true }))) throw ApiError.badRequest('Unknown exam profile');
    set['settings.examProfile'] = code;
  }
  if (body.category) set['settings.category'] = body.category;
  const user = await User.findByIdAndUpdate(req.user!.id, { $set: set }, { returnDocument: 'after' }).lean();
  res.json({ user: publicUser(user!) });
});
