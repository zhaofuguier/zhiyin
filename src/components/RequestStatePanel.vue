<script setup lang="ts">
defineProps<{ kind: 'loading' | 'retrying' | 'empty' | 'error' | 'not-found' | 'stale' | 'recovered'; message?: string }>();
defineEmits<{ retry: [] }>();
</script>

<template>
  <view :class="['request-state', `state-${kind}`]">
    <text class="request-state-title">
      {{ kind === 'loading' ? '正在加载' : kind === 'retrying' ? '正在重试' : kind === 'empty' ? '暂无内容' : kind === 'not-found' ? '内容不存在' : kind === 'stale' ? '内容可能不是最新' : kind === 'recovered' ? '重试成功' : '加载失败' }}
    </text>
    <text class="request-state-copy">{{ message || (kind === 'empty' ? '这里还没有内容。' : kind === 'not-found' ? '该内容可能已下架或不存在。' : kind === 'recovered' ? '内容已更新。' : '请稍后重试。') }}</text>
    <button v-if="kind === 'error' || kind === 'stale'" class="request-state-retry" @click="$emit('retry')">重试</button>
  </view>
</template>

<style scoped>
.request-state { border:2rpx solid var(--zy-border); border-radius:24rpx; background:rgba(255,255,255,.9); padding:28rpx; }
.request-state-title { display:block; color:var(--zy-ink); font-size:32rpx; font-weight:880; }
.request-state-copy { display:block; margin-top:8rpx; color:var(--zy-muted); font-size:27rpx; line-height:1.45; }
.state-error { border-color:#e1c5bc; }
.state-stale { border-color:#d9d5ad; background:#fffdf1; }
.request-state-retry { width:144rpx; min-height:70rpx; margin:20rpx 0 0; border:0; border-radius:999rpx; background:var(--zy-primary); color:#fff; font-size:28rpx; font-weight:850; }
.request-state-retry::after { border:0; }
</style>