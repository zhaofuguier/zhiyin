<script setup lang="ts">
import { ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import RequestStatePanel from '../../components/RequestStatePanel.vue';
import SingleAudioBar from '../../components/SingleAudioBar.vue';
import type { MusicSpace } from '../../types/music-space';
import { DEFAULT_COVER_IMAGE } from '../../services/assets';
import { formatDuration } from '../../services/player';
import { contentExperience, hasVisibleContentForm } from '../../services/content-experience';
import { applyTheme } from '../../services/theme';
import { getFavoriteSpaces, getLastPlayedSpace, type PlayHistoryItem } from '../../services/user-activity';
import { requestErrorMessage } from '../../services/network';
import { getSessionToken } from '../../services/session';
import { promptLoginForAction } from '../../services/session-scope';

const spaces = ref<MusicSpace[]>([]);
const lastPlayed = ref<{ space?: MusicSpace; history?: PlayHistoryItem }>({});
const isLoading = ref(true);
const errorMessage = ref('');
const loginRequired = ref(false);

async function loadFavorites() {
  loginRequired.value = !getSessionToken();
  if (loginRequired.value) {
    spaces.value = [];
    lastPlayed.value = {};
    errorMessage.value = '';
    isLoading.value = false;
    return;
  }
  isLoading.value = true;
  errorMessage.value = '';
  try {
    const [favoriteSpaces, last] = await Promise.all([
      getFavoriteSpaces(),
      getLastPlayedSpace()
    ]);
    spaces.value = favoriteSpaces.filter((space) => hasVisibleContentForm(space));
    lastPlayed.value = last.space && hasVisibleContentForm(last.space) ? last : {};
  } catch (error) {
    errorMessage.value = requestErrorMessage(error);
  } finally {
    isLoading.value = false;
  }
}

function requestLogin() { promptLoginForAction('收藏'); }
function browseContent() { uni.switchTab({ url: '/pages/home/index' }); }

function openPlayer(space: MusicSpace) {
  uni.setStorageSync('currentMusicSpaceId', space.id);
  uni.navigateTo({ url: '/pages/player/index' });
}

function useFallbackCover(space: MusicSpace) {
  if (space.coverImageUrl === DEFAULT_COVER_IMAGE) return;
  space.coverImageUrl = DEFAULT_COVER_IMAGE;
}

onShow(() => {
  applyTheme();
  loadFavorites();
});
</script>

<template>
  <view class="page">
    <SingleAudioBar />
    <view class="header">
      <text class="subtitle">你收藏的陪伴环境</text>
    </view>

    <button v-if="lastPlayed.space" class="continue-card" @click="openPlayer(lastPlayed.space)">
      <image class="continue-cover" :src="lastPlayed.space.coverImageUrl" mode="aspectFill" @error="useFallbackCover(lastPlayed.space)" />
      <view class="continue-shade">
        <text class="continue-label">继续播放</text>
        <text class="continue-title">{{ lastPlayed.space.title }}</text>
        <text class="continue-meta">
          {{ lastPlayed.history ? `上次 ${formatDuration(lastPlayed.history.currentTime)}` : formatDuration(lastPlayed.space.durationSeconds) }}
        </text>
      </view>
      <view class="continue-play"><image class="continue-play-icon" src="/static/tabbar/player-active.png" mode="aspectFit" /></view>
    </button>

    <view class="section-head">
      <text class="section-title">收藏空间</text>
      <text v-if="!loginRequired" class="section-more">{{ spaces.length }} 个</text>
    </view>

    <view v-if="loginRequired && !isLoading" class="empty login-panel">
      <text class="empty-title">登录后查看收藏</text>
      <text class="empty-copy">保存喜欢的声音，下次回来继续听。</text>
      <view class="empty-actions"><button class="login-action" @click="requestLogin">去登录</button><button class="browse-action" @click="browseContent">先去听听</button></view>
    </view>
    <RequestStatePanel v-else-if="errorMessage && !isLoading" kind="error" :message="errorMessage" @retry="loadFavorites" />

    <view v-if="isLoading" class="empty">
      <text class="empty-title">正在整理收藏</text>
      <text class="empty-copy">为你读取最近保存的音乐空间。</text>
    </view>

    <view v-else-if="!loginRequired && !errorMessage && !spaces.length" class="empty">
      <text class="empty-title">还没有收藏</text>
      <text class="empty-copy">在播放页点收藏后，这里会沉淀你的专属清单。</text>
      <button class="browse-action" @click="browseContent">去发现内容</button>
    </view>

    <view v-else class="space-list">
      <button v-for="space in spaces" :key="space.id" class="space-row" @click="openPlayer(space)">
        <image class="cover" :src="space.coverImageUrl" mode="aspectFill" @error="useFallbackCover(space)" />
        <view class="space-info">
          <text class="space-title">{{ space.title }}</text>
          <text class="space-subtitle">{{ contentExperience(space.contentForm).label }} · {{ formatDuration(space.durationSeconds) }}</text>
        </view>
        <view class="row-play"><image class="row-play-icon" src="/static/tabbar/player-active.png" mode="aspectFit" /></view>
      </button>
    </view>
  </view>
</template>

<style scoped>
.page { min-height: 100vh; box-sizing: border-box; padding: 22rpx 24rpx calc(180rpx + env(safe-area-inset-bottom)); background: #0b0f14; color: #eef3f7; }
button { box-sizing: border-box; line-height: normal; margin: 0; }
button::after { border: 0; }
text { display: block; }
.header { margin: 2rpx 2rpx 20rpx; }
.subtitle { color: #8b97a6; font-size: 28rpx; }
.continue-card { position: relative; overflow: hidden; width: 100%; height: auto; aspect-ratio: 16/9; border: 0; border-radius: 28rpx; background: #161c24; padding: 0; text-align: left; }
.continue-cover { width: 100%; height: 100%; filter: saturate(.9) contrast(1.02) brightness(.94); }
.continue-shade { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: flex-end; padding: 24rpx; background: linear-gradient(180deg,rgba(4,17,18,.02) 26%,rgba(4,17,18,.84)); }
.continue-label { color: #7ee7d6; font-size: 26rpx; font-weight: 700; }
.continue-title { max-width: 520rpx; overflow: hidden; margin-top: 6rpx; color: #fff; font-size: 36rpx; font-weight: 900; text-overflow: ellipsis; white-space: nowrap; }
.continue-meta { margin-top: 7rpx; color: rgba(255,255,255,.78); font-size: 28rpx; }
.continue-play { position: absolute; right: 24rpx; bottom: 26rpx; display: flex; width: 62rpx; height: 62rpx; align-items: center; justify-content: center; border: 2rpx solid rgba(255,255,255,.56); border-radius: 50%; background: rgba(255,255,255,.14); }
.continue-play-icon { width: 28rpx; height: 28rpx; filter: brightness(0) invert(1); }
.section-head { display: flex; align-items: baseline; justify-content: space-between; margin: 32rpx 2rpx 16rpx; }
.section-title { color: #f4f7fb; font-size: 34rpx; font-weight: 760; }
.section-more { color: #8b97a6; font-size: 26rpx; }
.empty { border-radius: 28rpx; background: #161c24; padding: 36rpx 28rpx; }
.empty-title { color: #f4f7fb; font-size: 34rpx; font-weight: 760; }
.empty-copy { margin-top: 9rpx; color: #8b97a6; font-size: 28rpx; line-height: 1.45; }
.empty-actions { display:flex; align-items:center; gap:20rpx; margin-top:24rpx; }
.login-action,.browse-action { min-height:88rpx; padding:20rpx 28rpx; border-radius:999rpx; font-size:28rpx; font-weight:750; }
.login-action { background:#7ee7d6; color:#0b0f14; }
.browse-action { margin-top:20rpx; background:#161c24; color:#7ee7d6; }
.empty-actions .browse-action { margin-top:0; }
.space-list { display: flex; flex-direction: column; gap: 14rpx; }
.space-row { display: flex; width: 100%; align-items: center; gap: 16rpx; border: 0; border-radius: 22rpx; background: #161c24; padding: 13rpx; text-align: left; }
.cover { width: 136rpx; height: auto; aspect-ratio: 16/9; border-radius: 14rpx; background: #d8e0de; filter: saturate(.9) contrast(1.02); }
.space-info { flex: 1; min-width: 0; }
.space-title,.space-subtitle { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.space-title { color: #f4f7fb; font-size: 30rpx; font-weight: 740; }
.space-subtitle { margin-top: 6rpx; color: #8b97a6; font-size: 26rpx; }
.row-play { display: flex; width: 56rpx; height: 56rpx; align-items: center; justify-content: center; border-radius: 50%; background: #f4f7fb; }
.row-play-icon { width: 23rpx; height: 23rpx; }
.continue-card:active,.space-row:active { opacity: .88; }
</style>
