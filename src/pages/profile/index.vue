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

const memberLabel = computed(() => {
  if (user.value?.memberLevel === 'pro') return 'Pro';
  if (user.value?.memberLevel === 'plus') return 'Plus';
  return '免费';
});

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
  <view :class="['page', getTheme() === 'dark' ? 'dark' : '']">
    <SingleAudioBar />
    <RequestStatePanel v-if="errorMessage" kind="error" :message="errorMessage" @retry="loadUser" />

    <view class="hero">
      <view class="avatar">知</view>
      <view class="identity">
        <text class="name">{{ isLoggedIn ? user?.nickname || '知音用户' : '未登录' }}</text>
        <text class="sub">{{ isLoggedIn ? `${growthLabel} · ${memberLabel}` : '免费听，登录后保存收藏' }}</text>
        <text v-if="user?.minorMode" class="minor-status">未成年人保护模式</text>
      </view>
      <button v-if="!isLoggedIn" class="member-pill login-pill" @click="openPrivacyCenter">去登录</button>
      <button v-else class="member-pill" @click="openMember">会员</button>
    </view>

    <view class="section">
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
          <text class="setting-copy">默认浅色，可切换深色</text>
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
.page { min-height: 100vh; box-sizing: border-box; padding: 22rpx 24rpx calc(180rpx + env(safe-area-inset-bottom)); background: var(--zy-bg); color: var(--zy-ink); }
.page.dark { --zy-bg:#07111a; --zy-surface:#0d1a25; --zy-surface-soft:#142631; --zy-ink:#eef5f7; --zy-muted:#93a5ad; --zy-border:#243843; background: var(--zy-bg); color: var(--zy-ink); }
button { box-sizing: border-box; line-height: normal; margin: 0; }
button::after { border: 0; }
text { display: block; }
.hero,.section { border: 2rpx solid var(--zy-border); background: rgba(255,255,255,.82); }
.dark .hero,.dark .section { background: rgba(13,26,37,.94); }
.hero { display: flex; align-items: center; gap: 18rpx; border-radius: 28rpx; padding: 24rpx; box-shadow: 0 12rpx 30rpx rgba(20,43,39,.06); }
.avatar { display: flex; width: 88rpx; height: 88rpx; flex: 0 0 88rpx; align-items: center; justify-content: center; border-radius: 50%; background: var(--zy-primary); color: #fff; font-size: 36rpx; font-weight: 900; }
.identity,.setting-main { flex: 1; min-width: 0; }
.name { overflow: hidden; color: var(--zy-ink); font-size: 34rpx; font-weight: 900; text-overflow: ellipsis; white-space: nowrap; }
.sub,.setting-copy,.sync-message { margin-top: 7rpx; color: var(--zy-muted); font-size: 28rpx; font-weight: 650; }
.minor-status { margin-top: 7rpx; color: #3f7466; font-size: 25rpx; font-weight: 800; }
.member-pill { width: 98rpx; min-height: 58rpx; border: 0; border-radius: 999rpx; background: var(--zy-surface-soft); color: var(--zy-primary); font-size: 28rpx; font-weight: 850; padding: 0; white-space: nowrap; }
.login-pill { width:120rpx; min-height:88rpx; background:var(--zy-primary); color:#fff; }
.section { margin-top: 18rpx; border-radius: 24rpx; padding: 22rpx; }
.setting { display: flex; width: 100%; align-items: center; gap: 16rpx; border: 0; border-bottom: 1rpx solid var(--zy-border); border-radius: 0; background: transparent; padding: 21rpx 0; text-align: left; }
.setting:first-child { padding-top: 4rpx; }
.setting:last-child { border-bottom: 0; padding-bottom: 4rpx; }
.setting-title { color: var(--zy-ink); font-size: 30rpx; font-weight: 850; }
.setting-copy { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.setting-value { width: 116rpx; overflow: hidden; color: var(--zy-primary); font-size: 28rpx; font-weight: 800; text-align: right; text-overflow: ellipsis; white-space: nowrap; }
.dark .setting-value { color: #9bc8bf; }
.feedback-unread { color:#b04d3c; }
.member-pill:active,.setting:active { opacity: .84; }
</style>
