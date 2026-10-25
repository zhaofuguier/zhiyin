export const feedbackCatalog = {
  schemaVersion: 1,
  categories: [
    { value: 'feature-suggestion', label: '功能建议' },
    { value: 'content-suggestion', label: '内容建议' },
    { value: 'usage-problem', label: '使用问题' },
    { value: 'complaint-report', label: '投诉举报' },
    { value: 'other', label: '其他' }
  ],
  statuses: [
    { value: 'pending', label: '待处理' },
    { value: 'replied', label: '已回复' },
    { value: 'closed', label: '已关闭' }
  ]
} as const;

export type FeedbackCategory = (typeof feedbackCatalog.categories)[number]['value'];
export type FeedbackStatus = (typeof feedbackCatalog.statuses)[number]['value'];
export type FeedbackAdminSettableStatus = Exclude<FeedbackStatus, 'replied'>;

export const feedbackCategoryValues: readonly FeedbackCategory[] =
  feedbackCatalog.categories.map(({ value }) => value);
export const feedbackStatusValues: readonly FeedbackStatus[] =
  feedbackCatalog.statuses.map(({ value }) => value);
export const feedbackAdminSettableStatusValues: readonly FeedbackAdminSettableStatus[] =
  feedbackStatusValues.filter((value): value is FeedbackAdminSettableStatus => value !== 'replied');

export function isFeedbackCategory(value: unknown): value is FeedbackCategory {
  return feedbackCategoryValues.some((candidate) => candidate === value);
}

export function isFeedbackStatus(value: unknown): value is FeedbackStatus {
  return feedbackStatusValues.some((candidate) => candidate === value);
}

export function feedbackCategoryLabel(value: FeedbackCategory): string {
  return feedbackCatalog.categories.find((item) => item.value === value)?.label ?? String(value);
}

export function feedbackStatusLabel(value: FeedbackStatus): string {
  return feedbackCatalog.statuses.find((item) => item.value === value)?.label ?? String(value);
}
