<script setup lang="ts">
import { computed } from 'vue'
import type { Breakdown } from '../../../shared/types'
import { fmtUsd } from '../format'

// items arrive pre-sorted by cost desc (store.ts breakdown query) — just cap
// how many rows a glanceable card can hold
const LIMIT = 5

const props = defineProps<{ title: string; items: Breakdown[] }>()

const rows = computed(() => props.items.slice(0, LIMIT))
const maxCost = computed(() => Math.max(...rows.value.map((r) => r.costUsd), 0.01))

function pct(item: Breakdown): string {
  return `${Math.max((item.costUsd / maxCost.value) * 100, item.costUsd > 0 ? 2 : 0)}%`
}
</script>

<template>
  <div class="breakdown">
    <h2 class="breakdown-title mono dim no-select">{{ title }}</h2>
    <div class="breakdown-rows">
      <div v-for="item in rows" :key="item.key" class="breakdown-row">
        <span class="breakdown-key mono">{{ item.key }}</span>
        <div class="breakdown-track no-select">
          <div class="breakdown-fill" :style="{ width: pct(item) }"></div>
        </div>
        <span class="breakdown-value mono dim">{{ fmtUsd(item.costUsd) }}</span>
      </div>
      <p v-if="rows.length === 0" class="empty mono dim">no usage yet</p>
    </div>
  </div>
</template>

<style scoped>
.breakdown {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  min-width: 0;
  padding: var(--space-3) var(--space-4);
  background: var(--glass);
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
}

.breakdown-title {
  font-size: var(--text-xs);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

/* a single grid shared by every row (rows use display:contents to feed their
   children into it) — that's what keeps the bars starting at the same x
   across rows instead of each row sizing its own columns off its own
   content width */
.breakdown-rows {
  flex: 1;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(60px, 30%) auto;
  align-content: space-evenly;
  align-items: center;
  column-gap: var(--space-3);
  row-gap: var(--space-3);
  min-height: 0;
}

.breakdown-row {
  display: contents;
}

.breakdown-key {
  font-size: var(--text-base);
  color: var(--ink-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.breakdown-track {
  height: 8px;
  border-radius: var(--radius-pill);
  background: var(--line-strong);
  overflow: hidden;
}

.breakdown-fill {
  height: 100%;
  border-radius: var(--radius-pill);
  background: var(--teal);
  transition: width 0.6s var(--ease-out);
}

.breakdown-value {
  font-size: var(--text-sm);
  text-align: right;
  flex-shrink: 0;
}

.empty {
  font-size: var(--text-sm);
  padding: var(--space-1) 0;
}

@media (prefers-reduced-motion: reduce) {
  .breakdown-fill {
    transition: none;
  }
}
</style>
