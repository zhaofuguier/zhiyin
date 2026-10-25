import type { CoListenPlatform, CoListenRoom } from './co-listen';

export interface CoListenPlaybackAction {
  seekTo?: number;
  playback: 'play' | 'pause' | 'none';
}

export function isCoListenOwner(room: CoListenRoom | undefined, selfParticipantId: string): boolean {
  return Boolean(room && selfParticipantId && room.ownerParticipantId === selfParticipantId);
}

export function resolveCoListenPlaybackAction(input: {
  localPosition: number;
  expectedPosition: number;
  localPlaying: boolean;
  remoteStatus: 'playing' | 'paused';
  audioArmed: boolean;
}): CoListenPlaybackAction {
  if (!input.audioArmed) return { playback: 'none' };
  const seekTo = Math.abs(input.localPosition - input.expectedPosition) > 2
    ? Math.max(0, input.expectedPosition) : undefined;
  const playback = input.remoteStatus === 'playing'
    ? (input.localPlaying ? 'none' : 'play')
    : (input.localPlaying ? 'pause' : 'none');
  return { ...(seekTo === undefined ? {} : { seekTo }), playback };
}

export function coListenNativeShare(platform: CoListenPlatform, input: {
  title: string;
  path: string;
  douyinTemplateId: string;
}): { title: string; path: string; templateId?: string } {
  if (platform === 'douyin') {
    if (!input.douyinTemplateId) throw new Error('CO_LISTEN_NATIVE_SHARE_NOT_CONFIGURED');
    return { title: input.title, path: input.path, templateId: input.douyinTemplateId };
  }
  return { title: input.title, path: input.path };
}

export const CO_LISTEN_HARD_LIMIT_WARNING = '本次一起听即将结束，可结束后重新发起。';

export function coListenHardLimitWarning(input: {
  room: CoListenRoom | undefined;
  selfParticipantId: string;
  now: number;
  alreadyShown: boolean;
}): { show: boolean; scheduleAfterMs?: number } {
  if (!input.room || input.alreadyShown || !isCoListenOwner(input.room, input.selfParticipantId)) return { show: false };
  const remaining = Date.parse(input.room.hardExpiresAt) - input.now;
  if (!Number.isFinite(remaining) || remaining <= 0) return { show: false };
  if (remaining <= 5 * 60 * 1000) return { show: true };
  return { show: false, scheduleAfterMs: remaining - 5 * 60 * 1000 };
}

export function coListenClosedMessage(value: unknown): string {
  const reason = value && typeof value === 'object' && !Array.isArray(value)
    ? (value as { reason?: unknown }).reason : undefined;
  if (reason === 'hard-limit') return '本次一起听已达到8小时上限';
  if (reason === 'owner-disconnected') return '房主离开时间过长，本次一起听已结束';
  if (reason === 'idle') return '房间已连续5分钟无人在线，本次一起听已结束';
  if (reason === 'owner-ended') return '房主已结束本次一起听';
  return '一起听房间已结束';
}
