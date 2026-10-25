export type MediaFailureKind = 'not-found' | 'range-invalid' | 'timeout' | 'unplayable';

export function mediaFailureMessage(kind: MediaFailureKind): string {
  if (kind === 'not-found') return '媒体文件不存在，请稍后重试。';
  if (kind === 'range-invalid') return '媒体文件暂不可播放，请稍后重试。';
  if (kind === 'timeout') return '媒体加载超时，请检查网络后重试。';
  return '媒体文件暂不可用，请稍后重试。';
}

export function canSubmitPlayRecord(input: {
  contentLoaded: boolean;
  playbackStarted: boolean;
  currentTime: number;
}): boolean {
  return input.contentLoaded
    && input.playbackStarted
    && Number.isFinite(input.currentTime)
    && input.currentTime > 0;
}

export type PlayerVisualMode = 'cover' | 'muted-loop-video';

export interface VideoPlaybackConfig {
  autoplay: boolean;
  loop: boolean;
  muted: true;
  playsinline: true;
}

export function resolveVideoPlaybackConfig(contentForm?: string): VideoPlaybackConfig {
  return {
    autoplay: contentForm !== 'silent-companion',
    loop: true,
    muted: true,
    playsinline: true
  };
}

export function resolvePlayerVisualMode(input: {
  motionVideoUrl?: string;
  videoFailed: boolean;
}): PlayerVisualMode {
  return input.motionVideoUrl && !input.videoFailed ? 'muted-loop-video' : 'cover';
}

export type ContentPlaybackRole = 'audio' | 'silent-content-video' | 'decorative-video';

export function playbackEvidenceFromEvent(
  event: 'audio-play' | 'video-play' | 'video-error',
  role: ContentPlaybackRole,
  userInitiated = false
) {
  const contentPlaybackStarted = event === 'audio-play' && role === 'audio' ||
    event === 'video-play' && role === 'silent-content-video' && userInitiated;
  return {
    contentPlaybackStarted,
    canRecordPlayback: contentPlaybackStarted
  };
}

export interface ContentPlaybackSubmission {
  currentTime: number;
  completed: boolean;
}

export interface PreparedContentPlaybackSubmission {
  submission: ContentPlaybackSubmission;
  commit(): void;
  rollback(): void;
}

export interface SilentCompletionSubmissionResult {
  success: boolean;
  failedStage?: 'play-count' | 'completion';
  errorMessage?: string;
}

export const SILENT_PLAYBACK_SAVE_ERROR = '播放记录保存失败，请稍后重试。';

export async function submitSilentCompletionEvidence(
  evidence: ContentPlaybackEvidence,
  submit: (submission: ContentPlaybackSubmission) => Promise<void>
): Promise<SilentCompletionSubmissionResult> {
  if (!evidence.silentPlaybackCompleted) return { success: false, failedStage: 'completion' };
  if (evidence.silentNeedsInitialPlayCountEvidence) {
    const initial = evidence.prepareProgress(0, false);
    if (initial) {
      try {
        await submit(initial.submission);
        initial.commit();
      } catch {
        initial.rollback();
        return { success: false, failedStage: 'play-count', errorMessage: SILENT_PLAYBACK_SAVE_ERROR };
      }
    }
  }
  const completion = evidence.prepareProgress(0, true);
  if (!completion) return { success: false, failedStage: 'completion' };
  try {
    await submit(completion.submission);
    completion.commit();
    return { success: true };
  } catch {
    completion.rollback();
    return { success: false, failedStage: 'completion', errorMessage: SILENT_PLAYBACK_SAVE_ERROR };
  }
}

export class ContentPlaybackEvidence {
  private role: ContentPlaybackRole | undefined;
  private active = false;
  private failed = false;
  private silentVideoArmed = false;
  private lastSubmissionKey = '';
  private silentSessionStarted = false;
  private silentContentDuration = 0;
  private silentLogicalTime = 0;
  private silentMediaPosition = 0;
  private silentMediaDuration = 0;
  private silentPlayCountEvidenceSubmitted = false;
  private silentBoundaryObserved = false;
  private silentBoundaryRearmed = false;
  private pendingSubmission = false;
  private revision = 0;

  armSilentVideo(contentDuration = 0): { newSession: boolean; logicalTime: number; mediaPosition: number } {
    const newSession = !this.silentSessionStarted || this.failed;
    if (newSession) {
      this.role = 'silent-content-video';
      this.silentSessionStarted = true;
      this.silentContentDuration = positiveNumber(contentDuration);
      this.silentLogicalTime = 0;
      this.silentMediaPosition = 0;
      this.silentMediaDuration = 0;
      this.silentPlayCountEvidenceSubmitted = false;
      this.silentBoundaryObserved = false;
      this.silentBoundaryRearmed = false;
      this.lastSubmissionKey = '';
    } else if (positiveNumber(contentDuration) > 0) {
      this.silentContentDuration = positiveNumber(contentDuration);
      this.silentLogicalTime = Math.min(this.silentLogicalTime, this.silentContentDuration);
    }
    this.silentVideoArmed = true;
    this.failed = false;
    return {
      newSession,
      logicalTime: this.silentLogicalTime,
      mediaPosition: this.silentMediaPosition
    };
  }

  onAudioPlay(): boolean {
    const evidence = playbackEvidenceFromEvent('audio-play', 'audio', true);
    this.role = 'audio';
    this.active = evidence.canRecordPlayback;
    this.failed = false;
    return this.active;
  }

  onVideoPlay(contentForm: string | undefined): boolean {
    const role: ContentPlaybackRole = contentForm === 'silent-companion'
      ? 'silent-content-video'
      : 'decorative-video';
    const evidence = playbackEvidenceFromEvent('video-play', role, this.silentVideoArmed);
    this.silentVideoArmed = false;
    if (!evidence.canRecordPlayback) return false;
    this.role = role;
    this.active = true;
    this.failed = false;
    return true;
  }

  onSilentVideoTimeUpdate(mediaPositionValue: number, mediaDurationValue?: number): number | undefined {
    if (this.role !== 'silent-content-video' || !this.active || this.failed) return undefined;
    const mediaPosition = nonNegativeNumber(mediaPositionValue);
    const suppliedDuration = positiveNumber(mediaDurationValue);
    if (suppliedDuration > 0) this.silentMediaDuration = suppliedDuration;
    const mediaDuration = this.silentMediaDuration;
    let delta = 0;
    if (mediaPosition >= this.silentMediaPosition) {
      delta = mediaPosition - this.silentMediaPosition;
    } else if (mediaDuration > 0) {
      delta = Math.max(0, mediaDuration - this.silentMediaPosition) + mediaPosition;
    }
    if (mediaDuration > 0) delta = Math.min(delta, mediaDuration);
    const crossedBoundary = mediaPosition < this.silentMediaPosition;
    if (crossedBoundary && this.silentBoundaryObserved && !this.silentBoundaryRearmed) {
      delta = 0;
    }
    this.silentLogicalTime = this.clampSilentLogicalTime(this.silentLogicalTime + delta);
    this.silentMediaPosition = mediaPosition;
    if (crossedBoundary) this.markSilentBoundaryObserved();
    else this.rearmSilentBoundaryAfterProgress(mediaPosition);
    return this.silentLogicalTime;
  }

  onSilentVideoLoopBoundary(mediaDurationValue?: number): number | undefined {
    if (this.role !== 'silent-content-video' || !this.active || this.failed) return undefined;
    const suppliedDuration = positiveNumber(mediaDurationValue);
    if (suppliedDuration > 0) this.silentMediaDuration = suppliedDuration;
    if (this.silentBoundaryObserved && !this.silentBoundaryRearmed) return this.silentLogicalTime;
    if (this.silentMediaDuration > 0) {
      this.silentLogicalTime = this.clampSilentLogicalTime(
        this.silentLogicalTime + Math.max(0, this.silentMediaDuration - this.silentMediaPosition)
      );
    }
    this.markSilentBoundaryObserved();
    return this.silentLogicalTime;
  }

  syncSilentVideoPosition(mediaPositionValue = 0): void {
    if (!this.silentSessionStarted) return;
    this.silentMediaPosition = nonNegativeNumber(mediaPositionValue);
    if (this.silentMediaPosition === 0 && this.silentBoundaryObserved) this.silentBoundaryRearmed = false;
  }

  seekSilentLogicalTime(logicalTimeValue: number): { logicalTime: number; mediaPosition: number } {
    if (!this.silentSessionStarted) return { logicalTime: 0, mediaPosition: 0 };
    this.silentLogicalTime = this.clampSilentLogicalTime(nonNegativeNumber(logicalTimeValue));
    this.silentMediaPosition = this.silentMediaDuration > 0
      ? this.silentLogicalTime % this.silentMediaDuration
      : 0;
    this.silentBoundaryObserved = false;
    this.silentBoundaryRearmed = this.silentMediaPosition >= this.silentBoundaryRearmThreshold();
    this.lastSubmissionKey = '';
    return { logicalTime: this.silentLogicalTime, mediaPosition: this.silentMediaPosition };
  }

  pause(): void {
    this.active = false;
  }

  fail(role: ContentPlaybackRole): void {
    if (this.role === role || role === 'silent-content-video') {
      this.active = false;
      this.failed = true;
    }
    this.silentVideoArmed = false;
  }

  reset(): void {
    this.role = undefined;
    this.active = false;
    this.failed = false;
    this.silentVideoArmed = false;
    this.lastSubmissionKey = '';
    this.silentSessionStarted = false;
    this.silentContentDuration = 0;
    this.silentLogicalTime = 0;
    this.silentMediaPosition = 0;
    this.silentMediaDuration = 0;
    this.silentPlayCountEvidenceSubmitted = false;
    this.silentBoundaryObserved = false;
    this.silentBoundaryRearmed = false;
    this.pendingSubmission = false;
    this.revision += 1;
  }

  takeProgress(currentTime: number, completed = false, requireActive = false): ContentPlaybackSubmission | undefined {
    const prepared = this.prepareProgress(currentTime, completed, requireActive);
    if (!prepared) return undefined;
    prepared.commit();
    return prepared.submission;
  }

  prepareProgress(
    currentTime: number,
    completed = false,
    requireActive = false
  ): PreparedContentPlaybackSubmission | undefined {
    if (this.pendingSubmission) return undefined;
    const isSilentVideo = this.role === 'silent-content-video';
    const logicalTime = isSilentVideo ? this.silentLogicalTime : nonNegativeNumber(currentTime);
    const safeTime = Math.max(0, Math.floor(logicalTime));
    if (!this.role || this.failed || safeTime <= 0 || requireActive && !this.active) return undefined;
    const actuallyCompleted = isSilentVideo
      ? completed && this.silentContentDuration > 0 && this.silentLogicalTime >= this.silentContentDuration
      : completed;
    if (isSilentVideo && this.silentContentDuration <= 20 && !actuallyCompleted) return undefined;
    let submissionTime = safeTime;
    const submittingInitialPlayCountEvidence = isSilentVideo && !this.silentPlayCountEvidenceSubmitted;
    if (submittingInitialPlayCountEvidence) {
      submissionTime = Math.min(20, safeTime);
    } else if (isSilentVideo && safeTime <= 20) {
      return undefined;
    }
    const submissionCompleted = actuallyCompleted && !(submittingInitialPlayCountEvidence && safeTime > 20);
    const key = `${submissionTime}:${submissionCompleted ? 'completed' : 'progress'}`;
    if (key === this.lastSubmissionKey) return undefined;
    const revision = this.revision;
    let settled = false;
    this.pendingSubmission = true;
    const settle = (commit: boolean) => {
      if (settled) return;
      settled = true;
      if (revision !== this.revision) return;
      this.pendingSubmission = false;
      if (!commit) return;
      this.lastSubmissionKey = key;
      if (submittingInitialPlayCountEvidence) this.silentPlayCountEvidenceSubmitted = true;
      if (submissionCompleted) this.active = false;
    };
    return {
      submission: { currentTime: submissionTime, completed: submissionCompleted },
      commit: () => settle(true),
      rollback: () => settle(false)
    };
  }

  get started(): boolean {
    return Boolean(this.role) && !this.failed;
  }

  get silentLogicalCurrentTime(): number {
    return this.silentLogicalTime;
  }

  get silentVideoPosition(): number {
    return this.silentMediaPosition;
  }

  get silentPlaybackCompleted(): boolean {
    return this.silentSessionStarted && this.silentContentDuration > 0 &&
      this.silentLogicalTime >= this.silentContentDuration;
  }

  get silentNeedsInitialPlayCountEvidence(): boolean {
    return this.silentSessionStarted && !this.silentPlayCountEvidenceSubmitted;
  }

  private clampSilentLogicalTime(value: number): number {
    const safeValue = nonNegativeNumber(value);
    return this.silentContentDuration > 0 ? Math.min(this.silentContentDuration, safeValue) : safeValue;
  }

  private markSilentBoundaryObserved(): void {
    this.silentBoundaryObserved = true;
    this.silentBoundaryRearmed = false;
    this.silentMediaPosition = 0;
  }

  private rearmSilentBoundaryAfterProgress(mediaPosition: number): void {
    if (!this.silentBoundaryObserved) return;
    if (mediaPosition >= this.silentBoundaryRearmThreshold()) this.silentBoundaryRearmed = true;
  }

  private silentBoundaryRearmThreshold(): number {
    return this.silentMediaDuration > 0 ? Math.min(1, this.silentMediaDuration / 4) : 1;
  }
}

function nonNegativeNumber(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

function positiveNumber(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}
