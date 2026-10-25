import {
  SingleAudioCoordinator,
  type SingleAudioAdapter,
  type SingleAudioDependencies
} from './single-audio-coordinator-core';
import { recordPlayEventForSession } from './personal-content';
import { captureSessionScope, isSessionScopeCurrent, sessionScopeWriteKey } from './session-scope';

const TIMER_STORAGE_KEY = 'zhiyin.singleAudioSleepDeadlineAt';
let singleton: SingleAudioCoordinator | undefined;

export * from './single-audio-coordinator-core';

export function getSingleAudioCoordinator(): SingleAudioCoordinator {
  if (!singleton) singleton = new SingleAudioCoordinator(createRuntimeDependencies());
  return singleton;
}

function createRuntimeDependencies(): SingleAudioDependencies {
  return {
    createAudio: () => uni.createInnerAudioContext() as SingleAudioAdapter,
    captureSessionScope,
    isSessionScopeCurrent,
    writeTargetKey: (scope, space) => {
      const identityKey = sessionScopeWriteKey(scope);
      return identityKey ? `${identityKey.length}:${identityKey}${space.id.length}:${space.id}` : undefined;
    },
    recordPlay: recordPlayEventForSession,
    now: () => Date.now(),
    setInterval: (callback, delay) => setInterval(callback, delay),
    clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
    readDeadline: () => positiveDeadline(uni.getStorageSync(TIMER_STORAGE_KEY)),
    writeDeadline: (value) => {
      if (value) uni.setStorageSync(TIMER_STORAGE_KEY, value);
      else uni.removeStorageSync(TIMER_STORAGE_KEY);
    }
  };
}

function positiveDeadline(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}
