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
import { contentExperience } from '../../services/content-experience';
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

const selectedPrimary = computed(() => findPrimaryScene(selectedPrimarySceneId.value));
const selectedSecondary = computed(() => selectedPrimary.value?.children
  .find((item) => item.id === selectedSecondarySceneId.value));
const currentTitle = computed(() => selectedSecondary.value?.name || selectedPrimary.value?.name || '场景');
const currentDescription = computed(() => selectedSecondary.value
  ? selectedPrimary.value?.name || ''
  : '全部分类');
const sortIndex = computed(() => sortTabs.findIndex(item => item.value === selectedSort.value));
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

function getCardBadge(space: MusicSpace) {
  if (selectedSort.value === 'latest') return formatPublishDate(space.updatedAt);
  if (selectedSort.value === 'hot') return formatHotText(space);
  return '精选';
}

function formatPublishDate(value?: string) {
  if (!value) return '新近';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(5).replace('-', '.');
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${month}.${day}`;
}

function hotScore(space: MusicSpace) {
  return (space.playCount || 0) + (space.favoriteCount || 0) * 4 + Math.round((space.completionRate || 0) * 1000);
}

function formatHotText(space: MusicSpace) {
  const score = hotScore(space);
  if (score >= 10000) return `${(score / 10000).toFixed(1)}万`;
  if (score > 0) return `${score}`;
  return '热度';
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
    <scroll-view class="category-scroll" scroll-x :show-scrollbar="false">
      <button
        v-for="item in sceneTaxonomy.primaryScenes"
        :key="item.id"
        :class="['category-chip', item.id === selectedPrimarySceneId ? 'active' : '']"
        @click="selectPrimary(item.id)"
      >
        {{ item.name }}
      </button>
    </scroll-view>

    <scroll-view class="secondary-scroll" scroll-x :show-scrollbar="false">
      <button :class="['secondary-chip', !selectedSecondarySceneId ? 'active' : '']" @click="selectSecondary()">全部</button>
      <button
        v-for="item in selectedPrimary?.children || []"
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
        <text class="section-copy">{{ currentDescription }}</text>
      </view>
      <button class="sort-control" :aria-label="`排序：${sortTabs[sortIndex]?.label}`" @click="chooseSort">{{ sortTabs[sortIndex]?.label }}排序⌄</button>
    </view>

    <RequestStatePanel v-if="errorMessage && !isLoading" kind="error" :message="errorMessage" @retry="retryCurrentSelection" />

    <view v-else-if="isLoading" class="empty-panel">
      <text class="empty-title">正在匹配音乐空间</text>
      <text class="empty-copy">正在寻找适合此刻的声音。</text>
    </view>

    <view v-else-if="spaces.length === 0" class="empty-panel">
      <text class="empty-title">内容准备中</text>
      <text class="empty-copy">试试上方其他分类，或先听听推荐内容。</text>
      <button class="empty-action" @click="browseRecommendations">返回推荐</button>
    </view>

    <view v-else class="space-list">
      <button v-for="space in spaces" :key="space.id" class="space-card" @click="openPlayer(space)">
        <image class="cover" :src="space.coverImageUrl" mode="aspectFill" @error="useFallbackCover(space)" />
        <view class="space-shade">
          <view class="space-copy">
            <text class="space-title">{{ space.title }}</text>
            <text class="space-subtitle">{{ contentExperience(space.contentForm).label }} · {{ formatDuration(space.durationSeconds) }}</text>
          </view>
          <text class="space-meta">{{ getCardBadge(space) }}</text>
        </view>
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
.page { min-height: 100vh; box-sizing: border-box; padding: 22rpx 24rpx calc(180rpx + env(safe-area-inset-bottom)); background: #f5f7f4; color: #12312d; -webkit-font-smoothing: antialiased; }
.pagination { margin-top: 24rpx; }
.pagination-actions { display: flex; align-items: center; justify-content: space-between; gap: 16rpx; }
.pagination-actions button { padding: 20rpx 30rpx; border-radius: 20rpx; background: #17675d; color: #fff; font-size: 28rpx; }
.pagination-actions button[disabled] { opacity: .4; }
.pagination-note { margin-top: 16rpx; color: #6f807d; font-size: 26rpx; }
.pagination-refresh { margin: 16rpx auto 0; background: transparent; color: #17675d; font-size: 26rpx; }
button { box-sizing: border-box; line-height: normal; margin: 0; }
button::after { border: 0; }
text { display: block; }
.category-scroll, .secondary-scroll { width: 100%; height: 68rpx; white-space: nowrap; scrollbar-width: none; }
.secondary-scroll { margin-top: 14rpx; }
.category-scroll :deep(.uni-scroll-view)::-webkit-scrollbar,
.secondary-scroll :deep(.uni-scroll-view)::-webkit-scrollbar { display: none; width: 0; height: 0; }
.category-chip, .secondary-chip { display: inline-flex; height: 68rpx; align-items: center; justify-content: center; margin-right: 12rpx; border: 1rpx solid #d4dfdb; border-radius: 999rpx; background: rgba(255,255,255,.92); padding: 0 24rpx; color: #294b46; font-size: 28rpx; font-weight: 850; }
.category-chip { min-width: 140rpx; }
.secondary-chip { min-width: 100rpx; font-size: 26rpx; }
.category-chip.active, .secondary-chip.active { border-color: #17675d; background: #17675d; color: #fff; }
.section-head { display: flex; align-items: center; justify-content: space-between; gap: 16rpx; margin: 24rpx 4rpx 18rpx; }
.section-title { color: #12312d; font-size: 36rpx; font-weight: 900; }
.section-copy { margin-top: 8rpx; color: #6f807d; font-size: 28rpx; font-weight: 650; }
.sort-control { display:flex; align-items:center; min-height:88rpx; padding:0 16rpx; background:transparent; color:#35544d; font-size:26rpx; white-space:nowrap; }
.empty-action { min-height:88rpx; margin-top:24rpx; padding:20rpx 28rpx; border-radius:999rpx; background:#17675d; color:#fff; font-size:28rpx; }
.space-list { display: flex; flex-direction: column; gap: 18rpx; }
.space-card { position: relative; overflow: hidden; width: 100%; height: auto; aspect-ratio: 16 / 9; border: 2rpx solid #d6dfdb; border-radius: 28rpx; background: #d8e0de; padding: 0; text-align: left; box-shadow: 0 14rpx 36rpx rgba(20,43,39,.09); }
.cover { width: 100%; height: 100%; filter: saturate(.88) contrast(1.02) brightness(.94); }
.space-shade { position: absolute; inset: 0; display: flex; align-items: flex-end; justify-content: space-between; gap: 16rpx; padding: 24rpx; background: linear-gradient(180deg,transparent 20%,rgba(5,16,18,.82)); }
.space-copy { flex: 1; min-width: 0; }
.space-title { color: #fff; font-size: 34rpx; font-weight: 900; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.space-subtitle { margin-top: 8rpx; color: rgba(255,255,255,.78); font-size: 28rpx; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.space-meta { border-radius: 999rpx; background: rgba(255,255,255,.2); padding: 10rpx 16rpx; color: #fff; font-size: 26rpx; font-weight: 850; }
.empty-panel { border: 1rpx solid rgba(33,79,72,.08); border-radius: 30rpx; background: rgba(255,255,255,.9); padding: 30rpx; }
.empty-title { color: #12312d; font-size: 34rpx; font-weight: 850; }
.empty-copy { margin-top: 8rpx; color: #73827f; font-size: 28rpx; line-height: 1.45; }
</style>
