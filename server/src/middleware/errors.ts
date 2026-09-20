import type { ErrorRequestHandler, RequestHandler } from 'express';

/** Throw this from anywhere in a route/service to send a clean JSON error. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  static badRequest(message: string, details?: unknown) { return new ApiError(400, message, 'BAD_REQUEST', details); }
  static unauthorized(message = 'Please sign in') { return new ApiError(401, message, 'UNAUTHORIZED'); }
  static forbidden(message = 'You do not have access to this') { return new ApiError(403, message, 'FORBIDDEN'); }
  static notFound(message = 'Not found') { return new ApiError(404, message, 'NOT_FOUND'); }
  static conflict(message: string) { return new ApiError(409, message, 'CONFLICT'); }
}

export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (res.headersSent) return;

  if (err instanceof ApiError) {
    res.status(err.status).json({ error: { code: err.code ?? 'ERROR', message: err.message, details: err.details } });
    return;
  }

  // Malformed JSON body etc. (body-parser sets err.status / err.type)
  const status = typeof err?.status === 'number' ? err.status : undefined;
  if (status && status >= 400 && status < 500) {
    res.status(status).json({ error: { code: 'BAD_REQUEST', message: err.message } });
    return;
  }

  // pino-http logs this once, with the real error + stack, when the response finishes.
  res.err = err instanceof Error ? err : new Error(String(err));
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong' } });
};
