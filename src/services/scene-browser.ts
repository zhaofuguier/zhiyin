import {
  findPrimaryScene,
  findSecondaryScene,
  type PrimarySceneId,
  type SecondarySceneId
} from '../shared/scene-taxonomy.generated';
import type { MusicSpace } from '../types/music-space';
import type { MusicSpaceSort } from './api';
import type { MusicSpacePage } from '../types/music-space-page';

const SCENE_SELECTION_KEY = 'zhiyin.sceneSelection';
const validSorts: readonly MusicSpaceSort[] = ['featured', 'latest', 'hot'];

export interface SceneSelection {
  primarySceneId: PrimarySceneId;
  secondarySceneId?: SecondarySceneId;
  sort: MusicSpaceSort;
}

export interface SceneQueryDependencies {
  getPrimary(primarySceneId: PrimarySceneId, sort: MusicSpaceSort): Promise<MusicSpace[]>;
  getSecondary(
    primarySceneId: PrimarySceneId,
    secondarySceneId: SecondarySceneId,
    sort: MusicSpaceSort
  ): Promise<MusicSpace[]>;
}

export type SceneQueryOutcome =
  | { state: 'loaded'; selection: SceneSelection; spaces: MusicSpace[] }
  | { state: 'error'; selection: SceneSelection; error: unknown }
  | { state: 'stale'; selection: SceneSelection };

export class LatestSceneQuery {
  private revision = 0;
  private readonly dependencies: SceneQueryDependencies;

  constructor(dependencies: SceneQueryDependencies) {
    this.dependencies = dependencies;
  }

  invalidate(): void {
    this.revision += 1;
  }

  async load(input: SceneSelection): Promise<SceneQueryOutcome> {
    const selection = requireSceneSelection(input);
    const revision = ++this.revision;
    try {
      const result = selection.secondarySceneId
        ? await this.dependencies.getSecondary(selection.primarySceneId, selection.secondarySceneId, selection.sort)
        : await this.dependencies.getPrimary(selection.primarySceneId, selection.sort);
      if (revision !== this.revision) return { state: 'stale', selection };
      return { state: 'loaded', selection, spaces: deduplicateMusicSpaces(result) };
    } catch (error) {
      if (revision !== this.revision) return { state: 'stale', selection };
      return { state: 'error', selection, error };
    }
  }
}

export type ScenePageOutcome =
  | { state: 'loaded'; selection: SceneSelection; result: MusicSpacePage }
  | { state: 'error'; selection: SceneSelection; page: number; error: unknown }
  | { state: 'stale'; selection: SceneSelection };

export class LatestScenePageQuery {
  private revision = 0;
  private pending?: { key: string; promise: Promise<ScenePageOutcome> };

  constructor(private readonly getPage: (input: SceneSelection & { page: number; pageSize: number }) => Promise<MusicSpacePage>) {}

  invalidate(): void { this.revision += 1; this.pending = undefined; }

  load(input: SceneSelection, page = 1): Promise<ScenePageOutcome> {
    const selection = requireSceneSelection(input);
    if (!Number.isInteger(page) || page < 1 || page > 1000) throw new Error('SCENE_PAGE_INVALID');
    const key = JSON.stringify([selection.primarySceneId, selection.secondarySceneId, selection.sort, page]);
    if (this.pending?.key === key) return this.pending.promise;
    const revision = ++this.revision;
    const promise = Promise.resolve().then(async (): Promise<ScenePageOutcome> => {
      if (revision !== this.revision) return { state: 'stale', selection };
      try {
        const result = await this.getPage({ ...selection, page, pageSize: 20 });
        if (revision !== this.revision) return { state: 'stale', selection };
        return { state: 'loaded', selection, result };
      } catch (error) {
        if (revision !== this.revision) return { state: 'stale', selection };
        return { state: 'error', selection, page, error };
      } finally {
        if (revision === this.revision) this.pending = undefined;
      }
    });
    this.pending = { key, promise };
    return promise;
  }
}

export function requireSceneSelection(value: unknown): SceneSelection {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('SCENE_SELECTION_INVALID');
  const record = value as Record<string, unknown>;
  const primary = findPrimaryScene(record.primarySceneId);
  if (!primary || !validSorts.includes(record.sort as MusicSpaceSort)) throw new TypeError('SCENE_SELECTION_INVALID');
  if (record.secondarySceneId !== undefined && !findSecondaryScene(primary.id, record.secondarySceneId)) {
    throw new TypeError('SCENE_SELECTION_INVALID');
  }
  return {
    primarySceneId: primary.id,
    secondarySceneId: record.secondarySceneId as SecondarySceneId | undefined,
    sort: record.sort as MusicSpaceSort
  };
}

export function saveSceneSelection(selection: SceneSelection): void {
  uni.setStorageSync(SCENE_SELECTION_KEY, requireSceneSelection(selection));
}

export function loadSceneSelection(): SceneSelection | undefined {
  try {
    const value = uni.getStorageSync(SCENE_SELECTION_KEY);
    return value ? requireSceneSelection(value) : undefined;
  } catch {
    uni.removeStorageSync(SCENE_SELECTION_KEY);
    return undefined;
  }
}

export function deduplicateMusicSpaces(spaces: MusicSpace[]): MusicSpace[] {
  const seen = new Set<string>();
  return spaces.filter((space) => {
    if (seen.has(space.id)) return false;
    seen.add(space.id);
    return true;
  });
}
