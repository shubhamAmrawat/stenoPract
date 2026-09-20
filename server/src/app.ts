import cors from 'cors';
import express from 'express';
import session from 'express-session';
import helmet from 'helmet';
import mongoose from 'mongoose';
import { env } from './config/env.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import { requestLogger } from './middleware/requestLogger.js';
import { apiLimiter, originCheck } from './middleware/security.js';
import { SESSION_COOKIE } from './modules/auth/routes.js';
import { apiRouter } from './routes.js';

export interface AppOptions {
  /** Where sessions are stored. Defaults to memory (fine for tests only). */
  sessionStore?: session.Store;
}

export function createApp(options: AppOptions = {}): express.Express {
  const app = express();

  // Behind Render/Railway/Nginx the client's real IP and https-ness come from a proxy header.
  if (env.isProd) app.set('trust proxy', 1);

  app.use(requestLogger);
  app.use(helmet());
  app.use(cors({ origin: env.clientOrigin, credentials: true }));
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/v1/health', (_req, res) => {
    res.json({
      status: 'ok',
      db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
      uptimeSeconds: Math.round(process.uptime()),
    });
  });

  app.use(
    session({
      name: SESSION_COOKIE,
      secret: env.sessionSecret,
      resave: false,
      saveUninitialized: false,
      store: options.sessionStore,
      cookie: {
        httpOnly: true,
        secure: env.isProd,
        sameSite: env.cookieSameSite,
        maxAge: 30 * 24 * 60 * 60 * 1000,
      },
    }),
  );

  app.use('/api/v1', apiLimiter, originCheck, apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
