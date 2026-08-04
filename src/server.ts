import { existsSync } from 'node:fs'
import { timingSafeEqual } from 'node:crypto'
import { resolve, sep } from 'node:path'
import { config } from './config'
import { store } from './store'
import { buildSummary } from './summary'
import { handleStream, notifyChange } from './stream'
import type { HealthResponse, IngestRequest, IngestResponse, UsageEvent } from '../shared/types'
import pkg from '../package.json'

const MAX_INGEST_BATCH = 5_000

const DIST = resolve(import.meta.dir, '../dist')
const STARTED = Date.now()

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })
}

// keep resolution inside dist — reject traversal
function safeJoin(base: string, pathname: string): string | null {
  const target = resolve(base, `.${pathname}`)
  return target === base || target.startsWith(base + sep) ? target : null
}

// csrf/dns-rebinding guard: same-origin + json content-type on writes,
// optional Host allowlist (no auth by design — tailscale is the perimeter,
// but the phone's browser lives inside it, so block cross-site posts)
function crossSiteBlock(req: Request): Response | null {
  const host = (req.headers.get('host') ?? '').toLowerCase()
  if (config.allowedHosts.length && !config.allowedHosts.includes(host)) {
    return json({ error: 'host not allowed' }, 403)
  }
  if (req.method === 'GET' || req.method === 'HEAD') return null
  const origin = req.headers.get('origin')
  if (origin) {
    try {
      if (new URL(origin).host.toLowerCase() !== host) return json({ error: 'bad origin' }, 403)
    } catch {
      return json({ error: 'bad origin' }, 403)
    }
  }
  const contentType = req.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) {
    return json({ error: 'content-type must be application/json' }, 415)
  }
  return null
}

function handleHealth(): Response {
  const body: HealthResponse = {
    ok: true,
    name: pkg.name,
    version: pkg.version,
    uptimeSec: Math.floor((Date.now() - STARTED) / 1000),
  }
  return json(body)
}

function handleSummary(): Response {
  return json(buildSummary(store(), Date.now()))
}

// length-safe token compare — a naive === leaks timing info about how many
// leading bytes matched
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

function isValidIngestEvent(e: unknown): e is UsageEvent {
  if (!e || typeof e !== 'object') return false
  const ev = e as Record<string, unknown>
  if (typeof ev.messageId !== 'string' || !ev.messageId) return false
  if (typeof ev.machine !== 'string' || !ev.machine) return false
  if (typeof ev.ts !== 'string' || !ev.ts) return false
  if (typeof ev.sessionId !== 'string') return false
  if (typeof ev.project !== 'string') return false
  if (typeof ev.model !== 'string') return false
  if (typeof ev.costUsd !== 'number') return false
  const tokens = ev.tokens as Record<string, unknown> | null
  if (!tokens || typeof tokens !== 'object') return false
  return ['input', 'output', 'cacheCreation', 'cacheRead'].every((k) => typeof tokens[k] === 'number')
}

// the windows agent pushes its own deduped events here — validate
// defensively, it's a different machine's data.
async function handleIngest(req: Request): Promise<Response> {
  if (config.ingestToken) {
    const provided = req.headers.get('x-fathom-token') ?? ''
    if (!safeEqual(provided, config.ingestToken)) return json({ error: 'unauthorized' }, 401)
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return json({ ok: false, accepted: 0, duplicates: 0, error: 'invalid json' } satisfies IngestResponse, 400)
  }

  const payload = body as Partial<IngestRequest> | null
  if (!payload || typeof payload.machine !== 'string' || !payload.machine || !Array.isArray(payload.events)) {
    return json(
      { ok: false, accepted: 0, duplicates: 0, error: 'machine and events[] required' } satisfies IngestResponse,
      400,
    )
  }
  if (payload.events.length > MAX_INGEST_BATCH) {
    return json(
      { ok: false, accepted: 0, duplicates: 0, error: `batch too large (max ${MAX_INGEST_BATCH})` } satisfies IngestResponse,
      400,
    )
  }

  const events = payload.events.filter(isValidIngestEvent)
  const s = store()
  const { accepted, duplicates } = events.length ? s.insertEvents(events) : { accepted: 0, duplicates: 0 }
  const agentVersion = typeof payload.agentVersion === 'string' ? payload.agentVersion : null
  s.touchMachine(payload.machine, Date.now(), agentVersion)
  if (accepted > 0) notifyChange()

  return json({ ok: true, accepted, duplicates } satisfies IngestResponse)
}

async function serveStatic(pathname: string): Promise<Response> {
  if (!existsSync(DIST)) {
    return new Response('fathom — run `bun run build` to create ./dist', {
      headers: { 'content-type': 'text/plain' },
    })
  }
  const rel = pathname === '/' ? '/index.html' : pathname
  const target = safeJoin(DIST, rel)
  if (target) {
    const file = Bun.file(target)
    if (await file.exists()) return new Response(file)
  }
  // a missing hashed asset is a hard 404 — the spa fallback would hand html
  // to a module script (and poison caches) after a deploy rolls the hashes
  if (pathname.startsWith('/assets/')) {
    return new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } })
  }
  // spa fallback
  const index = Bun.file(resolve(DIST, 'index.html'))
  if (await index.exists()) return new Response(index)
  return new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } })
}

// route table — thin dispatch, domain logic lives in the modules
async function route(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const { pathname } = url

  const blocked = crossSiteBlock(req)
  if (blocked) return blocked

  if (pathname === '/api/v1/health' && req.method === 'GET') return handleHealth()
  if (pathname === '/api/v1/summary' && req.method === 'GET') return handleSummary()
  if (pathname === '/api/v1/stream' && req.method === 'GET') return handleStream(req)
  if (pathname === '/api/v1/ingest' && req.method === 'POST') return handleIngest(req)

  if (pathname.startsWith('/api/')) return json({ error: 'not found' }, 404)

  if (req.method === 'GET') return serveStatic(pathname)
  return json({ error: 'not found' }, 404)
}

export function startServer() {
  Bun.serve({
    hostname: config.host,
    port: config.port,
    idleTimeout: 120, // default 10s would kill long-lived streams between heartbeats
    async fetch(req) {
      try {
        return await route(req)
      } catch (err) {
        console.error('unhandled route error', err)
        return json({ error: 'internal error' }, 500)
      }
    },
  })
  console.log(`fathom listening on ${config.host}:${config.port}`)
}
