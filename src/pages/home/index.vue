<script setup lang="ts">
import { computed, ref } from 'vue';
import { onShow, onUnload } from '@dcloudio/uni-app';
import RequestStatePanel from '../../components/RequestStatePanel.vue';
import SingleAudioBar from '../../components/SingleAudioBar.vue';
import type { MusicSpace } from '../../types/music-space';
import { getHomeMusicPreview, getMusicSpaceDetail, getMusicSpacePage, type MusicSpaceSort } from '../../services/api';
import { DEFAULT_COVER_IMAGE } from '../../services/assets';
import { sceneCoverMap } from '../../demo/scene-covers';
import { sceneTaxonomy, type PrimarySceneId, type SecondarySceneId } from '../../shared/scene-taxonomy.generated';
import { API_BASE_URL } from '../../services/config';
import { getNetworkState, requestErrorMessage } from '../../services/network';
import { formatDuration } from '../../services/player';
import { hasVisibleContentForm } from '../../services/content-experience';
import { sceneFormCaption, sceneStockFromSpaces } from '../../services/visible-catalog';
import { applyTheme } from '../../services/theme';
import type { PlayHistoryItem } from '../../services/user-activity';
import { getPlayHistory } from '../../services/user-activity';
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

const visibleFeatured = computed(() => featuredSpaces.value.filter((space) => hasVisibleContentForm(space)));
const visiblePreview = computed(() => [...homeFeaturedSpaces.value, ...latestSpaces.value].filter((space) => hasVisibleContentForm(space)));
const recommendSpaces = computed(() => {
  const pool = visibleFeatured.value;
  const rest = pool.slice(1);
  return rest.length ? rest : pool;
});
const visibleHero = computed(() => visibleFeatured.value[0]);
const continueSpace = computed(() => (
  lastPlayed.value.space && hasVisibleContentForm(lastPlayed.value.space) ? lastPlayed.value.space : undefined
));
const entranceScenes = computed(() => {
  const stock = sceneStockFromSpaces(visiblePreview.value);
  return sceneTaxonomy.primaryScenes
    .filter((scene) => stock.primaryIds.has(scene.id))
    .map((scene) => ({
      id: scene.id,
      name: scene.name,
      cover: sceneCoverMap[scene.id] || coverForPrimary(scene.id)
    }));
});

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
  try {
    const result = await loadOptionalLastPlayed();
    if (result.state === 'loaded') {
      lastPlayed.value = result.space && hasVisibleContentForm(result.space)
        ? { space: result.space, history: result.history }
        : {};
      return;
    }
    if (result.state === 'stale') return;
    if (result.state === 'anonymous' && !API_BASE_URL) {
      const history = await getPlayHistory();
      const latest = history[0];
      if (!latest) {
        lastPlayed.value = {};
        return;
      }
      const space = await getMusicSpaceDetail(latest.musicSpaceId);
      lastPlayed.value = space && hasVisibleContentForm(space) ? { space, history: latest } : {};
      return;
    }
    lastPlayed.value = {};
  } catch {
    lastPlayed.value = {};
  }
}

function refreshNetworkNotice() {
  const state = getNetworkState();
  networkNotice.value = state.status === 'online' ? '' : state.message;
}

function openPlayer(space?: MusicSpace) {
  if (!space || !hasVisibleContentForm(space)) return;
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

function openPrimaryScene(primarySceneId: PrimarySceneId) {
  saveSceneSelection({ primarySceneId, sort: 'featured' });
  uni.switchTab({ url: '/pages/categories/index' });
}

function retryHomeRequest() {
  if (selectedSecondarySceneId.value) return selectSecondaryScene(selectedSecondarySceneId.value);
  if (selectedPrimarySceneId.value) return selectPrimaryScene(selectedPrimarySceneId.value);
  return loadHomeData();
}

function shuffleSpaces() {
  const visible = featuredSpaces.value.filter((space) => hasVisibleContentForm(space));
  const hidden = featuredSpaces.value.filter((space) => !hasVisibleContentForm(space));
  if (visible.length <= 1) return;
  const rotated = [...visible.slice(1), visible[0]];
  featuredSpaces.value = [...rotated, ...hidden];
  hero.value = featuredSpaces.value[0];
}

function coverForPrimary(primarySceneId: string) {
  const space = visiblePreview.value.find((item) => item.scenePlacements?.some((placement) => placement.primarySceneId === primarySceneId));
  return space?.coverImageUrl || DEFAULT_COVER_IMAGE;
}

function useFallbackCover(space?: MusicSpace) {
  if (!space || space.coverImageUrl === DEFAULT_COVER_IMAGE) return;
  space.coverImageUrl = DEFAULT_COVER_IMAGE;
}

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
    <text class="brand">知音</text>
    <view class="top-actions">
      <button class="search-pill" @click="openSearch">
        <text class="search-text">搜索场景、情绪、关键词</text>
      </button>
    </view>

    <text v-if="networkNotice" class="notice">{{ networkNotice }}</text>

    <RequestStatePanel v-if="errorMessage && !isLoading" kind="error" :message="errorMessage" @retry="retryHomeRequest" />
    <RequestStatePanel v-else-if="!isLoading && !selectedPrimarySceneId && !visiblePreview.length" kind="empty" message="内容准备中" />

    <view v-if="isLoading" class="loading-panel">
      <text class="loading-title">正在整理音乐空间</text>
      <text class="loading-copy">为你匹配适合此刻的声音和画面。</text>
    </view>

    <view v-if="!isLoading && entranceScenes.length" class="section-head scene-head">
      <text>进入场景</text>
      <text class="section-note">仅展示有内容</text>
    </view>
    <view v-if="!isLoading && entranceScenes.length" class="scene-grid">
      <button
        v-for="scene in entranceScenes"
        :key="scene.id"
        class="scene-card"
        @click="openPrimaryScene(scene.id)"
      >
        <image class="scene-cover" :src="scene.cover" mode="aspectFill" />
        <view class="scene-shade"><text class="scene-name">{{ scene.name }}</text></view>
      </button>
    </view>

    <view v-if="!isLoading && visibleHero" class="section-head today-head">
      <text>今日音乐空间</text>
    </view>
    <view v-if="!isLoading && visibleHero" class="hero-card" :aria-label="`打开${visibleHero.title}`" @click="openPlayer(visibleHero)">
      <image class="hero-image" :src="visibleHero.coverImageUrl" mode="aspectFill" @error="useFallbackCover(visibleHero)" />
      <view class="hero-shade">
        <view class="hero-meta"><text class="hero-visual-type">{{ sceneFormCaption(visibleHero) }} · {{ formatDuration(visibleHero.durationSeconds) }}</text></view>
        <view class="hero-bottom">
          <view class="hero-copy-wrap">
            <text class="hero-title">{{ visibleHero.title }}</text>
            <text class="hero-copy">{{ visibleHero.atmosphereText }}</text>
          </view>
          <button class="hero-play" aria-label="播放" @click.stop="openPlayer(visibleHero)">
            <image class="hero-play-icon" src="/static/tabbar/player-active.png" mode="aspectFit" />
          </button>
        </view>
      </view>
    </view>

    <button v-if="continueSpace && !isLoading" class="continue-card" @click="openPlayer(continueSpace)">
      <image class="continue-cover" :src="continueSpace.coverImageUrl" mode="aspectFill" @error="useFallbackCover(continueSpace)" />
      <view class="continue-copy">
        <text class="continue-label">继续播放</text>
        <text class="continue-title">{{ continueSpace.title }}</text>
      </view>
      <image class="continue-play-icon" src="/static/tabbar/player-active.png" mode="aspectFit" />
    </button>

    <view v-if="!isLoading && recommendSpaces.length" class="section-head recommend-head">
      <text>推荐空间</text>
      <button class="head-action" @click="shuffleSpaces">换一批</button>
    </view>
    <scroll-view v-if="!isLoading && recommendSpaces.length" class="recommend-scroll" scroll-x>
      <button v-for="space in recommendSpaces" :key="space.id" class="recommend-card" @click="openPlayer(space)">
        <image class="recommend-image" :src="space.coverImageUrl" mode="aspectFill" @error="useFallbackCover(space)" />
        <view class="recommend-shade">
          <text class="recommend-title">{{ space.title }}</text>
          <text class="recommend-meta">{{ sceneFormCaption(space) }}</text>
        </view>
      </button>
    </scroll-view>
  </view>
</template>

<style scoped>
.page {
  min-height: 100vh;
  box-sizing: border-box;
  padding: calc(28rpx + env(safe-area-inset-top)) 24rpx calc(180rpx + env(safe-area-inset-bottom));
  background: #0b0f14;
  color: #eef3f7;
}
button { box-sizing: border-box; line-height: normal; margin: 0; touch-action: manipulation; }
button::after { border: 0; }
text { display: block; }
.brand { margin: 8rpx 4rpx 22rpx; color: #f4f7fb; font-size: 48rpx; font-weight: 760; letter-spacing: 1rpx; }
.top-actions { display: flex; gap: 16rpx; align-items: center; }
.search-pill {
  flex: 1;
  display: flex;
  align-items: center;
  min-height: 80rpx;
  border: 0;
  border-radius: 999rpx;
  background: #161c24;
  padding: 20rpx 28rpx;
  color: #8b97a6;
  font-size: 28rpx;
  text-align: left;
}
.search-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.notice { margin-top: 14rpx; border-radius: 18rpx; background: #161c24; padding: 14rpx 20rpx; color: #b7c3ce; font-size: 28rpx; }
.loading-panel { margin-top: 22rpx; border-radius: 28rpx; background: #161c24; padding: 34rpx; }
.loading-title { color: #f4f7fb; font-size: 34rpx; font-weight: 760; }
.loading-copy { margin-top: 8rpx; color: #8b97a6; font-size: 28rpx; }
.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 34rpx 4rpx 16rpx;
  color: #f4f7fb;
  font-size: 34rpx;
  font-weight: 760;
}
.section-note { color: #8b97a6; font-size: 24rpx; font-weight: 500; }
.head-action { border: 0; background: transparent; color: #7ee7d6; font-size: 28rpx; font-weight: 700; }
.scene-head { margin-top: 32rpx; }
.scene-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16rpx; }
.scene-card {
  position: relative;
  overflow: hidden;
  width: 100%;
  height: 196rpx;
  border: 0;
  border-radius: 28rpx;
  background: #161c24;
  padding: 0;
}
.scene-cover { width: 100%; height: 100%; }
.scene-shade {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: flex-end;
  padding: 18rpx 20rpx;
  background: linear-gradient(180deg, rgba(8, 12, 16, .05), rgba(8, 12, 16, .78));
}
.scene-name { color: #fff; font-size: 30rpx; font-weight: 760; }
.today-head { margin-top: 36rpx; }
.hero-card {
  position: relative;
  overflow: hidden;
  width: 100%;
  height: auto;
  aspect-ratio: 16 / 9;
  border: 0;
  border-radius: 32rpx;
  background: #161c24;
}
.hero-image, .recommend-image { width: 100%; height: 100%; }
.hero-shade {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 24rpx;
  background: linear-gradient(180deg, rgba(8, 12, 16, .12), rgba(8, 12, 16, .08) 38%, rgba(8, 12, 16, .86));
}
.hero-meta, .hero-bottom, .continue-card { display: flex; align-items: center; justify-content: space-between; }
.hero-visual-type { color: rgba(255,255,255,.86); font-size: 24rpx; font-weight: 650; }
.hero-copy-wrap, .continue-copy { flex: 1; min-width: 0; }
.hero-title { color: #fff; font-size: 40rpx; font-weight: 780; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hero-copy { margin-top: 8rpx; color: rgba(255,255,255,.82); font-size: 26rpx; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hero-play {
  display: flex;
  width: 92rpx;
  height: 92rpx;
  flex: 0 0 92rpx;
  align-items: center;
  justify-content: center;
  margin-left: 18rpx;
  border: 0;
  border-radius: 50%;
  background: #fff;
  padding: 0;
}
.hero-play-icon { width: 30rpx; height: 30rpx; margin-left: 4rpx; }
.continue-card {
  width: 100%;
  margin-top: 18rpx;
  border: 0;
  border-radius: 24rpx;
  background: #161c24;
  padding: 14rpx;
  text-align: left;
}
.continue-cover { width: 96rpx; height: auto; aspect-ratio: 16 / 9; border-radius: 14rpx; margin-right: 16rpx; }
.continue-label { color: #7ee7d6; font-size: 24rpx; font-weight: 700; }
.continue-title { color: #f4f7fb; font-size: 30rpx; font-weight: 740; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.continue-play-icon { width: 36rpx; height: 36rpx; margin: 0 12rpx 0 16rpx; filter: brightness(0) invert(1); }
.recommend-head { margin-top: 36rpx; }
.recommend-scroll { width: 100%; height: 250rpx; white-space: nowrap; }
.recommend-card {
  position: relative;
  display: inline-block;
  overflow: hidden;
  width: 420rpx;
  height: auto;
  aspect-ratio: 16 / 9;
  margin-right: 16rpx;
  border: 0;
  border-radius: 24rpx;
  background: #161c24;
  padding: 0;
  text-align: left;
  vertical-align: top;
}
.recommend-shade {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  padding: 18rpx;
  background: linear-gradient(180deg, rgba(8,12,16,.02) 28%, rgba(8,12,16,.82));
}
.recommend-title { color: #fff; font-size: 28rpx; font-weight: 760; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.recommend-meta { margin-top: 6rpx; color: rgba(255,255,255,.8); font-size: 24rpx; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.scene-card:active, .hero-card:active, .continue-card:active, .recommend-card:active, .search-pill:active, .head-action:active, .hero-play:active { opacity: .88; }
</style>
