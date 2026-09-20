import { randomUUID } from 'node:crypto';
import { pinoHttp } from 'pino-http';
import { logger } from '../config/logger.js';

export const requestLogger = pinoHttp({
  logger,
  genReqId: (req, res) => {
    const incoming = req.headers['x-request-id'];
    const id = typeof incoming === 'string' && incoming.length <= 100 ? incoming : randomUUID();
    res.setHeader('x-request-id', id);
    return id;
  },
  customLogLevel: (_req, res, err) => {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  customSuccessMessage: (req, res, ms) => `${req.method} ${req.url} ${res.statusCode} ${Math.round(ms)}ms`,
  customErrorMessage: (req, res, err) => `${req.method} ${req.url} ${res.statusCode} ${err.message}`,
  serializers: {
    // ip is the client address Express derives with TRUST_PROXY: check it against your real IP after deploying.
    req: (req) => ({ id: req.id, method: req.method, url: req.url, ip: (req as { ip?: string }).ip }),
    res: (res) => ({ statusCode: res.statusCode }),
  },
});
