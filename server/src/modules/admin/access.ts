import { Router } from 'express';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { ApiError } from '../../middleware/errors.js';
import { parse } from '../../middleware/validate.js';
import { Invite, User } from '../../models/index.js';

export const adminAccessRouter = Router();

type Status = 'invited' | 'active' | 'removed';

interface Member {
  email: string;
  name: string | null;
  picture: string | null;
  role: 'admin' | 'user';
  status: Status;
  /** Set in the server settings (admin or ALLOWED_EMAILS): cannot be changed from here. */
  locked: 'admin' | 'server' | null;
  invitedAt: string | null;
  lastLoginAt: string | null;
}

const emailSchema = z.string().trim().toLowerCase().email().max(254);

/** Everyone who is invited or has ever signed in, one row per email. */
adminAccessRouter.get('/access', async (_req, res) => {
  const [invites, users] = await Promise.all([Invite.find().lean(), User.find().sort({ createdAt: 1 }).limit(1000).lean()]);
  const inviteOnly = env.isProd || env.allowedEmails.length > 0 || invites.length > 0;
  const invitedAt = new Map(invites.map((i) => [i.email, i.createdAt?.toISOString() ?? null]));
  const listed = (email: string) => env.adminEmails.includes(email) || env.allowedEmails.includes(email);
  const lockOf = (email: string): Member['locked'] => (env.adminEmails.includes(email) ? 'admin' : env.allowedEmails.includes(email) ? 'server' : null);
  const byEmail = new Map<string, Member>();

  for (const email of [...invitedAt.keys(), ...env.adminEmails, ...env.allowedEmails]) {
    byEmail.set(email, {
      email, name: null, picture: null, role: env.adminEmails.includes(email) ? 'admin' : 'user',
      status: 'invited', locked: lockOf(email), invitedAt: invitedAt.get(email) ?? null, lastLoginAt: null,
    });
  }
  for (const u of users) {
    const allowed = invitedAt.has(u.email) || listed(u.email) || !inviteOnly;
    byEmail.set(u.email, {
      email: u.email, name: u.name, picture: u.picture ?? null, role: u.role === 'admin' ? 'admin' : 'user',
      status: u.active && allowed ? 'active' : 'removed', locked: lockOf(u.email),
      invitedAt: invitedAt.get(u.email) ?? null, lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    });
  }

  const order: Record<Status, number> = { active: 0, invited: 1, removed: 2 };
  const members = [...byEmail.values()].sort((a, b) => order[a.status] - order[b.status] || a.email.localeCompare(b.email));
  res.json({ members, inviteOnly });
});

/** Invite one or more emails. Re-inviting someone who was removed restores their account. */
adminAccessRouter.post('/access', async (req, res) => {
  const { emails } = parse(z.object({ emails: z.array(z.string().trim().max(254)).min(1).max(50) }), req.body);
  const invited: string[] = [];
  const already: string[] = [];
  const invalid: string[] = [];
  for (const raw of new Set(emails.map((e) => e.toLowerCase()))) {
    const ok = emailSchema.safeParse(raw);
    if (!ok.success) { invalid.push(raw); continue; }
    const email = ok.data;
    const existing = await Invite.exists({ email });
    if (existing) { already.push(email); continue; }
    await Invite.create({ email, invitedBy: req.user!.email });
    await User.updateOne({ email }, { $set: { active: true } });
    invited.push(email);
  }
  res.json({ invited, already, invalid });
});

/** Takes away someone's access: they can no longer sign in, and an open session ends on its next request. */
adminAccessRouter.delete('/access/:email', async (req, res) => {
  const email = emailSchema.parse(String(req.params.email));
  if (email === req.user!.email) throw ApiError.badRequest('You cannot remove your own access.');
  if (env.adminEmails.includes(email)) throw ApiError.badRequest('This email is an admin set in the server settings (ADMIN_EMAILS).');
  if (env.allowedEmails.includes(email)) throw ApiError.badRequest('This email is set in the server settings (ALLOWED_EMAILS). Remove it there.');
  const removed = await Invite.deleteOne({ email });
  const user = await User.updateOne({ email }, { $set: { active: false } });
  if (removed.deletedCount === 0 && user.matchedCount === 0) throw ApiError.notFound('That email is not on the list');
  res.json({ ok: true });
});
