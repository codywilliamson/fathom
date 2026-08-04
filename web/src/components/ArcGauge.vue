<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    label: string
    value: number // 0..1
    reading: string // formatted center readout
    caption?: string | null
    stale?: boolean
  }>(),
  { caption: null, stale: false }
)

// three-quarter arc (270deg sweep, 90deg gap at the bottom) — the classic
// instrument-gauge look. dasharray trick: draw a dash the length of the arc,
// then a gap covering the rest of the circle, rotated so the dash starts
// bottom-left.
const R = 84
const CIRC = 2 * Math.PI * R
const ARC_LEN = CIRC * 0.75
const ROTATE = 135

const clamped = computed(() => Math.min(1, Math.max(0, props.value)))
const trackDash = `${ARC_LEN} ${CIRC}`
const valueDash = computed(() => `${ARC_LEN * clamped.value} ${CIRC}`)

const color = computed(() => {
  if (clamped.value >= 0.9) return 'var(--danger)'
  if (clamped.value >= 0.75) return 'var(--accent)'
  return 'var(--teal)'
})

// longer readouts (fallback token volume, e.g. "335.0k tok") need a smaller
// size than short ones ("62%") to stay on one line
const readingSize = computed(() => (props.reading.length > 6 ? 'clamp(1.8rem, 4.4vw, 2.6rem)' : 'clamp(2.4rem, 5vw, 3.6rem)'))
</script>

<template>
  <div class="gauge" :class="{ stale }">
    <svg class="gauge-ring" viewBox="0 0 200 200" aria-hidden="true">
      <circle
        class="gauge-track"
        cx="100"
        cy="100"
        :r="R"
        transform="rotate(135 100 100)"
        :style="{ strokeDasharray: trackDash }"
      />
      <circle
        class="gauge-value"
        cx="100"
        cy="100"
        :r="R"
        transform="rotate(135 100 100)"
        :style="{ strokeDasharray: valueDash, stroke: color }"
      />
    </svg>
    <div class="gauge-body no-select">
      <span class="gauge-label mono dim">{{ label }}</span>
      <span class="gauge-reading mono" :style="{ fontSize: readingSize }">{{ reading }}</span>
      <span v-if="caption" class="gauge-caption mono dim">{{ caption }}</span>
      <span v-if="stale" class="gauge-flag mono">stale</span>
    </div>
  </div>
</template>

<style scoped>
.gauge {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  aspect-ratio: 1;
  width: 100%;
  max-width: 320px;
  margin: 0 auto;
}

.gauge-ring {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  transition: opacity 0.4s ease, filter 0.4s ease;
}

.gauge-track,
.gauge-value {
  fill: none;
  stroke-width: 14;
  stroke-linecap: round;
}

.gauge-track {
  stroke: var(--line-strong);
}

.gauge-value {
  transition: stroke-dasharray 0.6s var(--ease-out), stroke 0.3s ease;
}

.gauge-body {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-1);
  text-align: center;
  padding: 0 var(--space-5);
}

.gauge-label {
  font-size: var(--text-xs);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.gauge-reading {
  font-size: clamp(2.4rem, 5vw, 3.6rem);
  font-weight: 600;
  line-height: 1;
  color: var(--ink-1);
  transition: color 0.4s ease;
}

.gauge-caption {
  font-size: var(--text-xs);
}

.gauge-flag {
  font-size: var(--text-xs);
  color: var(--ink-3);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.gauge.stale .gauge-ring {
  filter: saturate(0.3);
  opacity: 0.55;
}

.gauge.stale .gauge-reading {
  color: var(--ink-2);
}

@media (prefers-reduced-motion: reduce) {
  .gauge-value,
  .gauge-ring,
  .gauge-reading {
    transition: none;
  }
}
</style>
