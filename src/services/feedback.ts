import { requestAuthenticatedJson } from './network';
import { ApiResponseContractError } from './response-contract';
import {
  feedbackCatalog,
  feedbackCategoryLabel,
  feedbackStatusLabel,
  isFeedbackCategory,
  isFeedbackStatus,
  type FeedbackCategory,
  type FeedbackStatus
} from '../shared/feedback-catalog.generated.ts';

export const feedbackCategories = feedbackCatalog.categories.map((item) => ({ ...item }));
export { feedbackCategoryLabel, feedbackStatusLabel, type FeedbackCategory, type FeedbackStatus };
export interface FeedbackReply { id: string; content: string; createdAt: string }
export interface UserFeedback {
  id: string; category: FeedbackCategory;
  content: string; status: FeedbackStatus; createdAt: string; updatedAt: string;
  lastReplyAt?: string; userLastReadAt?: string; replies: FeedbackReply[];
}
export interface UserFeedbackPage { items: UserFeedback[]; total: number; page: number; pageSize: number; unreadReplyCount: number }

export async function submitFeedback(category: FeedbackCategory, content: string): Promise<UserFeedback> {
  return requireFeedback(await requestAuthenticatedJson<unknown>('/api/feedback', {
    method: 'POST', data: { category, content }
  }));
}
export async function getMyFeedback(page = 1, pageSize = 20): Promise<UserFeedbackPage> {
  return requireFeedbackPage(await requestAuthenticatedJson<unknown>(`/api/feedback/me?page=${page}&pageSize=${pageSize}`));
}
export async function getMyFeedbackDetail(id: string): Promise<UserFeedback> {
  return requireFeedback(await requestAuthenticatedJson<unknown>(`/api/feedback/me/${encodeURIComponent(id)}`));
}
export async function markFeedbackRepliesRead(id: string): Promise<UserFeedback> {
  return requireFeedback(await requestAuthenticatedJson<unknown>(`/api/feedback/me/${encodeURIComponent(id)}/read`, { method: 'POST' }));
}
export function hasUnreadFeedbackReply(value: UserFeedback): boolean { return Boolean(value.lastReplyAt && (!value.userLastReadAt || value.userLastReadAt < value.lastReplyAt)); }

function requireFeedbackPage(value: unknown): UserFeedbackPage {
  const item = record(value, 'feedbackPage');
  if (!Array.isArray(item.items) || !integer(item.total) || !integer(item.page) || !integer(item.pageSize) || !integer(item.unreadReplyCount)) invalid('feedbackPage');
  return { items: item.items.map(requireFeedback), total: item.total as number, page: item.page as number, pageSize: item.pageSize as number, unreadReplyCount: item.unreadReplyCount as number };
}
function requireFeedback(value: unknown): UserFeedback {
  const item = record(value, 'feedback');
  if (!text(item.id) || !isFeedbackCategory(item.category) || !text(item.content) ||
      !isFeedbackStatus(item.status) || !text(item.createdAt) || !text(item.updatedAt) || !Array.isArray(item.replies)) invalid('feedback');
  const replies = (item.replies as unknown[]).map((reply, index) => requireReply(reply, `feedback.replies[${index}]`));
  return {
    id: item.id,
    category: item.category,
    content: item.content,
    status: item.status,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    ...(text(item.lastReplyAt) ? { lastReplyAt: item.lastReplyAt } : {}),
    ...(text(item.userLastReadAt) ? { userLastReadAt: item.userLastReadAt } : {}),
    replies
  };
}
function requireReply(value: unknown, field: string): FeedbackReply {
  const item = record(value, field);
  if (!text(item.id) || !text(item.content) || !text(item.createdAt)) invalid(field);
  return { id: item.id, content: item.content, createdAt: item.createdAt };
}
function record(value: unknown, field: string): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(field); return value as Record<string, unknown>; }
function text(value: unknown): value is string { return typeof value === 'string' && Boolean(value.trim()); }
function integer(value: unknown): value is number { return Number.isInteger(value) && Number(value) >= 0; }
function invalid(field: string): never { throw new ApiResponseContractError('API_RESPONSE_CONTRACT_INVALID', field); }
