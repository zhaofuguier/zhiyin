import type { MusicSpace } from '../types/music-space';

export interface PlayerState {
  current?: MusicSpace;
  isPlaying: boolean;
  currentTime: number;
}

export function createInitialPlayerState(): PlayerState {
  return {
    isPlaying: false,
    currentTime: 0
  };
}

export function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

