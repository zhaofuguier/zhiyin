export const sceneTaxonomy = {
  schemaVersion: 1,
  contentForms: [
    { id: 'silent-companion', name: '无声陪伴', audioRequired: false, loopVideoRequired: true },
    { id: 'instrumental-music', name: '功能性纯音乐', audioRequired: true, loopVideoRequired: false },
    { id: 'nature-sound', name: '自然环境声', audioRequired: true, loopVideoRequired: false },
    { id: 'steady-noise', name: '稳定噪声', audioRequired: true, loopVideoRequired: false },
    { id: 'guided-audio', name: '引导音频', audioRequired: true, loopVideoRequired: false }
  ],
  primaryScenes: [
    { id: 'study-focus', name: '学习专注', order: 1, children: [
      { id: 'silent-study', name: '无声陪学', order: 1, contentForm: 'silent-companion' },
      { id: 'light-focus', name: '轻音专注', order: 2, contentForm: 'instrumental-music' },
      { id: 'chinese-study', name: '国风静学', order: 3, contentForm: 'instrumental-music' },
      { id: 'immersive-focus', name: '沉浸专注', order: 4, contentForm: 'instrumental-music' },
      { id: 'focus-guidance', name: '专注引导', order: 5, contentForm: 'guided-audio' }
    ] },
    { id: 'deep-work', name: '工作阅读', order: 2, children: [
      { id: 'silent-work', name: '无声办公', order: 1, contentForm: 'silent-companion' },
      { id: 'light-jazz-work', name: '轻爵办公', order: 2, contentForm: 'instrumental-music' },
      { id: 'piano-reading', name: '钢琴阅读', order: 3, contentForm: 'instrumental-music' },
      { id: 'classical-reading', name: '古典阅读', order: 4, contentForm: 'instrumental-music' },
      { id: 'work-guidance', name: '工作引导', order: 5, contentForm: 'guided-audio' }
    ] },
    { id: 'sleep-aid', name: '睡前助眠', order: 3, children: [
      { id: 'soft-sleep', name: '轻音助眠', order: 1, contentForm: 'instrumental-music' },
      { id: 'nature-sleep', name: '自然入睡', order: 2, contentForm: 'nature-sound' },
      { id: 'steady-noise-sleep', name: '白噪助眠', order: 3, contentForm: 'steady-noise' },
      { id: 'sleep-meditation', name: '睡前冥想', order: 4, contentForm: 'guided-audio' }
    ] },
    { id: 'relax-recovery', name: '放松休息', order: 4, children: [
      { id: 'soothing-music', name: '舒缓轻音', order: 1, contentForm: 'instrumental-music' },
      { id: 'nature-relaxation', name: '自然放松', order: 2, contentForm: 'nature-sound' },
      { id: 'breathing-relaxation', name: '呼吸放松', order: 3, contentForm: 'guided-audio' },
      { id: 'mindfulness', name: '正念冥想', order: 4, contentForm: 'guided-audio' }
    ] },
    { id: 'late-night', name: '深夜陪伴', order: 5, children: [
      { id: 'late-night-music', name: '深夜轻音', order: 1, contentForm: 'instrumental-music' },
      { id: 'rainy-night', name: '雨夜陪伴', order: 2, contentForm: 'nature-sound' },
      { id: 'night-journey', name: '夜行氛围', order: 3, contentForm: 'instrumental-music' },
      { id: 'night-meditation', name: '夜间冥想', order: 4, contentForm: 'guided-audio' }
    ] },
    { id: 'nature-ambient', name: '自然氛围', order: 6, children: [
      { id: 'immersive-rain', name: '沉浸雨声', order: 1, contentForm: 'nature-sound' },
      { id: 'water-sounds', name: '海浪溪流', order: 2, contentForm: 'nature-sound' },
      { id: 'forest-morning', name: '森林晨声', order: 3, contentForm: 'nature-sound' },
      { id: 'mountain-breeze', name: '山野清风', order: 4, contentForm: 'nature-sound' }
    ] },
    { id: 'parent-child-sleep', name: '亲子睡前', order: 7, children: [
      { id: 'lullaby', name: '摇篮轻音', order: 1, contentForm: 'instrumental-music' },
      { id: 'nature-soothing', name: '自然哄睡', order: 2, contentForm: 'nature-sound' },
      { id: 'nap-music', name: '午睡轻音', order: 3, contentForm: 'instrumental-music' },
      { id: 'family-breathing', name: '亲子呼吸', order: 4, contentForm: 'guided-audio' },
      { id: 'family-meditation', name: '亲子冥想', order: 5, contentForm: 'guided-audio' }
    ] }
  ]
} as const;

export type ContentForm = (typeof sceneTaxonomy.contentForms)[number]['id'];
export type PrimarySceneId = (typeof sceneTaxonomy.primaryScenes)[number]['id'];
export type SecondarySceneId = (typeof sceneTaxonomy.primaryScenes)[number]['children'][number]['id'];

export interface ScenePlacementInput {
  primarySceneId: PrimarySceneId;
  secondarySceneId: SecondarySceneId;
  isPrimary: boolean;
  sortWeight: number;
  isFeatured: boolean;
}

export const contentFormValues = sceneTaxonomy.contentForms.map(({ id }) => id) as readonly ContentForm[];
export const primarySceneValues = sceneTaxonomy.primaryScenes.map(({ id }) => id) as readonly PrimarySceneId[];
export const secondarySceneValues = sceneTaxonomy.primaryScenes.flatMap(({ children }) =>
  children.map(({ id }) => id)) as readonly SecondarySceneId[];

export function isContentForm(value: unknown): value is ContentForm {
  return contentFormValues.some((item) => item === value);
}

export function findPrimaryScene(id: unknown) {
  return sceneTaxonomy.primaryScenes.find((item) => item.id === id);
}

export function findSecondaryScene(primarySceneId: unknown, secondarySceneId: unknown) {
  return findPrimaryScene(primarySceneId)?.children.find((item) => item.id === secondarySceneId);
}

export function validateScenePlacements(contentForm: unknown, value: unknown): string[] {
  if (!isContentForm(contentForm)) return ['CONTENT_FORM_INVALID'];
  if (!Array.isArray(value) || value.length < 1 || value.length > 4) return ['SCENE_PLACEMENTS_COUNT_INVALID'];
  const errors: string[] = [];
  const primaryIds = new Set<string>();
  const secondaryIds = new Set<string>();
  let primaryCount = 0;
  value.forEach((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      errors.push('SCENE_PLACEMENT_INVALID');
      return;
    }
    const item = raw as Record<string, unknown>;
    if (Object.keys(item).some((key) => !['primarySceneId', 'secondarySceneId', 'isPrimary', 'sortWeight', 'isFeatured'].includes(key)) ||
        typeof item.primarySceneId !== 'string' || typeof item.secondarySceneId !== 'string' ||
        typeof item.isPrimary !== 'boolean' || typeof item.isFeatured !== 'boolean' ||
        !Number.isSafeInteger(item.sortWeight)) {
      errors.push('SCENE_PLACEMENT_INVALID');
      return;
    }
    const secondary = findSecondaryScene(item.primarySceneId, item.secondarySceneId);
    if (!secondary) errors.push('SCENE_PLACEMENT_DIRECTORY_MISMATCH');
    else if (secondary.contentForm !== contentForm) errors.push('SCENE_PLACEMENT_CONTENT_FORM_MISMATCH');
    if (primaryIds.has(item.primarySceneId)) errors.push('SCENE_PLACEMENT_PRIMARY_SCENE_DUPLICATE');
    if (secondaryIds.has(item.secondarySceneId)) errors.push('SCENE_PLACEMENT_SECONDARY_DUPLICATE');
    primaryIds.add(item.primarySceneId);
    secondaryIds.add(item.secondarySceneId);
    if (item.isPrimary) primaryCount += 1;
  });
  if (primaryCount !== 1) errors.push('SCENE_PLACEMENT_PRIMARY_COUNT_INVALID');
  return [...new Set(errors)];
}

export function validateMusicSpaceClassification(contentForm: unknown, value: unknown): string[] {
  const hasContentForm = contentForm !== undefined && contentForm !== null;
  const hasPlacements = value !== undefined && value !== null &&
    (!Array.isArray(value) || value.length > 0);
  if (!hasContentForm && !hasPlacements) return [];
  if (!hasContentForm || !hasPlacements) return ['MUSIC_SPACE_SCENE_CLASSIFICATION_PARTIAL'];
  return validateScenePlacements(contentForm, value);
}

export function assertMusicSpaceClassification(contentForm: unknown, value: unknown): void {
  const errors = validateMusicSpaceClassification(contentForm, value);
  if (errors.length > 0) throw new TypeError(`MUSIC_SPACE_SCENE_CLASSIFICATION_INVALID:${errors.join(',')}`);
}

export function assertMusicSpaceClassificationRecord(value: object): void {
  const record = value as Record<string, unknown>;
  const hasContentForm = Object.prototype.hasOwnProperty.call(record, 'contentForm');
  const hasPlacements = Object.prototype.hasOwnProperty.call(record, 'scenePlacements');
  if (hasContentForm !== hasPlacements) {
    throw new TypeError('MUSIC_SPACE_SCENE_CLASSIFICATION_INVALID:MUSIC_SPACE_SCENE_CLASSIFICATION_PARTIAL');
  }
  assertMusicSpaceClassification(record.contentForm, record.scenePlacements);
}

export function assertSceneTaxonomyIntegrity(): void {
  if (sceneTaxonomy.primaryScenes.length !== 7 || secondarySceneValues.length !== 31 ||
      new Set(primarySceneValues).size !== 7 || new Set(secondarySceneValues).size !== 31 ||
      new Set(contentFormValues).size !== 5) throw new Error('SCENE_TAXONOMY_INTEGRITY_INVALID');
}
