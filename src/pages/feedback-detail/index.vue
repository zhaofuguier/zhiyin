<script setup lang="ts">
import { computed, ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import RequestStatePanel from '../../components/RequestStatePanel.vue';
import { feedbackCategoryLabel, feedbackStatusLabel, getMyFeedbackDetail, hasUnreadFeedbackReply, markFeedbackRepliesRead, type UserFeedback } from '../../services/feedback';
import { requestErrorMessage } from '../../services/network';
import { resolveRequestState } from '../../services/request-state';

const id = ref(''); const item = ref<UserFeedback>(); const loading = ref(false); const error = ref<unknown>();
const state = computed(() => resolveRequestState({ value: item.value, error: error.value, detail: true, loading: loading.value }));
async function load() {
  loading.value = true; error.value = undefined;
  try {
    const detail = await getMyFeedbackDetail(id.value);
    item.value = hasUnreadFeedbackReply(detail) ? await markFeedbackRepliesRead(id.value) : detail;
  } catch (reason) { error.value = reason; }
  finally { loading.value = false; }
}
function time(value: string) { return new Date(value).toLocaleString('zh-CN', { hour12: false }); }
onLoad((options) => { id.value = typeof options?.id === 'string' ? options.id : ''; load(); });
</script>

<template>
  <view class="page">
    <RequestStatePanel v-if="state === 'loading'" kind="loading" />
    <RequestStatePanel v-else-if="state === 'not-found'" kind="not-found" />
    <RequestStatePanel v-else-if="state === 'error'" kind="error" :message="requestErrorMessage(error)" @retry="load" />
    <template v-else-if="item">
      <view class="header"><view><text class="category">{{ feedbackCategoryLabel(item.category) }}</text><text class="id">{{ item.id }}</text></view><text :class="['status',item.status]">{{ feedbackStatusLabel(item.status) }}</text></view>
      <view class="card"><text class="label">我的反馈</text><text class="content">{{ item.content }}</text><text class="time">{{ time(item.createdAt) }}</text></view>
      <text class="timeline-title">后台回复</text>
      <view v-if="item.replies.length" class="timeline"><view v-for="reply in item.replies" :key="reply.id" class="reply"><text class="time">{{ time(reply.createdAt) }}</text><text class="content">{{ reply.content }}</text></view></view>
      <RequestStatePanel v-else kind="empty" message="后台尚未回复，我们会认真查看。" />
      <view v-if="item.status === 'closed'" class="closed">该反馈已关闭。如仍有问题，请新建反馈。</view>
    </template>
  </view>
</template>

<style scoped>
.page{min-height:100vh;box-sizing:border-box;padding:28rpx 24rpx 80rpx;background:var(--zy-bg);color:var(--zy-ink)}text{display:block}.header{display:flex;align-items:flex-start;justify-content:space-between;gap:20rpx}.category{font-size:38rpx;font-weight:900}.id{margin-top:7rpx;color:var(--zy-muted);font-size:22rpx}.status{border-radius:999rpx;background:#edf2f0;padding:9rpx 14rpx;color:#5d6c67;font-size:24rpx}.status.pending{background:#fff1d5;color:#805817}.status.replied{background:#e5f2e9;color:#286446}.card,.reply{border:2rpx solid var(--zy-border);border-radius:20rpx;background:#fff;padding:24rpx}.card{margin-top:24rpx}.label,.timeline-title{font-size:30rpx;font-weight:900}.content{margin-top:14rpx;font-size:28rpx;line-height:1.7;white-space:pre-wrap;word-break:break-word}.time{color:var(--zy-muted);font-size:23rpx}.card .time{margin-top:18rpx}.timeline-title{margin:32rpx 0 16rpx}.timeline{display:grid;gap:14rpx}.reply .content{margin-top:10rpx}.closed{margin-top:24rpx;border-radius:16rpx;background:#edf1f0;padding:20rpx;color:#66736f;font-size:26rpx}
</style>
