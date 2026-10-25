import type { MusicSpace } from './music-space';

export interface MusicSpacePage {
  items: MusicSpace[];
  page: number;
  pageSize: number;
  hasMore: boolean;
}
