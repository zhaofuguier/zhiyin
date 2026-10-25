export interface GrowthLevelFields {
  growthLevel?: number;
  growthLevelName?: string;
}

export function normalizeGrowthLevelFields<T extends GrowthLevelFields>(profile: T): T & {
  growthLevel: number;
  growthLevelName: string;
} {
  const growthLevel = Number.isInteger(profile.growthLevel) && profile.growthLevel! >= 1 && profile.growthLevel! <= 10
    ? profile.growthLevel!
    : 1;
  const growthLevelName = profile.growthLevelName?.trim() || (growthLevel === 1 ? '初遇' : '');
  return { ...profile, growthLevel, growthLevelName };
}

export function growthLevelLabel(profile: GrowthLevelFields): string {
  const normalized = normalizeGrowthLevelFields(profile);
  return `L${normalized.growthLevel} ${normalized.growthLevelName}`.trim();
}
