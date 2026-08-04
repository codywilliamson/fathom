<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{ values: number[] }>()

const VIEW = 100

// polyline over 0..100 viewbox, baseline zero. handles empty (no points, no
// crash) and single-point (flat line) without NaN-ing the path.
const points = computed(() => {
  const vals = props.values
  if (vals.length === 0) return ''
  if (vals.length === 1) return `0,${VIEW / 2} ${VIEW},${VIEW / 2}`
  const max = Math.max(...vals, 0)
  const range = max || 1
  const stepX = VIEW / (vals.length - 1)
  return vals
    .map((v, i) => `${(i * stepX).toFixed(2)},${(VIEW - (v / range) * VIEW).toFixed(2)}`)
    .join(' ')
})
</script>

<template>
  <svg class="sparkline" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
    <polyline v-if="points" :points="points" />
  </svg>
</template>

<style scoped>
.sparkline {
  display: block;
  width: 100%;
  height: 100%;
  overflow: visible;
}

polyline {
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linejoin: round;
  stroke-linecap: round;
  vector-effect: non-scaling-stroke;
}
</style>
