import { env } from '../config/env.js';
import { ApiError } from '../middleware/errors.js';

export interface PlaylistVideo {
  videoId: string;
  title: string;
  position: number;
}

export interface ParsedTitle {
  exerciseNo: number;
  /** null when the title does not state a speed (the admin can supply a default). */
  baseWpm: number | null;
}

// "Exercise 507", "Transcription No. 485", "Transcript #12": a bare number after the word is fine.
const STRONG_EXERCISE = /\b(?:exercise|transcription|transcript)\s*(?:no\.?|number|#)?\s*[:.-]?\s*(\d{1,5})(?!\d)(?!\s*-?\s*w\.?\s?p\.?\s?m)/i;
// "Dictation No. 12", "Passage #7": here the marker is required, so "Shorthand Dictation 100 WPM" is not read as exercise 100.
const WEAK_EXERCISE = /\b(?:dictation|passage)\s*(?:no\.?|number|#)\s*[:.-]?\s*(\d{1,5})(?!\d)(?!\s*-?\s*w\.?\s?p\.?\s?m)/i;
// "100 WPM", "@100wpm", "100-wpm", "100 w.p.m", "100 words per minute"
const SPEED = /(?<!\d)(\d{2,3})\s*(?:-?\s*w\.?\s?p\.?\s?m\b|words?\s*(?:per|a|\/)\s*min)/gi;

export const MIN_WPM = 40;
export const MAX_WPM = 200;

/**
 * Reads an exercise number and (when present) a speed out of a video title:
 *   "100 WPM | Exercise 507 | Kailash Chandra Vol 24"          -> { exerciseNo: 507, baseWpm: 100 }
 *   "Transcription No. 485 | Kailash Chandra Shorthand Dictation" -> { exerciseNo: 485, baseWpm: null }
 * Returns null only when no exercise number can be found. Speeds outside 40-200 are ignored.
 */
export function parseVideoTitle(title: string): ParsedTitle | null {
  const ex = title.match(STRONG_EXERCISE) ?? title.match(WEAK_EXERCISE);
  if (!ex) return null;
  let baseWpm: number | null = null;
  for (const m of title.matchAll(SPEED)) {
    const n = Number(m[1]);
    if (n >= MIN_WPM && n <= MAX_WPM) {
      baseWpm = n;
      break;
    }
  }
  return { exerciseNo: Number(ex[1]), baseWpm };
}

interface PlaylistItemsResponse {
  items?: { snippet?: { title?: string; position?: number; resourceId?: { videoId?: string } } }[];
  nextPageToken?: string;
  error?: { message?: string };
}

/**
 * Reads a playlist with YouTube Data API v3 playlistItems.list (1 quota unit per 50 videos).
 * We only keep the video id, title and position: no media is downloaded or stored.
 */
export async function fetchPlaylistVideos(playlistId: string): Promise<PlaylistVideo[]> {
  if (!env.youtubeApiKey) {
    throw new ApiError(503, 'YOUTUBE_API_KEY is not configured on the server', 'YOUTUBE_NOT_CONFIGURED');
  }
  const videos: PlaylistVideo[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL('https://www.googleapis.com/youtube/v3/playlistItems');
    url.searchParams.set('part', 'snippet');
    url.searchParams.set('maxResults', '50');
    url.searchParams.set('playlistId', playlistId);
    url.searchParams.set('key', env.youtubeApiKey);
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const res = await fetch(url);
    const body = (await res.json()) as PlaylistItemsResponse;
    if (!res.ok) throw new ApiError(502, `YouTube API error: ${body.error?.message ?? res.status}`, 'YOUTUBE_ERROR');

    for (const item of body.items ?? []) {
      const videoId = item.snippet?.resourceId?.videoId;
      const title = item.snippet?.title ?? '';
      if (!videoId || title === 'Private video' || title === 'Deleted video') continue;
      videos.push({ videoId, title, position: item.snippet?.position ?? videos.length });
    }
    pageToken = body.nextPageToken;
  } while (pageToken);
  return videos;
}

/** Accepts a bare playlist id or any youtube.com URL containing ?list=... */
export function extractPlaylistId(input: string): string | null {
  const trimmed = input.trim();
  const fromUrl = trimmed.match(/[?&]list=([A-Za-z0-9_-]+)/);
  if (fromUrl) return fromUrl[1]!;
  return /^[A-Za-z0-9_-]{10,}$/.test(trimmed) ? trimmed : null;
}
