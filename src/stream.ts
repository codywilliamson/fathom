import { store } from './store'
import { buildSummary } from './summary'
import type { StreamEvent } from '../shared/types'

// sse fan-out. one event type ("summary") keeps the client dumb: replace
// state, re-render. scanner/ratelimit/ingest all call notifyChange() when
// they touch the store — this is the single point every source funnels
// through, debounced so a burst of file writes doesn't spam connections.

const HEARTBEAT_MS = 15_000
const DEBOUNCE_MS = 1_000
const encoder = new TextEncoder()

type Listener = () => void
const subscribers = new Set<Listener>()
let debounceTimer: ReturnType<typeof setTimeout> | null = null

export function notifyChange(): void {
  if (debounceTimer) return
  debounceTimer = setTimeout(() => {
    debounceTimer = null
    for (const fn of subscribers) fn()
  }, DEBOUNCE_MS)
}

function sseFrame(event: string, data: unknown): Uint8Array {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

export function handleStream(req: Request): Response {
  let closed = false
  let heartbeat: ReturnType<typeof setInterval> | null = null
  let unsubscribe: (() => void) | null = null

  const stream = new ReadableStream({
    start(controller) {
      const send = () => {
        if (closed) return
        try {
          const event: StreamEvent = { type: 'summary', data: buildSummary(store(), Date.now()) }
          controller.enqueue(sseFrame(event.type, event.data))
        } catch {
          cleanup()
        }
      }

      subscribers.add(send)
      unsubscribe = () => subscribers.delete(send)

      send() // snapshot on connect

      heartbeat = setInterval(() => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(': ping\n\n'))
        } catch {
          cleanup()
        }
      }, HEARTBEAT_MS)
    },
    cancel() {
      cleanup()
    },
  })

  function cleanup() {
    if (closed) return
    closed = true
    unsubscribe?.()
    unsubscribe = null
    if (heartbeat) clearInterval(heartbeat)
    heartbeat = null
  }

  req.signal.addEventListener('abort', cleanup)

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    },
  })
}
