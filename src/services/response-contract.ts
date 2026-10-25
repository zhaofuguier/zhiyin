import type { MusicSpace } from '../types/music-space';
import type { SceneConfig } from './scene-configs';
import type {
  MembershipOrder,
  MembershipPlan,
  SchoolSummary,
  UserEntitlements,
  UserProfile
} from './user';
import type { PlayHistoryItem, ReactionSummaryItem } from './user-activity';
import { validateScenePlacements } from '../shared/scene-taxonomy.generated';
import type { MusicSpacePage } from '../types/music-space-page';

export type ApiResponseContractErrorCode =
  | 'API_RESPONSE_CONTRACT_INVALID'
  | 'API_RESPONSE_REQUIRED_FIELD_MISSING';

export class ApiResponseContractError extends Error {
  constructor(readonly code: ApiResponseContractErrorCode, readonly field?: string) {
    super(code);
    this.name = 'ApiResponseContractError';
  }
}

export function requireMusicSpaceList(value: unknown): MusicSpace[] {
  return requireArray(value, 'musicSpaces').map((item, index) => requireMusicSpace(item, `musicSpaces[${index}]`));
}

export function requireMusicSpacePage(value: unknown, expected: { page: number; pageSize: number }): MusicSpacePage {
  const record = requireRecord(value, 'musicSpacePage');
  const page = requireInteger(record, 'page', 'musicSpacePage');
  const pageSize = requireInteger(record, 'pageSize', 'musicSpacePage');
  requireBoolean(record, 'hasMore', 'musicSpacePage');
  if (page !== expected.page || pageSize !== expected.pageSize || page < 1 || page > 1000 || pageSize < 1 || pageSize > 50) {
    invalid('musicSpacePage.pagination');
  }
  const items = requireMusicSpaceList(record.items);
  if (items.length > pageSize || (record.hasMore && items.length !== pageSize) || new Set(items.map((item) => item.id)).size !== items.length) {
    invalid('musicSpacePage.items');
  }
  return { items, page, pageSize, hasMore: record.hasMore as boolean };
}

export function requireMusicSpace(value: unknown, field = 'musicSpace'): MusicSpace {
  const item = requireRecord(value, field);
  requireNonBlankString(item, 'id', field);
  requireNonBlankString(item, 'title', field);
  requireString(item, 'atmosphereText', field);
  requireNonNegativeNumber(item, 'durationSeconds', field);
  requireString(item, 'audioUrl', field);
  requireString(item, 'coverImageUrl', field);
  requireEnum(item, 'visualType', ['image', 'motion'] as const, field);
  requireStringArray(item, 'tags', field);
  requireBoolean(item, 'isFeatured', field);
  requireBoolean(item, 'isMemberOnly', field);
  optionalNumber(item, 'playCount', field);
  optionalNumber(item, 'favoriteCount', field);
  optionalNumber(item, 'completionRate', field);
  if ((item.contentForm !== undefined || item.scenePlacements !== undefined) &&
      validateScenePlacements(item.contentForm, item.scenePlacements).length > 0) invalid(field);
  return item as unknown as MusicSpace;
}

export function requireSceneConfigList(value: unknown): SceneConfig[] {
  return requireArray(value, 'sceneConfigs').map((item, index) => {
    const field = `sceneConfigs[${index}]`;
    const record = requireRecord(item, field);
    requireNonBlankString(record, 'id', field);
    requireNonBlankString(record, 'name', field);
    requireNonBlankString(record, 'query', field);
    requireString(record, 'groupName', field);
    requireEnum(record, 'mode', ['normal', 'student', 'both'] as const, field);
    requireEnum(record, 'status', ['enabled', 'disabled'] as const, field);
    requireInteger(record, 'sortOrder', field);
    requireEnum(record, 'defaultSort', ['featured', 'latest', 'hot'] as const, field);
    requireEnumArray(record, 'visibleSorts', ['featured', 'latest', 'hot'] as const, field);
    requireStringArray(record, 'matchTags', field);
    requireBoolean(record, 'showOnHome', field);
    requireBoolean(record, 'showOnScenePage', field);
    requireBoolean(record, 'showOnStudentPage', field);
    return record as unknown as SceneConfig;
  });
}

export function requireUserProfile(value: unknown, field = 'user'): UserProfile {
  const record = requireRecord(value, field);
  requireNonBlankString(record, 'id', field);
  requireEnum(record, 'mode', ['normal', 'student'] as const, field);
  requireEnum(record, 'memberLevel', ['free', 'plus', 'pro'] as const, field);
  if (hasValue(record, 'growthLevel')) {
    const level = requireInteger(record, 'growthLevel', field);
    if (level < 1 || level > 10) invalid(`${field}.growthLevel`);
  }
  optionalString(record, 'growthLevelName', field);
  if (hasValue(record, 'ageBand')) requireEnum(record, 'ageBand', ['unknown', 'adult', 'minor-14-17'] as const, field);
  if (hasValue(record, 'minorMode')) requireBoolean(record, 'minorMode', field);
  return record as unknown as UserProfile;
}

export function requireSchoolList(value: unknown): SchoolSummary[] {
  return requireArray(value, 'schools').map((item, index) => requireSchoolSummary(item, `schools[${index}]`));
}

export function requireSchoolSummary(value: unknown, field = 'schoolSummary'): SchoolSummary {
  const record = requireRecord(value, field);
  requireString(record, 'name', field);
  requireNonNegativeNumber(record, 'studentCount', field);
  requireNonNegativeNumber(record, 'ambassadorCount', field);
  requireNonNegativeNumber(record, 'appliedCount', field);
  return record as unknown as SchoolSummary;
}

export function requireMembershipPlanList(value: unknown): MembershipPlan[] {
  return requireArray(value, 'membershipPlans').map((item, index) => {
    const field = `membershipPlans[${index}]`;
    const record = requireRecord(item, field);
    requireEnum(record, 'level', ['plus', 'pro'] as const, field);
    requireNonBlankString(record, 'name', field);
    requireNonNegativeNumber(record, 'priceCents', field);
    requireEnum(record, 'period', ['month', 'year'] as const, field);
    requireStringArray(record, 'benefits', field);
    return record as unknown as MembershipPlan;
  });
}

export function requireUserEntitlements(value: unknown): UserEntitlements {
  const record = requireRecord(value, 'entitlements');
  requireNonBlankString(record, 'userId', 'entitlements');
  requireEnum(record, 'memberLevel', ['free', 'plus', 'pro'] as const, 'entitlements');
  requireBoolean(record, 'canPlayMemberOnly', 'entitlements');
  requireBoolean(record, 'canUseMotionPremium', 'entitlements');
  requireBoolean(record, 'canDownload', 'entitlements');
  return record as unknown as UserEntitlements;
}

export function requireMembershipOrder(value: unknown): MembershipOrder {
  const record = requireRecord(value, 'membershipOrder');
  requireNonBlankString(record, 'id', 'membershipOrder');
  requireNonBlankString(record, 'userId', 'membershipOrder');
  requireEnum(record, 'planLevel', ['plus', 'pro'] as const, 'membershipOrder');
  requireNonBlankString(record, 'planName', 'membershipOrder');
  requireNonNegativeNumber(record, 'amountCents', 'membershipOrder');
  requireEnum(record, 'status', ['pending', 'paid', 'closed'] as const, 'membershipOrder');
  requireEnum(record, 'paymentProvider', ['mock', 'douyin', 'wechat'] as const, 'membershipOrder');
  requireNonBlankString(record, 'createdAt', 'membershipOrder');
  optionalString(record, 'paidAt', 'membershipOrder');
  return record as unknown as MembershipOrder;
}

export function requireFavoriteState(value: unknown): boolean {
  const record = requireRecord(value, 'favoriteState');
  return requireBoolean(record, 'isFavorite', 'favoriteState');
}

export function requirePlayHistory(value: unknown): PlayHistoryItem[] {
  return requireArray(value, 'playHistory').map((item, index) => requirePlayHistoryItem(item, `playHistory[${index}]`));
}

export function requirePlayRecordResult(value: unknown): void {
  const record = requireRecord(value, 'playRecord');
  const recorded = requireBoolean(record, 'recorded', 'playRecord');
  if (recorded) requirePlayHistoryItem(required(record, 'item', 'playRecord'), 'playRecord.item');
}

export function requireReactionSummary(value: unknown): ReactionSummaryItem[] {
  return requireArray(value, 'reactionSummary').map((item, index) => {
    const field = `reactionSummary[${index}]`;
    const record = requireRecord(item, field);
    requireNonBlankString(record, 'label', field);
    requireNonNegativeNumber(record, 'count', field);
    requireBoolean(record, 'reacted', field);
    return record as unknown as ReactionSummaryItem;
  });
}

export function requireReactionToggleResult(value: unknown): ReactionSummaryItem[] {
  const record = requireRecord(value, 'reactionToggle');
  return requireReactionSummary(required(record, 'summary', 'reactionToggle'));
}

export function requirePaymentConfirmation(value: unknown): UserProfile {
  const record = requireRecord(value, 'paymentConfirmation');
  requireMembershipOrder(required(record, 'order', 'paymentConfirmation'));
  return requireUserProfile(required(record, 'user', 'paymentConfirmation'), 'paymentConfirmation.user');
}

function requirePlayHistoryItem(value: unknown, field: string): PlayHistoryItem {
  const record = requireRecord(value, field);
  requireNonBlankString(record, 'musicSpaceId', field);
  requireNonNegativeNumber(record, 'currentTime', field);
  requireNonNegativeNumber(record, 'durationSeconds', field);
  requireNonBlankString(record, 'playedAt', field);
  optionalString(record, 'title', field);
  optionalString(record, 'coverImageUrl', field);
  return record as unknown as PlayHistoryItem;
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalid(field);
  return value as Record<string, unknown>;
}
function requireArray(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) invalid(field);
  return value;
}
function required(record: Record<string, unknown>, key: string, field: string): unknown {
  if (!Object.prototype.hasOwnProperty.call(record, key) || record[key] === undefined) missing(`${field}.${key}`);
  return record[key];
}
function requireString(record: Record<string, unknown>, key: string, field: string): string {
  const value = required(record, key, field);
  if (typeof value !== 'string') invalid(`${field}.${key}`);
  return value;
}
function requireNonBlankString(record: Record<string, unknown>, key: string, field: string): string {
  const value = requireString(record, key, field);
  if (!value.trim()) invalid(`${field}.${key}`);
  return value;
}
function requireNonNegativeNumber(record: Record<string, unknown>, key: string, field: string): number {
  const value = required(record, key, field);
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) invalid(`${field}.${key}`);
  return value;
}
function requireInteger(record: Record<string, unknown>, key: string, field: string): number {
  const value = required(record, key, field);
  if (typeof value !== 'number' || !Number.isInteger(value)) invalid(`${field}.${key}`);
  return value;
}
function requireBoolean(record: Record<string, unknown>, key: string, field: string): boolean {
  const value = required(record, key, field);
  if (typeof value !== 'boolean') invalid(`${field}.${key}`);
  return value;
}
function requireStringArray(record: Record<string, unknown>, key: string, field: string): string[] {
  const value = required(record, key, field);
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) invalid(`${field}.${key}`);
  return value as string[];
}
function requireEnum<T extends string>(record: Record<string, unknown>, key: string, values: readonly T[], field: string): T {
  const value = required(record, key, field);
  if (typeof value !== 'string' || !values.includes(value as T)) invalid(`${field}.${key}`);
  return value as T;
}
function requireEnumArray<T extends string>(record: Record<string, unknown>, key: string, values: readonly T[], field: string): T[] {
  const value = required(record, key, field);
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !values.includes(item as T))) {
    invalid(`${field}.${key}`);
  }
  return value as T[];
}
function optionalString(record: Record<string, unknown>, key: string, field: string): void {
  if (hasValue(record, key) && typeof record[key] !== 'string') invalid(`${field}.${key}`);
}
function optionalNumber(record: Record<string, unknown>, key: string, field: string): void {
  if (hasValue(record, key) && (typeof record[key] !== 'number' || !Number.isFinite(record[key]))) invalid(`${field}.${key}`);
}
function hasValue(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key) && record[key] !== undefined;
}
function invalid(field: string): never {
  throw new ApiResponseContractError('API_RESPONSE_CONTRACT_INVALID', field);
}
function missing(field: string): never {
  throw new ApiResponseContractError('API_RESPONSE_REQUIRED_FIELD_MISSING', field);
}
