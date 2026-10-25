<script setup lang="ts">
import { computed, ref } from 'vue';
import { onShow, onUnload } from '@dcloudio/uni-app';
import RequestStatePanel from '../../components/RequestStatePanel.vue';
import type { MusicSpace } from '../../types/music-space';
import { getMusicSpacePage } from '../../services/api';
import { DEFAULT_COVER_IMAGE } from '../../services/assets';
import { formatDuration } from '../../services/player';
import { contentExperience } from '../../services/content-experience';
import { applyTheme } from '../../services/theme';
import { requestErrorMessage } from '../../services/network';

const keyword = ref('');
const spaces = ref<MusicSpace[]>([]);
const hasSearched = ref(false);
const isLoading = ref(false);
const errorMessage = ref('');
const currentPage = ref(1);
const hasMore = ref(false);
const isPaging = ref(false);
const pageError = ref('');
let revision = 0;
let activeKeyword = '';
let retryPage = 1;
let pendingKey = '';

const quickKeywords = ['学习', '工作', '助眠', '放松', '深夜', '自然', '亲子'];
const soundKeywords = ['轻音乐', '自然声音', '白噪音', '冥想'];
const resultTitle = computed(() => (hasSearched.value ? '搜索结果' : '你想做什么'));
const resultMeta = computed(() => (hasSearched.value && spaces.value.length ? `本页 ${spaces.value.length} 个` : ''));

async function runSearch(value = keyword.value, page = 1, paging = false) {
  const text = value.trim();
  const key = JSON.stringify([text, page]);
  if (pendingKey === key) return;
  const ticket = ++revision;
  keyword.value = value;
  pendingKey = key;
  if (!text) {
    spaces.value = [];
    hasSearched.value = false;
    isLoading.value = false; isPaging.value = false;
    errorMessage.value = ''; pageError.value = ''; pendingKey = '';
    activeKeyword = ''; currentPage.value = 1; hasMore.value = false;
    return;
  }

  isLoading.value = !paging;
  isPaging.value = paging;
  hasSearched.value = true;
  errorMessage.value = '';
  pageError.value = '';
  retryPage = page;
  activeKeyword = text;
  if (!paging) { spaces.value = []; currentPage.value = 1; hasMore.value = false; }
  try {
    const result = await getMusicSpacePage({ keyword: text, page, pageSize: 20 });
    if (ticket !== revision) return;
    spaces.value = result.items;
    currentPage.value = result.page;
    hasMore.value = result.hasMore;
  } catch (error) {
    if (ticket !== revision) return;
    if (paging) pageError.value = requestErrorMessage(error);
    else errorMessage.value = requestErrorMessage(error);
  } finally {
    if (ticket === revision) { isLoading.value = false; isPaging.value = false; pendingKey = ''; }
  }
}

function goToPage(page: number) {
  if (isLoading.value || isPaging.value || !activeKeyword || page < 1 || page > 1000) return;
  return runSearch(activeKeyword, page, true);
}

function retryPageRequest() { return goToPage(retryPage); }

function openPlayer(space: MusicSpace) {
  uni.setStorageSync('currentMusicSpaceId', space.id);
  uni.navigateTo({
    url: '/pages/player/index'
  });
}

function useFallbackCover(space: MusicSpace) {
  if (space.coverImageUrl === DEFAULT_COVER_IMAGE) return;
  space.coverImageUrl = DEFAULT_COVER_IMAGE;
}

onShow(applyTheme);
onUnload(() => { revision++; pendingKey = ''; });
</script>

<template>
  <view class="page">
    <view class="search-panel">
      <input
        v-model="keyword"
        class="search-input"
        confirm-type="search"
        :maxlength="100"
        placeholder="搜索场景、情绪、关键词"
        @confirm="runSearch()"
      />
      <button class="search-action" @click="runSearch()">搜索</button>
    </view>

    <view class="section-head">
      <text class="section-title">{{ resultTitle }}</text>
      <text class="section-more">{{ resultMeta }}</text>
    </view>

    <view v-if="!hasSearched" class="quick-grid">
      <button
        v-for="item in quickKeywords"
        :key="item"
        :class="['quick-chip', keyword === item ? 'active' : '']"
        @click="runSearch(item)"
      >
        {{ item }}
      </button>
    </view>

    <view v-if="!hasSearched" class="sound-keywords">
      <text class="section-title">声音类型</text>
      <view class="sound-grid"><button v-for="item in soundKeywords" :key="item" class="quick-chip" @click="runSearch(item)">{{ item }}</button></view>
    </view>

    <RequestStatePanel v-if="errorMessage && !isLoading" kind="error" :message="errorMessage" @retry="runSearch()" />

    <view v-if="isLoading" class="empty">
      <text class="empty-title">正在匹配</text>
      <text class="empty-copy">为你寻找适合此刻的音乐空间。</text>
    </view>

    <view v-else-if="hasSearched && !errorMessage && !spaces.length" class="empty">
      <text class="empty-title">暂时没有匹配结果</text>
      <text class="empty-copy">可以换一个场景、情绪或关键词试试。</text>
    </view>

    <view v-else-if="spaces.length" class="space-list">
      <button v-for="space in spaces" :key="space.id" class="space-card" @click="openPlayer(space)">
        <image class="cover" :src="space.coverImageUrl" mode="aspectFill" @error="useFallbackCover(space)" />
        <view class="space-shade">
          <view>
            <text class="space-title">{{ space.title }}</text>
            <text class="space-subtitle">{{ contentExperience(space.contentForm).label }} · {{ formatDuration(space.durationSeconds) }}</text>
          </view>
          <view class="play-dot"><image class="play-icon" src="/static/tabbar/player-active.png" mode="aspectFit" /></view>
        </view>
      </button>
    </view>
    <view v-if="hasSearched && !isLoading && !errorMessage && (spaces.length || currentPage > 1)" class="pagination">
      <text v-if="pageError" class="page-error">{{ pageError }}</text>
      <button v-if="pageError" :disabled="isPaging" @click="retryPageRequest">重试翻页</button>
      <view class="pagination-buttons">
        <button :disabled="isPaging || currentPage <= 1" @click="goToPage(currentPage - 1)">上一页</button>
        <text>{{ isPaging ? '正在加载' : `第 ${currentPage} 页` }}</text>
        <button :disabled="isPaging || !hasMore || currentPage >= 1000" @click="goToPage(currentPage + 1)">下一页</button>
      </view>
      <text v-if="hasMore && currentPage >= 1000">已达本次浏览范围，请使用更具体的关键词。</text>
    </view>
  </view>
</template>

<style scoped>
.page { min-height: 100vh; box-sizing: border-box; padding: 22rpx 24rpx calc(52rpx + env(safe-area-inset-bottom)); background: var(--zy-bg); color: var(--zy-ink); }
button { box-sizing: border-box; line-height: normal; margin: 0; }
button::after { border: 0; }
text { display: block; }
.search-panel { display: grid; grid-template-columns: minmax(0,1fr) 108rpx; gap: 10rpx; margin-bottom: 30rpx; border: 2rpx solid var(--zy-border); border-radius: 999rpx; background: #fff; padding: 8rpx; box-shadow: 0 8rpx 24rpx rgba(20,43,39,.04); }
.search-input { height: 68rpx; padding: 0 20rpx; color: var(--zy-ink); font-size: 30rpx; }
.search-action { height: 68rpx; border: 0; border-radius: 999rpx; background: var(--zy-primary); padding: 0; color: #fff; font-size: 28rpx; font-weight: 850; white-space: nowrap; }
.section-head { display: flex; align-items: baseline; justify-content: space-between; margin: 0 2rpx 16rpx; }
.section-title { color: var(--zy-ink); font-size: 34rpx; font-weight: 900; }
.section-more { color: var(--zy-muted); font-size: 26rpx; font-weight: 650; }
.quick-grid { display: grid; grid-template-columns: repeat(3,1fr); gap: 14rpx; }
.sound-keywords { margin-top:28rpx; }
.sound-grid { display:grid; grid-template-columns:repeat(2,1fr); gap:14rpx; margin-top:16rpx; }
.quick-chip { min-height: 78rpx; border: 2rpx solid #e0e6e3; border-radius: 22rpx; background: rgba(255,255,255,.82); color: #294b46; font-size: 30rpx; font-weight: 800; }
.quick-chip.active { border-color: var(--zy-primary); background: var(--zy-primary); color: #fff; }
.empty { border: 2rpx solid #e0e6e3; border-radius: 28rpx; background: rgba(255,255,255,.84); padding: 36rpx 28rpx; }
.empty-title { color: var(--zy-ink); font-size: 34rpx; font-weight: 850; }
.empty-copy { margin-top: 9rpx; color: var(--zy-muted); font-size: 28rpx; line-height: 1.45; }
.space-list { display: grid; gap: 18rpx; }
.space-card { position: relative; overflow: hidden; width: 100%; height: auto; aspect-ratio: 16/9; border: 2rpx solid #d6dfdb; border-radius: 28rpx; background: #dbe5e1; padding: 0; text-align: left; box-shadow: 0 14rpx 36rpx rgba(20,43,39,.09); }
.cover { width: 100%; height: 100%; filter: saturate(.9) contrast(1.02) brightness(.94); }
.space-shade { position: absolute; inset: 0; display: flex; align-items: flex-end; justify-content: space-between; padding: 24rpx; background: linear-gradient(180deg,rgba(4,17,18,.02) 28%,rgba(4,17,18,.82)); }
.space-title,.space-subtitle { max-width: 510rpx; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.space-title { color: #fff; font-size: 34rpx; font-weight: 900; }
.space-subtitle { margin-top: 7rpx; color: rgba(255,255,255,.8); font-size: 28rpx; }
.play-dot { display: flex; width: 58rpx; height: 58rpx; flex: 0 0 58rpx; align-items: center; justify-content: center; border: 2rpx solid rgba(255,255,255,.56); border-radius: 50%; background: rgba(255,255,255,.14); }
.play-icon { width: 27rpx; height: 27rpx; filter: brightness(0) invert(1); }
.search-action:active,.quick-chip:active,.space-card:active { opacity: .88; }
.pagination { margin-top: 24rpx; color: var(--zy-muted); font-size: 26rpx; }
.pagination-buttons { display: flex; align-items: center; justify-content: space-between; gap: 18rpx; }
.pagination button { padding: 16rpx 24rpx; border-radius: 16rpx; font-size: 26rpx; }
.pagination button[disabled] { opacity: .45; }
.page-error { margin-bottom: 12rpx; color: #a34040; }
</style>
