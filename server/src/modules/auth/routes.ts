import { Router, type Request } from 'express';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { requireAuth } from '../../middleware/auth.js';
import { ApiError } from '../../middleware/errors.js';
import { authLimiter } from '../../middleware/security.js';
import { parse } from '../../middleware/validate.js';
import { ExamProfile, User } from '../../models/index.js';
import { isEmailAllowed } from '../../services/access.js';
import { verifyGoogleIdToken } from '../../services/googleAuth.js';

export const SESSION_COOKIE = 'steno.sid';

interface UserLike {
  _id: unknown;
  email: string;
  name: string;
  picture?: string | null;
  role?: string | null;
  settings?: { examProfile?: string | null; category?: string | null } | null;
}

export function publicUser(u: UserLike) {
  return {
    id: String(u._id),
    email: u.email,
    name: u.name,
    picture: u.picture ?? null,
    role: u.role === 'admin' ? 'admin' : 'user',
    settings: {
      examProfile: u.settings?.examProfile ?? 'SSC_C',
      category: u.settings?.category === 'reserved' ? 'reserved' : 'general',
    },
  };
}

/** New session id on every sign-in (prevents session fixation). */
function startSession(req: Request, userId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) return reject(err);
      req.session.userId = userId;
      req.session.save((err2) => (err2 ? reject(err2) : resolve()));
    });
  });
}

async function signIn(req: Request, identity: { sub: string; email: string; name: string; picture?: string }) {
  if (!(await isEmailAllowed(identity.email))) {
    throw new ApiError(403, `${identity.email} has not been invited to this app yet. Ask the owner to add it, or sign in with another Google account.`, 'NOT_INVITED');
  }
  const isAdmin = env.adminEmails.includes(identity.email);
  const user = await User.findOneAndUpdate(
    { googleId: identity.sub },
    {
      $set: {
        email: identity.email,
        name: identity.name,
        picture: identity.picture,
        lastLoginAt: new Date(),
        ...(isAdmin ? { role: 'admin' } : {}),
      },
      $setOnInsert: { googleId: identity.sub },
    },
    { upsert: true, returnDocument: 'after', runValidators: true },
  ).lean();
  if (!user.active) throw ApiError.forbidden('This account has been disabled');
  await startSession(req, String(user._id));
  return publicUser(user);
}

export const authRouter = Router();

authRouter.post('/auth/google', authLimiter, async (req, res) => {
  const { credential } = parse(z.object({ credential: z.string().min(20).max(4000) }), req.body);
  const identity = await verifyGoogleIdToken(credential);
  res.json({ user: await signIn(req, identity) });
});

if (env.devLogin) {
  // Local testing only (AUTH_DEV_LOGIN=true, never in production): sign in without Google.
  authRouter.post('/auth/dev-login', authLimiter, async (req, res) => {
    const body = parse(z.object({ email: z.string().email(), name: z.string().min(1).max(80).optional() }), req.body);
    const email = body.email.toLowerCase();
    res.json({ user: await signIn(req, { sub: `dev:${email}`, email, name: body.name ?? email.split('@')[0]! }) });
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
