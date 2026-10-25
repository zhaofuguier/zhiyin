import type { MusicSpace } from '../types/music-space';
import { getMusicSpaceDetail, normalizeMusicSpaceList } from './api';
import { API_BASE_URL } from './config';
import { requestAuthenticatedJson } from './network';
import {
  requireFavoriteState,
  requirePlayHistory,
  requirePlayRecordResult,
  requireReactionSummary,
  requireReactionToggleResult
} from './response-contract';

const FAVORITES_KEY = 'zhiyin.favoriteIds';
const HISTORY_KEY = 'zhiyin.playHistory';
const REACTIONS_KEY = 'zhiyin.reactions';
const DEFAULT_REACTIONS = ['我也在听', '适合专注', '今晚陪我', '适合入睡', '很放松'];

export interface PlayHistoryItem {
  musicSpaceId: string;
  title?: string;
  coverImageUrl?: string;
  currentTime: number;
  durationSeconds: number;
  playedAt: string;
}

export interface ReactionSummaryItem {
  label: string;
  count: number;
  reacted: boolean;
}

export async function getFavoriteSpaces(): Promise<MusicSpace[]> {
  if (API_BASE_URL) {
    return normalizeMusicSpaceList(await requestAuthenticatedJson<MusicSpace[]>('/api/user-activity/favorites'));
  }
  const spaces = await Promise.all(getLocalFavoriteIds().map((id) => getMusicSpaceDetail(id)));
  return spaces.filter((space): space is MusicSpace => Boolean(space));
}

export async function isFavoriteSpace(id: string): Promise<boolean> {
  if (API_BASE_URL) {
    const remote = await requestAuthenticatedJson<unknown>(
      `/api/user-activity/favorites/${encodeURIComponent(id)}`
    );
    return requireFavoriteState(remote);
  }
  return getLocalFavoriteIds().includes(id);
}

export async function toggleFavoriteSpace(space: MusicSpace): Promise<boolean> {
  if (API_BASE_URL) {
    const remote = await requestAuthenticatedJson<unknown>(
      `/api/user-activity/favorites/${encodeURIComponent(space.id)}/toggle`, { method: 'POST' }
    );
    return requireFavoriteState(remote);
  }
  const ids = getLocalFavoriteIds();
  const index = ids.indexOf(space.id);
  const isFavorite = index < 0;
  if (isFavorite) ids.unshift(space.id);
  else ids.splice(index, 1);
  uni.setStorageSync(FAVORITES_KEY, ids);
  return isFavorite;
}

export async function getPlayHistory(): Promise<PlayHistoryItem[]> {
  if (API_BASE_URL) {
    return normalizeHistory(await requestAuthenticatedJson<PlayHistoryItem[]>('/api/user-activity/history'));
  }
  return normalizeHistory(uni.getStorageSync(HISTORY_KEY) || []);
}

export async function getHistoryForSpace(musicSpaceId: string): Promise<PlayHistoryItem | undefined> {
  return (await getPlayHistory()).find((item) => item.musicSpaceId === musicSpaceId);
}

export async function recordPlayEvent(space: MusicSpace, currentTime: number, completed = false) {
  const safeTime = Math.max(0, Math.floor(currentTime || 0));
  const payload = { musicSpaceId: space.id, currentTime: safeTime, completed };
  if (API_BASE_URL) {
    const result = await requestAuthenticatedJson<unknown>('/api/user-activity/play-events', { method: 'POST', data: payload });
    requirePlayRecordResult(result);
    return;
  }

  const history = await getPlayHistory();
  const item: PlayHistoryItem = {
    musicSpaceId: space.id, title: space.title, coverImageUrl: space.coverImageUrl,
    currentTime: safeTime, durationSeconds: space.durationSeconds, playedAt: new Date().toISOString()
  };
  uni.setStorageSync(HISTORY_KEY, [
    item, ...history.filter((historyItem) => historyItem.musicSpaceId !== space.id)
  ].slice(0, 30));
}

export async function getReactionSummary(musicSpaceId: string): Promise<ReactionSummaryItem[]> {
  if (API_BASE_URL) {
    return requireReactionSummary(await requestAuthenticatedJson<unknown>(
      `/api/user-activity/reactions/${encodeURIComponent(musicSpaceId)}`
    ));
  }
  const selected = getLocalReactions()[musicSpaceId] || [];
  return DEFAULT_REACTIONS.map((label) => ({
    label, count: selected.includes(label) ? 1 : 0, reacted: selected.includes(label)
  }));
}

export async function toggleReaction(musicSpaceId: string, label: string): Promise<ReactionSummaryItem[]> {
  if (API_BASE_URL) {
    const remote = await requestAuthenticatedJson<unknown>(
      `/api/user-activity/reactions/${encodeURIComponent(musicSpaceId)}/toggle`,
      { method: 'POST', data: { label } }
    );
    return requireReactionToggleResult(remote);
  }
  const local = getLocalReactions();
  const labels = local[musicSpaceId] || [];
  const index = labels.indexOf(label);
  if (index < 0) labels.push(label);
  else labels.splice(index, 1);
  local[musicSpaceId] = labels;
  uni.setStorageSync(REACTIONS_KEY, local);
  return getReactionSummary(musicSpaceId);
}

export async function getLastPlayedSpace(): Promise<{ space?: MusicSpace; history?: PlayHistoryItem }> {
  const first = (await getPlayHistory())[0];
  if (first) return { space: await getMusicSpaceDetail(first.musicSpaceId), history: first };
  return {};
}

function normalizeHistory(history: unknown): PlayHistoryItem[] {
  return requirePlayHistory(history)
    .filter((item) => item.musicSpaceId)
    .map((item) => ({
      ...item,
      currentTime: Math.max(0, Math.floor(item.currentTime || 0)),
      durationSeconds: Math.max(0, Math.floor(item.durationSeconds || 0))
    }));
}

function getLocalFavoriteIds(): string[] {
  return uni.getStorageSync(FAVORITES_KEY) || [];
}

function getLocalReactions(): Record<string, string[]> {
  return uni.getStorageSync(REACTIONS_KEY) || {};
}

export function clearCachedUserActivity(): void {
  uni.removeStorageSync(FAVORITES_KEY);
  uni.removeStorageSync(HISTORY_KEY);
  uni.removeStorageSync(REACTIONS_KEY);
}
