<script setup lang="ts">
defineProps<{ label: string; value: string; caption?: string | null }>()
</script>

<template>
  <div class="stat-tile">
    <span class="stat-label mono dim no-select">{{ label }}</span>
    <span class="stat-value mono">{{ value }}</span>
    <span v-if="caption" class="stat-caption mono dim">{{ caption }}</span>
  </div>
</template>

<style scoped>
.stat-tile {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  padding: var(--space-3) var(--space-4);
  background: var(--glass);
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  min-width: 0;
}

.stat-label {
  font-size: var(--text-xs);
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.stat-value {
  font-size: var(--text-xl);
  font-weight: 600;
  color: var(--ink-1);
  overflow-wrap: anywhere;
}

.stat-caption {
  font-size: var(--text-xs);
}
</style>
