import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { SummaryResponse } from '../../../shared/types'

// kiosk state fed by the sse stream, one event type ('summary') that replaces
// the whole payload. stale-while-revalidate: never clear summary on
// disconnect — a stale dashboard beats a blank one on a wall display.

const RECONNECT_MS = 3_000

export function useSummary() {
  const summary = ref<SummaryResponse | null>(null)
  const connected = ref(false)
  const loaded = ref(false)
  let es: EventSource | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null

  // one-shot fetch so first paint doesn't wait for the stream to open
  async function fetchOnce() {
    try {
      const res = await fetch('/api/v1/summary')
      if (!res.ok) return
      const data = (await res.json()) as SummaryResponse
      if (!summary.value) {
        summary.value = data
        loaded.value = true
      }
    } catch {
      // stream connect will carry it from here
    }
  }

  function connect() {
    es?.close()
    es = new EventSource('/api/v1/stream')
    es.addEventListener('summary', (e) => {
      summary.value = JSON.parse((e as MessageEvent).data) as SummaryResponse
      connected.value = true
      loaded.value = true
    })
    es.onerror = () => {
      connected.value = false
      es?.close()
      es = null
      if (reconnectTimer) clearTimeout(reconnectTimer)
      reconnectTimer = setTimeout(connect, RECONNECT_MS)
    }
  }

  function onVisibility() {
    if (document.visibilityState === 'visible' && !es) connect()
  }

  onMounted(() => {
    fetchOnce()
    connect()
    document.addEventListener('visibilitychange', onVisibility)
  })

  onBeforeUnmount(() => {
    es?.close()
    es = null
    if (reconnectTimer) clearTimeout(reconnectTimer)
    document.removeEventListener('visibilitychange', onVisibility)
  })

  return { summary, connected, loaded }
}
