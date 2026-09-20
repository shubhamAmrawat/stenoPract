import 'express-session';
import type { RequestHandler } from 'express';
import { User } from '../models/index.js';
import { ApiError } from './errors.js';

declare module 'express-session' {
  interface SessionData {
    userId?: string;
  }
}

declare module 'express-serve-static-core' {
  interface Request {
    /** Set by requireAuth. */
    user?: { id: string; email: string; name: string; role: 'user' | 'admin'; settings: { examProfile: string; category: 'general' | 'reserved' } };
  }
}

/** Loads the signed-in user from the session, or responds 401. */
export const requireAuth: RequestHandler = async (req, _res, next) => {
  const userId = req.session.userId;
  if (!userId) throw ApiError.unauthorized();

  const user = await User.findById(userId).lean();
  if (!user || !user.active) {
    // The account was removed or disabled after the cookie was issued.
    await new Promise<void>((resolve) => req.session.destroy(() => resolve()));
    throw ApiError.unauthorized();
  }

  req.user = {
    id: String(user._id),
    email: user.email,
    name: user.name,
    role: user.role === 'admin' ? 'admin' : 'user',
    settings: {
      examProfile: user.settings?.examProfile ?? 'SSC_C',
      category: user.settings?.category === 'reserved' ? 'reserved' : 'general',
    },
  };
  next();
};

export const requireAdmin: RequestHandler = (req, _res, next) => {
  if (req.user?.role !== 'admin') throw ApiError.forbidden('Admins only');
  next();
};
