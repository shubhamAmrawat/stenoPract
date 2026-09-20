import { OAuth2Client } from 'google-auth-library';
import { env } from '../config/env.js';
import { ApiError } from '../middleware/errors.js';

const client = new OAuth2Client();

export interface GoogleIdentity {
  sub: string;
  email: string;
  name: string;
  picture?: string;
}

/** Verifies a Google Identity Services ID token (signature, audience, expiry) and returns who signed in. */
export async function verifyGoogleIdToken(idToken: string): Promise<GoogleIdentity> {
  if (!env.googleClientId) {
    throw new ApiError(503, 'Google sign-in is not configured on this server', 'AUTH_NOT_CONFIGURED');
  }
  let payload;
  try {
    const ticket = await client.verifyIdToken({ idToken, audience: env.googleClientId });
    payload = ticket.getPayload();
  } catch {
    throw ApiError.unauthorized('Google sign-in could not be verified');
  }
  if (!payload?.sub || !payload.email || !payload.email_verified) {
    throw ApiError.unauthorized('Your Google email address is not verified');
  }
  return { sub: payload.sub, email: payload.email.toLowerCase(), name: payload.name ?? payload.email, picture: payload.picture };
}
