import { IS_DEMO_MODE } from './config';
import { requestJson } from './network';
import { demoSceneConfigs } from '../demo/scene-configs';
import { requireSceneConfigList } from './response-contract';

export type SceneMode = 'normal' | 'student' | 'both';
export type SceneSort = 'featured' | 'latest' | 'hot';
export interface SceneConfig {
  id: string; name: string; mode: SceneMode; groupName: string; subtitle?: string; intro?: string;
  query: string; icon?: string; sortOrder: number; defaultSort: SceneSort; visibleSorts: SceneSort[];
  matchTags: string[]; status: 'enabled' | 'disabled'; showOnHome: boolean; showOnScenePage: boolean; showOnStudentPage: boolean;
}

export async function getSceneConfigs(mode?: SceneMode): Promise<SceneConfig[]> {
  const path = mode ? `/api/scene-configs?mode=${mode}` : '/api/scene-configs';
  let data: unknown;
  try {
    data = await requestJson<unknown>(path);
  } catch (error) {
    if (!IS_DEMO_MODE) throw error;
  }
  const source = data === undefined && IS_DEMO_MODE ? demoSceneConfigs : requireSceneConfigList(data);
  return source
    .filter((item) => item.status !== 'disabled')
    .filter((item) => !mode || item.mode === 'both' || item.mode === mode)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}
export async function getHomeScenes(): Promise<SceneConfig[]> {
  return (await getSceneConfigs()).filter((item) => item.showOnHome).slice(0, 6);
}
export async function getScenePageConfigs(): Promise<SceneConfig[]> {
  return (await getSceneConfigs()).filter((item) => item.showOnScenePage);
}
export async function getStudentSceneConfigs(): Promise<SceneConfig[]> {
  return (await getSceneConfigs('student')).filter((item) => item.showOnStudentPage || item.mode === 'student').slice(0, 8);
}