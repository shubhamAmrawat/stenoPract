import { env } from '../config/env.js';
import { Invite } from '../models/index.js';

interface AccessConfig {
  isProd: boolean;
  adminEmails: string[];
  allowedEmails: string[];
}

/**
 * Who may sign in.
 *  - Admin emails and the ALLOWED_EMAILS list (server settings) are always allowed.
 *  - Anyone the owner invited from Admin → Access is allowed.
 *  - Otherwise nobody, except while running locally with nothing configured at all
 *    (no allow-list and no invites), so a fresh dev database stays easy to try out.
 *    Production is always closed.
 */
export async function isEmailAllowed(email: string, cfg: AccessConfig = env): Promise<boolean> {
  const e = email.toLowerCase();
  if (cfg.adminEmails.includes(e) || cfg.allowedEmails.includes(e)) return true;
  if (await Invite.exists({ email: e })) return true;
  if (cfg.isProd || cfg.allowedEmails.length > 0) return false;
  return (await Invite.estimatedDocumentCount()) === 0;
}
