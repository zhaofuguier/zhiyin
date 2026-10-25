<script setup lang="ts">
import { ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import RequestStatePanel from '../../components/RequestStatePanel.vue';
import {
  getCurrentUser,
  getMembershipPlans,
  type MembershipPlan,
  type UserProfile
} from '../../services/user';
import { applyTheme } from '../../services/theme';
import { requestErrorMessage } from '../../services/network';

const user = ref<UserProfile>();
const plans = ref<MembershipPlan[]>([]);
const message = ref('暂未开放');
const errorMessage = ref('');

async function loadData() {
  errorMessage.value = '';
  try {
    user.value = await getCurrentUser();
    plans.value = await getMembershipPlans();
  } catch (error) {
    errorMessage.value = requestErrorMessage(error);
  }
}

function formatPrice(priceCents: number) {
  return '¥' + (priceCents / 100).toFixed(0);
}

onShow(() => {
  applyTheme();
  loadData();
});
</script>

<template>
  <view class="page">
    <RequestStatePanel v-if="errorMessage" kind="error" :message="errorMessage" @retry="loadData" />

    <view class="hero">
      <text class="eyebrow">知音会员</text>
      <text class="title">更完整的音乐空间体验</text>
      <text class="copy">当前等级：{{ user?.memberLevel || 'free' }}</text>
    </view>

    <view class="benefit-grid">
      <view class="benefit">
        <text class="benefit-title">会员空间</text>
        <text class="benefit-copy">解锁更完整的精选音乐空间</text>
      </view>
      <view class="benefit">
        <text class="benefit-title">高清视觉</text>
        <text class="benefit-copy">支持更高质量的16:9微动画</text>
      </view>
      <view class="benefit">
        <text class="benefit-title">离线预留</text>
        <text class="benefit-copy">为后续下载和离线能力做准备</text>
      </view>
    </view>

    <view class="section-head">
      <text class="section-title">会员方案</text>
      <text class="section-more">暂未开放</text>
    </view>

    <view class="plans">
      <button v-for="plan in plans" :key="plan.level" class="plan" disabled>
        <view class="plan-copy">
          <text class="plan-name">{{ plan.name }}</text>
          <text class="plan-benefits">{{ plan.benefits.join(' / ') }}</text>
        </view>
        <text class="price">{{ formatPrice(plan.priceCents) }}</text>
      </button>
    </view>

    <text class="message">{{ message }}</text>
  </view>
</template>

<style scoped>
.page { min-height: 100vh; box-sizing: border-box; padding: 22rpx 24rpx calc(52rpx + env(safe-area-inset-bottom)); background: var(--zy-bg); color: var(--zy-ink); }
button { box-sizing: border-box; line-height: normal; margin: 0; }
button::after { border: 0; }
text { display: block; }
.hero { overflow: hidden; border-radius: 28rpx; background: #12312d; padding: 36rpx 30rpx; color: #fff; box-shadow: 0 16rpx 42rpx rgba(20,43,39,.14); }
.eyebrow { color: rgba(255,255,255,.72); font-size: 28rpx; font-weight: 700; }
.title { margin-top: 10rpx; font-size: 42rpx; font-weight: 900; line-height: 1.18; }
.copy { margin-top: 14rpx; color: rgba(255,255,255,.78); font-size: 28rpx; }
.benefit-grid { display: grid; grid-template-columns: repeat(3,1fr); gap: 12rpx; margin-top: 18rpx; }
.benefit { min-height: 120rpx; border: 0; border-radius: 22rpx; background: #161c24; padding: 18rpx 15rpx; }
.benefit-title { color: #f4f7fb; font-size: 28rpx; font-weight: 740; }
.benefit-copy { margin-top: 7rpx; color: #8b97a6; font-size: 26rpx; line-height: 1.4; }
.section-head { display: flex; align-items: baseline; justify-content: space-between; margin: 30rpx 2rpx 15rpx; }
.section-title { color: #f4f7fb; font-size: 34rpx; font-weight: 760; }
.section-more { color: #e7a394; font-size: 26rpx; }
.plans { display: flex; flex-direction: column; gap: 14rpx; }
.plan { display: flex; width: 100%; align-items: center; gap: 18rpx; border: 0; border-radius: 24rpx; background: #161c24; padding: 22rpx; text-align: left; opacity: .86; }
.plan-copy { flex: 1; min-width: 0; }
.plan-name,.plan-benefits { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.plan-name { color: #f4f7fb; font-size: 32rpx; font-weight: 740; }
.plan-benefits { margin-top: 7rpx; color: #8b97a6; font-size: 26rpx; }
.price { width: 104rpx; color: #7ee7d6; font-size: 36rpx; font-weight: 760; text-align: right; }
.message { margin-top: 20rpx; border-radius: 18rpx; background: #161c24; padding: 16rpx 18rpx; color: #8b97a6; font-size: 26rpx; line-height: 1.5; }
</style>