<script setup lang="ts">
import { computed } from 'vue'
import { updateReady, applyUpdate } from './composables/useAppUpdate'
import { useSummary } from './composables/useSummary'
import ArcGauge from './components/ArcGauge.vue'
import Sparkline from './components/Sparkline.vue'
import StatTile from './components/StatTile.vue'
import MachineStrip from './components/MachineStrip.vue'
import SessionList from './components/SessionList.vue'
import { fmtAge, fmtPct, fmtResetsIn, fmtTokens, fmtUsd, totalTokens } from './format'
import type { RateLimitWindow } from '../../shared/types'

const { summary, connected, loaded } = useSummary()

// a quota reading older than this reads as stale even if ok:true
const QUOTA_STALE_MS = 15 * 60 * 1000

function findWindow(windows: RateLimitWindow[], patterns: RegExp[]) {
  return windows.find((w) => patterns.some((p) => p.test(w.label) || p.test(w.key)))
}

const windows = computed(() => summary.value?.rateLimit.windows ?? [])
const hasQuota = computed(() => windows.value.length > 0)

const fiveHourWindow = computed(
  () => findWindow(windows.value, [/5.?\s?hour/i, /five.?hour/i]) ?? windows.value[0]
)
const weeklyWindow = computed(() => {
  const found = findWindow(windows.value, [/week/i, /7.?\s?day/i, /seven.?day/i])
  if (found) return found
  return windows.value.find((w) => w !== fiveHourWindow.value)
})

const quotaStale = computed(() => {
  const rl = summary.value?.rateLimit
  if (!rl || !rl.ok || !rl.fetchedAt) return true
  return Date.now() - new Date(rl.fetchedAt).getTime() > QUOTA_STALE_MS
})

function quotaGauge(win: RateLimitWindow | undefined, fallbackLabel: string, fallbackTokens: number) {
  if (hasQuota.value && win) {
    return {
      label: `${win.label} quota`,
      value: win.utilization,
      reading: fmtPct(win.utilization),
      caption: fmtResetsIn(win.resetsAt) ?? fmtAge(summary.value?.rateLimit.fetchedAt ?? null),
      stale: quotaStale.value,
    }
  }
  return {
    label: fallbackLabel,
    value: 0,
    reading: fmtTokens(fallbackTokens),
    caption: 'quota data unavailable',
    stale: true,
  }
}

const gauge5h = computed(() =>
  quotaGauge(fiveHourWindow.value, '5-hour volume', totalTokens(summary.value?.totals.last5h.tokens ?? zeroTokens()))
)
const gauge7d = computed(() =>
  quotaGauge(weeklyWindow.value, '7-day volume', totalTokens(summary.value?.totals.last7d.tokens ?? zeroTokens()))
)

function zeroTokens() {
  return { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 }
}

const dailyTokens = computed(() => (summary.value?.daily ?? []).map((b) => totalTokens(b.tokens)))
const dailyCost = computed(() => (summary.value?.daily ?? []).map((b) => b.costUsd))

const statTiles = computed(() => {
  const t = summary.value?.totals
  if (!t) return []
  return [
    { label: '24h', value: fmtTokens(totalTokens(t.last24h.tokens)), caption: `${fmtUsd(t.last24h.costUsd)} est. api equiv` },
    { label: '7d', value: fmtTokens(totalTokens(t.last7d.tokens)), caption: `${fmtUsd(t.last7d.costUsd)} est. api equiv` },
    { label: '30d', value: fmtTokens(totalTokens(t.last30d.tokens)), caption: `${fmtUsd(t.last30d.costUsd)} est. api equiv` },
  ]
})

const generatedAge = computed(() => fmtAge(summary.value?.generatedAt ?? null))
</script>

<template>
  <div class="app-viewport">
    <header class="app-header no-select">
      <h1 class="app-title mono">fathom</h1>
      <span class="conn-flag mono dim" :class="{ live: connected }">{{ connected ? 'live' : 'reconnecting…' }}</span>
    </header>

    <main class="app-main">
      <p v-if="!loaded" class="loading mono dim">reading usage…</p>

      <div v-else class="dashboard">
        <section class="gauges">
          <ArcGauge
            :label="gauge5h.label"
            :value="gauge5h.value"
            :reading="gauge5h.reading"
            :caption="gauge5h.caption"
            :stale="gauge5h.stale"
          />
          <ArcGauge
            :label="gauge7d.label"
            :value="gauge7d.value"
            :reading="gauge7d.reading"
            :caption="gauge7d.caption"
            :stale="gauge7d.stale"
          />
        </section>

        <section class="trend">
          <div class="trend-block">
            <div class="trend-head no-select">
              <span class="trend-label mono dim">tokens · 30d</span>
            </div>
            <div class="trend-chart teal-ink">
              <Sparkline :values="dailyTokens" />
            </div>
          </div>
          <div class="trend-block">
            <div class="trend-head no-select">
              <span class="trend-label mono dim">est. api equiv · 30d</span>
            </div>
            <div class="trend-chart accent-ink">
              <Sparkline :values="dailyCost" />
            </div>
          </div>
          <div class="stats">
            <StatTile v-for="s in statTiles" :key="s.label" :label="s.label" :value="s.value" :caption="s.caption" />
          </div>
        </section>

        <aside class="side">
          <div class="side-block">
            <h2 class="side-title mono dim no-select">machines</h2>
            <MachineStrip :machines="summary?.machines ?? []" />
          </div>
          <div class="side-block sessions-block">
            <h2 class="side-title mono dim no-select">active sessions</h2>
            <SessionList :sessions="summary?.activeSessions ?? []" />
          </div>
          <p class="generated-age mono dim no-select">updated {{ generatedAge }}</p>
        </aside>
      </div>
    </main>

    <Transition name="update-pop">
      <button v-if="updateReady" class="update-pill mono" type="button" @click="applyUpdate()">
        update ready — reload
      </button>
    </Transition>
  </div>
</template>

<style>
.app-viewport {
  display: flex;
  flex-direction: column;
  height: 100dvh;
  padding: calc(var(--safe-top) + var(--space-4)) calc(var(--safe-right) + var(--space-4))
    calc(var(--safe-bottom) + var(--space-4)) calc(var(--safe-left) + var(--space-4));
}

.app-header {
  display: flex;
  align-items: baseline;
  gap: var(--space-3);
  padding-bottom: var(--space-3);
  border-bottom: 1px solid var(--line);
}

.app-title {
  font-size: var(--text-lg);
  font-weight: 600;
  color: var(--accent);
  letter-spacing: 0.04em;
}

.conn-flag {
  font-size: var(--text-xs);
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.conn-flag.live {
  color: var(--teal);
}

.app-main {
  flex: 1;
  padding-top: var(--space-5);
  overflow-y: auto;
  min-height: 0;
}

.loading {
  font-size: var(--text-sm);
}

/* landscape kiosk grid: gauges dominate the top-left, trend + stats beneath,
   machines/sessions ride alongside as a side column */
.dashboard {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 300px;
  grid-template-rows: auto 1fr;
  gap: var(--space-5);
  height: 100%;
  min-height: 0;
}

.gauges {
  grid-column: 1;
  grid-row: 1;
  display: flex;
  gap: var(--space-5);
}

.gauges > * {
  flex: 1;
  min-width: 0;
}

.trend {
  grid-column: 1;
  grid-row: 2;
  display: grid;
  grid-template-columns: 1fr 1fr auto;
  gap: var(--space-5);
  align-items: stretch;
  min-height: 0;
}

.trend-block {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-width: 0;
  padding: var(--space-3) var(--space-4);
  background: var(--glass);
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
}

.trend-label {
  font-size: var(--text-xs);
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.trend-chart {
  flex: 1;
  min-height: 48px;
}

.teal-ink {
  color: var(--teal);
}

.accent-ink {
  color: var(--accent);
}

.stats {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  justify-content: center;
  min-width: 180px;
}

.side {
  grid-column: 2;
  grid-row: 1 / span 2;
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
  min-height: 0;
}

.side-block {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-height: 0;
}

.sessions-block {
  flex: 1;
  overflow: hidden;
}

.side-title {
  font-size: var(--text-xs);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.generated-age {
  font-size: var(--text-xs);
}

@media (max-width: 640px) {
  /* below the grid degrades to plain stacked flow — nesting grid auto-rows
     around flex children with no definite height collapses tracks, so drop
     the grid entirely rather than fight it */
  .dashboard {
    display: flex;
    flex-direction: column;
    height: auto;
    min-height: 100%;
  }

  .gauges {
    flex-direction: column;
  }

  .trend {
    display: flex;
    flex-direction: column;
  }

  .stats {
    flex-direction: row;
    flex-wrap: wrap;
  }

  .stats > * {
    flex: 1 1 140px;
  }

  .side {
    min-height: 0;
  }

  .sessions-block {
    flex: none;
  }
}

/* new-build pill — floats over everything, top center below the notch */
.update-pill {
  position: fixed;
  top: calc(var(--safe-top) + var(--space-3));
  left: 50%;
  transform: translateX(-50%);
  z-index: 10;
  padding: 9px 18px;
  border: none;
  border-radius: var(--radius-pill);
  background: var(--accent);
  color: var(--accent-ink);
  font-size: var(--text-sm);
  font-weight: 600;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
  cursor: pointer;
}

.update-pop-enter-active,
.update-pop-leave-active {
  transition:
    opacity 0.2s var(--ease-out),
    transform 0.2s var(--ease-out);
}

.update-pop-enter-from,
.update-pop-leave-to {
  opacity: 0;
  transform: translate(-50%, -10px);
}

@media (prefers-reduced-motion: reduce) {
  .update-pop-enter-active,
  .update-pop-leave-active {
    transition: opacity 0.15s ease;
  }
  .update-pop-enter-from,
  .update-pop-leave-to {
    transform: translateX(-50%);
  }
}
</style>
