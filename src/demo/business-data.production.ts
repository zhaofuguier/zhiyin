import type { MembershipOrder, MembershipPlan, SchoolSummary, UserEntitlements, UserProfile } from '../services/user';
function disabled(): never { throw new Error('DEMO_DATA_DISABLED_IN_PRODUCTION'); }
export function getDemoUser(): UserProfile { return disabled(); }
export function getDemoSchoolSummary(_name: string): SchoolSummary { return disabled(); }
export function getDemoSchoolOptions(): SchoolSummary[] { return disabled(); }
export function getDemoMembershipPlans(): MembershipPlan[] { return disabled(); }
export function getDemoEntitlements(_user: UserProfile): UserEntitlements { return disabled(); }
export function createDemoOrder(_user: UserProfile, _planLevel: 'plus' | 'pro'): MembershipOrder { return disabled(); }export function memberPageInitialMessage(): string { return '会员方案由服务端提供'; }
export function memberPageModeLabel(): string { return '服务端方案'; }
export function memberPaymentSuccessMessage(_memberLevel: string): string { return '订单已由服务端处理'; }