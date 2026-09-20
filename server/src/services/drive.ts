import { env } from '../config/env.js';
import { ApiError } from '../middleware/errors.js';

const FOLDER_MIME = 'application/vnd.google-apps.folder';

/** Accepts a folder link (any of the usual shapes) or a bare folder id. */
export function parseDriveFolderId(input: string): string | null {
  const s = input.trim();
  const fromLink = s.match(/drive\.google\.com\/(?:drive\/(?:u\/\d+\/)?folders\/|folderview\?id=|open\?id=|drive\/u\/\d+\/mobile\/folders\/)([\w-]{10,})/);
  if (fromLink) return fromLink[1]!;
  return /^[\w-]{10,}$/.test(s) ? s : null;
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
}

export interface DriveListing {
  pdfs: DriveFile[];
  otherFiles: number;
  subfolders: number;
}

interface FilesListResponse {
  files?: DriveFile[];
  nextPageToken?: string;
  error?: { code?: number; message?: string; errors?: { reason?: string }[] };
}

/**
 * Lists one folder with Drive API v3 files.list (an API key is enough for a folder shared as "Anyone with the link").
 * Nothing is downloaded or stored: we only read file names and ids. Subfolders are not opened.
 */
export async function listDriveFolder(folderId: string): Promise<DriveListing> {
  if (!env.googleDriveApiKey) {
    throw new ApiError(503, 'Drive import is not set up yet: add GOOGLE_DRIVE_API_KEY to server/.env and restart the server', 'DRIVE_NOT_CONFIGURED');
  }
  const files: DriveFile[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL('https://www.googleapis.com/drive/v3/files');
    url.searchParams.set('q', `'${folderId}' in parents and trashed = false`);
    url.searchParams.set('fields', 'nextPageToken,files(id,name,mimeType)');
    url.searchParams.set('pageSize', '1000');
    url.searchParams.set('supportsAllDrives', 'true');
    url.searchParams.set('includeItemsFromAllDrives', 'true');
    url.searchParams.set('key', env.googleDriveApiKey);
    if (pageToken) url.searchParams.set('pageToken', pageToken);

    const res = await fetch(url);
    const body = (await res.json().catch(() => ({}))) as FilesListResponse;
    if (!res.ok) throw driveError(res.status, body);
    files.push(...(body.files ?? []));
    pageToken = body.nextPageToken;
  } while (pageToken);

  return {
    pdfs: files.filter((f) => f.mimeType === 'application/pdf'),
    otherFiles: files.filter((f) => f.mimeType !== 'application/pdf' && f.mimeType !== FOLDER_MIME).length,
    subfolders: files.filter((f) => f.mimeType === FOLDER_MIME).length,
  };
}

function driveError(status: number, body: FilesListResponse): ApiError {
  const reason = body.error?.errors?.[0]?.reason ?? '';
  const message = body.error?.message ?? `HTTP ${status}`;
  if (status === 404) {
    return new ApiError(400, 'Drive could not find that folder. Check the link, and share the folder as “Anyone with the link”.', 'DRIVE_FOLDER_NOT_FOUND');
  }
  if (reason === 'accessNotConfigured' || /has not been used in project|is disabled/i.test(message)) {
    return new ApiError(502, 'The Google Drive API is not enabled for this API key’s project. Enable “Google Drive API” in Google Cloud, wait a minute and try again.', 'DRIVE_API_DISABLED');
  }
  if (status === 400 && /API key not valid/i.test(message)) {
    return new ApiError(502, 'Google says this API key is not valid. Check GOOGLE_DRIVE_API_KEY in server/.env.', 'DRIVE_KEY_INVALID');
  }
  if (status === 403 || status === 401) {
    return new ApiError(502, `Google refused the request (${message}). Check that the key allows the Google Drive API and that the folder is shared as “Anyone with the link”.`, 'DRIVE_FORBIDDEN');
  }
  return new ApiError(502, `Google Drive error: ${message}`, 'DRIVE_ERROR');
}
