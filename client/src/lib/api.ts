export class ApiError extends Error {
  status: number
  code: string
  details?: unknown

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

interface Options {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  /** Sent as JSON, except a Blob (a photo), which goes as it is with its own type. */
  body?: unknown
  signal?: AbortSignal
}

/**
 * Where the API lives. Empty (the default) means the same origin as the page: in development Vite proxies /api to the server,
 * and on Vercel vercel.json rewrites /api to it. Set VITE_API_URL (e.g. https://api.example.com) only when the API has its own domain.
 */
const API_BASE = ((import.meta.env.VITE_API_URL as string | undefined) ?? '').trim().replace(/\/+$/, '')

/** Full URL of an API path, for things a browser loads itself (an <img>, a download link). */
export const apiUrl = (path: string) => `${API_BASE}/api/v1${path}`

/** Thin fetch wrapper: cookies included, JSON in/out, errors as ApiError. */
export async function api<T>(path: string, { method = 'GET', body, signal }: Options = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API_BASE}/api/v1${path}`, {
      method,
      credentials: 'include',
      headers: body === undefined ? undefined : { 'Content-Type': body instanceof Blob ? body.type : 'application/json' },
      body: body === undefined ? undefined : body instanceof Blob ? body : JSON.stringify(body),
      signal,
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    throw new ApiError(0, 'NETWORK', 'Cannot reach the server. Is it running?')
  }

  const data: unknown = await res.json().catch(() => null)
  if (!res.ok) {
    const e = (data as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error
    // A rejected form comes back as "Invalid request" plus one message per field. Show the first field message: it says what to fix.
    const detail = Array.isArray(e?.details) ? (e.details as { message?: string }[]).find((d) => typeof d?.message === 'string')?.message : undefined
    const message = e?.message === 'Invalid request' && detail ? detail : e?.message
    throw new ApiError(res.status, e?.code ?? 'ERROR', message ?? `Request failed (${res.status})`, e?.details)
  }
  return data as T
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong'
}

/** Build "?a=1&b=2" from an object, skipping empty values. */
export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') sp.set(k, String(v))
  }
  const s = sp.toString()
  return s ? `?${s}` : ''
}
