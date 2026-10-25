<script setup lang="ts">
import { onHide, onLaunch, onShow } from '@dcloudio/uni-app';
import DemoModeBadge from './components/DemoModeBadge.vue';
import NetworkStatusBanner from './components/NetworkStatusBanner.vue';
import { getSingleAudioCoordinator } from './services/single-audio-coordinator';

let runtimeInitialized = false;

onLaunch(() => {
  if (runtimeInitialized) return;
  runtimeInitialized = true;
  const coordinator = getSingleAudioCoordinator();
  uni.$on('zhiyin:session-invalidated', (payload?: { reason?: string; hadPrincipal?: boolean }) => {
    coordinator.handleSessionInvalidated(payload);
  });
  uni.$on('zhiyin:account-deleted', () => coordinator.stopForExclusivePlayback());
  const runtime = uni as typeof uni & { onAudioInterruptionBegin?: (listener: () => void) => void };
  runtime.onAudioInterruptionBegin?.(() => coordinator.handleSystemInterruption());
});

onHide(() => getSingleAudioCoordinator().handleApplicationHide());
onShow(() => getSingleAudioCoordinator().handleApplicationShow());
</script>

<template>
  <DemoModeBadge />
  <NetworkStatusBanner />
  <slot />
</template>

<style>
page {
  --zy-bg: #0b0f14;
  --zy-surface: #161c24;
  --zy-surface-soft: #1c2530;
  --zy-primary: #7ee7d6;
  --zy-ink: #eef3f7;
  --zy-muted: #8b97a6;
  --zy-border: #2a3542;
  background: var(--zy-bg);
  color: var(--zy-ink);
  font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
}
button { font: inherit; touch-action: manipulation; }
.search-pill,.search-input,.search-action,.quick-chip,.category-chip,.sort-tab,.tab,.primary-button,.secondary-button,.member-pill,.quiet-action,.visual-fullscreen,.heart,.transport,.setting { min-height:88rpx !important; }
/* #ifdef H5 */
html,
body {
  min-height: 100%;
  background: var(--zy-bg);
}

body {
  overflow-x: hidden;
}

#app {
  position: relative;
  width: 100%;
  min-height: 100vh;
  margin: 0;
  overflow: visible;
  background: var(--zy-bg);
}

uni-app,
uni-page,
uni-page-wrapper,
uni-page-body {
  width: 100%;
  max-width: none;
}

.uni-page-head,
.uni-tabbar {
  right: 0 !important;
  left: 0 !important;
  width: 100% !important;
  transform: none !important;
}

@media (max-width: 430px) {
  html {
    scrollbar-width: none;
  }

  html::-webkit-scrollbar,
  body::-webkit-scrollbar {
    display: none;
  }
}

@media (min-width: 431px) {
  html,
  body {
    background: #07090c;
  }

  html {
    font-size: 18.34667px !important;
    scrollbar-gutter: stable;
  }

  #app {
    width: 430px;
    margin: 0 auto;
    box-shadow: 0 0 56px rgba(0, 0, 0, 0.45);
  }

  uni-app,
  uni-page,
  uni-page-wrapper,
  uni-page-body {
    max-width: 430px;
  }

  .uni-page-head,
  .uni-tabbar {
    right: auto !important;
    left: 50% !important;
    width: 430px !important;
    transform: translateX(-50%) !important;
  }
}
/* #endif */
</style>
