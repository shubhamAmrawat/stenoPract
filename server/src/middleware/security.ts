import type { RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';
import { ApiError } from './errors.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence for cookie sessions: a browser always sends Origin on cross-site
 * state-changing requests, so reject any whose Origin is not our client.
 * (Requests without an Origin header - curl, server-to-server - carry no browser cookie risk.)
 */
export const originCheck: RequestHandler = (req, _res, next) => {
  if (SAFE_METHODS.has(req.method)) return next();
  const origin = req.get('origin');
  if (origin && !env.clientOrigins.includes(origin)) throw ApiError.forbidden('Cross-origin request blocked');
  next();
};

const json429 = {
  handler: ((_req, res) => {
    res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many requests, please slow down' } });
  }) as RequestHandler,
};

/** Skipped under test so suites can hammer endpoints. */
const skip = () => process.env.NODE_ENV === 'test';

export const apiLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 600, standardHeaders: 'draft-8', legacyHeaders: false, skip, ...json429 });
export const authLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false, skip, ...json429 });
export const submitLimiter = rateLimit({ windowMs: 60 * 60_000, limit: 40, standardHeaders: 'draft-8', legacyHeaders: false, skip, ...json429 });
export const reportLimiter = rateLimit({ windowMs: 24 * 60 * 60_000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false, skip, ...json429 });
export const avatarLimiter = rateLimit({ windowMs: 60 * 60_000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false, skip, ...json429 });
/** Each uploaded page costs an API call, so cap how many an admin session can send in an hour. */
export const scanUploadLimiter = rateLimit({ windowMs: 60 * 60_000, limit: 400, standardHeaders: 'draft-8', legacyHeaders: false, skip, ...json429 });
