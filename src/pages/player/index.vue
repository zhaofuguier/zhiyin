<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { onHide, onLoad, onShareAppMessage, onShow, onUnload } from '@dcloudio/uni-app';
import RequestStatePanel from '../../components/RequestStatePanel.vue';
import { initialPlayerPresentation, updatePlayerPresentation, resolveUploadedVisual, type PlayerPanel } from '../../services/player-presentation';
import type { MusicSpace } from '../../types/music-space';
import { getMusicSpaceDetail, getNextMusicSpaces } from '../../services/api';
import { DEFAULT_COVER_IMAGE } from '../../services/assets';
import { formatDuration } from '../../services/player';
import { contentExperience, contentPlayLabel, hasVisibleContentForm } from '../../services/content-experience';
import { sceneFormCaption } from '../../services/visible-catalog';
import {
  ContentPlaybackEvidence,
  SILENT_PLAYBACK_SAVE_ERROR,
  mediaFailureMessage,
  resolveVideoPlaybackConfig,
  submitSilentCompletionEvidence
} from '../../services/media-playback';
import { MediaPlayerLifecycle } from '../../services/media-player-lifecycle';
import { applyTheme } from '../../services/theme';
import { toggleFavoriteSpace } from '../../services/user-activity';
import { requestErrorMessage } from '../../services/network';
import { loadOptionalPlayerPersonalState, recordPlayEventForSession } from '../../services/personal-content';
import { PlayerContentLoader } from '../../services/player-content-loader';
import {
  captureSessionScope,
  isSessionScopeCurrent,
  requireSessionForAction,
  type SessionScope
} from '../../services/session-scope';
import {
  CoListenRealtimeClient,
  coListenSharePath,
  createCoListenRoom,
  expectedCoListenPosition,
  getCoListenCapability,
  joinCoListenRoom,
  leaveCoListenRoom,
  requireCoListenParticipants,
  requireRoom,
  type CoListenRoom,
  type CoListenRealtimeEvent
} from '../../services/co-listen';
import {
  CO_LISTEN_HARD_LIMIT_WARNING,
  coListenClosedMessage,
  coListenHardLimitWarning,
  coListenNativeShare,
  isCoListenOwner,
  resolveCoListenPlaybackAction
} from '../../services/co-listen-player';
import { DOUYIN_CO_LISTEN_SHARE_TEMPLATE_ID } from '../../services/config';
import { currentRuntimePlatform } from '../../services/session';
import {
  getSingleAudioCoordinator,
  type SingleAudioState
} from '../../services/single-audio-coordinator';

const space = ref<MusicSpace>();
const experience = computed(() => contentExperience(space.value?.contentForm));
const playbackCaption = computed(() => {
  if (!space.value || !hasVisibleContentForm(space.value)) return '';
  return `${sceneFormCaption(space.value)} · ${formatDuration(space.value.durationSeconds)}`;
});
const playLabel = computed(() => contentPlayLabel(space.value?.contentForm, isPlaying.value, currentTime.value, space.value?.durationSeconds || 0));
const guidedCompleted = computed(() => experience.value.guided && !isPlaying.value && Boolean(space.value?.durationSeconds) && currentTime.value >= (space.value?.durationSeconds || 0));
const nextSpaces = ref<MusicSpace[]>([]);
const isPlaying = ref(false);
const isFavorite = ref(false);
const currentTime = ref(0);
const showTimer = ref(false);
const selectedTimer = ref('不开启');
const timerRemainingSeconds = ref(0);
const lockedByMembership = ref(false);
const audioErrorMessage = ref('');
const playbackSaveRetryAvailable = ref(false);
const playbackSaveRetryInFlight = ref(false);
const visualErrorMessage = ref('');
const loadErrorMessage = ref('');
const loadStateKind = ref<'error' | 'not-found'>('error');
const coListenAvailable = ref(false);
const coListenRoom = ref<CoListenRoom>();
const coListenSelfParticipantId = ref('');
const coListenInviteToken = ref('');
const pendingListenInvite = ref('');
const coListenBusy = ref(false);
const coListenError = ref('');
const coListenLifecycleNotice = ref('');
const authenticated = ref(false);
const presentation = ref(initialPlayerPresentation());
const uploadedCoverFailed = ref(false);
const uploadedVideoFailed = ref(false);
const uploadedVisual = computed(() => resolveUploadedVisual({
  visualType: space.value?.visualType,
  motionVideoUrl: space.value?.motionVideoUrl,
  coverImageUrl: space.value?.coverImageUrl,
  videoFailed: uploadedVideoFailed.value,
  coverFailed: uploadedCoverFailed.value
}));
function openPlayerPanel(panel: PlayerPanel) {
  presentation.value = updatePlayerPresentation(presentation.value, { type: 'panel', panel });
}
function revealPlayerControls() {
  presentation.value = updatePlayerPresentation(presentation.value, { type: 'reveal' });
}
function enterImmersion() {
  if (audioErrorMessage.value || visualErrorMessage.value || lockedByMembership.value) return;
  presentation.value = updatePlayerPresentation(presentation.value, { type: 'immerse' });
}
function setVisualFit(fit: 'contain' | 'cover') {
  presentation.value = updatePlayerPresentation(presentation.value, { type: 'fit', fit });
}
function resetPlayerPresentation() {
  presentation.value = updatePlayerPresentation(presentation.value, { type: 'reset' });
  showTimer.value = false;
}
function handleUploadedCoverError() { uploadedCoverFailed.value = true; }
function handleUploadedVideoError() {
  uploadedVideoFailed.value = true;
  handleVisualError();
}
watch([audioErrorMessage, visualErrorMessage, coListenError, lockedByMembership], (values) => {
  if (values.some(Boolean)) revealPlayerControls();
});
const coListenRealtime = new CoListenRealtimeClient();
let coListenAudioArmed = false;
let coListenWarningTimer: ReturnType<typeof setTimeout> | undefined;
let coListenWarningShownForRoom = '';

const coListenOwner = computed(() => isCoListenOwner(coListenRoom.value, coListenSelfParticipantId.value));
const coListenNativeShareConfigured = computed(() => {
  const platform = currentRuntimePlatform();
  return platform === 'wechat' || (platform === 'douyin' && Boolean(DOUYIN_CO_LISTEN_SHARE_TEMPLATE_ID));
});
const coListenShareLabel = computed(() => {
  // #ifdef MP-TOUTIAO
  return '分享给抖音好友';
  // #endif
  return '分享给微信好友或群';
});
const coListenNicknameNotice = computed(() => {
  // #ifdef MP-TOUTIAO
  return '你的知音昵称（可使用抖音昵称）会展示给本房间成员';
  // #endif
  return '你的知音昵称（可使用微信昵称）会展示给本房间成员';
});

const coListenParticipantNames = computed(() => {
  const members = coListenRoom.value?.participants || [];
  return members.slice(0, 3).map(member => member.displayName).join('、') + (members.length > 3 ? ' 等' : '');
});

const timerOptions = ['不开启', '15 分钟', '30 分钟', '45 分钟', '1 小时'];
const timerOptionSeconds: Record<string, number> = {
  不开启: 0,
  '15 分钟': 15 * 60,
  '30 分钟': 30 * 60,
  '45 分钟': 45 * 60,
  '1 小时': 60 * 60
};

let progressReporter: ReturnType<typeof setInterval> | undefined;
const mediaLifecycle = new MediaPlayerLifecycle<UniApp.InnerAudioContext>();
const playbackEvidence = new ContentPlaybackEvidence();
let playbackWriteQueue: Promise<unknown> = Promise.resolve();
let silentCompletionInFlight = false;
let playbackSessionScope: SessionScope | undefined;
const singleAudio = getSingleAudioCoordinator();
let unsubscribeSingleAudio: (() => void) | undefined;

const playerContentLoader = new PlayerContentLoader(
  {
    getDetail: getMusicSpaceDetail,
    getNext: getNextMusicSpaces,
    getPersonal: loadOptionalPlayerPersonalState
  },
  {
    applyDetail(nextSpace) {
      if (nextSpace.id !== space.value?.id) {
        resetPlayerPresentation();
        uploadedCoverFailed.value = false;
        uploadedVideoFailed.value = false;
        const continuingSingleAudio = nextSpace.contentForm !== 'silent-companion' &&
          singleAudio.snapshot().current?.id === nextSpace.id;
        currentTime.value = continuingSingleAudio ? singleAudio.snapshot().currentTime : 0;
        audioErrorMessage.value = '';
        visualErrorMessage.value = '';
        playbackEvidence.reset();
        resetAudioContext();
      }
      space.value = nextSpace;
      if (nextSpace.contentForm === 'silent-companion') singleAudio.stopForExclusivePlayback();
      else if (nextSpace.isMemberOnly) singleAudio.stopForContentTransition();
      else singleAudio.selectContent(nextSpace, currentTime.value);
      loadErrorMessage.value = '';
      lockedByMembership.value = Boolean(nextSpace.isMemberOnly);
      isFavorite.value = false;
    },
    applyNotFound() {
      loadStateKind.value = 'not-found';
      loadErrorMessage.value = '内容不存在';
      space.value = undefined;
      nextSpaces.value = [];
    },
    applyError(error) {
      loadStateKind.value = 'error';
      loadErrorMessage.value = requestErrorMessage(error);
    },
    applyNext(spaceId, items) {
      if (space.value?.id === spaceId) nextSpaces.value = items.filter((item) => hasVisibleContentForm(item));
    },
    applyPersonal(spaceId, personal) {
      if (space.value?.id !== spaceId || personal.state === 'stale') return;
      authenticated.value = personal.scope.authenticated;
      lockedByMembership.value = personal.lockedByMembership;
      isFavorite.value = personal.favorite;
      if (!personal.lockedByMembership && space.value?.contentForm !== 'silent-companion') {
        singleAudio.selectContent(space.value, currentTime.value);
      }
      if (currentTime.value === 0 && personal.history && space.value) {
        const resumeTime = personal.history.currentTime || 0;
        const shouldResume = resumeTime > 10 && resumeTime < Math.max(0, space.value.durationSeconds - 20);
        if (shouldResume) {
          currentTime.value = resumeTime;
          if (space.value.contentForm !== 'silent-companion') singleAudio.restoreInitialProgress(space.value.id, resumeTime);
        }
      }
    }
  }
);

const progressPercent = computed(() => {
  const duration = space.value?.durationSeconds || 1;
  return `${Math.min(100, Math.max(0, (currentTime.value / duration) * 100))}%`;
});

const timerLabel = computed(() => {
  if (!timerRemainingSeconds.value) return '定时';
  return `${Math.ceil(timerRemainingSeconds.value / 60)}分钟`;
});

const visualPlaybackConfig = computed(() => resolveVideoPlaybackConfig(space.value?.contentForm));

async function loadCurrentSpace() {
  const id = uni.getStorageSync('currentMusicSpaceId');
  if (typeof id !== 'string' || !id) {
    playerContentLoader.invalidate();
    loadStateKind.value = 'not-found';
    loadErrorMessage.value = '未选择音乐空间';
    return;
  }
  loadErrorMessage.value = '';
  await playerContentLoader.load(id);
}

async function loadCoListenCapability() {
  const scope = captureSessionScope();
  authenticated.value = scope.authenticated;
  if (!scope.authenticated) {
    coListenAvailable.value = false;
    return;
  }
  try { coListenAvailable.value = (await getCoListenCapability()).enabled; }
  catch { coListenAvailable.value = false; }
}

async function startCoListenRoom() {
  if (!space.value || coListenBusy.value) return;
  if (!requireSessionForAction('一起听')) return;
  coListenBusy.value = true;
  coListenError.value = '';
  try {
    const result = await createCoListenRoom(space.value.id);
    singleAudio.stopForExclusivePlayback();
    coListenRoom.value = result.room;
    coListenSelfParticipantId.value = result.selfParticipantId;
    coListenInviteToken.value = result.inviteToken;
    coListenAudioArmed = true;
    scheduleCoListenHardLimitWarning();
    await connectCoListenRealtime();
  } catch (error) { coListenError.value = requestErrorMessage(error); }
  finally { coListenBusy.value = false; }
}

async function acceptCoListenInvite() {
  if (!space.value || !pendingListenInvite.value || coListenBusy.value) return;
  if (!requireSessionForAction('一起听')) return;
  coListenBusy.value = true;
  coListenError.value = '';
  try {
    const result = await joinCoListenRoom(pendingListenInvite.value, space.value.id);
    singleAudio.stopForExclusivePlayback();
    coListenRoom.value = result.room;
    coListenSelfParticipantId.value = result.selfParticipantId;
    coListenInviteToken.value = pendingListenInvite.value;
    pendingListenInvite.value = '';
    coListenAudioArmed = true;
    scheduleCoListenHardLimitWarning();
    await connectCoListenRealtime();
  } catch (error) { coListenError.value = requestErrorMessage(error); }
  finally { coListenBusy.value = false; }
}

async function connectCoListenRealtime() {
  if (!coListenRoom.value) return;
  await coListenRealtime.connect(coListenRoom.value.roomId, handleCoListenRealtimeEvent);
}

function handleCoListenRealtimeEvent(event: CoListenRealtimeEvent) {
  if (event.event === 'room-closed') {
    const message = coListenClosedMessage(event.data);
    clearCoListenLocalState();
    coListenError.value = message;
    return;
  }
  if (event.event === 'error') {
    coListenError.value = '一起听连接暂时中断，请稍后重试';
    return;
  }
  if (event.event === 'participant-list') {
    try {
      if (coListenRoom.value) coListenRoom.value = { ...coListenRoom.value, participants: requireCoListenParticipants(event.data) };
    } catch { coListenError.value = '一起听成员状态异常'; }
    return;
  }
  if (event.event !== 'room-state') return;
  try {
    const room = requireRoom(event.data);
    if (!coListenRoom.value || room.roomId !== coListenRoom.value.roomId || room.platform !== currentRuntimePlatform()) return;
    coListenRoom.value = room;
    scheduleCoListenHardLimitWarning();
    applyCoListenPlayback(room);
  } catch { coListenError.value = '一起听状态异常，请稍后重试'; }
}

function applyCoListenPlayback(room: CoListenRoom) {
  const expected = Math.min(space.value?.durationSeconds || Number.MAX_SAFE_INTEGER, expectedCoListenPosition(room.playback));
  const action = resolveCoListenPlaybackAction({
    localPosition: currentTime.value,
    expectedPosition: expected,
    localPlaying: isPlaying.value,
    remoteStatus: room.playback.status,
    audioArmed: coListenAudioArmed
  });
  if (action.playback === 'none' && action.seekTo === undefined) return;
  const context = setupCoListenAudioContext();
  if (!context) return;
  if (action.seekTo !== undefined) { currentTime.value = action.seekTo; context.seek(action.seekTo); }
  if (action.playback === 'play') context.play();
  if (action.playback === 'pause') context.pause();
}

async function exitCoListenRoom() {
  const roomId = coListenRoom.value?.roomId;
  clearCoListenLocalState();
  if (roomId) {
    try { await leaveCoListenRoom(roomId); } catch (error) { uni.showToast({ title: requestErrorMessage(error), icon: 'none' }); }
  }
}

function clearCoListenLocalState() {
  coListenRealtime.disconnect();
  coListenRoom.value = undefined;
  coListenSelfParticipantId.value = '';
  coListenInviteToken.value = '';
  pendingListenInvite.value = '';
  coListenAudioArmed = false;
  clearCoListenWarningTimer();
  coListenLifecycleNotice.value = '';
  coListenWarningShownForRoom = '';
}

function scheduleCoListenHardLimitWarning() {
  clearCoListenWarningTimer();
  const room = coListenRoom.value;
  const decision = coListenHardLimitWarning({
    room,
    selfParticipantId: coListenSelfParticipantId.value,
    now: Date.now(),
    alreadyShown: Boolean(room && coListenWarningShownForRoom === room.roomId)
  });
  if (decision.show && room) {
    coListenWarningShownForRoom = room.roomId;
    coListenLifecycleNotice.value = CO_LISTEN_HARD_LIMIT_WARNING;
    return;
  }
  if (decision.scheduleAfterMs === undefined || !room) return;
  const roomId = room.roomId;
  coListenWarningTimer = setTimeout(() => {
    coListenWarningTimer = undefined;
    if (coListenRoom.value?.roomId !== roomId || !coListenOwner.value || coListenWarningShownForRoom === roomId) return;
    coListenWarningShownForRoom = roomId;
    coListenLifecycleNotice.value = CO_LISTEN_HARD_LIMIT_WARNING;
  }, decision.scheduleAfterMs);
}

function clearCoListenWarningTimer() {
  if (coListenWarningTimer) clearTimeout(coListenWarningTimer);
  coListenWarningTimer = undefined;
}

function setupCoListenAudioContext() {
  if (!space.value?.audioUrl) return undefined;
  if (mediaLifecycle.audio) return mediaLifecycle.audio;

  const context = mediaLifecycle.getOrCreateAudio(() => uni.createInnerAudioContext());
  context.src = space.value.audioUrl;
  context.loop = false;
  context.obeyMuteSwitch = false;
  context.onPlay(() => {
    if (!playbackSessionScope) playbackSessionScope = captureSessionScope();
    playbackEvidence.onAudioPlay();
    isPlaying.value = true;
    audioErrorMessage.value = '';
    startProgressReporter();
  });
  context.onPause(() => {
    playbackEvidence.pause();
    isPlaying.value = false;
    stopProgressReporter();
    submitPlaybackProgress();
  });
  context.onStop(() => {
    playbackEvidence.pause();
    isPlaying.value = false;
    stopProgressReporter();
    submitPlaybackProgress();
  });
  context.onTimeUpdate(() => {
    currentTime.value = Math.floor(context.currentTime || 0);
  });
  context.onEnded(() => {
    currentTime.value = space.value?.durationSeconds || currentTime.value;
    isPlaying.value = false;
    stopProgressReporter();
    submitPlaybackProgress(true);
    currentTime.value = 0;
    playbackEvidence.reset();
    playNext();
  });
  context.onError(handleAudioError);
  if (currentTime.value > 0) {
    setTimeout(() => {
      if (mediaLifecycle.audio) mediaLifecycle.audio.seek(currentTime.value);
    }, 120);
  }
  return context;
}

function togglePlay() {
  if (lockedByMembership.value) {
    uni.navigateTo({ url: '/pages/member/index' });
    return;
  }

  if (audioErrorMessage.value && !playbackSaveRetryAvailable.value) {
    audioErrorMessage.value = '';
    visualErrorMessage.value = '';
    if (coListenRoom.value) {
      playbackEvidence.reset();
      resetAudioContext();
    }
  }

  if (coListenRoom.value) {
    coListenAudioArmed = true;
    if (!coListenOwner.value) {
      applyCoListenPlayback(coListenRoom.value);
      return;
    }
    coListenRealtime.command(
      coListenRoom.value.playback.status === 'playing' ? 'pause' : 'play',
      coListenRoom.value.playback.revision,
      currentTime.value
    );
    return;
  }

  if (space.value?.contentForm === 'silent-companion') {
    if (!space.value.motionVideoUrl) {
      visualErrorMessage.value = '循环画面暂不可用，请稍后重试。';
      return;
    }
    if (playbackEvidence.silentPlaybackCompleted) {
      void completeSilentPlaybackIfReady();
      return;
    }
    const visual = uni.createVideoContext('spaceVisual');
    if (isPlaying.value) visual.pause();
    else {
      playbackSessionScope = captureSessionScope();
      const session = playbackEvidence.armSilentVideo(space.value.durationSeconds);
      currentTime.value = session.logicalTime;
      visual.seek(session.mediaPosition);
      visual.play();
    }
    return;
  }

  if (!space.value?.audioUrl) {
    audioErrorMessage.value = '音频暂未准备好，请稍后再试。';
    isPlaying.value = false;
    uni.showToast({ title: '音频暂未准备好', icon: 'none' });
    return;
  }

  singleAudio.selectContent(space.value, currentTime.value);
  singleAudio.toggle();
}

async function retryPlaybackSave() {
  await singleAudio.retryFailedSave();
}

function handleAudioError() {
  playbackEvidence.fail('audio');
  isPlaying.value = false;
  stopProgressReporter();
  resetAudioContext();
  audioErrorMessage.value = mediaFailureMessage('unplayable');
  uni.showToast({ title: audioErrorMessage.value, icon: 'none' });
}

async function toggleFavorite() {
  if (!space.value) return;
  if (!requireSessionForAction('收藏')) return;
  const targetId = space.value.id;
  const scope = captureSessionScope();
  try {
    const result = await toggleFavoriteSpace(space.value);
    if (space.value?.id === targetId && isSessionScopeCurrent(scope)) isFavorite.value = result;
  } catch (error) {
    uni.showToast({ title: requestErrorMessage(error), icon: 'none' });
  }
}

function restartCurrent() {
  if (coListenRoom.value) {
    if (coListenOwner.value) coListenRealtime.command('seek', coListenRoom.value.playback.revision, 0);
    return;
  }
  currentTime.value = 0;
  if (space.value?.contentForm === 'silent-companion') {
    playbackEvidence.seekSilentLogicalTime(0);
    uni.createVideoContext('spaceVisual').seek(0);
  }
  else singleAudio.seek(0);
}

function handleSeek(event: { detail: { value: number } }) {
  const duration = space.value?.durationSeconds || 0;
  const value = Math.min(duration, Math.max(0, Math.round(Number(event.detail.value) || 0)));
  if (coListenRoom.value) {
    if (coListenOwner.value) coListenRealtime.command('seek', coListenRoom.value.playback.revision, value);
    return;
  }
  currentTime.value = value;
  if (space.value?.contentForm === 'silent-companion') {
    const position = playbackEvidence.seekSilentLogicalTime(value);
    currentTime.value = position.logicalTime;
    uni.createVideoContext('spaceVisual').seek(position.mediaPosition);
  }
  else singleAudio.seek(value);
}

function startSleepTimer(seconds: number) {
  singleAudio.setSleepTimer(seconds);
}

function selectTimer(option: string) {
  selectedTimer.value = option;
  showTimer.value = false;
  startSleepTimer(timerOptionSeconds[option] || 0);
}


function goBack() {
  uni.navigateBack({
    fail: () => uni.switchTab({ url: '/pages/home/index' })
  });
}

function clearSleepTimer() {
  singleAudio.clearSleepTimer();
}

function startProgressReporter() {
  stopProgressReporter();
  progressReporter = setInterval(() => {
    if (!isPlaying.value) return;
    submitPlaybackProgress(false, true);
  }, 15000);
}

function stopProgressReporter() {
  if (!progressReporter) return;
  clearInterval(progressReporter);
  progressReporter = undefined;
}

function openFullscreen() {
  if (!space.value) return;

  if (space.value.visualType === 'motion' && space.value.motionVideoUrl) {
    uni.createVideoContext('spaceVisual').requestFullScreen({ direction: 90 });
    return;
  }

  if (space.value.coverImageUrl) {
    uni.previewImage({ urls: [space.value.coverImageUrl], current: space.value.coverImageUrl });
  }
}

function playNext(spaceToPlay?: MusicSpace) {
  if (coListenRoom.value) {
    uni.showToast({ title: '请先退出一起听房间', icon: 'none' });
    return;
  }
  const target = spaceToPlay || nextSpaces.value[0];
  if (!target) return;

  submitPlaybackProgress();
  uni.setStorageSync('currentMusicSpaceId', target.id);
  isPlaying.value = false;
  stopVisualPlayback();
  if (space.value?.contentForm === 'silent-companion' || coListenRoom.value) resetAudioContext();
  loadCurrentSpace();
}

function useFallbackCover(target?: MusicSpace) {
  if (!target || target.coverImageUrl === DEFAULT_COVER_IMAGE) return;
  target.coverImageUrl = DEFAULT_COVER_IMAGE;
}

function handleVisualError() {
  if (!space.value) return;
  if (space.value.contentForm === 'silent-companion') {
    playbackEvidence.fail('silent-content-video');
    isPlaying.value = false;
    stopProgressReporter();
  }
  space.value.visualType = 'image';
  visualErrorMessage.value = mediaFailureMessage('unplayable');
}

function handleVisualPlay() {
  if (!space.value || !playbackEvidence.onVideoPlay(space.value.contentForm)) return;
  isPlaying.value = true;
  visualErrorMessage.value = '';
  startProgressReporter();
}

function handleVisualPause() {
  if (space.value?.contentForm !== 'silent-companion' || !playbackEvidence.started) return;
  playbackEvidence.pause();
  isPlaying.value = false;
  stopProgressReporter();
  if (silentCompletionInFlight) return;
  submitPlaybackProgress();
}

function handleVisualTimeUpdate(event: unknown) {
  if (space.value?.contentForm !== 'silent-companion' || !playbackEvidence.started) return;
  const detail = (event as { detail?: { currentTime?: number; duration?: number } })?.detail;
  const logicalTime = playbackEvidence.onSilentVideoTimeUpdate(
    Number(detail?.currentTime) || 0,
    Number(detail?.duration) || 0
  );
  if (logicalTime === undefined) return;
  currentTime.value = Math.floor(logicalTime);
  void completeSilentPlaybackIfReady();
}

function handleVisualEnded(event: unknown) {
  if (space.value?.contentForm !== 'silent-companion' || !playbackEvidence.started) return;
  const duration = Number((event as { detail?: { duration?: number } })?.detail?.duration) || 0;
  const logicalTime = playbackEvidence.onSilentVideoLoopBoundary(duration);
  if (logicalTime === undefined) return;
  currentTime.value = Math.floor(logicalTime);
  void completeSilentPlaybackIfReady();
}

async function completeSilentPlaybackIfReady() {
  if (!space.value || !playbackEvidence.silentPlaybackCompleted || silentCompletionInFlight) return;
  const completedSpace = space.value;
  silentCompletionInFlight = true;
  isPlaying.value = false;
  stopProgressReporter();
  const visual = uni.createVideoContext('spaceVisual');
  visual.pause();
  if (!playbackSessionScope?.authenticated || !isSessionScopeCurrent(playbackSessionScope)) {
    playbackEvidence.reset();
    visual.seek(0);
    currentTime.value = 0;
    silentCompletionInFlight = false;
    playNext();
    return;
  }
  const completionScope = playbackSessionScope;
  const result = await enqueuePlaybackWrite(() => submitSilentCompletionEvidence(
    playbackEvidence,
    async (submission) => {
      const outcome = await recordPlayEventForSession(
        completionScope,
        completedSpace,
        submission.currentTime,
        submission.completed
      );
      if (outcome !== 'recorded') throw new Error('PLAYBACK_SESSION_STALE');
    }
  ));
  if (!result.success) {
    silentCompletionInFlight = false;
    visualErrorMessage.value = result.errorMessage || SILENT_PLAYBACK_SAVE_ERROR;
    uni.showToast({ title: visualErrorMessage.value, icon: 'none' });
    return;
  }
  visualErrorMessage.value = '';
  playbackEvidence.reset();
  visual.seek(0);
  currentTime.value = 0;
  silentCompletionInFlight = false;
  playNext();
}

function stopVisualPlayback() {
  if (!space.value?.motionVideoUrl) return;
  const visual = uni.createVideoContext('spaceVisual');
  visual.pause();
  visual.seek(0);
  playbackEvidence.syncSilentVideoPosition(0);
}

function resetAudioContext() {
  stopProgressReporter();
  mediaLifecycle.destroyAudio();
  playbackEvidence.reset();
  playbackSessionScope = undefined;
}

function pausePlayback() {
  if (space.value?.contentForm === 'silent-companion') uni.createVideoContext('spaceVisual').pause();
  else if (coListenRoom.value && mediaLifecycle.audio) mediaLifecycle.audio.pause();
  else singleAudio.pause();
  stopProgressReporter();
  playbackEvidence.pause();
  submitPlaybackProgress();
  isPlaying.value = false;
}

function showWriteError(error: unknown) {
  uni.showToast({ title: requestErrorMessage(error), icon: 'none' });
}

function suspendPageMedia() {
  coListenRealtime.disconnect();
  clearCoListenWarningTimer();
  coListenAudioArmed = false;
  if (coListenRoom.value) {
    mediaLifecycle.suspend({
      recordProgress: recordPlaybackProgress,
      clearProgressTimer: stopProgressReporter,
      clearSleepTimer: () => undefined,
      videoContext: () => space.value?.motionVideoUrl ? uni.createVideoContext('spaceVisual') : undefined
    });
  } else if (space.value?.contentForm === 'silent-companion') {
    recordPlaybackProgress();
    stopProgressReporter();
    uni.createVideoContext('spaceVisual').pause();
    isPlaying.value = false;
    playbackEvidence.pause();
  } else if (space.value?.motionVideoUrl) {
    uni.createVideoContext('spaceVisual').pause();
  }
}

function recordPlaybackProgress() {
  submitPlaybackProgress();
}

function enqueuePlaybackWrite<T>(write: () => Promise<T>): Promise<T> {
  const result = playbackWriteQueue.then(write, write);
  playbackWriteQueue = result.then(() => undefined, () => undefined);
  return result;
}

function submitPlaybackProgress(completed = false, requireActive = false) {
  const target = space.value;
  const scope = playbackSessionScope;
  if (!scope?.authenticated || !isSessionScopeCurrent(scope)) return Promise.resolve(false);
  const prepared = playbackEvidence.prepareProgress(currentTime.value, completed, requireActive);
  if (!target || !prepared) return Promise.resolve(false);
  return enqueuePlaybackWrite(async () => {
    try {
      const outcome = await recordPlayEventForSession(
        scope,
        target,
        prepared.submission.currentTime,
        prepared.submission.completed
      );
      if (outcome !== 'recorded') {
        prepared.rollback();
        return false;
      }
      prepared.commit();
      return true;
    } catch (error) {
      prepared.rollback();
      showWriteError(error);
      return false;
    }
  });
}

function handleAccountDeleted() {
  playerContentLoader.invalidate();
  suspendPageMedia();
  currentTime.value = 0;
  space.value = undefined;
  nextSpaces.value = [];
  isFavorite.value = false;
  authenticated.value = false;
  playbackSessionScope = undefined;
}

function handleSessionInvalidated() {
  playerContentLoader.invalidate();
  playbackSessionScope = undefined;
  authenticated.value = false;
}

function applySingleAudioState(state: Readonly<SingleAudioState>) {
  timerRemainingSeconds.value = state.timerRemainingSeconds;
  selectedTimer.value = state.timerRemainingSeconds > 0 ? selectedTimer.value : '不开启';
  if (!space.value || space.value.contentForm === 'silent-companion' || coListenRoom.value || state.current?.id !== space.value.id) return;
  isPlaying.value = state.isPlaying;
  currentTime.value = Math.floor(state.currentTime);
  audioErrorMessage.value = state.errorMessage;
  playbackSaveRetryAvailable.value = state.saveRetryAvailable;
  playbackSaveRetryInFlight.value = state.saveRetryInFlight;
}

onMounted(() => {
  unsubscribeSingleAudio = singleAudio.subscribe(applySingleAudioState);
  uni.$on('zhiyin:account-deleted', handleAccountDeleted);
  uni.$on('zhiyin:session-invalidated', handleSessionInvalidated);
});
onUnmounted(() => {
  unsubscribeSingleAudio?.();
  uni.$off('zhiyin:account-deleted', handleAccountDeleted);
  uni.$off('zhiyin:session-invalidated', handleSessionInvalidated);
});

onShow(() => {
  mediaLifecycle.enterForeground();
  applyTheme();
  loadCurrentSpace();
  loadCoListenCapability();
  if (coListenRoom.value) { scheduleCoListenHardLimitWarning(); void connectCoListenRealtime(); }
});
onHide(() => { resetPlayerPresentation(); suspendPageMedia(); });
onUnload(() => { playerContentLoader.invalidate(); suspendPageMedia(); void exitCoListenRoom(); });
onLoad((options) => {
  const musicSpaceId = typeof options?.musicSpaceId === 'string' ? options.musicSpaceId.trim() : '';
  const listenInvite = typeof options?.listenInvite === 'string' ? options.listenInvite.trim() : '';
  if (musicSpaceId) uni.setStorageSync('currentMusicSpaceId', musicSpaceId);
  if (listenInvite && /^[A-Za-z0-9_-]{43,128}$/u.test(listenInvite)) pendingListenInvite.value = listenInvite;
});
onShareAppMessage(() => {
  if (!space.value || !coListenRoom.value || !coListenInviteToken.value ||
      coListenRoom.value.platform !== currentRuntimePlatform() ||
      (coListenRoom.value.platform === 'douyin' && !DOUYIN_CO_LISTEN_SHARE_TEMPLATE_ID)) {
    return { title: '知音音乐空间', path: '/pages/home/index' };
  }
  return coListenNativeShare(coListenRoom.value.platform, {
    title: `来和我一起听《${space.value.title}》`,
    path: coListenSharePath(space.value.id, coListenInviteToken.value),
    douyinTemplateId: DOUYIN_CO_LISTEN_SHARE_TEMPLATE_ID
  });
});
</script>

<template>
  <view v-if="loadErrorMessage && !space" class="page page-state">
    <RequestStatePanel :kind="loadStateKind" :message="loadErrorMessage" @retry="loadCurrentSpace" />
  </view>
  <view v-else-if="space" :class="['page', 'immersive-player', { 'controls-hidden': presentation.immersive }]">
    <image v-if="uploadedVisual.cover" class="page-bg" :src="uploadedVisual.cover" mode="aspectFill" @error="handleUploadedCoverError" />
    <view class="page-tint"></view>

    <view class="visual-frame" @click="revealPlayerControls">
      <video v-if="uploadedVisual.kind === 'video'" id="spaceVisual" class="visual" :src="uploadedVisual.video" :poster="uploadedVisual.cover" :object-fit="presentation.fit" :autoplay="visualPlaybackConfig.autoplay" :loop="visualPlaybackConfig.loop" :muted="visualPlaybackConfig.muted" :playsinline="visualPlaybackConfig.playsinline" :controls="false" :show-center-play-btn="false" :show-mute-btn="false" :enable-progress-gesture="false" @play="handleVisualPlay" @pause="handleVisualPause" @timeupdate="handleVisualTimeUpdate" @ended="handleVisualEnded" @error="handleUploadedVideoError" />
      <image v-else-if="uploadedVisual.kind === 'image'" class="visual" :src="uploadedVisual.cover" :mode="presentation.fit === 'contain' ? 'aspectFit' : 'aspectFill'" @error="handleUploadedCoverError" />
      <view v-else class="visual-empty">
        <text class="empty-title">{{ uploadedCoverFailed || uploadedVideoFailed ? '画面暂时无法加载' : '画面素材待上传' }}</text>
        <text class="empty-copy">{{ space.audioUrl ? '音频可独立播放' : '内容准备中' }}</text>
      </view>
    </view>

    <view class="player-topbar">
      <button class="quiet-button" aria-label="返回" @click="goBack">返回</button>
      <button v-if="presentation.immersive" class="quiet-button" @click="revealPlayerControls">显示控件</button>
      <button v-else class="quiet-button" @click="openPlayerPanel('display')">画面设置</button>
    </view>
    <view class="player-foreground">
      <view v-if="coListenRoom" class="together-peek">
        <button class="quiet-button" @click="openPlayerPanel('together')">{{ coListenRoom.participants.length }}人一起听</button>
        <text class="together-names">{{ coListenParticipantNames }}</text>
      </view>
      <text v-if="coListenError" class="notice">{{ coListenError }}</text>
      <text v-if="coListenLifecycleNotice" class="notice">{{ coListenLifecycleNotice }}</text>
      <view v-if="!presentation.immersive" class="player-heading">
        <text class="visual-title">{{ space.title }}</text>
        <text class="visual-copy">{{ space.atmosphereText }}</text>
        <text v-if="playbackCaption" class="experience-meta">{{ playbackCaption }}</text>
      </view>
      <view v-if="presentation.immersive" class="minimal-controls">
        <button class="play-button" :aria-label="playLabel" @click="togglePlay"><text>{{ playLabel }}</text></button>
        <text v-if="timerRemainingSeconds" class="minimal-timer">{{ timerLabel }}后关闭</text>
      </view>
      <view v-show="!presentation.immersive">
    <view class="control-dock">
      <text v-if="lockedByMembership" class="notice">此内容暂不可播放，请查看当前权益。</text>
      <view v-else-if="audioErrorMessage" class="save-notice">
        <text class="notice">{{ audioErrorMessage }}</text>
        <button v-if="playbackSaveRetryAvailable" class="save-retry" :loading="playbackSaveRetryInFlight" :disabled="playbackSaveRetryInFlight" @click="retryPlaybackSave">重试保存</button>
      </view>
      <text v-if="visualErrorMessage" class="notice">{{ visualErrorMessage }}</text>
      <text v-if="guidedCompleted" class="notice">本次引导已结束。可以安静停留，或主动重新开始。</text>
      <view class="progress-track"><view class="progress-fill" :style="{ width: progressPercent }"></view><slider class="progress-slider" :disabled="Boolean(coListenRoom && !coListenOwner)" :value="currentTime" :min="0" :max="space.durationSeconds" :block-size="14" activeColor="transparent" backgroundColor="transparent" @change="handleSeek" /></view>
      <view class="time-row"><text>{{ formatDuration(currentTime) }}</text><text>{{ formatDuration(space.durationSeconds) }}</text></view>
      <view class="control-actions">
        <button :class="['side-control', timerRemainingSeconds ? 'active' : '']" @click="showTimer = true"><text class="side-control-title">定时</text><text class="side-control-label">{{ timerRemainingSeconds ? timerLabel : '未开启' }}</text></button>
        <button class="play-button" :aria-label="playLabel" @click="togglePlay"><text v-if="isPlaying || space.contentForm === 'silent-companion' || experience.guided" class="pause-label">{{ playLabel }}</text><image v-else class="play-image" src="/static/tabbar/player-active.png" mode="aspectFit" /></button>
        <button class="side-control" :aria-label="experience.nextLabel" :disabled="Boolean(coListenRoom) || !nextSpaces.length" @click="playNext()"><image class="side-control-icon" src="/static/tabbar/player-active.png" mode="aspectFit" /><text class="side-control-label">{{ experience.nextLabel }}</text></button>
      </view>
      <view class="player-tools">
        <button :class="['quiet-button', { selected: isFavorite }]" @click="toggleFavorite">{{ isFavorite ? '已收藏' : '收藏' }}</button>
        <button v-if="coListenAvailable || coListenRoom || pendingListenInvite || !authenticated" class="quiet-button" @click="openPlayerPanel('together')">{{ pendingListenInvite ? '加入一起听' : '一起听' }}</button>
        <button class="quiet-button" @click="openPlayerPanel('details')">内容介绍</button>
        <button class="quiet-button" :disabled="Boolean(audioErrorMessage || visualErrorMessage || lockedByMembership)" @click="enterImmersion">隐藏控件</button>
      </view>
    </view>
      </view>
    </view>

    <view v-if="presentation.panel !== 'none'" class="player-sheet-mask" @click="openPlayerPanel('none')">
      <view class="player-sheet" @click.stop>
        <view class="sheet-heading"><text>{{ presentation.panel === 'together' ? '一起听' : presentation.panel === 'display' ? '画面设置' : '内容与推荐' }}</text><button class="quiet-button" @click="openPlayerPanel('none')">关闭</button></view>
        <view v-if="presentation.panel === 'display'">
          <text class="sheet-copy">选择喜欢的画面大小，不影响音频播放。</text>
          <button :class="['timer-option', { selected: presentation.fit === 'contain' }]" @click="setVisualFit('contain')">完整画面</button>
          <button :class="['timer-option', { selected: presentation.fit === 'cover' }]" @click="setVisualFit('cover')">铺满屏幕 · 可能裁切</button>
          <button v-if="uploadedVisual.kind !== 'empty'" class="timer-option" @click="openFullscreen">查看原始画面</button>
        </view>
        <view v-if="presentation.panel === 'details'" class="classification-row">
          <text class="classification-primary">{{ space.primarySceneLabel || '待重新分类' }}</text>
          <text v-if="playbackCaption" class="classification-secondary">{{ sceneFormCaption(space) }} · {{ experience.description }}</text>
          <text v-if="space.alsoSuitableLabels?.length" class="classification-secondary">也适合：{{ space.alsoSuitableLabels.join('、') }}</text>
          <text class="classification-secondary">{{ formatDuration(space.durationSeconds) }}</text>
        </view>
        <view v-show="presentation.panel === 'together'">
    <view v-if="coListenAvailable || coListenRoom || pendingListenInvite || !authenticated" class="co-listen-panel">
      <view class="co-listen-head"><view><text class="co-listen-title">一起听</text><text class="co-listen-copy">{{ coListenRoom ? '声音由房主同步控制' : coListenNicknameNotice }}</text></view><text v-if="coListenRoom" class="co-listen-count">{{ coListenRoom.participants.length }}/10</text></view>
      <text v-if="coListenError" class="notice">{{ coListenError }}</text>
      <text v-if="coListenLifecycleNotice" class="notice">{{ coListenLifecycleNotice }}</text>
      <view v-if="coListenRoom" class="participant-strip">
        <view v-for="participant in coListenRoom.participants" :key="participant.participantId" class="participant">
          <image v-if="participant.avatarUrl" class="participant-avatar" :src="participant.avatarUrl" mode="aspectFill" />
          <view v-else class="participant-avatar participant-fallback">知</view>
          <text class="participant-name">{{ participant.displayName }}</text><text class="participant-status">{{ participant.role === 'owner' ? '房主' : participant.online ? '在线' : '离线' }}</text>
        </view>
      </view>
      <view v-if="pendingListenInvite && !coListenRoom" class="co-listen-actions"><button class="co-primary" :loading="coListenBusy" @click="acceptCoListenInvite">同意展示昵称并加入</button></view>
      <view v-else-if="!coListenRoom" class="co-listen-actions"><button class="co-primary" :loading="coListenBusy" @click="startCoListenRoom">发起一起听</button></view>
      <view v-else class="co-listen-actions">
        <button v-if="coListenNativeShareConfigured" class="co-primary" open-type="share">{{ coListenShareLabel }}</button>
        <button v-else class="co-disabled" disabled>分享功能暂未配置</button>
        <button class="co-secondary" @click="exitCoListenRoom">退出房间</button>
      </view>
    </view>

        </view>
        <view v-show="presentation.panel === 'details'">
    <view v-if="nextSpaces.length" class="next-panel">
      <view class="next-head"><text class="next-heading">接下来</text><text class="next-sub">同场景</text></view>
      <button v-for="item in nextSpaces.slice(0, 2)" :key="item.id" class="next-card" :disabled="Boolean(coListenRoom)" @click="playNext(item)">
        <image class="next-cover" :src="item.coverImageUrl" mode="aspectFill" @error="useFallbackCover(item)" />
        <view class="next-copy"><text class="next-title">{{ item.title }}</text><text class="next-meta">{{ sceneFormCaption(item) }} · {{ formatDuration(item.durationSeconds) }}</text></view>
        <view class="next-play"><image class="next-play-icon" src="/static/tabbar/player-active.png" mode="aspectFit" /></view>
      </button>
    </view>
          <text v-else class="sheet-copy">暂时没有更多推荐</text>
        </view>
      </view>
    </view>

    <view v-if="showTimer" class="timer-mask" @click="showTimer = false"><view class="timer-sheet" @click.stop><view class="sheet-heading"><text class="timer-title">定时关闭</text><button class="quiet-button" @click="showTimer = false">关闭</button></view><button v-for="option in timerOptions" :key="option" :class="['timer-option', selectedTimer === option ? 'selected' : '']" @click="selectTimer(option)">{{ option }}</button></view></view>
  </view>
</template>

<style scoped>
.experience-meta { margin-top:12rpx; color:rgba(235,242,238,.75); font-size:24rpx; line-height:1.5; }
.play-button { padding:0; }
.minimal-controls .play-button { font-size:24rpx; line-height:1.4; }
.page-state { padding:120rpx 28rpx; }
.page { position:relative; box-sizing:border-box; height:100vh; overflow-x:hidden; overflow-y:auto; background:#091916; color:#f4f8f6; }
.page-bg { position:fixed; inset:-12%; z-index:0; width:124%; height:124%; opacity:.52; filter:blur(52rpx) saturate(.86) brightness(.48); transform:scale(1.04); }
.page-tint { position:fixed; inset:0; z-index:0; background:linear-gradient(180deg,rgba(2,9,8,.18),rgba(5,20,17,.84) 62%,rgba(4,14,12,.96)); }
button { box-sizing:border-box; margin:0; line-height:normal; } button::after { border:0; } text { display:block; }
.visual-frame { position:relative; z-index:1; overflow:hidden; width:100%; height:820rpx; background:#14221f; }
.visual { width:100%; height:100%; } .effect-soft .visual { filter:saturate(.76) contrast(.94) brightness(1.04); } .effect-calm .visual { filter:saturate(.54) contrast(.98) brightness(.9); }
.visual-shade { position:absolute; inset:0; display:flex; flex-direction:column; justify-content:space-between; padding:calc(52rpx + env(safe-area-inset-top)) 28rpx 76rpx; background:linear-gradient(180deg,rgba(2,8,7,.38),rgba(2,8,7,.02) 42%,rgba(2,10,9,.9)); }
.visual-toolbar,.visual-bottom { display:flex; align-items:center; justify-content:space-between; gap:22rpx; }
.theater-back,.visual-fullscreen { min-height:72rpx; border:1rpx solid rgba(255,255,255,.18); border-radius:999rpx; background:rgba(8,18,17,.38); padding:0 24rpx; color:#f7faf8; font-size:26rpx; font-weight:800; white-space:nowrap; backdrop-filter:blur(18rpx); }
.visual-copy-group { flex:1; min-width:0; } .visual-title,.visual-copy,.meta-text,.next-title,.next-meta { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.visual-title { color:#fff; font-size:40rpx; font-weight:900; } .visual-copy { margin-top:10rpx; color:rgba(243,247,245,.78); font-size:28rpx; font-weight:640; }
.visual-heart { flex:0 0 auto; width:78rpx; min-height:78rpx; border:0; border-radius:50%; background:transparent; } .visual-heart-icon { width:38rpx; height:38rpx; filter:brightness(0) invert(1); } .visual-heart.active { background:rgba(230,239,234,.92); } .visual-heart.active .visual-heart-icon { filter:none; }
.control-dock { position:relative; z-index:3; margin:-20rpx 28rpx 0; border:1rpx solid rgba(255,255,255,.19); border-radius:34rpx; background:rgba(31,42,38,.58); padding:40rpx 32rpx 36rpx; box-shadow:0 30rpx 82rpx rgba(0,0,0,.38); backdrop-filter:blur(34rpx) saturate(1.1); }
.meta-row { display:flex; align-items:center; justify-content:space-between; gap:16rpx; } .meta-text { flex:1; color:rgba(231,239,235,.66); font-size:27rpx; font-weight:660; } .effect-status { flex:0 0 auto; border-radius:999rpx; background:rgba(226,239,232,.1); padding:8rpx 14rpx; color:rgba(239,245,242,.64); font-size:24rpx; font-weight:750; }
.classification-row { display:flex; flex-wrap:wrap; gap:10rpx 18rpx; margin-top:12rpx; } .classification-primary { color:#f1f7f4; font-size:25rpx; font-weight:800; } .classification-secondary { color:rgba(231,239,235,.6); font-size:24rpx; }
.notice { margin-top:14rpx; border-radius:16rpx; background:rgba(151,117,62,.22); padding:13rpx 16rpx; color:#eed6aa; font-size:26rpx; line-height:1.4; }
.save-notice { display:flex; align-items:center; gap:12rpx; margin-top:14rpx; } .save-notice .notice { flex:1; margin-top:0; } .save-retry { flex:0 0 auto; min-height:62rpx; border:1rpx solid rgba(238,214,170,.62); border-radius:6rpx; background:transparent; padding:0 16rpx; color:#eed6aa; font-size:24rpx; font-weight:800; }
.progress-track { position:relative; height:36rpx; margin-top:16rpx; } .progress-track::before { content:''; position:absolute; top:16rpx; right:0; left:0; height:4rpx; border-radius:999rpx; background:rgba(235,242,238,.22); } .progress-fill { position:absolute; top:16rpx; left:0; height:4rpx; border-radius:999rpx; background:#7ee7d6; } .progress-slider { position:absolute; top:-22rpx; right:-18rpx; left:-18rpx; }
.time-row { display:flex; justify-content:space-between; color:rgba(229,238,233,.54); font-size:24rpx; font-variant-numeric:tabular-nums; }
.control-actions { display:grid; grid-template-columns:1fr 118rpx 1fr 1fr; align-items:center; gap:12rpx; margin-top:18rpx; }
.side-control { display:flex; min-width:0; min-height:160rpx; flex-direction:column; align-items:center; justify-content:center; border:0; border-radius:22rpx; background:transparent; padding:0 4rpx; color:rgba(239,245,242,.68); } .side-control.active { background:rgba(224,238,230,.1); color:#fff; } .side-control-title { font-size:25rpx; font-weight:820; } .side-control-label { margin-top:8rpx; font-size:23rpx; font-weight:650; white-space:nowrap; } .side-control-icon { width:34rpx; height:34rpx; filter:brightness(0) invert(1); opacity:.82; }
.play-button { display:flex; width:130rpx; height:130rpx; min-height:130rpx; align-items:center; justify-content:center; border:1rpx solid rgba(211,235,222,.38); border-radius:50%; background:#0f4a3e; box-shadow:0 0 0 10rpx rgba(12,46,40,.42),0 16rpx 36rpx rgba(0,0,0,.3); } .play-image { width:46rpx; height:46rpx; margin-left:6rpx; filter:brightness(0) invert(1); } .pause-label { color:#fff; font-size:25rpx; font-weight:900; }
.next-panel { position:relative; z-index:2; margin:32rpx 28rpx 0; padding-bottom:calc(28rpx + env(safe-area-inset-bottom)); } .next-head { display:flex; align-items:center; justify-content:space-between; padding:0 4rpx 12rpx; border-bottom:1rpx solid rgba(255,255,255,.12); } .next-heading { color:#f3f7f5; font-size:32rpx; font-weight:880; } .next-sub { color:rgba(225,235,230,.5); font-size:25rpx; font-weight:650; }
.co-listen-panel { position:relative; z-index:2; margin:28rpx; border-top:1rpx solid rgba(255,255,255,.16); padding:24rpx 2rpx 8rpx; } .co-listen-head { display:flex; align-items:flex-start; justify-content:space-between; gap:20rpx; } .co-listen-title { color:#fff; font-size:31rpx; font-weight:880; } .co-listen-copy { margin-top:7rpx; color:rgba(229,238,233,.58); font-size:24rpx; line-height:1.45; } .co-listen-count { color:rgba(235,243,239,.7); font-size:25rpx; font-weight:800; } .participant-strip { display:flex; gap:18rpx; overflow-x:auto; margin-top:20rpx; padding-bottom:8rpx; } .participant { flex:0 0 112rpx; text-align:center; } .participant-avatar { width:72rpx; height:72rpx; margin:0 auto; border-radius:50%; background:#1a3530; } .participant-fallback { display:flex; align-items:center; justify-content:center; color:#eaf3ef; font-size:27rpx; font-weight:850; } .participant-name { overflow:hidden; margin-top:7rpx; color:#edf4f1; font-size:23rpx; text-overflow:ellipsis; white-space:nowrap; } .participant-status { margin-top:3rpx; color:rgba(225,236,230,.46); font-size:20rpx; } .co-listen-actions { display:flex; gap:14rpx; margin-top:20rpx; } .co-primary,.co-secondary,.co-disabled { min-height:76rpx; border-radius:6rpx; padding:0 22rpx; font-size:25rpx; font-weight:800; } .co-primary { flex:1; border:0; background:#dcebe4; color:#143c34; } .co-secondary { border:1rpx solid rgba(255,255,255,.18); background:transparent; color:#eaf2ee; } .co-disabled { flex:1; border:0; background:rgba(255,255,255,.08); color:rgba(235,242,238,.4); }
.next-card { display:flex; width:100%; min-height:112rpx; align-items:center; gap:16rpx; border:0; border-bottom:1rpx solid rgba(255,255,255,.1); border-radius:0; background:transparent; padding:16rpx 0; text-align:left; } .next-cover { width:142rpx; height:86rpx; border:1rpx solid rgba(255,255,255,.12); border-radius:16rpx; background:#152522; } .next-copy { flex:1; min-width:0; } .next-title { color:#f1f6f3; font-size:28rpx; font-weight:820; } .next-meta { margin-top:7rpx; color:rgba(224,234,229,.5); font-size:24rpx; } .next-play { display:flex; width:58rpx; height:58rpx; align-items:center; justify-content:center; border:1rpx solid rgba(255,255,255,.14); border-radius:50%; background:rgba(230,240,235,.07); } .next-play-icon { width:25rpx; height:25rpx; filter:brightness(0) invert(1); opacity:.8; }
.timer-mask { position:fixed; inset:0; z-index:20; display:flex; align-items:flex-end; background:rgba(2,9,8,.66); backdrop-filter:blur(12rpx); } .timer-sheet { width:100%; max-height:76vh; overflow-y:auto; border:1rpx solid rgba(255,255,255,.14); border-radius:38rpx 38rpx 0 0; background:#102723; padding:30rpx 26rpx calc(42rpx + env(safe-area-inset-bottom)); box-shadow:0 -30rpx 80rpx rgba(0,0,0,.4); }
.timer-kicker { color:rgba(220,233,226,.48); font-size:24rpx; font-weight:720; letter-spacing:3rpx; } .timer-title { margin:6rpx 0 18rpx; color:#f4f8f6; font-size:34rpx; font-weight:880; } .sheet-copy { margin:-8rpx 0 14rpx; color:rgba(224,234,229,.58); font-size:26rpx; line-height:1.5; }
.timer-option { width:100%; min-height:88rpx; border:0; border-bottom:1rpx solid rgba(255,255,255,.1); border-radius:0; background:transparent; padding:22rpx 4rpx; color:rgba(238,244,241,.72); font-size:28rpx; text-align:left; } .timer-option.selected { color:#fff; font-weight:850; }
.effect-option { display:flex; width:100%; min-height:100rpx; align-items:center; justify-content:space-between; border:0; border-bottom:1rpx solid rgba(255,255,255,.1); border-radius:0; background:transparent; padding:18rpx 4rpx; text-align:left; } .effect-label { color:#f1f6f3; font-size:28rpx; font-weight:840; } .effect-description { margin-top:6rpx; color:rgba(224,234,229,.5); font-size:25rpx; } .effect-current { border-radius:999rpx; background:rgba(226,239,232,.16); padding:8rpx 14rpx; color:#eef5f1; font-size:24rpx; font-weight:820; }
/* #ifdef H5 */
@media (min-width: 431px) {
  .page-tint,.timer-mask { right:auto; left:50%; width:430px; transform:translateX(-50%); }
  .page-bg { top:-12%; right:auto; bottom:-12%; left:50%; width:533px; transform:translateX(-50%) scale(1.04); }
}
/* #endif */
@media (min-width:540px) { .page { max-width:780rpx; margin:0 auto; } }

/* Uploaded media is the scene; presentation changes never remount the video. */
.immersive-player { height:100vh; height:100dvh; overflow:hidden; background:#111715; }
.immersive-player .page-bg { position:absolute; inset:-5%; width:110%; height:110%; opacity:.65; filter:blur(32rpx) brightness(.65); transform:none; }
.immersive-player .page-tint { position:absolute; inset:0; width:auto; transform:none; background:rgba(0,0,0,.08); pointer-events:none; }
.immersive-player .visual-frame { position:absolute; inset:0; width:100%; height:100%; background:transparent; }
.visual-empty { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:40rpx 40rpx 260rpx; text-align:center; }
.empty-title { font-size:32rpx; color:#e0e5e2; } .empty-copy { margin-top:18rpx; color:#a9b3ad; font-size:26rpx; }
.player-topbar { position:absolute; top:0; left:0; right:0; z-index:5; display:flex; align-items:center; justify-content:space-between; padding:calc(84rpx + env(safe-area-inset-top)) 26rpx 16rpx; background:linear-gradient(rgba(0,0,0,.48),transparent); }
.quiet-button { display:flex; align-items:center; justify-content:center; min-height:88rpx; min-width:88rpx; border:0; border-radius:12rpx; padding:0 16rpx; color:#f2f3ed; background:rgba(0,0,0,.16); font-size:26rpx; font-weight:500; }
.quiet-button.selected { color:#e8d8ae; } .quiet-button[disabled],.side-control[disabled] { opacity:.45; color:#c0c5c2; }
.player-foreground { position:absolute; z-index:4; bottom:0; left:0; right:0; box-sizing:border-box; max-height:72%; overflow-y:auto; padding:100rpx 32rpx calc(32rpx + env(safe-area-inset-bottom)); background:linear-gradient(transparent,rgba(0,0,0,.7) 30%,rgba(0,0,0,.86)); }
.player-heading { margin:0 4rpx 16rpx; } .player-heading .visual-title { font-size:44rpx; font-weight:600; line-height:1.4; white-space:normal; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; }
.player-heading .visual-copy { font-size:26rpx; font-weight:400; line-height:1.5; color:#d1d7d1; }
.immersive-player .control-dock { margin:0; padding:0; border:0; border-radius:0; background:transparent; box-shadow:none; backdrop-filter:none; }
.immersive-player .control-actions { grid-template-columns:1fr 132rpx 1fr; margin-top:14rpx; gap:30rpx; }
.immersive-player .side-control { min-height:110rpx; color:#e5e9e3; }
.immersive-player .play-button { width:128rpx; height:128rpx; min-height:128rpx; color:#17231e; background:#e9ece1; box-shadow:none; border:0; font-size:28rpx; }
.immersive-player .pause-label { color:#17231e; font-weight:600; } .immersive-player .play-image { filter:none; }
.immersive-player .time-row { color:#c2cac3; }
.player-tools { display:flex; justify-content:space-between; gap:8rpx; margin-top:18rpx; }
.player-tools .quiet-button { background:transparent; }
.minimal-controls { display:flex; flex-direction:column; align-items:center; gap:18rpx; }
.minimal-timer { color:#e0e4df; font-size:24rpx; }
.controls-hidden .player-foreground { padding-top:54rpx; background:linear-gradient(transparent,rgba(0,0,0,.5)); }
.together-peek { display:flex; align-items:center; gap:16rpx; margin-bottom:20rpx; }
.together-peek .quiet-button { white-space:nowrap; min-height:72rpx; }
.together-names { font-size:24rpx; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:#e0e4df; }
.player-sheet-mask { position:absolute; inset:0; z-index:15; display:flex; align-items:flex-end; background:rgba(0,0,0,.55); }
.player-sheet { box-sizing:border-box; width:100%; max-height:75%; overflow-y:auto; padding:24rpx 28rpx calc(32rpx + env(safe-area-inset-bottom)); border-radius:28rpx 28rpx 0 0; background:#17221e; }
.sheet-heading { display:flex; align-items:center; justify-content:space-between; gap:20rpx; margin-bottom:24rpx; font-size:32rpx; }
.sheet-heading .quiet-button { background:transparent; }
.player-sheet .classification-row { margin:12rpx 0 28rpx; }
.player-sheet .next-panel,.player-sheet .co-listen-panel { margin:0; padding:0; border:0; }
.player-sheet .sheet-copy { margin:18rpx 0; color:#c1cdc5; }
.immersive-player .timer-mask { position:absolute; inset:0; width:100%; transform:none; }
@media (max-height:640px) {
  .player-foreground { max-height:76%; padding-top:48rpx; }
  .immersive-player .play-button { width:100rpx; height:100rpx; min-height:100rpx; }
  .player-heading .visual-title { font-size:36rpx; }
}
</style>
