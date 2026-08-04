<script setup lang="ts">
import { computed } from 'vue'
import { updateReady, applyUpdate } from './composables/useAppUpdate'
import { useSummary } from './composables/useSummary'
import QuotaCard from './components/QuotaCard.vue'
import BreakdownBars from './components/BreakdownBars.vue'
import StatTile from './components/StatTile.vue'
import MachineStrip from './components/MachineStrip.vue'
import SessionList from './components/SessionList.vue'
import { fmtAge, fmtPct, fmtResetsIn, fmtTokens, fmtUsd, totalTokens } from './format'

const { summary, connected, loaded } = useSummary()

// a quota reading older than this reads as stale even if ok:true
const QUOTA_STALE_MS = 15 * 60 * 1000

const windows = computed(() => summary.value?.rateLimit.windows ?? [])
const hasQuota = computed(() => windows.value.length > 0)

const quotaStale = computed(() => {
  const rl = summary.value?.rateLimit
  if (!rl || !rl.ok || !rl.fetchedAt) return true
  return Date.now() - new Date(rl.fetchedAt).getTime() > QUOTA_STALE_MS
})

function zeroTokens() {
  return { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 }
}

// one card per quota window the api reports — grows or shrinks automatically
// if anthropic adds or drops a window, no layout change needed. falls back to
// rolling token volume for 5h/7d when the api has no quota data at all.
const quotaCards = computed(() => {
  if (hasQuota.value) {
    return windows.value.map((w) => ({
      key: w.key,
      label: `${w.label} quota`,
      value: w.utilization,
      reading: fmtPct(w.utilization),
      caption: fmtResetsIn(w.resetsAt) ?? fmtAge(summary.value?.rateLimit.fetchedAt ?? null),
      stale: quotaStale.value,
    }))
  }
  const t = summary.value?.totals
  return [
    {
      key: 'last5h',
      label: '5-hour volume',
      value: 0,
      reading: fmtTokens(totalTokens(t?.last5h.tokens ?? zeroTokens())),
      caption: 'quota data unavailable',
      stale: true,
    },
    {
      key: 'last7d',
      label: '7-day volume',
      value: 0,
      reading: fmtTokens(totalTokens(t?.last7d.tokens ?? zeroTokens())),
      caption: 'quota data unavailable',
      stale: true,
    },
  ]
})

const statTiles = computed(() => {
  const t = summary.value?.totals
  if (!t) return []
  return [
    { label: '24h', value: fmtTokens(totalTokens(t.last24h.tokens)), caption: `${fmtUsd(t.last24h.costUsd)} est. api equiv` },
    { label: '7d', value: fmtTokens(totalTokens(t.last7d.tokens)), caption: `${fmtUsd(t.last7d.costUsd)} est. api equiv` },
    { label: '30d', value: fmtTokens(totalTokens(t.last30d.tokens)), caption: `${fmtUsd(t.last30d.costUsd)} est. api equiv` },
  ]
})

const costByMachine = computed(() => Object.fromEntries((summary.value?.byMachine ?? []).map((b) => [b.key, b.costUsd])))

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
        <section class="quota-cards">
          <QuotaCard
            v-for="c in quotaCards"
            :key="c.key"
            :label="c.label"
            :value="c.value"
            :reading="c.reading"
            :caption="c.caption"
            :stale="c.stale"
          />
        </section>

        <section class="kpi-row">
          <StatTile v-for="s in statTiles" :key="s.label" :label="s.label" :value="s.value" :caption="s.caption" />
        </section>

        <section class="breakdowns">
          <BreakdownBars title="by model · 30d" :items="summary?.byModel ?? []" />
          <BreakdownBars title="by project · 30d" :items="summary?.byProject ?? []" />
        </section>

        <aside class="side">
          <div class="side-block">
            <h2 class="side-title mono dim no-select">machines</h2>
            <MachineStrip :machines="summary?.machines ?? []" :cost-by-machine="costByMachine" />
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

/* landscape kiosk grid: quota cards on top, a kpi strip beneath, breakdowns
   filling the rest, machines/sessions ride alongside as a side column */
.dashboard {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 300px;
  grid-template-rows: auto auto 1fr;
  gap: var(--space-5);
  height: 100%;
  min-height: 0;
}

.quota-cards {
  grid-column: 1;
  grid-row: 1;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: var(--space-5);
}

.kpi-row {
  grid-column: 1;
  grid-row: 2;
  display: grid;
  grid-template-columns: repeat(3, minmax(140px, 1fr));
  gap: var(--space-4);
}

.breakdowns {
  grid-column: 1;
  grid-row: 3;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-5);
  align-items: stretch;
  min-height: 0;
}

.side {
  grid-column: 2;
  grid-row: 1 / span 3;
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

  .breakdowns {
    display: flex;
    flex-direction: column;
  }

  .kpi-row {
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
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
