<script setup lang="ts">
import type { ActiveSession } from '../../../shared/types'
import { fmtAge, fmtTokens, totalTokens } from '../format'

defineProps<{ sessions: ActiveSession[] }>()
</script>

<template>
  <div class="sessions">
    <div v-for="s in sessions" :key="s.sessionId" class="session">
      <div class="session-main">
        <span class="session-project mono">{{ s.project }}</span>
        <span class="session-model mono dim">{{ s.model }}</span>
      </div>
      <div class="session-meta mono dim">
        <span>{{ fmtTokens(totalTokens(s.tokens)) }}</span>
        <span>{{ fmtAge(s.lastSeen) }}</span>
      </div>
    </div>
    <p v-if="sessions.length === 0" class="empty mono dim">no active sessions</p>
  </div>
</template>

<style scoped>
.sessions {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  overflow-y: auto;
  overscroll-behavior: contain;
}

.session {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-3);
  background: var(--glass);
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
}

.session-main {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.session-project {
  font-size: var(--text-sm);
  color: var(--ink-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session-model {
  font-size: var(--text-xs);
}

.session-meta {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  font-size: var(--text-xs);
  flex-shrink: 0;
}

.empty {
  font-size: var(--text-sm);
  padding: var(--space-2) var(--space-3);
}
</style>
