<script setup lang="ts">
import { computed, ref } from 'vue';
import { onLoad, onShow, onUnload } from '@dcloudio/uni-app';
import RequestStatePanel from '../../components/RequestStatePanel.vue';
import SingleAudioBar from '../../components/SingleAudioBar.vue';
import type { MusicSpace } from '../../types/music-space';
import { getMusicSpacePage, type MusicSpaceSort } from '../../services/api';
import { DEFAULT_COVER_IMAGE } from '../../services/assets';
import { sceneTaxonomy, findPrimaryScene, type PrimarySceneId, type SecondarySceneId } from '../../shared/scene-taxonomy.generated';
import { formatDuration } from '../../services/player';
import { contentExperience, hasVisibleContentForm } from '../../services/content-experience';
import { loadCatalogSceneStock } from '../../services/scene-stock';
import type { SceneStock } from '../../services/visible-catalog';
import { applyTheme } from '../../services/theme';
import { requestErrorMessage } from '../../services/network';
import {
  LatestScenePageQuery,
  loadSceneSelection,
  requireSceneSelection,
  saveSceneSelection,
  type SceneSelection
} from '../../services/scene-browser';

const sortTabs = [
  { label: '精选', value: 'featured' },
  { label: '最新', value: 'latest' },
  { label: '热门', value: 'hot' }
] as const;
const sortLabels = sortTabs.map(item => item.label);

const initialPrimary = sceneTaxonomy.primaryScenes[0].id;
const selectedPrimarySceneId = ref<PrimarySceneId>(initialPrimary);
const selectedSecondarySceneId = ref<SecondarySceneId>();
const selectedSort = ref<MusicSpaceSort>('featured');
const spaces = ref<MusicSpace[]>([]);
const isLoading = ref(true);
const errorMessage = ref('');
const currentPage = ref(1);
const hasMore = ref(false);
const isPaging = ref(false);
const pageError = ref('');
let retryPage = 1;
let loadedSelectionKey = '';
let initialSelection: SceneSelection | undefined;

const query = new LatestScenePageQuery(getMusicSpacePage);
const stock = ref<SceneStock>({ ready: false, primaryIds: new Set(), secondaryKeys: new Set(), unknownPrimaryIds: new Set() });

const selectedPrimary = computed(() => findPrimaryScene(selectedPrimarySceneId.value));
const selectedSecondary = computed(() => selectedPrimary.value?.children
  .find((item) => item.id === selectedSecondarySceneId.value));
const currentTitle = computed(() => selectedSecondary.value?.name || selectedPrimary.value?.name || '场景');
const currentDescription = computed(() => selectedSecondary.value
  ? selectedPrimary.value?.name || ''
  : '全部分类');
const sortIndex = computed(() => sortTabs.findIndex(item => item.value === selectedSort.value));
const visiblePrimaryScenes = computed(() => {
  if (!stock.value.ready) return [];
  return sceneTaxonomy.primaryScenes.filter((scene) =>
    stock.value.primaryIds.has(scene.id) || stock.value.unknownPrimaryIds.has(scene.id));
});
const visibleSecondaries = computed(() => {
  const children = selectedPrimary.value?.children || [];
  if (!stock.value.ready) return [];
  if (stock.value.unknownPrimaryIds.has(selectedPrimarySceneId.value)) return [...children];
  return children.filter((child) => stock.value.secondaryKeys.has(`${selectedPrimarySceneId.value}:${child.id}`));
});
const visibleSpaces = computed(() => spaces.value.filter((space) => hasVisibleContentForm(space)));
function chooseSort() {
  uni.showActionSheet({
    itemList: sortLabels,
    success(result) {
      const option = sortTabs[result.tapIndex];
      if (option) selectSort(option.value);
    }
  });
}
function browseRecommendations() { uni.switchTab({ url: '/pages/home/index' }); }

async function applySelection(selection: SceneSelection, page = 1, changingPage = false) {
  const normalized = requireSceneSelection(selection);
  selectedPrimarySceneId.value = normalized.primarySceneId;
  selectedSecondarySceneId.value = normalized.secondarySceneId;
  selectedSort.value = normalized.sort;
  saveSceneSelection(normalized);
  isLoading.value = !changingPage;
  isPaging.value = changingPage;
  errorMessage.value = '';
  pageError.value = '';
  retryPage = page;
  if (!changingPage) {
    spaces.value = [];
    currentPage.value = 1;
    hasMore.value = false;
    loadedSelectionKey = '';
  }
  const outcome = await query.load(normalized, page);
  if (outcome.state === 'stale') return;
  if (outcome.state === 'loaded') {
    spaces.value = outcome.result.items;
    currentPage.value = outcome.result.page;
    hasMore.value = outcome.result.hasMore;
    loadedSelectionKey = selectionKey(normalized);
    if (changingPage) uni.pageScrollTo({ scrollTop: 0, duration: 0 });
  } else {
    if (changingPage) pageError.value = requestErrorMessage(outcome.error);
    else errorMessage.value = requestErrorMessage(outcome.error);
  }
  isLoading.value = false;
  isPaging.value = false;
}

function currentSelection(): SceneSelection {
  return { primarySceneId: selectedPrimarySceneId.value, secondarySceneId: selectedSecondarySceneId.value, sort: selectedSort.value };
}

function selectionKey(selection: SceneSelection): string {
  return JSON.stringify([selection.primarySceneId, selection.secondarySceneId, selection.sort]);
}

function goToPage(page: number) {
  if (isLoading.value || isPaging.value || page < 1 || page > 1000) return;
  return applySelection(currentSelection(), page, true);
}

function retryPageRequest() { return goToPage(retryPage); }

function selectPrimary(primarySceneId: PrimarySceneId) {
  void applySelection({ primarySceneId, sort: selectedSort.value });
}

function selectSecondary(secondarySceneId?: SecondarySceneId) {
  void applySelection({
    primarySceneId: selectedPrimarySceneId.value,
    secondarySceneId,
    sort: selectedSort.value
  });
}

function selectSort(sort: MusicSpaceSort) {
  void applySelection({
    primarySceneId: selectedPrimarySceneId.value,
    secondarySceneId: selectedSecondarySceneId.value,
    sort
  });
}

function retryCurrentSelection() {
  return applySelection({
    primarySceneId: selectedPrimarySceneId.value,
    secondarySceneId: selectedSecondarySceneId.value,
    sort: selectedSort.value
  });
}

function openPlayer(space: MusicSpace) {
  uni.setStorageSync('currentMusicSpaceId', space.id);
  uni.navigateTo({ url: '/pages/player/index' });
}

function useFallbackCover(space: MusicSpace) {
  if (space.coverImageUrl === DEFAULT_COVER_IMAGE) return;
  space.coverImageUrl = DEFAULT_COVER_IMAGE;
}

onLoad((options) => {
  if (!options?.primarySceneId) return;
  try {
    initialSelection = requireSceneSelection({
      primarySceneId: options.primarySceneId,
      secondarySceneId: options.secondarySceneId || undefined,
      sort: options.sort || 'featured'
    });
  } catch {
    initialSelection = undefined;
  }
});

onShow(() => {
  applyTheme();
  void loadCatalogSceneStock().then((value) => { stock.value = value; }).catch(() => {
    stock.value = {
      ready: true,
      primaryIds: new Set(),
      secondaryKeys: new Set(),
      unknownPrimaryIds: new Set(sceneTaxonomy.primaryScenes.map((scene) => scene.id))
    };
  });
  const selection = initialSelection || loadSceneSelection() || { primarySceneId: initialPrimary, sort: 'featured' };
  initialSelection = undefined;
  if (loadedSelectionKey === selectionKey(selection)) return;
  void applySelection(selection);
});

onUnload(() => query.invalidate());
</script>

<template>
  <view class="page">
    <SingleAudioBar />
    <button class="back-link" @click="browseRecommendations">‹ 发现</button>
    <scroll-view v-if="visiblePrimaryScenes.length" class="category-scroll" scroll-x :show-scrollbar="false">
      <button
        v-for="item in visiblePrimaryScenes"
        :key="item.id"
        :class="['category-chip', item.id === selectedPrimarySceneId ? 'active' : '']"
        @click="selectPrimary(item.id)"
      >
        {{ item.name }}
      </button>
    </scroll-view>

    <scroll-view v-if="visibleSecondaries.length" class="secondary-scroll" scroll-x :show-scrollbar="false">
      <button :class="['secondary-chip', !selectedSecondarySceneId ? 'active' : '']" @click="selectSecondary()">全部</button>
      <button
        v-for="item in visibleSecondaries"
        :key="item.id"
        :class="['secondary-chip', item.id === selectedSecondarySceneId ? 'active' : '']"
        @click="selectSecondary(item.id)"
      >
        {{ item.name }}
      </button>
    </scroll-view>

    <view class="section-head">
      <view>
        <text class="section-title">{{ currentTitle }}</text>
        <text class="section-copy">{{ isLoading ? currentDescription : `${visibleSpaces.length} 个可播空间 · 空分类已隐藏` }}</text>
      </view>
      <button class="sort-control" :aria-label="`排序：${sortTabs[sortIndex]?.label}`" @click="chooseSort">{{ sortTabs[sortIndex]?.label }}排序⌄</button>
    </view>

    <RequestStatePanel v-if="errorMessage && !isLoading" kind="error" :message="errorMessage" @retry="retryCurrentSelection" />

    <view v-else-if="isLoading" class="empty-panel">
      <text class="empty-title">正在匹配音乐空间</text>
      <text class="empty-copy">正在寻找适合此刻的声音。</text>
    </view>

    <view v-else-if="visibleSpaces.length === 0" class="empty-panel">
      <text class="empty-title">内容准备中</text>
      <text class="empty-copy">试试上方其他分类，或先听听推荐内容。</text>
      <button class="empty-action" @click="browseRecommendations">返回推荐</button>
    </view>

    <view v-else class="space-list">
      <button v-for="space in visibleSpaces" :key="space.id" class="space-row" @click="openPlayer(space)">
        <image class="cover" :src="space.coverImageUrl" mode="aspectFill" @error="useFallbackCover(space)" />
        <view class="space-copy">
          <text class="space-title">{{ space.title }}</text>
          <text class="space-subtitle">{{ contentExperience(space.contentForm).label }} · {{ formatDuration(space.durationSeconds) }}</text>
        </view>
        <view class="row-play" aria-hidden="true"><image class="row-play-icon" src="/static/tabbar/player-active.png" mode="aspectFit" /></view>
      </button>
    </view>
    <view v-if="!isLoading && !errorMessage && (spaces.length || currentPage > 1)" class="pagination">
      <RequestStatePanel v-if="pageError" kind="error" :message="pageError" @retry="retryPageRequest" />
      <view class="pagination-actions">
        <button :disabled="isPaging || currentPage <= 1" @click="goToPage(currentPage - 1)">上一页</button>
        <text>{{ isPaging ? '加载中…' : `第 ${currentPage} 页` }}</text>
        <button :disabled="isPaging || !hasMore || currentPage >= 1000" @click="goToPage(currentPage + 1)">下一页</button>
      </view>
      <button class="pagination-refresh" :disabled="isPaging" @click="goToPage(currentPage)">刷新本页</button>
      <text v-if="currentPage >= 1000 && hasMore" class="pagination-note">已达本次浏览范围，请选择更具体的分类。</text>
    </view>
  </view>
</template>

<style scoped>
.page { min-height: 100vh; box-sizing: border-box; padding: calc(24rpx + env(safe-area-inset-top)) 24rpx calc(180rpx + env(safe-area-inset-bottom)); background: #0b0f14; color: #eef3f7; }
.back-link { border: 0; background: transparent; padding: 0 0 8rpx; color: #8b97a6; font-size: 26rpx; text-align: left; }
.pagination { margin-top: 24rpx; color: #c5d0da; }
.pagination-actions { display: flex; align-items: center; justify-content: space-between; gap: 16rpx; }
.pagination-actions button { padding: 20rpx 30rpx; border-radius: 20rpx; background: #161c24; color: #7ee7d6; font-size: 28rpx; }
.pagination-actions button[disabled] { opacity: .4; }
.pagination-note { margin-top: 16rpx; color: #8b97a6; font-size: 26rpx; }
.pagination-refresh { margin: 16rpx auto 0; background: transparent; color: #7ee7d6; font-size: 26rpx; }
button { box-sizing: border-box; line-height: normal; margin: 0; }
button::after { border: 0; }
text { display: block; }
.category-scroll, .secondary-scroll { width: 100%; height: 72rpx; white-space: nowrap; }
.secondary-scroll { margin-top: 14rpx; }
.category-chip, .secondary-chip { display: inline-flex; height: 68rpx; align-items: center; justify-content: center; margin-right: 12rpx; border: 0; border-radius: 999rpx; background: #161c24; padding: 0 24rpx; color: #d5dee6; font-size: 26rpx; font-weight: 700; }
.category-chip { min-width: 140rpx; }
.secondary-chip { min-width: 100rpx; }
.category-chip.active, .secondary-chip.active { background: #1c3f3a; color: #7ee7d6; }
.section-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16rpx; margin: 28rpx 4rpx 18rpx; }
.section-title { color: #f4f7fb; font-size: 44rpx; font-weight: 760; }
.section-copy { margin-top: 8rpx; color: #8b97a6; font-size: 24rpx; }
.sort-control { display:flex; align-items:center; min-height:88rpx; padding:0 8rpx; background:transparent; color:#7ee7d6; font-size:26rpx; white-space:nowrap; }
.empty-action { min-height:88rpx; margin-top:24rpx; padding:20rpx 28rpx; border-radius:999rpx; background:#7ee7d6; color:#0b0f14; font-size:28rpx; }
.space-list { display: flex; flex-direction: column; gap: 18rpx; }
.space-row { display: flex; width: 100%; align-items: center; gap: 16rpx; border: 0; border-radius: 24rpx; background: transparent; padding: 8rpx 0; text-align: left; }
.cover { width: 148rpx; height: 112rpx; border-radius: 18rpx; background: #161c24; }
.space-copy { flex: 1; min-width: 0; }
.space-title { color: #f4f7fb; font-size: 30rpx; font-weight: 740; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.space-subtitle { margin-top: 8rpx; color: #8b97a6; font-size: 24rpx; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.row-play { display: flex; width: 72rpx; height: 72rpx; flex: 0 0 72rpx; align-items: center; justify-content: center; border-radius: 50%; background: #f4f7fb; }
.row-play-icon { width: 26rpx; height: 26rpx; margin-left: 4rpx; }
.empty-panel { border-radius: 28rpx; background: #161c24; padding: 30rpx; }
.empty-title { color: #f4f7fb; font-size: 34rpx; font-weight: 760; }
.empty-copy { margin-top: 8rpx; color: #8b97a6; font-size: 28rpx; line-height: 1.45; }
</style>
