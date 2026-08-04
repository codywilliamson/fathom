<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    label: string
    value: number // 0..1
    reading: string // formatted percentage or fallback token volume
    caption?: string | null
    stale?: boolean
  }>(),
  { caption: null, stale: false }
)

const clamped = computed(() => Math.min(1, Math.max(0, props.value)))

const color = computed(() => {
  if (clamped.value >= 0.9) return 'var(--danger)'
  if (clamped.value >= 0.75) return 'var(--accent)'
  return 'var(--teal)'
})
</script>

<template>
  <div class="quota-card" :class="{ stale }">
    <div class="quota-head no-select">
      <span class="quota-label mono dim">{{ label }}</span>
      <span v-if="stale" class="quota-flag mono dim">stale</span>
    </div>
    <div class="quota-readout">
      <span class="quota-reading mono" :style="{ color: stale ? undefined : color }">{{ reading }}</span>
      <span v-if="caption" class="quota-caption mono dim">{{ caption }}</span>
    </div>
    <div class="quota-track">
      <div class="quota-fill" :style="{ width: `${clamped * 100}%`, background: color }"></div>
    </div>
  </div>
</template>

<style scoped>
.quota-card {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-4);
  background: var(--glass);
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  min-width: 0;
}

.quota-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-2);
}

.quota-label {
  font-size: var(--text-xs);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.quota-flag {
  font-size: var(--text-xs);
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.quota-readout {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  min-width: 0;
}

.quota-reading {
  font-size: clamp(1.6rem, 2.6vw, 2.2rem);
  font-weight: 600;
  line-height: 1;
  color: var(--ink-1);
  transition: color 0.4s ease;
}

.quota-caption {
  font-size: var(--text-xs);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.quota-track {
  height: 8px;
  border-radius: var(--radius-pill);
  background: var(--line-strong);
  overflow: hidden;
}

.quota-fill {
  height: 100%;
  border-radius: var(--radius-pill);
  transition: width 0.6s var(--ease-out), background 0.3s ease;
}

.quota-card.stale .quota-fill {
  filter: saturate(0.3);
  opacity: 0.55;
}

.quota-card.stale .quota-reading {
  color: var(--ink-2);
}

@media (prefers-reduced-motion: reduce) {
  .quota-fill,
  .quota-reading {
    transition: none;
  }
}
</style>
