import type { Types } from 'mongoose';
import { UserDictationState } from '../../models/index.js';

interface DictationLike {
  _id: unknown;
  setId: unknown;
  exerciseNo: number;
  title: string;
  videos?: { youtubeVideoId: string; baseWpm: number; title?: string | null }[] | null;
  masterWordCount?: number | null;
  tags?: string[] | null;
  activeTextVersion?: number | null;
  published?: boolean | null;
}

interface StateLike {
  dictationId: unknown;
  seen?: boolean | null;
  favourite?: boolean | null;
  folderIds?: unknown[] | null;
  attemptsCount?: number | null;
  bestErrorPct?: number | null;
  lastErrorPct?: number | null;
  lastAttemptAt?: Date | null;
}

export type StateMap = Map<string, StateLike>;

export async function loadStates(userId: string, dictationIds: unknown[]): Promise<StateMap> {
  const states = await UserDictationState.find({ userId, dictationId: { $in: dictationIds as Types.ObjectId[] } }).lean();
  return new Map(states.map((s) => [String(s.dictationId), s]));
}

export function publicState(s?: StateLike) {
  return {
    seen: s?.seen ?? false,
    favourite: s?.favourite ?? false,
    folderIds: (s?.folderIds ?? []).map(String),
    attemptsCount: s?.attemptsCount ?? 0,
    bestErrorPct: s?.bestErrorPct ?? null,
    lastErrorPct: s?.lastErrorPct ?? null,
    lastAttemptAt: s?.lastAttemptAt ?? null,
  };
}

/** Never includes the transcript: that is only ever returned after a submitted attempt. */
export function publicDictation(d: DictationLike, state?: StateLike) {
  return {
    id: String(d._id),
    setId: String(d.setId),
    exerciseNo: d.exerciseNo,
    title: d.title,
    videos: (d.videos ?? []).map((v) => ({ youtubeVideoId: v.youtubeVideoId, baseWpm: v.baseWpm, title: v.title ?? null })),
    masterWordCount: d.masterWordCount ?? 0,
    tags: d.tags ?? [],
    ready: d.activeTextVersion != null,
    state: publicState(state),
  };
}
