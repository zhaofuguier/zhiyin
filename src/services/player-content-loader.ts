import type { MusicSpace } from '../types/music-space';
import type { OptionalPlayerPersonalResult } from './personal-content';

export interface PlayerContentLoaderDependencies {
  getDetail(id: string): Promise<MusicSpace | undefined>;
  getNext(id: string): Promise<MusicSpace[]>;
  getPersonal(space: MusicSpace): Promise<OptionalPlayerPersonalResult>;
}

export interface PlayerContentLoaderEffects {
  applyDetail(space: MusicSpace): void;
  applyNotFound(): void;
  applyError(error: unknown): void;
  applyNext(spaceId: string, spaces: MusicSpace[]): void;
  applyPersonal(spaceId: string, personal: OptionalPlayerPersonalResult): void;
}

export class PlayerContentLoader {
  private revision = 0;
  private readonly dependencies: PlayerContentLoaderDependencies;
  private readonly effects: PlayerContentLoaderEffects;

  constructor(
    dependencies: PlayerContentLoaderDependencies,
    effects: PlayerContentLoaderEffects
  ) {
    this.dependencies = dependencies;
    this.effects = effects;
  }

  invalidate(): void {
    this.revision += 1;
  }

  async load(id: string): Promise<'applied' | 'not-found' | 'error' | 'stale'> {
    const revision = ++this.revision;
    let space: MusicSpace | undefined;
    try {
      space = await this.dependencies.getDetail(id);
    } catch (error) {
      if (!this.isCurrent(revision)) return 'stale';
      this.effects.applyError(error);
      return 'error';
    }
    if (!this.isCurrent(revision)) return 'stale';
    if (!space) {
      this.effects.applyNotFound();
      return 'not-found';
    }

    this.effects.applyDetail(space);
    void this.loadNext(revision, space.id);
    void this.loadPersonal(revision, space);
    return 'applied';
  }

  private async loadNext(revision: number, spaceId: string): Promise<void> {
    try {
      const spaces = await this.dependencies.getNext(spaceId);
      if (this.isCurrent(revision)) this.effects.applyNext(spaceId, spaces);
    } catch {
      if (this.isCurrent(revision)) this.effects.applyNext(spaceId, []);
    }
  }

  private async loadPersonal(revision: number, space: MusicSpace): Promise<void> {
    let personal: OptionalPlayerPersonalResult;
    try {
      personal = await this.dependencies.getPersonal(space);
    } catch {
      return;
    }
    if (this.isCurrent(revision)) this.effects.applyPersonal(space.id, personal);
  }

  private isCurrent(revision: number): boolean {
    return revision === this.revision;
  }
}
