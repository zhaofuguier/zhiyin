import type { ContentForm, ScenePlacementInput } from '../shared/scene-taxonomy.generated';

export type VisualType = 'image' | 'motion';
export type ThemeMode = 'light' | 'dark' | 'auto';

export interface MusicSpace {
  id: string;
  title: string;
  subtitle?: string;
  atmosphereText: string;
  durationSeconds: number;
  audioUrl: string;
  coverImageUrl: string;
  motionVideoUrl?: string;
  visualType: VisualType;
  contentForm?: ContentForm;
  scenePlacements?: ScenePlacementInput[];
  classificationStatus?: 'confirmed' | 'pending-reclassification';
  primarySceneLabel?: string;
  alsoSuitableLabels?: string[];
  category: string;
  tags: string[];
  isFeatured: boolean;
  isMemberOnly: boolean;
  isFavorite?: boolean;
  recommendationWeight?: number;
  playCount?: number;
  favoriteCount?: number;
  completionRate?: number;
  updatedAt?: string;
}
