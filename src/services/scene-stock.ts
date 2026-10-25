import { sceneTaxonomy, type PrimarySceneId } from '../shared/scene-taxonomy.generated';
import type { MusicSpace } from '../types/music-space';
import { demoMusicSpaces } from '../demo/music-spaces';
import { getMusicSpacePage } from './api';
import { IS_DEMO_MODE } from './config';
import { sceneStockFromSpaces, type SceneStock } from './visible-catalog';

let cached: SceneStock | undefined;
let inflight: Promise<SceneStock> | undefined;

export function loadCatalogSceneStock(): Promise<SceneStock> {
  if (cached) return Promise.resolve(cached);
  if (inflight) return inflight;
  inflight = resolveSceneStock().then((stock) => {
    cached = stock;
    inflight = undefined;
    return stock;
  }, (error: unknown) => {
    inflight = undefined;
    throw error;
  });
  return inflight;
}

async function resolveSceneStock(): Promise<SceneStock> {
  if (IS_DEMO_MODE) return sceneStockFromSpaces(demoMusicSpaces);
  const primaryIds = new Set<PrimarySceneId>();
  const secondaryKeys = new Set<string>();
  const unknownPrimaryIds = new Set<PrimarySceneId>();
  await Promise.all(sceneTaxonomy.primaryScenes.map(async (scene) => {
    try {
      const page = await getMusicSpacePage({ primarySceneId: scene.id, page: 1, pageSize: 20, sort: 'featured' });
      absorb(scene.id, page.items, primaryIds, secondaryKeys);
    } catch {
      unknownPrimaryIds.add(scene.id);
    }
  }));
  return { ready: true, primaryIds, secondaryKeys, unknownPrimaryIds };
}

function absorb(
  primarySceneId: PrimarySceneId,
  spaces: MusicSpace[],
  primaryIds: Set<PrimarySceneId>,
  secondaryKeys: Set<string>
) {
  const stock = sceneStockFromSpaces(spaces);
  if (!stock.primaryIds.has(primarySceneId)) return;
  primaryIds.add(primarySceneId);
  for (const key of stock.secondaryKeys) {
    if (key.startsWith(`${primarySceneId}:`)) secondaryKeys.add(key);
  }
}
