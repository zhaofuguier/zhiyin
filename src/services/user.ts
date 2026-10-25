import { API_BASE_URL, IS_DEMO_MODE } from './config';
import { normalizeGrowthLevelFields } from '../domain/growth-level';
import { requestAuthenticatedJson, requestJson, markStale } from './network';
import {
  createDemoOrder,
  getDemoEntitlements,
  getDemoMembershipPlans,
  getDemoSchoolOptions,
  getDemoSchoolSummary,
  getDemoUser
} from '../demo/business-data';
import {
  requireMembershipOrder,
  requireMembershipPlanList,
  requireSchoolList,
  requireSchoolSummary,
  requireUserEntitlements,
  requireUserProfile
} from './response-contract';
import { captureSessionScope, isSessionScopeCurrent } from './session-scope';

const USER_PROFILE_KEY = 'zhiyin.userProfile';

export interface UserProfile {
  id: string;
  nickname?: string;
  avatarUrl?: string;
  phoneNumber?: string;
  schoolName?: string;
  studyGoal?: string;
  ambassadorStatus?: 'none' | 'interested' | 'applied' | 'approved';
  ambassadorTitle?: string;
  mode: 'normal' | 'student';
  memberLevel: 'free' | 'plus' | 'pro';
  growthLevel?: number;
  growthLevelName?: string;
  ageBand?: 'unknown' | 'adult' | 'minor-14-17';
  minorMode?: boolean;
}
export type EditableUserProfile = Pick<UserProfile,
  'nickname' | 'avatarUrl' | 'phoneNumber' | 'schoolName' | 'studyGoal' | 'ambassadorStatus' | 'mode'
>;
export interface MembershipPlan {
  level: 'plus' | 'pro'; name: string; priceCents: number; period: 'month' | 'year'; benefits: string[];
}
export interface UserEntitlements {
  userId: string; memberLevel: 'free' | 'plus' | 'pro'; canPlayMemberOnly: boolean; canUseMotionPremium: boolean; canDownload: boolean;
}
export interface SchoolSummary { name: string; studentCount: number; ambassadorCount: number; appliedCount: number; }
export interface MembershipOrder {
  id: string; userId: string; planLevel: 'plus' | 'pro'; planName: string; amountCents: number;
  status: 'pending' | 'paid' | 'closed'; paymentProvider: 'mock' | 'douyin' | 'wechat'; createdAt: string; paidAt?: string;
}

export async function getCurrentUser(): Promise<UserProfile> {
  const cached = uni.getStorageSync(USER_PROFILE_KEY) as UserProfile | undefined;
  if (cached?.id) {
    if (API_BASE_URL) syncCurrentUser().catch(() => markStale());
    return normalizeGrowthLevelFields(cached);
  }
  return syncCurrentUser();
}
export async function refreshCurrentUser(): Promise<UserProfile> { return syncCurrentUser(); }

export async function updateLocalUserProfile(profile: Partial<EditableUserProfile>): Promise<UserProfile> {
  if (!API_BASE_URL) {
    ensureDemoMode();
    const current = await getCurrentUser();
    const next = normalizeGrowthLevelFields({ ...current, ...profile });
    uni.setStorageSync(USER_PROFILE_KEY, next);
    return next;
  }
  const scope = captureSessionScope();
  const remote = await requestAuthenticatedJson<unknown>('/api/users/me/profile', { method: 'PATCH', data: profile });
  const next = normalizeGrowthLevelFields(requireUserProfile(remote));
  assertCurrentUserScope(scope);
  return cacheCurrentUserProfile(next);
}
export async function getSchoolSummary(schoolName: string): Promise<SchoolSummary> {
  const name = schoolName.trim();
  if (!name) return { name: '', studentCount: 0, ambassadorCount: 0, appliedCount: 0 };
  if (!API_BASE_URL) { ensureDemoMode(); return getDemoSchoolSummary(name); }
  const remote = await requestJson<unknown>(`/api/users/schools/summary?name=${encodeURIComponent(name)}`);
  if (remote !== undefined || !IS_DEMO_MODE) return requireSchoolSummary(remote);
  return getDemoSchoolSummary(name);
}
export async function getSchoolOptions(): Promise<SchoolSummary[]> {
  if (!API_BASE_URL) { ensureDemoMode(); return getDemoSchoolOptions(); }
  const remote = await requestJson<unknown>('/api/users/schools');
  if (remote !== undefined || !IS_DEMO_MODE) return requireSchoolList(remote);
  return getDemoSchoolOptions();
}
export async function getMembershipPlans(): Promise<MembershipPlan[]> {
  if (!API_BASE_URL) { ensureDemoMode(); return getDemoMembershipPlans(); }
  const remote = await requestJson<unknown>('/api/users/membership/plans');
  if (remote !== undefined || !IS_DEMO_MODE) return requireMembershipPlanList(remote);
  return getDemoMembershipPlans();
}
export async function getUserEntitlements(): Promise<UserEntitlements> {
  if (!API_BASE_URL) { ensureDemoMode(); return getDemoEntitlements(await getCurrentUser()); }
  return requireUserEntitlements(await requestAuthenticatedJson<unknown>('/api/users/me/entitlements'));
}
export async function upgradeMembership(memberLevel: 'plus' | 'pro'): Promise<UserProfile> {
  if (API_BASE_URL || !IS_DEMO_MODE) throw new Error('MEMBERSHIP_SELF_UPGRADE_FORBIDDEN');
  const current = await getCurrentUser();
  const next = normalizeGrowthLevelFields({ ...current, memberLevel });
  uni.setStorageSync(USER_PROFILE_KEY, next);
  return next;
}
export async function createMembershipOrder(planLevel: 'plus' | 'pro'): Promise<MembershipOrder> {
  if (!API_BASE_URL) { ensureDemoMode(); return createDemoOrder(await getCurrentUser(), planLevel); }
  return requireMembershipOrder(
    await requestAuthenticatedJson<unknown>('/api/orders/membership', { method: 'POST', data: { planLevel } })
  );
}
async function syncCurrentUser(): Promise<UserProfile> {
  if (!API_BASE_URL) {
    ensureDemoMode();
    const local = getDemoUser();
    uni.setStorageSync(USER_PROFILE_KEY, local);
    return local;
  }
  const scope = captureSessionScope();
  const remote = await requestAuthenticatedJson<unknown>('/api/users/me');
  const normalized = normalizeGrowthLevelFields(requireUserProfile(remote));
  assertCurrentUserScope(scope);
  return cacheCurrentUserProfile(normalized);
}
function ensureDemoMode(): void {
  if (!IS_DEMO_MODE) throw new Error('DEMO_DATA_DISABLED_IN_PRODUCTION');
}

export function clearCachedUserProfile(): void {
  uni.removeStorageSync(USER_PROFILE_KEY);
  uni.removeStorageSync('zhiyinMode');
}

export function cacheCurrentUserProfile(value: unknown): UserProfile {
  const profile = normalizeGrowthLevelFields(requireUserProfile(value));
  uni.setStorageSync(USER_PROFILE_KEY, profile);
  return profile;
}

function assertCurrentUserScope(scope: ReturnType<typeof captureSessionScope>): void {
  if (!isSessionScopeCurrent(scope)) throw new Error('USER_SESSION_CHANGED');
}
