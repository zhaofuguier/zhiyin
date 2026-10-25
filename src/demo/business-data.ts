import { normalizeGrowthLevelFields } from '../domain/growth-level';
import type { MembershipOrder, MembershipPlan, SchoolSummary, UserEntitlements, UserProfile } from '../services/user';

const DEMO_USER_KEY = 'zhiyin.demo.user';

export function getDemoUser(): UserProfile {
  const cached = uni.getStorageSync(DEMO_USER_KEY) as UserProfile | undefined;
  if (cached?.id) return normalizeGrowthLevelFields(cached);
  const profile = normalizeGrowthLevelFields({
    id: `demo-user-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    mode: 'normal', memberLevel: 'free'
  } as UserProfile);
  uni.setStorageSync(DEMO_USER_KEY, profile);
  return profile;
}
export function getDemoSchoolSummary(name: string): SchoolSummary {
  return { name, studentCount: 128, ambassadorCount: 1, appliedCount: 3 };
}
export function getDemoSchoolOptions(): SchoolSummary[] {
  return [
    { name: '第一中学', studentCount: 238, ambassadorCount: 2, appliedCount: 4 },
    { name: '实验中学', studentCount: 186, ambassadorCount: 1, appliedCount: 2 },
    { name: '外国语学校', studentCount: 96, ambassadorCount: 1, appliedCount: 1 }
  ];
}
export function getDemoMembershipPlans(): MembershipPlan[] {
  return [
    { level: 'plus', name: '知音 Plus 月卡', priceCents: 900, period: 'month', benefits: ['会员专属音乐空间', '高清微动画空间', '更多收藏容量'] },
    { level: 'pro', name: '知音 Pro 年卡', priceCents: 6800, period: 'year', benefits: ['全部 Plus 权益', '下载与离线预留', '更多精选音乐空间'] }
  ];
}
export function getDemoEntitlements(user: UserProfile): UserEntitlements {
  const isMember = user.memberLevel === 'plus' || user.memberLevel === 'pro';
  return { userId: user.id, memberLevel: user.memberLevel, canPlayMemberOnly: isMember, canUseMotionPremium: isMember, canDownload: user.memberLevel === 'pro' };
}
export function createDemoOrder(user: UserProfile, planLevel: 'plus' | 'pro'): MembershipOrder {
  return {
    id: `demo-order-${Date.now()}`, userId: user.id, planLevel,
    planName: planLevel === 'plus' ? '知音 Plus 月卡' : '知音 Pro 年卡',
    amountCents: planLevel === 'plus' ? 900 : 6800,
    status: 'pending', paymentProvider: 'mock', createdAt: new Date().toISOString()
  };
}
export function memberPageInitialMessage(): string { return '会员能力仅供演示，不代表真实支付。'; }
export function memberPageModeLabel(): string { return '演示模式'; }
export function memberPaymentSuccessMessage(memberLevel: string): string { return `演示支付完成，当前等级为 ${memberLevel}`; }