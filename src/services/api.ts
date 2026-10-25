import type { MusicSpace } from '../types/music-space';
import type { SceneConfig } from './scene-configs';
import { getSafeCoverImage } from './assets';
import { ApiRequestError, requestJson } from './network';
import { IS_DEMO_MODE } from './config';
import { demoMusicSpaces } from '../demo/music-spaces';
import { ApiResponseContractError, requireMusicSpace, requireMusicSpaceList, requireMusicSpacePage } from './response-contract';
import type { MusicSpacePage } from '../types/music-space-page';
import {
  findPrimaryScene,
  findSecondaryScene,
  type ContentForm,
  type PrimarySceneId,
  type ScenePlacementInput,
  type SecondarySceneId
} from '../shared/scene-taxonomy.generated';

export type MusicSpaceSort = 'featured' | 'latest' | 'hot';

export interface MusicSpacePageQuery {
  page?: number;
  pageSize?: number;
  sort?: MusicSpaceSort;
  primarySceneId?: PrimarySceneId;
  secondarySceneId?: SecondarySceneId;
  featuredOnly?: boolean;
  keyword?: string;
}

export async function getMusicSpacePage(input: MusicSpacePageQuery = {}): Promise<MusicSpacePage> {
  const page = input.page ?? 1, pageSize = input.pageSize ?? 20, sort = input.sort ?? 'featured';
  if (!Number.isInteger(page) || page < 1 || page > 1000 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50 ||
      !['featured', 'latest', 'hot'].includes(sort) ||
      (input.primarySceneId !== undefined && !findPrimaryScene(input.primarySceneId)) ||
      (input.secondarySceneId !== undefined && (!input.primarySceneId || !findSecondaryScene(input.primarySceneId, input.secondarySceneId))) ||
      (input.featuredOnly !== undefined && typeof input.featuredOnly !== 'boolean') ||
      (input.keyword !== undefined && (typeof input.keyword !== 'string' || !input.keyword.trim() || input.keyword.length > 100 ||
        /[\u0000-\u001f\u007f]/u.test(input.keyword)))) throw new Error('MUSIC_SPACE_BROWSE_QUERY_INVALID');
  const params: Record<string, string> = { page: String(page), pageSize: String(pageSize), sort };
  if (input.primarySceneId) params.primarySceneId = input.primarySceneId;
  if (input.secondarySceneId) params.secondarySceneId = input.secondarySceneId;
  if (input.featuredOnly !== undefined) params.featuredOnly = String(input.featuredOnly);
  if (input.keyword !== undefined) params.keyword = input.keyword.trim();
  const path = '/api/music-spaces/browse?' + Object.entries(params).map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('&');
  const fallback = (): MusicSpacePage => {
    const filtered = demoMusicSpaces.filter((space) => (!input.keyword ||
      [space.title, space.subtitle, space.atmosphereText, space.category, ...space.tags]
        .some((field) => field?.toLowerCase().includes(input.keyword!.trim().toLowerCase()))) && (!input.featuredOnly || space.isFeatured) &&
      (!input.primarySceneId || space.scenePlacements?.some((placement) => placement.primarySceneId === input.primarySceneId &&
        (!input.secondarySceneId || placement.secondarySceneId === input.secondarySceneId))));
    const ordered = sortMusicSpaces(filtered, sort);
    return { items: ordered.slice((page - 1) * pageSize, page * pageSize), page, pageSize, hasMore: ordered.length > page * pageSize };
  };
  return requestWithFallback(path, fallback, (data) => {
    const result = requireMusicSpacePage(data, { page, pageSize });
    return { ...result, items: result.items.map((item) => normalizeMusicSpace(item as RemoteMusicSpace)) };
  });
}

export async function getHomeMusicPreview(): Promise<{ featured: MusicSpace[]; latest: MusicSpace[] }> {
  const [featured, latest] = await Promise.all([
    getMusicSpacePage({ pageSize: 6, featuredOnly: true }),
    getMusicSpacePage({ pageSize: 4, sort: 'latest' })
  ]);
  // Preserve the existing "no featured content -> global ranking" rule, still bounded.
  const recommended = featured.items.length ? featured : await getMusicSpacePage({ pageSize: 6 });
  return { featured: recommended.items, latest: latest.items };
}

const genericTags = new Set(['通用', '通用人群', '通用场景', '通用状态', '通用风格']);

export type RemoteMusicSpace = Partial<MusicSpace> & {
  primaryCategoryId?: string;
  primaryAudience?: string;
  primaryScene?: string;
  primaryGoal?: string;
  sortWeight?: number;
  isStudentFeatured?: boolean;
  contentForm?: ContentForm;
  scenePlacements?: ScenePlacementInput[];
};

async function requestWithFallback<T>(path: string, fallback: () => T | Promise<T>, normalize?: (data: unknown) => T): Promise<T> {
  try {
    const data = await requestJson<unknown>(path, { method: 'GET' });
    if (data !== undefined || !IS_DEMO_MODE) return normalize ? normalize(data) : data as T;
  } catch (error) {
    if (!IS_DEMO_MODE) throw error;
  }
  if (!IS_DEMO_MODE) throw new Error('PRODUCTION_RESPONSE_MISSING');
  return fallback();
}

function displayCategory(item: RemoteMusicSpace): string {
  const placement = item.scenePlacements?.find((candidate) => candidate.isPrimary);
  if (placement) return findSecondaryScene(placement.primarySceneId, placement.secondarySceneId)?.name || '音乐空间';
  const candidate = item.category || item.primaryScene || item.primaryGoal || item.primaryCategoryId || '';
  if (!candidate || genericTags.has(candidate)) return '音乐空间';
  return candidate;
}

export function normalizeMusicSpace(item: RemoteMusicSpace): MusicSpace {
  const primaryPlacement = item.scenePlacements?.find((placement) => placement.isPrimary);
  const primarySceneLabel = primaryPlacement
    ? findSecondaryScene(primaryPlacement.primarySceneId, primaryPlacement.secondarySceneId)?.name
    : undefined;
  const alsoSuitableLabels = item.scenePlacements?.filter((placement) => !placement.isPrimary)
    .map((placement) => findSecondaryScene(placement.primarySceneId, placement.secondarySceneId)?.name)
    .filter(Boolean) as string[] | undefined;
  return {
    id: String(item.id || ''),
    title: item.title || '未命名音乐空间',
    subtitle: item.subtitle,
    atmosphereText: item.atmosphereText || '',
    durationSeconds: item.durationSeconds || 0,
    audioUrl: item.audioUrl || '',
    coverImageUrl: getSafeCoverImage(item.coverImageUrl),
    motionVideoUrl: item.motionVideoUrl,
    visualType: item.visualType || 'image',
    contentForm: item.contentForm,
    scenePlacements: item.scenePlacements,
    classificationStatus: item.classificationStatus,
    primarySceneLabel,
    alsoSuitableLabels,
    category: displayCategory(item),
    tags: Array.isArray(item.tags) ? item.tags : ['通用'],
    isFeatured: Boolean(item.isFeatured),
    isMemberOnly: Boolean(item.isMemberOnly),
    isFavorite: item.isFavorite,
    recommendationWeight: item.recommendationWeight ?? item.sortWeight ?? 0,
    playCount: item.playCount || 0,
    favoriteCount: item.favoriteCount || 0,
    completionRate: item.completionRate || 0,
    updatedAt: item.updatedAt
  };
}

export function normalizeMusicSpaceList(data: unknown): MusicSpace[] {
  return requireMusicSpaceList(data).map((item) => normalizeMusicSpace(item as RemoteMusicSpace));
}

export function normalizeMusicSpaceDetail(data: unknown): MusicSpace {
  return normalizeMusicSpace(requireMusicSpace(data) as RemoteMusicSpace);
}

export async function getFeaturedMusicSpaces(): Promise<MusicSpace[]> {
  return requestWithFallback('/api/music-spaces/featured', () => sortMusicSpaces(demoMusicSpaces.filter((space) => space.isFeatured), 'featured'), normalizeMusicSpaceList);
}

export async function getAllMusicSpaces(): Promise<MusicSpace[]> {
  return requestWithFallback('/api/music-spaces', () => demoMusicSpaces, normalizeMusicSpaceList);
}

export async function getMusicSpacesByCategory(category: string): Promise<MusicSpace[]> {
  const fallback = () => demoMusicSpaces.filter((space) => matchesSpace(space, category));
  return requestWithFallback(`/api/music-spaces/scene/${encodeURIComponent(category)}`, fallback, normalizeMusicSpaceList);
}

export async function getMusicSpacesByPrimaryScene(primarySceneId: PrimarySceneId, sort: MusicSpaceSort = 'featured') {
  if (!findPrimaryScene(primarySceneId)) throw new Error('SCENE_PRIMARY_ID_INVALID');
  return requestWithFallback(`/api/music-spaces/categories/${primarySceneId}?sort=${sort}`, () => [], normalizeMusicSpaceList);
}

export async function getMusicSpacesBySecondaryScene(
  primarySceneId: PrimarySceneId,
  secondarySceneId: SecondarySceneId,
  sort: MusicSpaceSort = 'featured'
) {
  if (!findSecondaryScene(primarySceneId, secondarySceneId)) throw new Error('SCENE_SECONDARY_ID_INVALID');
  return requestWithFallback(`/api/music-spaces/categories/${primarySceneId}/${secondarySceneId}?sort=${sort}`, () => [], normalizeMusicSpaceList);
}

export async function getMusicSpacesBySceneConfig(config: SceneConfig, sort: MusicSpaceSort = 'featured'): Promise<MusicSpace[]> {
  const tags = buildSceneTags(config);
  const fallback = () => {
    const strictMatched = demoMusicSpaces.filter((space) => matchesAnySpecificSpace(space, tags));
    const matched = demoMusicSpaces.filter((space) => matchesAnySpace(space, tags));
    return sortMusicSpaces(strictMatched.length ? strictMatched : matched.length ? matched : demoMusicSpaces, sort);
  };

  return requestWithFallback(buildScenePath('scene', config, sort), fallback, normalizeMusicSpaceList);
}

export async function getStudentMusicSpacesBySceneConfig(config: SceneConfig, sort: MusicSpaceSort): Promise<MusicSpace[]> {
  const tags = buildSceneTags(config);
  const fallback = () => getStudentFallbackSpaces(tags, sort);
  return requestWithFallback(buildScenePath('student', config, sort), fallback, normalizeMusicSpaceList);
}
export function sortMusicSpaces(spaces: MusicSpace[], sort: MusicSpaceSort): MusicSpace[] {
  return [...spaces].sort((a, b) => {
    if (sort === 'latest') return new Date(b.updatedAt || '').getTime() - new Date(a.updatedAt || '').getTime();
    if (sort === 'hot') return hotScore(b) - hotScore(a);
    return (b.recommendationWeight || 0) - (a.recommendationWeight || 0) || hotScore(b) - hotScore(a);
  });
}

export async function getSceneMusicSpaces(scene: string, sort: MusicSpaceSort): Promise<MusicSpace[]> {
  const fallback = () => {
    const matched = demoMusicSpaces.filter((space) => matchesSpace(space, scene));
    return sortMusicSpaces(matched.length ? matched : demoMusicSpaces, sort);
  };

  return requestWithFallback(`/api/music-spaces/scene/${encodeURIComponent(scene)}?sort=${sort}`, fallback, normalizeMusicSpaceList);
}

export async function getStudentMusicSpaces(scene: string, sort: MusicSpaceSort): Promise<MusicSpace[]> {
  const fallback = () => {
    const pool = demoMusicSpaces.filter((space) => space.tags.includes('学生') || space.tags.some((tag) => genericTags.has(tag)));
    const exactStudentMatched = pool.filter((space) => space.tags.includes('学生') && matchesSpecificSpace(space, scene));
    const matched = pool.filter((space) => matchesSpace(space, scene));
    return sortMusicSpaces(exactStudentMatched.length ? exactStudentMatched : matched.length ? matched : pool, sort);
  };

  return requestWithFallback(`/api/music-spaces/student/${encodeURIComponent(scene)}?sort=${sort}`, fallback, normalizeMusicSpaceList);
}

export async function getNextMusicSpaces(currentId: string): Promise<MusicSpace[]> {
  const fallback = () => {
    const current = demoMusicSpaces.find((space) => space.id === currentId);
    if (!current) return sortMusicSpaces(demoMusicSpaces, 'featured').slice(0, 2);

    const related = demoMusicSpaces.filter((space) => {
      return space.id !== current.id && (
        space.category === current.category ||
        space.tags.some((tag) => !genericTags.has(tag) && current.tags.includes(tag)) ||
        space.tags.some((tag) => genericTags.has(tag))
      );
    });

    return sortMusicSpaces(related.length ? related : demoMusicSpaces.filter((space) => space.id !== current.id), 'featured').slice(0, 2);
  };

  return requestWithFallback(`/api/music-spaces/${encodeURIComponent(currentId)}/next?limit=2`, fallback, (data) => {
    const result = normalizeMusicSpaceList(data);
    if (result.length > 2 || new Set(result.map((item) => item.id)).size !== result.length || result.some((item) => item.id === currentId)) {
      throw new ApiResponseContractError('API_RESPONSE_CONTRACT_INVALID', 'recommendations');
    }
    return result;
  });
}

export async function searchMusicSpaces(keyword: string): Promise<MusicSpace[]> {
  const value = keyword.trim().toLowerCase();
  if (!value) return IS_DEMO_MODE ? demoMusicSpaces.filter((space) => space.isFeatured) : [];

  const fallback = () => demoMusicSpaces.filter((space) => {
    const text = [space.title, space.subtitle, space.atmosphereText, space.category, ...space.tags].join(' ').toLowerCase();
    return text.includes(value);
  });

  return requestWithFallback(`/api/music-spaces/search?keyword=${encodeURIComponent(keyword)}&sort=featured`, fallback, normalizeMusicSpaceList);
}

export async function getMusicSpaceDetail(id: string): Promise<MusicSpace | undefined> {
  try {
    return await requestWithFallback(
      `/api/music-spaces/${encodeURIComponent(id)}`,
      () => demoMusicSpaces.find((space) => space.id === id),
      normalizeMusicSpaceDetail
    );
  } catch (error) {
    if (!IS_DEMO_MODE && error instanceof ApiRequestError && error.statusCode === 404) return undefined;
    throw error;
  }
}

function buildSceneTags(config: SceneConfig): string[] {
  return Array.from(new Set([config.query, config.name, ...(config.matchTags || [])].filter(Boolean)));
}

function buildScenePath(prefix: 'scene' | 'student', config: SceneConfig, sort: MusicSpaceSort): string {
  const tags = buildSceneTags(config);
  const main = config.query || config.name;
  const params = [`sort=${sort}`];
  if (tags.length) params.push(`tags=${encodeURIComponent(tags.join(','))}`);
  return `/api/music-spaces/${prefix}/${encodeURIComponent(main)}?${params.join('&')}`;
}

function getStudentFallbackSpaces(tags: string[], sort: MusicSpaceSort): MusicSpace[] {
  const pool = demoMusicSpaces.filter((space) => space.tags.includes('学生') || space.tags.some((tag) => genericTags.has(tag)));
  const exactStudentMatched = pool.filter((space) => space.tags.includes('学生') && matchesAnySpecificSpace(space, tags));
  const matched = pool.filter((space) => matchesAnySpace(space, tags));
  return sortMusicSpaces(exactStudentMatched.length ? exactStudentMatched : matched.length ? matched : pool, sort);
}

function matchesSpace(space: MusicSpace, scene: string): boolean {
  return space.category === scene || space.tags.includes(scene) || space.tags.some((tag) => genericTags.has(tag));
}

function matchesSpecificSpace(space: MusicSpace, scene: string): boolean {
  return space.category === scene || space.tags.some((tag) => !genericTags.has(tag) && tag === scene);
}

function matchesAnySpace(space: MusicSpace, scenes: string[]): boolean {
  return scenes.some((scene) => matchesSpace(space, scene));
}

function matchesAnySpecificSpace(space: MusicSpace, scenes: string[]): boolean {
  return scenes.some((scene) => matchesSpecificSpace(space, scene));
}

function hotScore(space: MusicSpace): number {
  return (space.playCount || 0) + (space.favoriteCount || 0) * 4 + Math.round((space.completionRate || 0) * 1000);
}



