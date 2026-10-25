<script setup lang="ts">
import { onLoad } from '@dcloudio/uni-app';
import { redirectLegacyStudentRoute } from '../../services/legacy-student-route';

onLoad(redirectLegacyStudentRoute);
</script>

<template>
  <view class="redirect-page">
    <text class="redirect-title">正在前往统一场景</text>
    <button class="redirect-action" @click="redirectLegacyStudentRoute">查看场景</button>
  </view>
</template>

<style scoped>
.redirect-page { min-height:100vh; box-sizing:border-box; padding:72rpx 24rpx; background:var(--zy-bg); color:var(--zy-ink); text-align:center; }
.redirect-title { display:block; font-size:32rpx; font-weight:850; }
.redirect-action { width:100%; min-height:76rpx; margin-top:24rpx; border:0; border-radius:20rpx; background:var(--zy-primary); color:#fff; font-size:30rpx; font-weight:850; }
.redirect-action::after { border:0; }
</style>
