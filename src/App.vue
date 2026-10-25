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
  --zy-bg: #f5f7f4;
  --zy-surface: #ffffff;
  --zy-surface-soft: #eef4f1;
  --zy-primary: #17675d;
  --zy-ink: #12312d;
  --zy-muted: #73827f;
  --zy-border: #d8e1dd;
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
  background: #d8d5cc;
}

@media (min-width: 431px) {
  html {
    font-size: 18.34667px !important;
    scrollbar-gutter: stable;
  }
}

body {
  overflow-x: hidden;
}

#app {
  position: relative;
  width: min(100%, 430px);
  min-height: 100vh;
  margin: 0 auto;
  overflow: visible;
  background: var(--zy-bg);
  box-shadow: 0 0 56px rgba(20, 31, 29, 0.18);
}

uni-app,
uni-page,
uni-page-wrapper,
uni-page-body {
  width: 100%;
  max-width: 430px;
}

.uni-page-head,
.uni-tabbar {
  right: auto !important;
  left: 50% !important;
  width: min(100vw, 430px) !important;
  transform: translateX(-50%) !important;
}

@media (max-width: 430px) {
  html {
    scrollbar-width: none;
  }

  html::-webkit-scrollbar,
  body::-webkit-scrollbar {
    display: none;
  }

  #app {
    box-shadow: none;
  }
}
/* #endif */
</style>
