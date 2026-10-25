import type { MusicSpace } from '../types/music-space';
import {
  findPrimaryScene,
  findSecondaryScene,
  type PrimarySceneId
} from '../shared/scene-taxonomy.generated.ts';
import { contentExperience, hasVisibleContentForm } from './content-experience.ts';

export interface SceneStock {
  ready: boolean;
  primaryIds: ReadonlySet<PrimarySceneId>;
  secondaryKeys: ReadonlySet<string>;
  unknownPrimaryIds: ReadonlySet<PrimarySceneId>;
}

export function sceneStockFromSpaces(spaces: readonly MusicSpace[]): SceneStock {
  const primaryIds = new Set<PrimarySceneId>();
  const secondaryKeys = new Set<string>();
  for (const space of spaces) {
    if (!hasVisibleContentForm(space)) continue;
    for (const placement of space.scenePlacements || []) {
      const secondary = findSecondaryScene(placement.primarySceneId, placement.secondarySceneId);
      if (!secondary || secondary.contentForm !== space.contentForm) continue;
      primaryIds.add(placement.primarySceneId);
      secondaryKeys.add(`${placement.primarySceneId}:${placement.secondarySceneId}`);
    }
  }
  return { ready: true, primaryIds, secondaryKeys, unknownPrimaryIds: new Set() };
}

/** Scene name · content form. Empty when the space must not be shown. */
export function sceneFormCaption(space: Pick<MusicSpace, 'contentForm' | 'scenePlacements' | 'primarySceneLabel'>): string {
  if (!hasVisibleContentForm(space)) return '';
  const form = contentExperience(space.contentForm).label;
  const placement = space.scenePlacements?.find((item) => item.isPrimary) || space.scenePlacements?.[0];
  const sceneName = placement ? findPrimaryScene(placement.primarySceneId)?.name : undefined;
  const scene = sceneName || space.primarySceneLabel || '';
  return scene ? `${scene} · ${form}` : form;
}
