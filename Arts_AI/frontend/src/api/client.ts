import { ApiError, type ApiErrorBody } from './types'

const DEFAULT_TIMEOUT_MS = 25000

function baseUrl(): string {
  const raw = import.meta.env.VITE_API_BASE_URL as string | undefined
  if (raw && raw.trim()) return raw.replace(/\/$/, '')
  // Dev proxy: /api → Express :4000
  return '/api'
}

export type RequestOpts = {
  method?: string
  token?: string | null
  body?: unknown
  signal?: AbortSignal
  timeoutMs?: number
}

export async function apiRequest<T>(path: string, opts: RequestOpts = {}): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  const onAbort = () => controller.abort()
  opts.signal?.addEventListener('abort', onAbort)

  try {
    const res = await fetch(`${baseUrl()}${path}`, {
      method: opts.method || (opts.body ? 'POST' : 'GET'),
      headers: {
        Accept: 'application/json',
        ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
        ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
    })
    const text = await res.text()
    let json: unknown = null
    if (text) {
      try {
        json = JSON.parse(text)
      } catch {
        json = { raw: text }
      }
    }
    if (!res.ok) {
      throw new ApiError(res.status, (json || { error: `http_${res.status}` }) as ApiErrorBody)
    }
    return json as T
  } catch (e) {
    if (e instanceof ApiError) throw e
    if (e instanceof DOMException && e.name === 'AbortError') {
      throw new ApiError(408, { error: 'request_timeout_or_cancelled' })
    }
    throw new ApiError(0, { error: 'network_error', note: String(e) })
  } finally {
    clearTimeout(timeout)
    opts.signal?.removeEventListener('abort', onAbort)
  }
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const parts = [err.body.error || err.message]
    if (err.body.reason) parts.push(String(err.body.reason))
    if (err.body.note) parts.push(String(err.body.note))
    if (err.status === 409 && err.body.available != null) {
      parts.push(`available=${err.body.available}`)
    }
    return parts.filter(Boolean).join(' — ')
  }
  return String(err)
}
