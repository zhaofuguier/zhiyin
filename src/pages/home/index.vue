<script setup lang="ts">
import { computed, ref } from 'vue';
import { onShow, onUnload } from '@dcloudio/uni-app';
import RequestStatePanel from '../../components/RequestStatePanel.vue';
import SingleAudioBar from '../../components/SingleAudioBar.vue';
import type { MusicSpace } from '../../types/music-space';
import { getHomeMusicPreview, getMusicSpacePage, type MusicSpaceSort } from '../../services/api';
import { DEFAULT_COVER_IMAGE } from '../../services/assets';
import { sceneTaxonomy, type PrimarySceneId, type SecondarySceneId } from '../../shared/scene-taxonomy.generated';
import { getNetworkState, requestErrorMessage } from '../../services/network';
import { formatDuration } from '../../services/player';
import { contentExperience } from '../../services/content-experience';
import { applyTheme } from '../../services/theme';
import type { PlayHistoryItem } from '../../services/user-activity';
import { loadOptionalLastPlayed } from '../../services/personal-content';
import { LatestSceneQuery, saveSceneSelection } from '../../services/scene-browser';

const featuredSpaces = ref<MusicSpace[]>([]);
const homeFeaturedSpaces = ref<MusicSpace[]>([]);
const latestSpaces = ref<MusicSpace[]>([]);
let homeLoaded = false;
const hero = ref<MusicSpace>();
const keyword = ref('');
const selectedSort = ref<MusicSpaceSort>('featured');
const selectedPrimarySceneId = ref<PrimarySceneId>();
const selectedSecondarySceneId = ref<SecondarySceneId>();
const networkNotice = ref('');
const isLoading = ref(true);
const errorMessage = ref('');
const lastPlayed = ref<{ space?: MusicSpace; history?: PlayHistoryItem }>({});
let contentRequestRevision = 0;

const sceneQuery = new LatestSceneQuery({
  getPrimary: async (primarySceneId, sort) => (await getMusicSpacePage({ primarySceneId, sort, pageSize: 8 })).items,
  getSecondary: async (primarySceneId, secondarySceneId, sort) => (await getMusicSpacePage({ primarySceneId, secondarySceneId, sort, pageSize: 8 })).items
});

const recommendSpaces = computed(() => featuredSpaces.value.slice(1).length ? featuredSpaces.value.slice(1) : featuredSpaces.value);
const previewSpaces = computed(() => [...homeFeaturedSpaces.value, ...latestSpaces.value]);

loadHomeData();

async function loadHomeData() {
  const revision = ++contentRequestRevision;
  sceneQuery.invalidate();
  isLoading.value = true;
  errorMessage.value = '';
  try {
    const { featured, latest } = await getHomeMusicPreview();
    if (revision !== contentRequestRevision) return;
    homeFeaturedSpaces.value = featured;
    latestSpaces.value = latest;
    homeLoaded = true;
    featuredSpaces.value = featured;
    hero.value = featuredSpaces.value[0];
    refreshNetworkNotice();
    void refreshLastPlayed();
  } catch (error) {
    if (revision !== contentRequestRevision) return;
    errorMessage.value = requestErrorMessage(error);
    refreshNetworkNotice();
  } finally {
    if (revision === contentRequestRevision) isLoading.value = false;
  }
}

async function refreshLastPlayed() {
  const result = await loadOptionalLastPlayed();
  if (result.state === 'loaded') lastPlayed.value = { space: result.space, history: result.history };
  else if (result.state !== 'stale') lastPlayed.value = {};
}

function refreshNetworkNotice() {
  const state = getNetworkState();
  networkNotice.value = state.status === 'online' ? '' : state.message;
}

function openPlayer(space: MusicSpace) {
  uni.setStorageSync('currentMusicSpaceId', space.id);
  uni.navigateTo({ url: '/pages/player/index' });
}

function openSearch() {
  uni.navigateTo({ url: '/pages/search/index' });
}

async function selectPrimaryScene(primarySceneId: PrimarySceneId) {
  const revision = ++contentRequestRevision;
  selectedPrimarySceneId.value = primarySceneId;
  selectedSecondarySceneId.value = undefined;
  keyword.value = sceneTaxonomy.primaryScenes.find((item) => item.id === primarySceneId)?.name || '';
  selectedSort.value = 'featured';
  isLoading.value = true;
  const outcome = await sceneQuery.load({ primarySceneId, sort: selectedSort.value });
  if (revision !== contentRequestRevision || outcome.state === 'stale') return;
  if (outcome.state === 'loaded') {
    featuredSpaces.value = outcome.spaces;
    hero.value = outcome.spaces[0];
    errorMessage.value = '';
  } else {
    featuredSpaces.value = [];
    hero.value = undefined;
    errorMessage.value = requestErrorMessage(outcome.error);
  }
  isLoading.value = false;
}

async function selectSecondaryScene(secondarySceneId: SecondarySceneId) {
  const primarySceneId = selectedPrimarySceneId.value;
  if (!primarySceneId) return;
  const revision = ++contentRequestRevision;
  selectedSecondarySceneId.value = secondarySceneId;
  keyword.value = sceneTaxonomy.primaryScenes.find((item) => item.id === primarySceneId)?.children
    .find((item) => item.id === secondarySceneId)?.name || '';
  isLoading.value = true;
  const outcome = await sceneQuery.load({ primarySceneId, secondarySceneId, sort: selectedSort.value });
  if (revision !== contentRequestRevision || outcome.state === 'stale') return;
  if (outcome.state === 'loaded') {
    featuredSpaces.value = outcome.spaces;
    hero.value = outcome.spaces[0];
    errorMessage.value = '';
  } else {
    featuredSpaces.value = [];
    hero.value = undefined;
    errorMessage.value = requestErrorMessage(outcome.error);
  }
  isLoading.value = false;
}

function clearScene() {
  contentRequestRevision += 1;
  sceneQuery.invalidate();
  isLoading.value = false;
  errorMessage.value = '';
  keyword.value = '';
  selectedPrimarySceneId.value = undefined;
  selectedSecondarySceneId.value = undefined;
  selectedSort.value = 'featured';
  featuredSpaces.value = homeFeaturedSpaces.value;
  hero.value = featuredSpaces.value[0];
  if (!homeLoaded) void loadHomeData();
}

function openSelectedScene() {
  const primarySceneId = selectedPrimarySceneId.value;
  if (!primarySceneId) return;
  saveSceneSelection({
    primarySceneId,
    secondarySceneId: selectedSecondarySceneId.value,
    sort: selectedSort.value
  });
  uni.switchTab({ url: '/pages/categories/index' });
}

function retryHomeRequest() {
  if (selectedSecondarySceneId.value) return selectSecondaryScene(selectedSecondarySceneId.value);
  if (selectedPrimarySceneId.value) return selectPrimaryScene(selectedPrimarySceneId.value);
  return loadHomeData();
}

function shuffleSpaces() {
  if (featuredSpaces.value.length <= 1) return;
  featuredSpaces.value = [...featuredSpaces.value.slice(1), featuredSpaces.value[0]];
  hero.value = featuredSpaces.value[0];
}

function formatDate(value?: string) {
  if (!value) return '新近';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(5).replace('-', '.');
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${month}.${day}`;
}

function useFallbackCover(space?: MusicSpace) {
  if (!space || space.coverImageUrl === DEFAULT_COVER_IMAGE) return;
  space.coverImageUrl = DEFAULT_COVER_IMAGE;
}

function openScenes() { uni.switchTab({ url: '/pages/categories/index' }); }

onShow(() => {
  applyTheme();
  refreshNetworkNotice();
  void refreshLastPlayed();
});
onUnload(() => { contentRequestRevision += 1; sceneQuery.invalidate(); });
</script>

<template>
  <view class="page">
    <SingleAudioBar />
    <view class="top-actions">
      <button class="search-pill" @click="openSearch">
        <text class="search-text">搜索场景、情绪、关键词</text>
      </button>
    </view>

    <text v-if="networkNotice" class="notice">{{ networkNotice }}</text>

    <RequestStatePanel v-if="errorMessage && !isLoading" kind="error" :message="errorMessage" @retry="retryHomeRequest" />
    <RequestStatePanel v-else-if="!isLoading && !selectedPrimarySceneId && !previewSpaces.length" kind="empty" message="内容准备中" />

    <view v-if="isLoading" class="loading-panel">
      <text class="loading-title">正在整理音乐空间</text>
      <text class="loading-copy">为你匹配适合此刻的声音和画面。</text>
    </view>

    <view v-if="!isLoading && hero" class="section-head today-head">
      <text>{{ selectedPrimarySceneId ? '为你推荐' : '找一个适合此刻的环境' }}</text>
    </view>
    <button v-if="!isLoading && hero" class="hero-card" :aria-label="`打开${hero.title}`" @click="openPlayer(hero)">
      <image class="hero-image" :src="hero.coverImageUrl" mode="aspectFill" @error="useFallbackCover(hero)" />
      <view class="hero-shade">
        <view class="hero-meta"><text class="hero-visual-type">{{ contentExperience(hero.contentForm).label }} · {{ formatDuration(hero.durationSeconds) }}</text></view>
        <view class="hero-bottom">
          <view class="hero-copy-wrap"><text class="hero-title">{{ hero.title }}</text><text class="hero-copy">{{ hero.atmosphereText }}</text></view>
          <view class="hero-play-cue"><image class="hero-play-icon" src="/static/tabbar/player-active.png" mode="aspectFit" /></view>
        </view>
      </view>
    </button>

    <view v-if="!isLoading" class="section-head scene-head">
      <text>进入场景</text>
      <button v-if="keyword" class="head-action" @click="clearScene">全部</button>
    </view>

    <view v-if="!isLoading" class="scene-grid">
      <button
        v-for="scene in sceneTaxonomy.primaryScenes"
        :key="scene.id"
        :class="['scene-card', selectedPrimarySceneId === scene.id ? 'active' : '']"
        @click="selectPrimaryScene(scene.id)"
      >
        <text class="scene-name">{{ scene.name }}</text>
      </button>
      <button class="scene-card scene-all" @click="openScenes"><text class="scene-name">全部场景 ›</text></button>
    </view>

    <scroll-view v-if="!isLoading && selectedPrimarySceneId" class="secondary-scroll" scroll-x>
      <button v-for="item in sceneTaxonomy.primaryScenes.find((scene) => scene.id === selectedPrimarySceneId)?.children || []"
        :key="item.id" :class="['secondary-chip', selectedSecondarySceneId === item.id ? 'active' : '']"
        @click="selectSecondaryScene(item.id)">{{ item.name }}</button>
    </scroll-view>

    <button v-if="!isLoading && selectedPrimarySceneId" class="scene-enter" @click="openSelectedScene">
      在场景页查看{{ selectedSecondarySceneId ? '当前分类' : '全部内容' }}
    </button>

    <view v-if="!isLoading && selectedPrimarySceneId && !featuredSpaces.length && !errorMessage" class="empty-scene">内容准备中</view>

    <button v-if="lastPlayed.space && !isLoading" class="continue-card" @click="openPlayer(lastPlayed.space)">
      <image class="continue-cover" :src="lastPlayed.space.coverImageUrl" mode="aspectFill" @error="useFallbackCover(lastPlayed.space)" />
      <view class="continue-copy">
        <text class="continue-label">继续播放</text>
        <text class="continue-title">{{ lastPlayed.space.title }}</text>
      </view>
      <image class="continue-play-icon" src="/static/tabbar/player-active.png" mode="aspectFit" />
    </button>
    <view v-if="!isLoading" class="section-head recommend-head">
      <text>{{ keyword ? `${keyword}空间` : '推荐空间' }}</text>
      <button class="head-action" @click="shuffleSpaces">换一批</button>
    </view>

    <scroll-view v-if="!isLoading" class="recommend-scroll" scroll-x>
      <button v-for="space in recommendSpaces" :key="space.id" class="recommend-card" @click="openPlayer(space)">
        <image class="recommend-image" :src="space.coverImageUrl" mode="aspectFill" @error="useFallbackCover(space)" />
        <view class="recommend-shade">
          <text class="recommend-title">{{ space.title }}</text>
          <text class="recommend-meta">{{ contentExperience(space.contentForm).label }}</text>
          <text class="recommend-meta">{{ formatDuration(space.durationSeconds) }}</text>
        </view>
      </button>
    </scroll-view>

    <view v-if="latestSpaces.length" class="section-head latest-head">
      <text>新近上架</text>
    </view>
    <view class="latest-list">
      <button v-for="space in latestSpaces" :key="space.id" class="latest-row" @click="openPlayer(space)">
        <image class="latest-cover" :src="space.coverImageUrl" mode="aspectFill" @error="useFallbackCover(space)" />
        <view class="latest-copy">
          <text class="latest-title">{{ space.title }}</text>
          <text class="latest-meta">{{ contentExperience(space.contentForm).label }} · {{ formatDuration(space.durationSeconds) }}</text>
        </view>
      </button>
    </view>
  </view>
</template>

<style scoped>
.page {
  min-height: 100vh;
  box-sizing: border-box;
  padding: 22rpx 24rpx calc(180rpx + env(safe-area-inset-bottom));
  background: #f5f7f4;
  color: #12312d;
  -webkit-font-smoothing: antialiased;
}
button { box-sizing: border-box; line-height: normal; margin: 0; touch-action: manipulation; }
button::after { border: 0; }
text { display: block; }
.top-actions { display: flex; gap: 16rpx; align-items: center; }
.search-pill {
  flex: 1;
  display: flex;
  align-items: center;
  min-height: 72rpx;
  border: 2rpx solid #d8e1dd;
  border-radius: 999rpx;
  background: #fff;
  padding: 20rpx 24rpx;
  color: #7a8885;
  font-size: 28rpx;
  text-align: left;
  box-shadow: 0 8rpx 24rpx rgba(20,43,39,.04);
}
.search-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.notice {
  margin-top: 14rpx;
  border-radius: 18rpx;
  background: rgba(23,103,93,.08);
  padding: 14rpx 20rpx;
  color: #49635e;
  font-size: 28rpx;
}
.loading-panel { margin-top: 22rpx; border-radius: 30rpx; background: #fff; padding: 34rpx; }
.loading-title { color: #12312d; font-size: 34rpx; font-weight: 900; }
.loading-copy { margin-top: 8rpx; color: #72827f; font-size: 28rpx; }
.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 30rpx 2rpx 16rpx;
  color: #12312d;
  font-size: 34rpx;
  font-weight: 900;
  line-height: 1.15;
  letter-spacing: .2rpx;
}
.head-action { border: 0; background: transparent; color: #58706b; font-size: 28rpx; font-weight: 800; }
.scene-head { margin-top: 30rpx; }
.secondary-scroll { width:100%; margin-top:16rpx; white-space:nowrap; }
.secondary-chip { display:inline-flex; min-height:66rpx; align-items:center; margin-right:12rpx; border:1rpx solid #cbd9d4; border-radius:999rpx; background:#fff; padding:0 24rpx; color:#35544d; font-size:25rpx; }
.secondary-chip.active { border-color:#17675d; background:#17675d; color:#fff; }
.scene-enter { width:100%; margin-top:14rpx; border:1rpx solid #cbd9d4; border-radius:18rpx; background:#fff; padding:18rpx; color:#17675d; font-size:27rpx; font-weight:800; }
.empty-scene { margin-top:20rpx; padding:50rpx 20rpx; color:#73827e; text-align:center; }
.scene-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12rpx; }
.scene-card {
  position: relative;
  overflow: hidden;
  width: 100%;
  min-height: 88rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2rpx solid #d8e1dd;
  border-radius: 18rpx;
  background: #fff;
  padding: 12rpx 4rpx;
  text-align: center;
}
.scene-card.active { border-color: #17675d; background: #17675d; }
.scene-card.active .scene-name { color: #fff; }
.scene-all { background: #eaf1ed; }
.scene-name {
  color: #294b46;
  font-size: 25rpx;
  font-weight: 750;
  line-height: 1.4;
}
.today-head { margin-top: 34rpx; }
.hero-card {
  position: relative;
  overflow: hidden;
  width: 100%;
  height: auto;
  aspect-ratio: 16 / 9;
  border: 2rpx solid #d6dfdb;
  border-radius: 28rpx;
  background: #dbe5e1;
  padding: 0;
  text-align: left;
  box-shadow: 0 18rpx 46rpx rgba(20,43,39,.12);
}
.hero-image, .recommend-image { width: 100%; height: 100%; filter: saturate(.9) contrast(1.02) brightness(.94); }
.hero-shade {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 26rpx;
  background: linear-gradient(180deg,rgba(7,18,28,.12),rgba(7,18,28,.02) 36%,rgba(7,18,28,.82));
}
.hero-meta, .hero-bottom, .continue-card, .latest-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.hero-visual-type {
  align-self: flex-start;
  border-radius: 999rpx;
  background: rgba(8,28,28,.48);
  padding: 9rpx 16rpx;
  color: #fff;
  font-size: 26rpx;
  font-weight: 800;
}
.hero-copy-wrap, .continue-copy, .latest-copy { flex: 1; min-width: 0; }
.hero-title {
  color: #fff;
  font-size: 42rpx;
  font-weight: 900;
  line-height: 1.15;
  letter-spacing: .3rpx;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.hero-copy {
  margin-top: 10rpx;
  color: rgba(255,255,255,.86);
  font-size: 28rpx;
  font-weight: 700;
  line-height: 1.35;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.hero-play-cue {
  display: flex;
  width: 88rpx;
  height: 88rpx;
  flex: 0 0 88rpx;
  align-items: center;
  justify-content: center;
  margin-left: 18rpx;
  border: 2rpx solid rgba(255,255,255,.55);
  border-radius: 50%;
  background: rgba(255,255,255,.12);
}
.hero-play-icon { width: 30rpx; height: 30rpx; filter: brightness(0) invert(1); }
.continue-card {
  width: 100%;
  margin-top: 16rpx;
  border: 2rpx solid #dbe3df;
  border-radius: 22rpx;
  background: rgba(255,255,255,.82);
  padding: 14rpx;
  text-align: left;
  box-shadow: 0 8rpx 24rpx rgba(20,43,39,.045);
}
.continue-cover { width: 96rpx; height: auto; aspect-ratio: 16 / 9; border-radius: 12rpx; margin-right: 16rpx; filter: saturate(.88) contrast(1.02); }
.continue-label { color: #7c8b88; font-size: 26rpx; font-weight: 800; }
.continue-title, .latest-title {
  color: #12312d;
  font-size: 30rpx;
  font-weight: 900;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.continue-play-icon { width: 44rpx; height: 44rpx; margin: 0 10rpx 0 18rpx; opacity: .82; }
.recommend-head { margin-top: 34rpx; }
.recommend-scroll { width: 100%; height: 242rpx; white-space: nowrap; scrollbar-width: none; }
.recommend-scroll :deep(.uni-scroll-view)::-webkit-scrollbar { display: none; width: 0; height: 0; }
.recommend-card {
  position: relative;
  display: inline-block;
  overflow: hidden;
  width: 430rpx;
  height: auto;
  aspect-ratio: 16 / 9;
  margin-right: 16rpx;
  border: 2rpx solid #d6dfdb;
  border-radius: 24rpx;
  background: #d8e0de;
  padding: 0;
  text-align: left;
  box-shadow: 0 10rpx 28rpx rgba(20,43,39,.08);
}
.recommend-shade {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  padding: 20rpx;
  background: linear-gradient(180deg,rgba(5,16,18,.02) 30%,rgba(5,16,18,.78));
}
.recommend-title {
  color: #fff;
  font-size: 30rpx;
  font-weight: 900;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.recommend-meta { margin-top: 6rpx; color: rgba(255,255,255,.8); font-size: 26rpx; }
.latest-list { display: grid; gap: 14rpx; }
.latest-row {
  width: 100%;
  border: 2rpx solid #e0e6e3;
  border-radius: 22rpx;
  background: rgba(255,255,255,.72);
  padding: 14rpx;
  text-align: left;
  box-shadow: 0 8rpx 24rpx rgba(20,43,39,.035);
}
.latest-cover { width: 136rpx; height: auto; aspect-ratio: 16 / 9; border-radius: 14rpx; margin-right: 16rpx; filter: saturate(.88) contrast(1.02); }
.latest-meta {
  margin-top: 6rpx;
  color: #73827f;
  font-size: 26rpx;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.scene-card:active,
.hero-card:active,
.continue-card:active,
.recommend-card:active,
.latest-row:active,
.search-pill:active,
.head-action:active { opacity: .88; }
</style>


