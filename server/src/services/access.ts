import { env } from '../config/env.js';
import { Invite } from '../models/index.js';
import { isSignupOpen } from './settings.js';

interface AccessConfig {
  adminEmails: string[];
  allowedEmails: string[];
  /** True when anyone may create an account (the default; an admin can turn it off). */
  signupOpen?: boolean;
}

/**
 * Who may sign in or create an account.
 *  - When sign-up is open, everyone.
 *  - Otherwise (invite-only): admin emails and the ALLOWED_EMAILS list (server settings) are always allowed, so is anyone
 *    the owner invited from Admin → Access. Nobody else.
 * A removed account is refused separately, whatever this returns.
 */
export async function isEmailAllowed(email: string, cfg: AccessConfig = { ...env }): Promise<boolean> {
  if (cfg.signupOpen) return true;
  const e = email.toLowerCase();
  if (cfg.adminEmails.includes(e) || cfg.allowedEmails.includes(e)) return true;
  return (await Invite.exists({ email: e })) !== null;
}

/** isEmailAllowed with the current sign-up switch applied. Use this in the sign-in and sign-up routes. */
export async function canSignIn(email: string): Promise<boolean> {
  return isEmailAllowed(email, { ...env, signupOpen: await isSignupOpen() });
}
