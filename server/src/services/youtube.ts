import { env } from '../config/env.js';
import { ApiError } from '../middleware/errors.js';

export interface PlaylistVideo {
  videoId: string;
  title: string;
  position: number;
}

/**
 * "100 WPM | Exercise 507 | Kailash Chandra Vol 24" -> { baseWpm: 100, exerciseNo: 507 }
 * Returns null when either number cannot be found.
 */
export function parseVideoTitle(title: string): { baseWpm: number; exerciseNo: number } | null {
  const wpm = title.match(/(\d{2,3})\s*-?\s*WPM/i);
  const ex = title.match(/Exercise\s*(?:No\.?|Number|#)?\s*(\d{1,5})/i);
  if (!wpm || !ex) return null;
  return { baseWpm: Number(wpm[1]), exerciseNo: Number(ex[1]) };
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
