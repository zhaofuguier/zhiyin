import { mediaFailureMessage } from './media-playback.ts';

export interface SingleAudioContent {
  id: string;
  title: string;
  durationSeconds: number;
  audioUrl: string;
  contentForm?: string;
}

export interface PlaybackSessionScope {
  readonly authenticated: boolean;
}

const REPORT_INTERVAL_MS = 15_000;
const TIMER_TICK_MS = 1_000;
export interface SingleAudioAdapter {
  src: string;
  loop: boolean;
  obeyMuteSwitch: boolean;
  readonly currentTime: number;
  play(): void;
  pause(): void;
  stop(): void;
  seek(position: number): void;
  destroy(): void;
  onPlay(listener: () => void): void;
  onPause(listener: () => void): void;
  onStop(listener: () => void): void;
  onTimeUpdate(listener: () => void): void;
  onEnded(listener: () => void): void;
  onError(listener: () => void): void;
}

export interface SingleAudioState {
  current?: SingleAudioContent;
  isPlaying: boolean;
  currentTime: number;
  revision: number;
  errorMessage: string;
  saveRetryAvailable: boolean;
  saveRetryInFlight: boolean;
  sleepDeadlineAt: number | null;
  timerRemainingSeconds: number;
  suspendedByApplication: boolean;
}

export interface SingleAudioDependencies {
  createAudio(): SingleAudioAdapter;
  captureSessionScope(): PlaybackSessionScope;
  isSessionScopeCurrent(scope: PlaybackSessionScope): boolean;
  writeTargetKey(scope: PlaybackSessionScope, space: SingleAudioContent): string | undefined;
  recordPlay(scope: PlaybackSessionScope, space: SingleAudioContent, currentTime: number, completed: boolean): Promise<'recorded' | 'skipped' | 'stale'>;
  now(): number;
  setInterval(callback: () => void, delay: number): unknown;
  clearInterval(handle: unknown): void;
  readDeadline(): number | null;
  writeDeadline(value: number | null): void;
}

export type SingleAudioListener = (state: Readonly<SingleAudioState>) => void;

interface PlaybackWriteIntent {
  currentTime: number;
  completed: boolean;
  terminal: boolean;
}

interface PlaybackWriteSession {
  readonly generation: number;
  readonly content: SingleAudioContent;
  readonly scope: PlaybackSessionScope;
  readonly targetKey?: string;
  active: boolean;
  closed: boolean;
  cancelled: boolean;
  initialCountCommitted: boolean;
  completionCommitted: boolean;
  pending?: PlaybackWriteIntent;
  inFlight?: PlaybackWriteIntent;
  failed?: PlaybackWriteIntent;
  retryHead?: PlaybackWriteIntent;
  drain?: Promise<void>;
  retry?: Promise<boolean>;
}

export class SingleAudioCoordinator {
  private readonly dependencies: SingleAudioDependencies;
  private readonly listeners = new Set<SingleAudioListener>();
  private readonly writeSessions = new Set<PlaybackWriteSession>();
  private readonly activeDrains = new Set<Promise<void>>();
  private readonly targetWriteTails = new Map<string, Promise<void>>();
  private readonly latestWriteGeneration = new Map<string, number>();
  private audio: SingleAudioAdapter | undefined;
  private reporter: unknown;
  private timerTicker: unknown;
  private playbackSession: PlaybackWriteSession | undefined;
  private failedSaveSession: PlaybackWriteSession | undefined;
  private nextPlaybackGeneration = 1;
  private state: SingleAudioState;

  constructor(dependencies: SingleAudioDependencies) {
    this.dependencies = dependencies;
    const deadline = positiveDeadline(dependencies.readDeadline());
    this.state = {
      isPlaying: false,
      currentTime: 0,
      revision: 0,
      errorMessage: '',
      saveRetryAvailable: false,
      saveRetryInFlight: false,
      sleepDeadlineAt: deadline,
      timerRemainingSeconds: remainingSeconds(deadline, dependencies.now()),
      suspendedByApplication: false
    };
    if (deadline) this.ensureTimerTicker();
  }

  snapshot(): Readonly<SingleAudioState> {
    return { ...this.state };
  }

  subscribe(listener: SingleAudioListener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  selectContent(space: SingleAudioContent, initialTime = 0): void {
    if (space.contentForm === 'silent-companion') return;
    if (this.state.current?.id === space.id) {
      this.state.current = space;
      this.emit();
      return;
    }
    this.finalizeCurrentSession(false);
    this.releaseAudio(false);
    this.state.current = space;
    this.state.currentTime = clampTime(initialTime, space.durationSeconds);
    this.state.errorMessage = '';
    this.state.saveRetryAvailable = false;
    this.state.saveRetryInFlight = false;
    this.failedSaveSession = undefined;
    this.state.suspendedByApplication = false;
    this.state.revision += 1;
    this.playbackSession = undefined;
    this.pruneWriteSessions();
    this.emit();
  }

  restoreInitialProgress(contentId: string, currentTime: number): boolean {
    if (this.state.current?.id !== contentId || this.audio || this.playbackSession?.active || this.state.currentTime > 0) return false;
    this.state.currentTime = clampTime(currentTime, this.state.current.durationSeconds);
    this.emit();
    return true;
  }

  play(): boolean {
    const current = this.state.current;
    if (!current?.audioUrl || current.contentForm === 'silent-companion') return false;
    this.checkDeadline();
    if (this.state.sleepDeadlineAt && this.state.timerRemainingSeconds === 0) return false;
    this.state.suspendedByApplication = false;
    const audio = this.audio || this.createAudio(current);
    // Restart only after an explicit user action; a finished guide never loops itself.
    if (current.contentForm === 'guided-audio' && current.durationSeconds > 0 && this.state.currentTime >= current.durationSeconds) {
      this.state.currentTime = 0;
      audio.seek(0);
    }
    audio.play();
    return true;
  }

  pause(): void {
    if (!this.audio || !this.state.isPlaying) return;
    this.audio.pause();
  }

  toggle(): boolean {
    if (this.state.isPlaying) {
      this.pause();
      return false;
    }
    return this.play();
  }

  seek(position: number): void {
    const current = this.state.current;
    if (!current) return;
    this.state.currentTime = clampTime(position, current.durationSeconds);
    this.audio?.seek(this.state.currentTime);
    this.emit();
  }

  stopUserInitiated(): void {
    this.finalizeCurrentSession(false);
    this.releaseAudio(false);
    this.clearSleepTimer();
    this.state.currentTime = 0;
    this.state.suspendedByApplication = false;
    this.state.revision += 1;
    this.playbackSession = undefined;
    this.pruneWriteSessions();
    this.emit();
  }

  stopForContentTransition(): void {
    this.finalizeCurrentSession(false);
    this.releaseAudio(false);
    this.state.current = undefined;
    this.state.currentTime = 0;
    this.state.suspendedByApplication = false;
    this.state.revision += 1;
    this.playbackSession = undefined;
    this.pruneWriteSessions();
    this.emit();
  }

  stopForExclusivePlayback(): void {
    this.stopForContentTransition();
    this.clearSleepTimer();
    this.emit();
  }

  handleApplicationHide(): void {
    if (!this.state.isPlaying) return;
    this.state.suspendedByApplication = true;
    this.audio?.pause();
  }

  handleApplicationShow(): void {
    this.checkDeadline();
    this.emit();
  }

  handleSystemInterruption(): void {
    if (!this.state.isPlaying) return;
    this.state.suspendedByApplication = true;
    this.audio?.pause();
  }

  handleSessionInvalidated(input?: { reason?: string; hadPrincipal?: boolean }): void {
    if (input?.reason === 'explicit-login' && !input.hadPrincipal) {
      if (this.playbackSession) {
        this.cancelWriteSession(this.playbackSession);
        this.clearSaveFailure(this.playbackSession);
      }
      this.playbackSession = undefined;
      this.pruneWriteSessions();
      return;
    }
    this.stopForExclusivePlayback();
    this.cancelStaleWriteSessions();
  }

  setSleepTimer(seconds: number): void {
    const safeSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
    if (!safeSeconds) {
      this.clearSleepTimer();
      this.emit();
      return;
    }
    const deadline = this.dependencies.now() + safeSeconds * 1000;
    this.state.sleepDeadlineAt = deadline;
    this.state.timerRemainingSeconds = safeSeconds;
    this.dependencies.writeDeadline(deadline);
    this.ensureTimerTicker();
    this.emit();
  }

  clearSleepTimer(): void {
    if (this.timerTicker !== undefined) this.dependencies.clearInterval(this.timerTicker);
    this.timerTicker = undefined;
    this.state.sleepDeadlineAt = null;
    this.state.timerRemainingSeconds = 0;
    this.dependencies.writeDeadline(null);
  }

  submitProgress(completed = false, requireActive = false): Promise<boolean> {
    const session = this.playbackSession;
    if (!session || requireActive && !session.active) return Promise.resolve(false);
    return this.queueEvidence(session, this.state.currentTime, completed, completed);
  }

  retryFailedSave(): Promise<boolean> {
    const session = this.failedSaveSession;
    if (!session?.failed || !session.pending || session.cancelled) return Promise.resolve(false);
    if (!this.dependencies.isSessionScopeCurrent(session.scope) || this.isWriteSessionSuperseded(session)) {
      this.cancelWriteSession(session);
      this.clearSaveFailure(session);
      return Promise.resolve(false);
    }
    if (session.retry) return session.retry;
    this.state.saveRetryInFlight = true;
    this.emit();
    const priorDrain = session.drain || Promise.resolve();
    const retry = priorDrain.then(async () => {
      if (!this.dependencies.isSessionScopeCurrent(session.scope) || this.isWriteSessionSuperseded(session)) {
        this.cancelWriteSession(session);
        this.clearSaveFailure(session);
        return false;
      }
      const failed = session.failed;
      if (!failed) return false;
      session.failed = undefined;
      session.retryHead = failed;
      if (session.pending && sameIntent(session.pending, failed)) session.pending = undefined;
      await this.ensureWriteDrain(session);
      const succeeded = !session.failed && !session.retryHead && !session.pending && !session.cancelled;
      if (succeeded) this.clearSaveFailure(session);
      return succeeded;
    }).finally(() => {
      session.retry = undefined;
      if (this.failedSaveSession === session) {
        this.state.saveRetryInFlight = false;
        this.emit();
      }
      this.pruneWriteSessions();
    });
    session.retry = retry;
    return retry;
  }

  async whenWritesSettled(): Promise<void> {
    while (this.activeDrains.size > 0) {
      await Promise.allSettled([...this.activeDrains]);
    }
  }

  private createAudio(space: SingleAudioContent): SingleAudioAdapter {
    const audio = this.dependencies.createAudio();
    const revision = this.state.revision;
    const isCurrent = () => this.audio === audio && this.state.revision === revision && this.state.current?.id === space.id;
    audio.src = space.audioUrl;
    audio.loop = false;
    audio.obeyMuteSwitch = false;
    audio.onPlay(() => {
      if (!isCurrent()) return;
      if (!this.playbackSession || this.playbackSession.closed || this.playbackSession.content.id !== space.id) {
        this.playbackSession = this.createPlaybackWriteSession(space);
      }
      this.playbackSession.active = true;
      this.state.isPlaying = true;
      if (!this.state.saveRetryAvailable) this.state.errorMessage = '';
      this.startReporter();
      this.emit();
    });
    audio.onPause(() => {
      if (!isCurrent()) return;
      if (this.playbackSession) this.playbackSession.active = false;
      this.state.isPlaying = false;
      this.stopReporter();
      this.submitProgress();
      this.emit();
    });
    audio.onStop(() => {
      if (!isCurrent()) return;
      if (this.playbackSession) this.playbackSession.active = false;
      this.state.isPlaying = false;
      this.stopReporter();
      this.submitProgress();
      this.emit();
    });
    audio.onTimeUpdate(() => {
      if (!isCurrent()) return;
      this.state.currentTime = clampTime(audio.currentTime, space.durationSeconds);
      this.emit();
    });
    audio.onEnded(() => {
      if (!isCurrent()) return;
      this.state.currentTime = space.durationSeconds;
      this.state.isPlaying = false;
      this.stopReporter();
      const session = this.playbackSession;
      if (session) {
        session.active = false;
        session.closed = true;
        this.queueEvidence(session, space.durationSeconds, true, true);
      }
      this.emit();
    });
    audio.onError(() => {
      if (!isCurrent()) return;
      if (this.playbackSession) {
        this.playbackSession.active = false;
        this.playbackSession.closed = true;
      }
      this.state.isPlaying = false;
      this.stopReporter();
      this.state.errorMessage = mediaFailureMessage('unplayable');
      this.releaseAudio(false);
      this.emit();
    });
    this.audio = audio;
    if (this.state.currentTime > 0) audio.seek(this.state.currentTime);
    return audio;
  }

  private releaseAudio(clearCurrent: boolean): void {
    this.stopReporter();
    const audio = this.audio;
    this.audio = undefined;
    this.state.isPlaying = false;
    if (audio) {
      audio.stop();
      audio.destroy();
    }
    if (clearCurrent) this.state.current = undefined;
  }

  private startReporter(): void {
    this.stopReporter();
    this.reporter = this.dependencies.setInterval(() => {
      if (this.state.isPlaying) this.submitProgress(false, true);
    }, REPORT_INTERVAL_MS);
  }

  private stopReporter(): void {
    if (this.reporter !== undefined) this.dependencies.clearInterval(this.reporter);
    this.reporter = undefined;
  }

  private ensureTimerTicker(): void {
    if (this.timerTicker !== undefined) return;
    this.timerTicker = this.dependencies.setInterval(() => this.checkDeadline(), TIMER_TICK_MS);
  }

  private checkDeadline(): void {
    const deadline = this.state.sleepDeadlineAt;
    if (!deadline) return;
    const remaining = remainingSeconds(deadline, this.dependencies.now());
    this.state.timerRemainingSeconds = remaining;
    if (remaining > 0) {
      this.emit();
      return;
    }
    this.finalizeCurrentSession(false);
    this.releaseAudio(false);
    this.clearSleepTimer();
    this.state.suspendedByApplication = false;
    this.state.revision += 1;
    this.playbackSession = undefined;
    this.pruneWriteSessions();
    this.emit();
  }

  private createPlaybackWriteSession(content: SingleAudioContent): PlaybackWriteSession {
    const scope = this.dependencies.captureSessionScope();
    const targetKey = this.dependencies.writeTargetKey(scope, content);
    const session: PlaybackWriteSession = {
      generation: this.nextPlaybackGeneration++,
      content: { ...content },
      scope,
      targetKey,
      active: false,
      closed: false,
      cancelled: false,
      initialCountCommitted: false,
      completionCommitted: false
    };
    if (targetKey) {
      this.latestWriteGeneration.set(targetKey, session.generation);
      if (this.failedSaveSession?.targetKey === targetKey) this.clearSaveFailure(this.failedSaveSession);
    }
    this.writeSessions.add(session);
    this.pruneWriteSessions();
    return session;
  }

  private finalizeCurrentSession(completed: boolean): Promise<boolean> {
    const session = this.playbackSession;
    if (!session) return Promise.resolve(false);
    session.active = false;
    session.closed = true;
    const result = this.queueEvidence(session, this.state.currentTime, completed, true);
    if (!session.drain && !session.retryHead && !session.pending && !session.inFlight) this.writeSessions.delete(session);
    return result;
  }

  private queueEvidence(
    session: PlaybackWriteSession,
    currentTimeValue: number,
    completed: boolean,
    terminal: boolean
  ): Promise<boolean> {
    if (session.cancelled || session.completionCommitted || !session.scope.authenticated) return Promise.resolve(false);
    if (completed && session.inFlight?.completed && session.drain) {
      return session.drain.then(() => session.completionCommitted);
    }
    if (!this.dependencies.isSessionScopeCurrent(session.scope)) {
      this.cancelWriteSession(session);
      return Promise.resolve(false);
    }
    const currentTime = Math.max(0, Math.floor(clampTime(currentTimeValue, session.content.durationSeconds)));
    if (currentTime <= 0 && !completed) return Promise.resolve(false);
    if (session.initialCountCommitted && currentTime <= 20 && !completed) return Promise.resolve(false);
    const next: PlaybackWriteIntent = {
      currentTime: completed ? Math.max(currentTime, Math.floor(session.content.durationSeconds)) : currentTime,
      completed,
      terminal
    };
    session.pending = mergeWriteIntents(session.pending, next);
    if (!session.targetKey) {
      this.markWriteFailure(session, session.pending);
      return Promise.resolve(false);
    }
    if (session.failed) {
      return Promise.resolve(false);
    }
    const drain = this.ensureWriteDrain(session);
    return drain.then(() => !session.failed && !session.pending);
  }

  private ensureWriteDrain(session: PlaybackWriteSession): Promise<void> {
    if (session.drain) return session.drain;
    const targetKey = session.targetKey;
    const predecessor = targetKey ? this.targetWriteTails.get(targetKey) : undefined;
    const operation = predecessor
      ? predecessor.then(() => this.drainWriteSession(session), () => this.drainWriteSession(session))
      : this.drainWriteSession(session);
    const targetTail = operation.then(() => undefined, () => undefined);
    if (targetKey) this.targetWriteTails.set(targetKey, targetTail);
    const drain = operation.finally(() => {
      session.drain = undefined;
      this.activeDrains.delete(drain);
      if (targetKey && this.targetWriteTails.get(targetKey) === targetTail) {
        this.targetWriteTails.delete(targetKey);
      }
      if (session.closed && !session.retryHead && !session.pending && !session.inFlight) this.writeSessions.delete(session);
      this.pruneWriteSessions();
    });
    session.drain = drain;
    this.activeDrains.add(drain);
    return drain;
  }

  private async drainWriteSession(session: PlaybackWriteSession): Promise<void> {
    while ((session.retryHead || session.pending) && !session.cancelled) {
      if (!this.dependencies.isSessionScopeCurrent(session.scope)) {
        this.cancelWriteSession(session);
        return;
      }
      const retryingFailedIntent = session.retryHead;
      const pending = retryingFailedIntent || session.pending as PlaybackWriteIntent;
      const requiresInitial = !session.initialCountCommitted;
      const sendsSyntheticInitial = !retryingFailedIntent && requiresInitial && pending.completed;
      const submission: PlaybackWriteIntent = sendsSyntheticInitial
        ? { currentTime: Math.min(20, pending.currentTime), completed: false, terminal: false }
        : pending;
      if (retryingFailedIntent) session.retryHead = undefined;
      else if (!sendsSyntheticInitial) session.pending = undefined;
      session.inFlight = submission;
      try {
        const outcome = await this.dependencies.recordPlay(
          session.scope,
          session.content,
          submission.currentTime,
          submission.completed
        );
        session.inFlight = undefined;
        if (!this.dependencies.isSessionScopeCurrent(session.scope)) {
          this.cancelWriteSession(session);
          return;
        }
        if (outcome !== 'recorded') {
          this.markWriteFailure(session, submission);
          return;
        }
        if (!session.initialCountCommitted && submission.currentTime <= 20 && !submission.completed) {
          session.initialCountCommitted = true;
        }
        if (submission.completed) {
          session.completionCommitted = true;
          session.pending = undefined;
        } else if (session.initialCountCommitted && session.pending && !session.pending.completed && session.pending.currentTime <= 20) {
          session.pending = undefined;
        }
      } catch {
        session.inFlight = undefined;
        this.markWriteFailure(session, submission);
        return;
      }
    }
  }

  private markWriteFailure(session: PlaybackWriteSession, intent: PlaybackWriteIntent): void {
    // Retry the actual failed request; a synthetic initial write can have a
    // separate completion still pending behind it.
    if (!session.pending) session.pending = { ...intent };
    session.failed = { ...intent };
    if (!this.dependencies.isSessionScopeCurrent(session.scope)) {
      this.cancelWriteSession(session);
      return;
    }
    if (this.state.current?.id === session.content.id && (
      !this.playbackSession || this.playbackSession.generation === session.generation
    )) {
      this.failedSaveSession = session;
      this.state.errorMessage = '播放记录保存失败，请稍后重试。';
      this.state.saveRetryAvailable = !this.isWriteSessionSuperseded(session);
      this.state.saveRetryInFlight = false;
      this.emit();
    }
  }

  private cancelStaleWriteSessions(): void {
    for (const session of this.writeSessions) {
      if (this.dependencies.isSessionScopeCurrent(session.scope)) continue;
      this.cancelWriteSession(session);
    }
    if (this.failedSaveSession?.cancelled) this.clearSaveFailure(this.failedSaveSession);
    this.pruneWriteSessions();
  }

  private pruneWriteSessions(): void {
    for (const session of this.writeSessions) {
      // In-flight work and cross-generation tails must keep their ordering until
      // settlement. Only the displayed, current-identity failure is retryable.
      if (session.drain || session.inFlight || session.retry) continue;
      const retryable = session === this.failedSaveSession && !session.cancelled
        && this.state.current?.id === session.content.id
        && this.dependencies.isSessionScopeCurrent(session.scope)
        && !this.isWriteSessionSuperseded(session);
      if (retryable) continue;
      if (session.cancelled || session.failed || (session.closed && !session.pending && !session.retryHead)) {
        this.cancelWriteSession(session);
        this.clearSaveFailure(session);
      }
    }
    const referencedTargets = new Set([...this.writeSessions].map(session => session.targetKey));
    for (const key of this.latestWriteGeneration.keys()) {
      if (!referencedTargets.has(key) && !this.targetWriteTails.has(key)) this.latestWriteGeneration.delete(key);
    }
  }

  private isWriteSessionSuperseded(session: PlaybackWriteSession): boolean {
    return Boolean(session.targetKey && this.latestWriteGeneration.get(session.targetKey) !== session.generation);
  }

  private cancelWriteSession(session: PlaybackWriteSession): void {
    session.cancelled = true;
    session.pending = undefined;
    session.failed = undefined;
    session.retryHead = undefined;
    if (!session.inFlight) this.writeSessions.delete(session);
  }

  private clearSaveFailure(session: PlaybackWriteSession): void {
    if (this.failedSaveSession !== session) return;
    this.failedSaveSession = undefined;
    this.state.errorMessage = '';
    this.state.saveRetryAvailable = false;
    this.state.saveRetryInFlight = false;
    // Clearing ownership means the retry finalizer can no longer publish this
    // transition. Notify subscribers here, together with the state mutation.
    this.emit();
  }

  private emit(): void {
    const snapshot = this.snapshot();
    this.listeners.forEach((listener) => listener(snapshot));
  }
}

function mergeWriteIntents(
  current: PlaybackWriteIntent | undefined,
  next: PlaybackWriteIntent
): PlaybackWriteIntent {
  if (!current) return { ...next };
  if (current.completed) return current;
  if (next.completed) return { ...next, terminal: true };
  if (current.terminal && !next.terminal) return current;
  return { ...next, terminal: current.terminal || next.terminal };
}

function sameIntent(left: PlaybackWriteIntent, right: PlaybackWriteIntent): boolean {
  return left.currentTime === right.currentTime
    && left.completed === right.completed
    && left.terminal === right.terminal;
}

function positiveDeadline(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function remainingSeconds(deadline: number | null, now: number): number {
  return deadline ? Math.max(0, Math.ceil((deadline - now) / 1000)) : 0;
}

function clampTime(value: unknown, duration: number): number {
  const number = Number(value);
  const safe = Number.isFinite(number) ? Math.max(0, number) : 0;
  return Math.min(Math.max(0, duration || 0), safe);
}
