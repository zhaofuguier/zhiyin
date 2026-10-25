export interface DisposableAudioContext {
  stop(): void;
  destroy(): void;
}

export interface ResettableVideoContext {
  pause(): void;
  seek(position: number): void;
}

export interface MediaReleaseHooks {
  recordProgress(): void;
  clearProgressTimer(): void;
  clearSleepTimer(): void;
  videoContext(): ResettableVideoContext | undefined;
}

export class MediaPlayerLifecycle<TAudio extends DisposableAudioContext> {
  private audioContext: TAudio | undefined;
  private suspended = false;

  get audio(): TAudio | undefined {
    return this.audioContext;
  }

  getOrCreateAudio(create: () => TAudio): TAudio {
    if (!this.audioContext) this.audioContext = create();
    this.suspended = false;
    return this.audioContext;
  }

  enterForeground(): void {
    this.suspended = false;
  }

  destroyAudio(): boolean {
    const current = this.audioContext;
    this.audioContext = undefined;
    if (!current) return false;
    current.stop();
    current.destroy();
    return true;
  }

  suspend(hooks: MediaReleaseHooks): boolean {
    if (this.suspended) return false;
    hooks.recordProgress();
    hooks.clearProgressTimer();
    hooks.clearSleepTimer();
    this.destroyAudio();
    const video = hooks.videoContext();
    if (video) {
      video.pause();
      video.seek(0);
    }
    this.suspended = true;
    return true;
  }
}
