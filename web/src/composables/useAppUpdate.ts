import { ref } from 'vue'

// flips true when a newer shell than the one running is available
export const updateReady = ref(false)

// what bundle would a reload serve? the fetch goes through the sw (cached shell
// or fresh), which is exactly what location.reload() would get — if its script
// hash differs from the running one, a new build is waiting. no sw-message
// races: the page asks whenever it wants.
async function checkForNewShell() {
  try {
    const running = document.querySelector('script[type="module"]')?.getAttribute('src')
    if (!running) return
    const html = await (await fetch('/')).text()
    const next = html.match(/\/assets\/index-[\w-]+\.js/)?.[0]
    if (next && next !== running) updateReady.value = true
  } catch {
    // offline — next resume retries
  }
}

export function initAppUpdate() {
  if (!('serviceWorker' in navigator)) return

  // instant path: sw noticed a fresh shell while we're open
  navigator.serviceWorker.addEventListener('message', (e: MessageEvent) => {
    if ((e.data as { type?: string } | null)?.type === 'shell-updated') updateReady.value = true
  })
  // sw messages are buffered until this is called — addEventListener alone
  // never starts delivery
  navigator.serviceWorker.startMessages()

  // launch check: did this launch serve a stale shell?
  checkForNewShell()

  // long-lived standalone pwas never re-navigate, so also recheck whenever the
  // app resumes from the home screen
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkForNewShell()
  })
}

export function applyUpdate() {
  location.reload()
}

// manual refresh (menu item + pull-to-refresh): sw update check, hard no-cache
// shell revalidate, then reload — the ios-installed escape hatch
export async function forceRefresh() {
  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration()
      await reg?.update()
    }
    await fetch('/', { cache: 'no-cache' })
  } catch {
    // offline — reload still serves the cached shell
  }
  location.reload()
}
