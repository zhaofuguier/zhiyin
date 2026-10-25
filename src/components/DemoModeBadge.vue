<script setup lang="ts">
import { IS_DEMO_MODE } from '../services/config';
</script>

<template>
  <view v-if="IS_DEMO_MODE" class="demo-mode-badge" aria-label="演示模式">演示模式</view>
</template>

<style scoped>
.demo-mode-badge {
  position: fixed;
  top: calc(12rpx + env(safe-area-inset-top));
  right: 16rpx;
  z-index: 9999;
  border: 2rpx solid rgba(255,255,255,.72);
  border-radius: 999rpx;
  background: #9b4b22;
  padding: 8rpx 16rpx;
  color: #fff;
  font-size: 22rpx;
  font-weight: 850;
  box-shadow: 0 8rpx 24rpx rgba(34,20,14,.22);
  pointer-events: none;
}
/* #ifdef H5 */
@media (min-width: 431px) { .demo-mode-badge { right: calc((100vw - 430px) / 2 + 8px); } }
/* #endif */
</style>