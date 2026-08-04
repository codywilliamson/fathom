// app-shell service worker: instant launch from home screen.
// hashed assets are immutable -> cache-first. navigations serve the cached
// shell immediately and revalidate in the background (old shell + old cached
// assets stay coherent across deploys). /api is never touched (sse + live data).
// background cache writes ride event.waitUntil — ios kills idle workers fast,
// so without it the silent refresh never lands and deploys don't propagate.
const CACHE = 'fathom-shell-v1'

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  const url = new URL(req.url)
  if (req.method !== 'GET' || url.origin !== location.origin) return
  if (url.pathname.startsWith('/api/')) return

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(event, req))
  } else {
    event.respondWith(staleWhileRevalidate(event, req))
  }
})

async function cacheFirst(event, req) {
  const cached = await caches.match(req)
  if (cached) return cached
  const res = await fetch(req)
  // never cache html under an asset key — a missing hashed file used to get
  // the spa fallback, poisoning the cache with html where a module belongs
  const isHtml = (res.headers.get('content-type') ?? '').includes('text/html')
  if (res.ok && !isHtml) {
    const cache = await caches.open(CACHE)
    event.waitUntil(cache.put(req, res.clone()))
  }
  return res
}

async function staleWhileRevalidate(event, req) {
  const cache = await caches.open(CACHE)
  const cached = await cache.match(req)
  // shell requests come in as navigations AND as page-initiated pings
  // (visibilitychange recheck), so key off the path, not request mode
  const isShell = new URL(req.url).pathname === '/'
  // clone NOW for the update comparison — the original goes to the page, which
  // consumes its body long before the background refresh gets to compare
  const cachedCopy = isShell ? cached?.clone() : undefined
  // bypass the http cache — heuristic freshness happily returns the same stale
  // copy we're trying to replace, and the update check compares copies of it.
  // url string, not req: navigate-mode requests can't be re-constructed with init
  const refresh = fetch(req.url, { cache: 'no-cache' })
    .then(async (res) => {
      if (res.ok) {
        if (isShell) {
          const oldHtml = cachedCopy ? await cachedCopy.text() : null
          const newHtml = await res.clone().text()
          // precache the shell's assets BEFORE the shell itself — a cached
          // shell must never exist without its modules. the page's own asset
          // requests can be swallowed by the memory cache and never reach us,
          // and old hashes vanish from the server on the next deploy
          await precacheAssets(cache, newHtml)
          await cache.put(req, res.clone())
          // prune hashed assets, but keep BOTH generations: the open page may
          // still be running the outgoing shell and fetching its modules
          await pruneAssets(cache, `${oldHtml ?? ''}\n${newHtml}`)
          if (oldHtml !== null && oldHtml !== newHtml) await notifyShellUpdated()
        } else {
          await cache.put(req, res.clone())
        }
      }
      return res
    })
    .catch(() => cached)
  event.waitUntil(refresh)
  return cached ?? refresh
}

// tell open pages a newer shell is cached — they offer a reload, which then
// serves the fresh build instantly from cache. no reinstall needed.
async function notifyShellUpdated() {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
  for (const client of clients) client.postMessage({ type: 'shell-updated' })
}

async function precacheAssets(cache, html) {
  const refs = html.match(/\/assets\/[\w.-]+/g) ?? []
  await Promise.all(
    refs.map(async (path) => {
      if (await cache.match(path)) return
      const res = await fetch(path, { cache: 'no-cache' })
      if (res.ok) await cache.put(path, res)
    }),
  )
}

async function pruneAssets(cache, html) {
  const referenced = new Set(html.match(/\/assets\/[\w.-]+/g) ?? [])
  const keys = await cache.keys()
  const stale = keys.filter((k) => {
    const path = new URL(k.url).pathname
    return path.startsWith('/assets/') && !referenced.has(path)
  })
  await Promise.all(stale.map((k) => cache.delete(k)))
}
