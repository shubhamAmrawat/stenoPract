import { Router } from 'express';
import { z } from 'zod';
import { ApiError } from '../../middleware/errors.js';
import { parse } from '../../middleware/validate.js';
import { Abbreviation, AlternateForm, ExamProfile } from '../../models/index.js';
import { invalidateLexicon } from '../../services/lexicon.js';

export const adminConfigRouter = Router();

// ---------- exam profiles ----------

const profileBody = z.object({
  name: z.string().trim().min(1).max(80),
  wpm: z.number().int().min(20).max(300),
  durationMin: z.number().int().min(1).max(180),
  words: z.number().int().min(50).max(5000),
  limits: z.object({ general: z.number().min(0).max(100), reserved: z.number().min(0).max(100) }),
  rules: z.object({ commas: z.enum(['ignore', 'half']) }).default({ commas: 'ignore' }),
  active: z.boolean().default(true),
  verifiedAgainstNotice: z.boolean().default(false),
});

const publicProfile = (p: {
  code: string; name: string; wpm: number; durationMin: number; words: number;
  limits?: { general: number; reserved: number } | null; rules?: { commas?: string | null } | null;
  rulesVersion?: number | null; active?: boolean | null; verifiedAgainstNotice?: boolean | null;
}) => ({
  code: p.code,
  name: p.name,
  wpm: p.wpm,
  durationMin: p.durationMin,
  words: p.words,
  limits: p.limits,
  rules: { commas: p.rules?.commas ?? 'ignore' },
  rulesVersion: p.rulesVersion ?? 1,
  active: p.active ?? true,
  verifiedAgainstNotice: p.verifiedAgainstNotice ?? false,
});

adminConfigRouter.get('/exam-profiles', async (_req, res) => {
  const items = await ExamProfile.find().sort({ code: 1 }).lean();
  res.json({ items: items.map(publicProfile) });
});

// Create or replace a profile. Changing limits or rules bumps rulesVersion so old and new gradings can be told apart.
adminConfigRouter.put('/exam-profiles/:code', async (req, res) => {
  const code = parse(z.string().regex(/^[A-Za-z0-9_]{2,20}$/), req.params.code).toUpperCase();
  const body = parse(profileBody, req.body);
  const existing = await ExamProfile.findOne({ code }).lean();
  const gradingChanged =
    !existing ||
    existing.limits?.general !== body.limits.general ||
    existing.limits?.reserved !== body.limits.reserved ||
    (existing.rules?.commas ?? 'ignore') !== body.rules.commas;

  const profile = await ExamProfile.findOneAndUpdate(
    { code },
    { $set: { ...body, code }, ...(existing && gradingChanged ? { $inc: { rulesVersion: 1 } } : {}), ...(!existing ? { $setOnInsert: { rulesVersion: 1 } } : {}) },
    { upsert: true, returnDocument: 'after', runValidators: true },
  ).lean();
  res.json({ profile: publicProfile(profile) });
});

// ---------- alternate forms (words accepted for one another) ----------

const altBody = z.object({
  canonical: z.string().trim().toLowerCase().min(1).max(40),
  variants: z.array(z.string().trim().toLowerCase().min(1).max(40)).min(1).max(20),
  note: z.string().max(200).optional(),
});

adminConfigRouter.get('/alternate-forms', async (_req, res) => {
  const items = await AlternateForm.find().sort({ canonical: 1 }).lean();
  res.json({ items: items.map((a) => ({ canonical: a.canonical, variants: a.variants, note: a.note ?? null })) });
});

adminConfigRouter.put('/alternate-forms', async (req, res) => {
  const body = parse(altBody, req.body);
  const variants = [...new Set([body.canonical, ...body.variants])];
  const doc = await AlternateForm.findOneAndUpdate(
    { canonical: body.canonical },
    { $set: { variants, note: body.note } },
    { upsert: true, returnDocument: 'after' },
  ).lean();
  invalidateLexicon();
  res.json({ item: { canonical: doc.canonical, variants: doc.variants, note: doc.note ?? null } });
});

adminConfigRouter.delete('/alternate-forms/:canonical', async (req, res) => {
  const r = await AlternateForm.deleteOne({ canonical: String(req.params.canonical).toLowerCase() });
  if (r.deletedCount === 0) throw ApiError.notFound('Not found');
  invalidateLexicon();
  res.json({ ok: true });
});

// ---------- abbreviations ----------

const abbrBody = z.object({
  abbr: z.string().trim().toLowerCase().min(1).max(20),
  expansions: z.array(z.string().trim().toLowerCase().min(1).max(40)).max(10),
  dotted: z.boolean().default(false),
});

adminConfigRouter.get('/abbreviations', async (_req, res) => {
  const items = await Abbreviation.find().sort({ abbr: 1 }).lean();
  res.json({ items: items.map((a) => ({ abbr: a.abbr, expansions: a.expansions, dotted: a.dotted ?? false })) });
});

adminConfigRouter.put('/abbreviations', async (req, res) => {
  const body = parse(abbrBody, req.body);
  const doc = await Abbreviation.findOneAndUpdate({ abbr: body.abbr }, { $set: body }, { upsert: true, returnDocument: 'after' }).lean();
  invalidateLexicon();
  res.json({ item: { abbr: doc.abbr, expansions: doc.expansions, dotted: doc.dotted ?? false } });
});

adminConfigRouter.delete('/abbreviations/:abbr', async (req, res) => {
  const r = await Abbreviation.deleteOne({ abbr: String(req.params.abbr).toLowerCase() });
  if (r.deletedCount === 0) throw ApiError.notFound('Not found');
  invalidateLexicon();
  res.json({ ok: true });
});
