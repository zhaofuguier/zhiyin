<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { getNetworkState, type NetworkState } from '../services/network';

const current = ref<NetworkState>(getNetworkState());
const visible = computed(() => !['online', 'loading'].includes(current.value.status));
function update(next: NetworkState) { current.value = next; }
onMounted(() => uni.$on('zhiyin:network-state', update));
onUnmounted(() => uni.$off('zhiyin:network-state', update));
</script>

<template>
  <view v-if="visible" :class="['network-status-banner', `status-${current.status}`]">
    {{ current.message }}
  </view>
</template>

<style scoped>
.network-status-banner { position:fixed; right:16rpx; bottom:calc(118rpx + env(safe-area-inset-bottom)); left:16rpx; z-index:9998; border:2rpx solid rgba(255,255,255,.72); border-radius:16rpx; background:#334b46; padding:14rpx 18rpx; color:#fff; font-size:24rpx; font-weight:780; text-align:center; box-shadow:0 10rpx 28rpx rgba(16,36,32,.18); pointer-events:none; }
.status-error,.status-unavailable,.status-auth-error { background:#7b3f35; }
.status-maintenance { background:#705a2d; }
.status-stale { background:#625f35; }
.status-recovered { background:#17675d; }
/* #ifdef H5 */
@media (min-width: 431px) { .network-status-banner { right: calc((100vw - 430px) / 2 + 8px); left: calc((100vw - 430px) / 2 + 8px); } }
/* #endif */
</style>