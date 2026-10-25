<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { formatDuration } from '../services/player';
import { contentPlayLabel } from '../services/content-experience';
import { getSingleAudioCoordinator, type SingleAudioState } from '../services/single-audio-coordinator';

const coordinator = getSingleAudioCoordinator();
const state = ref<Readonly<SingleAudioState>>(coordinator.snapshot());
let unsubscribe: (() => void) | undefined;

const visible = computed(() => Boolean(state.value.current?.audioUrl && state.value.current.contentForm !== 'silent-companion'));
const timerLabel = computed(() => state.value.timerRemainingSeconds > 0
  ? `${Math.ceil(state.value.timerRemainingSeconds / 60)}分钟`
  : '');
const playLabel = computed(() => contentPlayLabel(state.value.current?.contentForm, state.value.isPlaying, state.value.currentTime, state.value.current?.durationSeconds || 0));

function toggle() {
  coordinator.toggle();
}

function retrySave() {
  void coordinator.retryFailedSave();
}

function openPlayer() {
  const current = state.value.current;
  if (!current) return;
  uni.setStorageSync('currentMusicSpaceId', current.id);
  uni.navigateTo({ url: '/pages/player/index' });
}

onMounted(() => { unsubscribe = coordinator.subscribe((value) => { state.value = value; }); });
onUnmounted(() => { unsubscribe?.(); });
</script>

<template>
  <view v-if="visible" class="single-audio-bar">
    <button class="bar-main" aria-label="返回播放页" @click="openPlayer">
      <view class="bar-copy">
        <text class="bar-title">{{ state.current?.title }}</text>
        <text class="bar-meta">{{ formatDuration(Math.floor(state.currentTime)) }}<text v-if="timerLabel"> · {{ timerLabel }}后关闭</text></text>
      </view>
    </button>
    <button v-if="state.saveRetryAvailable" class="bar-retry" :loading="state.saveRetryInFlight" :disabled="state.saveRetryInFlight" @click="retrySave">重试保存</button>
    <button class="bar-control" :aria-label="playLabel" @click="toggle">
      <text>{{ playLabel }}</text>
    </button>
  </view>
</template>

<style scoped>
.single-audio-bar { position:fixed; right:20rpx; bottom:calc(112rpx + env(safe-area-inset-bottom)); left:20rpx; z-index:18; display:flex; min-height:96rpx; align-items:center; gap:12rpx; border:1rpx solid rgba(27,71,63,.18); border-radius:8rpx; background:rgba(246,250,248,.96); padding:10rpx 12rpx 10rpx 20rpx; box-shadow:0 12rpx 30rpx rgba(16,45,40,.16); backdrop-filter:blur(18rpx); }
.bar-main { flex:1; min-width:0; border:0; background:transparent; padding:0; text-align:left; }
.bar-copy { min-width:0; }
.bar-title,.bar-meta { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.bar-title { color:#12312d; font-size:27rpx; font-weight:850; }
.bar-meta { margin-top:5rpx; color:#73827f; font-size:23rpx; }
.bar-retry { min-width:112rpx; min-height:60rpx; border:1rpx solid #17675d; border-radius:6rpx; background:#fff; padding:0 12rpx; color:#17675d; font-size:22rpx; font-weight:750; }
.bar-control { width:92rpx; min-height:68rpx; border:0; border-radius:50%; background:#17675d; padding:0; color:#fff; font-size:24rpx; font-weight:850; }
button::after { border:0; }
.bar-control { width:128rpx; font-size:24rpx; border-radius:999rpx; flex-shrink:0; }
/* #ifdef H5 */
.single-audio-bar { right:auto; left:50%; width:min(calc(100vw - 40rpx),390px); box-sizing:border-box; transform:translateX(-50%); }
/* #endif */
</style>
