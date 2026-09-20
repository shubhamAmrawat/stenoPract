import pino from 'pino';
import pretty from 'pino-pretty';
import { env } from './env.js';

const isProd = env.nodeEnv === 'production';

// Dev: coloured, human-readable lines. Prod: one JSON object per line
// (what log platforms such as Render/Railway/Datadog expect).
const prettyStream = pretty({
  colorize: true,
  translateTime: 'HH:MM:ss',
  ignore: 'pid,hostname,req,res,responseTime,reqId',
  singleLine: false,
  sync: true,
});

export const logger = pino(
  {
    level: env.logLevel,
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
      censor: '[redacted]',
    },
  },
  isProd ? undefined : prettyStream,
);
