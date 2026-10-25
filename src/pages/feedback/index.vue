<script setup lang="ts">
import { computed, ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import RequestStatePanel from '../../components/RequestStatePanel.vue';
import {
  feedbackCategories, feedbackCategoryLabel, feedbackStatusLabel, getMyFeedback,
  hasUnreadFeedbackReply, submitFeedback, type FeedbackCategory, type UserFeedback
} from '../../services/feedback';
import { requestErrorMessage } from '../../services/network';
import { resolveRequestState, type RequestViewState } from '../../services/request-state';
import { getSessionToken } from '../../services/session';
import { FeedbackSessionState } from '../../services/feedback-session-state';

const category = ref<FeedbackCategory>('feature-suggestion');
const content = ref('');
const items = ref<UserFeedback[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = 20;
const unread = ref(0);
const loading = ref(false);
const submitting = ref(false);
const error = ref<unknown>();
const sessionState = new FeedbackSessionState(getSessionToken);
const loggedIn = ref(false);
const state = computed<RequestViewState>(() => resolveRequestState({ value: items.value, error: error.value, loading: loading.value }));
const canLoadMore = computed(() => items.value.length < total.value);

async function load(reset = true) {
  if (!loggedIn.value) return;
  loading.value = true; error.value = undefined;
  try {
    const targetPage = reset ? 1 : page.value + 1;
    const result = await getMyFeedback(targetPage, pageSize);
    items.value = reset ? result.items : [...items.value, ...result.items];
    page.value = targetPage; total.value = result.total; unread.value = result.unreadReplyCount;
  } catch (reason) { error.value = reason; }
  finally { loading.value = false; }
}
async function submit() {
  submitting.value = true; error.value = undefined;
  try {
    await submitFeedback(category.value, content.value);
    content.value = '';
    uni.showToast({ title: '反馈已收到，我们会认真查看。', icon: 'none' });
    await load(true);
  } catch (reason) { error.value = reason; }
  finally { submitting.value = false; }
}
function openDetail(id: string) { uni.navigateTo({ url: `/pages/feedback-detail/index?id=${encodeURIComponent(id)}` }); }
function openLogin() { uni.navigateTo({ url: '/pages/privacy/index' }); }
function selectCategory(index: number) { const selected = feedbackCategories[index]; if (selected) category.value = selected.value; }
function time(value: string) { return new Date(value).toLocaleString('zh-CN', { hour12: false }); }
function summary(value: string) { return value.length > 70 ? `${value.slice(0,70)}…` : value; }
onShow(() => {
  loggedIn.value = sessionState.refresh();
  if (loggedIn.value) void load(true);
});
</script>

<template>
  <view class="page">
    <view class="head"><text class="title">意见反馈</text><text class="copy">你的意见会进入后台统一处理</text></view>
    <RequestStatePanel v-if="!loggedIn" kind="error" message="登录后使用" @retry="openLogin" />
    <template v-else>
      <view class="composer">
        <text class="section-title">提交反馈</text>
        <picker :range="feedbackCategories" range-key="label" @change="selectCategory(Number($event.detail.value))"><view class="picker">{{ feedbackCategoryLabel(category) }}</view></picker>
        <textarea v-model="content" maxlength="1000" placeholder="请填写10至1000字的意见或建议" />
        <view class="submit-row"><text>{{ content.trim().length }}/1000</text><button :disabled="submitting" @click="submit">{{ submitting ? '提交中' : '提交反馈' }}</button></view>
      </view>
      <view class="list-head"><text class="section-title">我的反馈</text><text v-if="unread" class="badge">{{ unread }} 条未读回复</text></view>
      <RequestStatePanel v-if="state === 'loading' && !items.length" kind="loading" />
      <RequestStatePanel v-else-if="state === 'error'" kind="error" :message="requestErrorMessage(error)" @retry="load(true)" />
      <RequestStatePanel v-else-if="state === 'empty'" kind="empty" message="你还没有提交过反馈。" />
      <view v-else class="items">
        <button v-for="item in items" :key="item.id" class="item" @click="openDetail(item.id)">
          <view class="item-top"><text>{{ feedbackCategoryLabel(item.category) }}</text><text :class="['status', item.status]">{{ feedbackStatusLabel(item.status) }}</text></view>
          <text class="summary">{{ summary(item.content) }}</text>
          <view class="item-bottom"><text>{{ time(item.updatedAt) }}</text><text v-if="hasUnreadFeedbackReply(item)" class="unread">有新回复</text></view>
        </button>
        <button v-if="canLoadMore" class="more" :disabled="loading" @click="load(false)">{{ loading ? '加载中' : '加载更多' }}</button>
      </view>
    </template>
  </view>
</template>

<style scoped>
.page{min-height:100vh;box-sizing:border-box;padding:28rpx 24rpx 80rpx;background:var(--zy-bg);color:var(--zy-ink)}text{display:block}button::after{border:0}.head{margin:8rpx 0 24rpx}.title{font-size:42rpx;font-weight:900}.copy{margin-top:8rpx;color:var(--zy-muted);font-size:27rpx}.composer,.item{border:2rpx solid var(--zy-border);border-radius:20rpx;background:#fff}.composer{padding:24rpx}.section-title{font-size:32rpx;font-weight:900}.picker,textarea{margin-top:18rpx;border:2rpx solid var(--zy-border);border-radius:14rpx;background:#f7f9f8;padding:18rpx;font-size:28rpx}.picker{min-height:38rpx}textarea{width:100%;height:240rpx;box-sizing:border-box}.submit-row{display:flex;align-items:center;justify-content:space-between;margin-top:16rpx}.submit-row>text{color:var(--zy-muted);font-size:24rpx}.submit-row button,.more{margin:0;border:0;border-radius:999rpx;background:var(--zy-primary);color:#fff;font-size:28rpx;font-weight:850}.submit-row button{width:190rpx;min-height:70rpx}.list-head{display:flex;align-items:center;justify-content:space-between;margin:34rpx 0 16rpx}.badge,.unread{color:#b04d3c;font-size:24rpx;font-weight:850}.items{display:grid;gap:14rpx}.item{width:100%;margin:0;padding:22rpx;text-align:left}.item-top,.item-bottom{display:flex;align-items:center;justify-content:space-between}.item-top>text:first-child{font-size:29rpx;font-weight:850}.status{border-radius:999rpx;padding:7rpx 12rpx;background:#edf2f0;color:#5d6c67;font-size:23rpx}.status.pending{background:#fff1d5;color:#805817}.status.replied{background:#e5f2e9;color:#286446}.summary{margin-top:14rpx;color:var(--zy-ink);font-size:27rpx;line-height:1.55}.item-bottom{margin-top:16rpx;color:var(--zy-muted);font-size:23rpx}.more{width:240rpx;min-height:72rpx;margin:12rpx auto 0}
</style>
