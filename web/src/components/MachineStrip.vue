<script setup lang="ts">
import type { MachineStatus } from '../../../shared/types'
import { fmtAge, fmtUsd } from '../format'

const props = withDefaults(defineProps<{ machines: MachineStatus[]; costByMachine?: Record<string, number> }>(), {
  costByMachine: () => ({}),
})

function meta(m: MachineStatus): string {
  const cost = props.costByMachine[m.machine]
  const costPart = cost ? ` · ${fmtUsd(cost)} 30d` : ''
  return `${m.activeSessions} active · ${fmtAge(m.lastSeen)}${costPart}`
}
</script>

<template>
  <div class="machines">
    <div v-for="m in machines" :key="m.machine" class="machine">
      <span class="dot no-select" :class="m.online ? 'dot-ok' : 'dot-off'" aria-hidden="true"></span>
      <div class="machine-body">
        <span class="machine-name mono">{{ m.machine }}</span>
        <span class="machine-meta mono dim">{{ meta(m) }}</span>
      </div>
    </div>
    <p v-if="machines.length === 0" class="empty mono dim">no machines seen yet</p>
  </div>
</template>

<style scoped>
.machines {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.machine {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-3);
  background: var(--glass);
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
}

.machine-body {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.machine-name {
  font-size: var(--text-sm);
  color: var(--ink-1);
}

.machine-meta {
  font-size: var(--text-xs);
}

.dot {
  width: 9px;
  height: 9px;
  border-radius: var(--radius-pill);
  flex-shrink: 0;
}

.dot-ok {
  background: var(--teal);
  box-shadow: 0 0 8px var(--teal-dim);
}

.dot-off {
  background: var(--ink-3);
}

.empty {
  font-size: var(--text-sm);
  padding: var(--space-2) var(--space-3);
}
</style>
