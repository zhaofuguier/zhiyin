<script setup lang="ts">
import { computed, ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import RequestStatePanel from '../../components/RequestStatePanel.vue';
import { requestErrorMessage } from '../../services/network';
import {
  ACCOUNT_DELETION_CONFIRMATION,
  deleteCurrentAccount,
  exportPersonalData,
  getLegalDocument,
  getLegalDocuments,
  loginWithConsent,
  type LegalDocument,
  type LoginConsentSelection,
  type PersonalDataExport
} from '../../services/privacy';
import { getSessionToken } from '../../services/session';
import { refreshCurrentUser, type UserProfile } from '../../services/user';

const documents = ref<LegalDocument[]>([]);
const selectedDocument = ref<LegalDocument>();
const user = ref<UserProfile>();
const accepted = ref(false);
const ageBand = ref<LoginConsentSelection['ageBand']>();
const busy = ref<'login' | 'export' | 'delete' | ''>('');
const error = ref('');
const exported = ref<PersonalDataExport>();
const deletionPhrase = ref('');
const loggedIn = computed(() => Boolean(getSessionToken()));
const privacyVersion = computed(() => documents.value.find((item) => item.documentType === 'privacy')?.version);
const termsVersion = computed(() => documents.value.find((item) => item.documentType === 'terms')?.version);
const minorsVersion = computed(() => documents.value.find((item) => item.documentType === 'minors')?.version);
const minorProtection = computed(() => user.value?.minorMode === true || user.value?.ageBand === 'minor-14-17');

async function load() {
  error.value = '';
  try {
    documents.value = await getLegalDocuments();
    if (loggedIn.value) user.value = await refreshCurrentUser();
  } catch (reason) { error.value = requestErrorMessage(reason); }
}
async function openDocument(document: LegalDocument) {
  error.value = '';
  try { selectedDocument.value = await getLegalDocument(document.documentType); }
  catch (reason) { error.value = requestErrorMessage(reason); }
}
async function login() {
  busy.value = 'login'; error.value = '';
  try {
    user.value = await loginWithConsent({
      accepted: accepted.value,
      ageBand: ageBand.value,
      privacyVersion: privacyVersion.value,
      termsVersion: termsVersion.value,
      minorsVersion: minorsVersion.value
    });
    accepted.value = false;
    uni.showToast({ title: '登录成功', icon: 'success' });
  } catch (reason) { error.value = privacyErrorMessage(reason); }
  finally { busy.value = ''; }
}
async function runExport() {
  busy.value = 'export'; error.value = '';
  try { exported.value = await exportPersonalData(); }
  catch (reason) { error.value = privacyErrorMessage(reason); }
  finally { busy.value = ''; }
}
function confirmDeletion() {
  if (deletionPhrase.value.trim() !== ACCOUNT_DELETION_CONFIRMATION) {
    error.value = `请输入“${ACCOUNT_DELETION_CONFIRMATION}”`;
    return;
  }
  uni.showModal({
    title: '确认注销账号',
    content: '注销后资料和活动不可恢复，必要订单记录会按最小范围保留。',
    confirmText: '确认注销',
    success: (result) => { if (result.confirm) void runDeletion(); }
  });
}
async function runDeletion() {
  busy.value = 'delete'; error.value = '';
  try {
    await deleteCurrentAccount(deletionPhrase.value);
    user.value = undefined; exported.value = undefined; deletionPhrase.value = '';
    uni.showToast({ title: '账号已注销', icon: 'success' });
    uni.reLaunch({ url: '/pages/home/index' });
  } catch (reason) { error.value = privacyErrorMessage(reason); }
  finally { busy.value = ''; }
}
function privacyErrorMessage(reason: unknown): string {
  if (reason instanceof Error && reason.message === 'USER_CONSENT_REQUIRED') return '请先选择年龄段并勾选同意协议';
  if (reason instanceof Error && reason.message === 'ACCOUNT_DELETION_CONFIRMATION_INVALID') return `请输入“${ACCOUNT_DELETION_CONFIRMATION}”`;
  return requestErrorMessage(reason);
}
onShow(load);
</script>

<template>
  <view class="page">
    <RequestStatePanel v-if="error" kind="error" :message="error" @retry="load" />

    <view class="card">
      <text class="eyebrow">隐私与账号</text>
      <text class="title">你的信息由你管理</text>
      <text class="copy">法律文本为技术草案，正式开放前仍需经营主体和专业审核。</text>
      <button v-for="document in documents" :key="document.documentType" class="document" @click="openDocument(document)">
        <view><text class="document-title">{{ document.title }}</text><text class="document-meta">{{ document.version }} · 生效日 {{ document.effectiveDate }}</text></view>
        <text>查看</text>
      </button>
    </view>

    <view v-if="selectedDocument" class="card document-body">
      <text class="title small">{{ selectedDocument.title }}</text>
      <text class="copy body">{{ selectedDocument.body }}</text>
      <button class="quiet" @click="selectedDocument = undefined">收起</button>
    </view>

    <view v-if="!loggedIn" class="card">
      <text class="title small">登录知音</text>
      <text class="copy">登录前请选择年龄段，并明确同意当前版本的隐私政策、用户协议和儿童与未成年人保护说明。</text>
      <radio-group class="age-options" @change="ageBand = ($event.detail.value as LoginConsentSelection['ageBand'])">
        <label><radio value="adult" :checked="ageBand === 'adult'" />已成年</label>
        <label><radio value="minor-14-17" :checked="ageBand === 'minor-14-17'" />14至17周岁</label>
        <label><radio value="under-14" :checked="ageBand === 'under-14'" />未满14周岁</label>
      </radio-group>
      <checkbox-group @change="accepted = $event.detail.value.includes('accepted')">
        <label class="consent"><checkbox value="accepted" :checked="accepted" />我已阅读并同意当前隐私政策、用户协议和儿童与未成年人保护说明</label>
      </checkbox-group>
      <text v-if="ageBand === 'under-14'" class="minor-note">暂不提供未满14周岁用户账号服务，仍可匿名浏览公开内容。</text>
      <button class="primary" :disabled="busy === 'login'" @click="login">{{ busy === 'login' ? '登录中' : '同意并登录' }}</button>
    </view>

    <view v-else class="card">
      <text class="title small">账号与个人数据</text>
      <view v-if="minorProtection" class="minor-banner"><text>未成年人保护模式</text><text>仅显示年龄段，不推断或展示具体年龄。</text></view>
      <button class="primary" :disabled="busy === 'export'" @click="runExport">{{ busy === 'export' ? '生成中' : '导出我的个人数据' }}</button>
      <view v-if="exported" class="export-result">
        <text>导出生成时间：{{ exported.generatedAt }}</text>
        <text selectable>{{ JSON.stringify(exported, null, 2) }}</text>
      </view>
      <view class="danger-zone">
        <text class="document-title">注销账号</text>
        <text class="copy">输入固定短语后，还需通过当前平台重新认证。失败不会清除本地登录状态。</text>
        <input v-model="deletionPhrase" :placeholder="ACCOUNT_DELETION_CONFIRMATION" />
        <button class="danger" :disabled="busy === 'delete'" @click="confirmDeletion">{{ busy === 'delete' ? '验证中' : '注销知音账号' }}</button>
      </view>
    </view>
  </view>
</template>

<style scoped>
.page{min-height:100vh;box-sizing:border-box;padding:24rpx 24rpx 80rpx;background:var(--zy-bg);color:var(--zy-ink)}text{display:block}.card{margin-bottom:18rpx;border:2rpx solid var(--zy-border);border-radius:26rpx;background:#fff;padding:26rpx}.eyebrow{color:var(--zy-primary);font-size:26rpx;font-weight:850}.title{margin-top:8rpx;font-size:40rpx;font-weight:900}.title.small{font-size:32rpx}.copy{margin-top:10rpx;color:var(--zy-muted);font-size:27rpx;line-height:1.6}.document{display:flex;width:100%;align-items:center;justify-content:space-between;margin:14rpx 0 0;border:0;border-top:1rpx solid var(--zy-border);border-radius:0;background:transparent;padding:20rpx 0;text-align:left}.document-title{font-size:29rpx;font-weight:850}.document-meta{margin-top:6rpx;color:var(--zy-muted);font-size:24rpx}.document-body .body{white-space:pre-wrap}.quiet{margin:18rpx 0 0;border:0;background:transparent;color:var(--zy-primary)}.age-options{display:grid;gap:14rpx;margin-top:20rpx}.age-options label,.consent{display:flex;align-items:center;gap:12rpx;color:var(--zy-ink);font-size:28rpx}.consent{margin-top:24rpx;line-height:1.5}.minor-note,.minor-banner{margin-top:18rpx;border-radius:16rpx;background:#eef5f1;padding:18rpx;color:#42695e;font-size:26rpx;line-height:1.55}.minor-banner text+text{margin-top:6rpx;color:var(--zy-muted)}.primary,.danger{width:100%;min-height:82rpx;margin-top:22rpx;border:0;border-radius:999rpx;background:var(--zy-primary);color:#fff;font-size:29rpx;font-weight:850}.primary:disabled,.danger:disabled{opacity:.6}.export-result{max-height:460rpx;overflow:auto;margin-top:18rpx;border-radius:16rpx;background:#f5f8f7;padding:18rpx}.export-result text{color:#596965;font-size:23rpx;line-height:1.55;white-space:pre-wrap}.danger-zone{margin-top:28rpx;border-top:1rpx solid var(--zy-border);padding-top:24rpx}.danger-zone input{box-sizing:border-box;width:100%;height:82rpx;margin-top:18rpx;border:2rpx solid #d9c5bf;border-radius:14rpx;padding:0 18rpx}.danger{background:#9d4033}
</style>
