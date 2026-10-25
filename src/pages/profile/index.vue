<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import RequestStatePanel from '../../components/RequestStatePanel.vue';
import SingleAudioBar from '../../components/SingleAudioBar.vue';
import { growthLevelLabel } from '../../domain/growth-level';
import { applyTheme, getTheme, getThemeLabel, toggleTheme as toggleAppTheme } from '../../services/theme';
import { getCurrentUser, refreshCurrentUser, type UserProfile } from '../../services/user';
import { requestErrorMessage } from '../../services/network';
import { getSessionToken } from '../../services/session';
import { getMyFeedback } from '../../services/feedback';
import { getSingleAudioCoordinator, type SingleAudioState } from '../../services/single-audio-coordinator';

const theme = ref(getThemeLabel());
const singleAudio = getSingleAudioCoordinator();
const timer = ref(timerLabel(singleAudio.snapshot()));
const user = ref<UserProfile>();
const syncMessage = ref('');
const errorMessage = ref('');
const isLoggedIn = ref(Boolean(getSessionToken()));
const unreadFeedbackCount = ref(0);
let unsubscribeSingleAudio: (() => void) | undefined;

const growthLabel = computed(() => growthLevelLabel(user.value || {}));

async function loadUser() {
  applyTheme();
  theme.value = getThemeLabel();
  errorMessage.value = '';
  isLoggedIn.value = Boolean(getSessionToken());
  if (!isLoggedIn.value) {
    user.value = undefined;
    unreadFeedbackCount.value = 0;
    return;
  }
  try {
    user.value = await getCurrentUser();
  } catch (error) {
    errorMessage.value = requestErrorMessage(error);
    return;
  }
  try {
    unreadFeedbackCount.value = (await getMyFeedback(1, 1)).unreadReplyCount;
  } catch {
    unreadFeedbackCount.value = 0;
  }
}

async function refreshIdentity() {
  try {
    user.value = await refreshCurrentUser();
    syncMessage.value = '身份已刷新';
  } catch (error) {
    syncMessage.value = requestErrorMessage(error);
  }
}

function toggleTheme() {
  theme.value = getThemeLabel(toggleAppTheme());
}

function toggleTimer() {
  if (singleAudio.snapshot().timerRemainingSeconds > 0) singleAudio.clearSleepTimer();
  else singleAudio.setSleepTimer(30 * 60);
}

function timerLabel(state: Readonly<SingleAudioState>): string {
  return state.timerRemainingSeconds > 0 ? `${Math.ceil(state.timerRemainingSeconds / 60)} 分钟` : '未开启';
}

function openMember() {
  uni.navigateTo({ url: '/pages/member/index' });
}

function openPrivacyCenter() {
  uni.navigateTo({ url: '/pages/privacy/index' });
}

function openFeedback() {
  uni.navigateTo({ url: '/pages/feedback/index' });
}

onShow(loadUser);
onMounted(() => {
  unsubscribeSingleAudio = singleAudio.subscribe((state) => { timer.value = timerLabel(state); });
});
onUnmounted(() => unsubscribeSingleAudio?.());
</script>

<template>
  <view :class="['page', getTheme() === 'light' ? 'light' : '']">
    <SingleAudioBar />
    <RequestStatePanel v-if="errorMessage" kind="error" :message="errorMessage" @retry="loadUser" />

    <view class="hero">
      <view class="avatar"></view>
      <text class="name">{{ isLoggedIn ? user?.nickname || '知音用户' : '未登录' }}</text>
      <text v-if="isLoggedIn && user?.mode === 'student'" class="audience-tag">学生</text>
      <text class="sub">{{ isLoggedIn ? '人群标签 · 非独立模式' : '登录后可保存收藏' }}</text>
      <text v-if="isLoggedIn" class="sub">{{ growthLabel }}</text>
      <text v-if="user?.minorMode" class="minor-status">未成年人保护模式</text>
      <button v-if="!isLoggedIn" class="login-pill" @click="openPrivacyCenter">去登录</button>
    </view>

    <view class="section">
      <view class="setting">
        <view class="setting-main">
          <text class="setting-title">偏好设置</text>
          <text class="setting-copy">{{ isLoggedIn && user?.mode === 'student' ? '已标记为学生人群，仍进入同一批场景' : '按场景收听，没有单独入口' }}</text>
        </view>
      </view>
      <button class="setting" @click="openMember">
        <view class="setting-main">
          <text class="setting-title">会员预告</text>
          <text class="setting-copy">购买尚未开放</text>
        </view>
        <text class="setting-value">查看</text>
      </button>
      <button class="setting" @click="openFeedback">
        <view class="setting-main">
          <text class="setting-title">意见反馈</text>
          <text class="setting-copy">建议与回复</text>
        </view>
        <text :class="['setting-value', unreadFeedbackCount ? 'feedback-unread' : '']">{{ unreadFeedbackCount ? `${unreadFeedbackCount} 条新回复` : '进入' }}</text>
      </button>
      <button class="setting" @click="openPrivacyCenter">
        <view class="setting-main">
          <text class="setting-title">隐私与账号</text>
          <text class="setting-copy">{{ isLoggedIn ? '查看协议、导出数据或注销账号' : '阅读协议并登录' }}</text>
        </view>
        <text class="setting-value">进入</text>
      </button>
      <button class="setting" @click="toggleTheme">
        <view class="setting-main">
          <text class="setting-title">主题</text>
          <text class="setting-copy">深色为主，可切换浅色</text>
        </view>
        <text class="setting-value">{{ theme }}</text>
      </button>
      <button class="setting" @click="toggleTimer">
        <view class="setting-main">
          <text class="setting-title">定时关闭</text>
          <text class="setting-copy">适合睡前、午休和专注时段</text>
        </view>
        <text class="setting-value">{{ timer }}</text>
      </button>
      <button v-if="isLoggedIn" class="setting" @click="refreshIdentity">
        <view class="setting-main">
          <text class="setting-title">账号信息</text>
          <text class="setting-copy">更新当前账号资料</text>
        </view>
        <text class="setting-value">刷新</text>
      </button>
      <text v-if="syncMessage" class="sync-message">{{ syncMessage }}</text>
    </view>
  </view>
</template>

<style scoped>
.page { min-height: 100vh; box-sizing: border-box; padding: calc(36rpx + env(safe-area-inset-top)) 24rpx calc(180rpx + env(safe-area-inset-bottom)); background: #0b0f14; color: #eef3f7; }
.page.light { --zy-bg:#f5f7f4; --zy-surface:#ffffff; --zy-ink:#12312d; --zy-muted:#73827f; --zy-border:#d8e1dd; background: var(--zy-bg); color: var(--zy-ink); }
button { box-sizing: border-box; line-height: normal; margin: 0; }
button::after { border: 0; }
text { display: block; }
.hero { display: flex; flex-direction: column; align-items: center; padding: 28rpx 12rpx 12rpx; text-align: center; }
.avatar { width: 132rpx; height: 132rpx; border-radius: 50%; background: #1c2833; }
.name { margin-top: 22rpx; color: #f4f7fb; font-size: 36rpx; font-weight: 760; }
.light .name, .light .setting-title { color: #12312d; }
.audience-tag { margin-top: 12rpx; border-radius: 999rpx; background: #1c3f3a; padding: 6rpx 18rpx; color: #7ee7d6; font-size: 24rpx; }
.sub, .setting-copy, .sync-message { margin-top: 8rpx; color: #8b97a6; font-size: 24rpx; }
.minor-status { margin-top: 8rpx; color: #7ee7d6; font-size: 24rpx; }
.login-pill { min-height: 72rpx; margin-top: 18rpx; border: 0; border-radius: 999rpx; background: #7ee7d6; padding: 0 28rpx; color: #0b0f14; font-size: 28rpx; font-weight: 740; }
.section { margin-top: 28rpx; display: flex; flex-direction: column; gap: 16rpx; }
.setting { display: flex; width: 100%; align-items: center; gap: 16rpx; border: 0; border-radius: 22rpx; background: #161c24; padding: 26rpx 24rpx; text-align: left; }
.light .setting { background: #fff; }
.setting-main { flex: 1; min-width: 0; }
.setting-title { color: #f4f7fb; font-size: 30rpx; font-weight: 700; }
.setting-copy { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.setting-value { color: #7ee7d6; font-size: 26rpx; font-weight: 700; }
.feedback-unread { color:#e7a394; }
.login-pill:active, .setting:active { opacity: .84; }
</style>
