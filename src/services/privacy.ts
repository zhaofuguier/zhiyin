import { requestAuthenticatedJson, requestJson } from './network';
import { clearSession, establishSession, obtainDeletionLoginCode, type LoginAgeBand } from './session';
import { cacheCurrentUserProfile, clearCachedUserProfile, type UserProfile } from './user';
import { clearCachedUserActivity } from './user-activity';

export type LegalDocumentType = 'privacy' | 'terms' | 'minors';
export interface LegalDocument {
  id: 'privacy-policy' | 'terms-of-service' | 'minors-protection';
  documentType: LegalDocumentType;
  version: string;
  title: string;
  effectiveDate: string;
  body?: string;
  reviewStatus: 'draft' | 'approved';
}
export interface LoginConsentSelection {
  accepted: boolean;
  ageBand?: LoginAgeBand;
  privacyVersion?: string;
  termsVersion?: string;
  minorsVersion?: string;
}
export interface PersonalDataExport {
  generatedAt: string;
  requestId: string;
  profile: Record<string, unknown>;
  activity: { favoriteIds: string[]; history: unknown[]; reactions: Record<string, unknown> };
  orders: unknown[];
  legalAcceptances: unknown[];
}
export const ACCOUNT_DELETION_CONFIRMATION = '注销知音账号';

export async function getLegalDocuments(): Promise<LegalDocument[]> {
  return requireLegalDocuments(await requestJson<unknown>('/api/legal/documents'));
}
export async function getLegalDocument(type: LegalDocumentType): Promise<LegalDocument> {
  return requireLegalDocument(await requestJson<unknown>(`/api/legal/documents/${documentId(type)}`), true);
}
export async function loginWithConsent(selection: LoginConsentSelection): Promise<UserProfile> {
  if (!selection.accepted || !selection.ageBand || !selection.privacyVersion ||
      !selection.termsVersion || !selection.minorsVersion) {
    throw new Error('USER_CONSENT_REQUIRED');
  }
  const user = await establishSession<unknown>({
    consent: true,
    privacyVersion: selection.privacyVersion,
    termsVersion: selection.termsVersion,
    minorsVersion: selection.minorsVersion,
    ageBand: selection.ageBand
  });
  return cacheCurrentUserProfile(user);
}
export async function exportPersonalData(): Promise<PersonalDataExport> {
  return requirePersonalDataExport(await requestAuthenticatedJson<unknown>('/api/privacy/data-export', {
    method: 'POST'
  }));
}
export async function deleteCurrentAccount(confirmation: string): Promise<{ deleted: true; requestId: string }> {
  if (confirmation.trim() !== ACCOUNT_DELETION_CONFIRMATION) throw new Error('ACCOUNT_DELETION_CONFIRMATION_INVALID');
  const loginCode = await obtainDeletionLoginCode();
  const response = requireDeletionResult(await requestAuthenticatedJson<unknown>('/api/privacy/account-deletion', {
    method: 'POST', data: { confirmation: ACCOUNT_DELETION_CONFIRMATION, loginCode }, retryAuthentication: false
  }));
  clearDeletedAccountClientState();
  return response;
}
export function clearDeletedAccountClientState(): void {
  clearSession();
  clearCachedUserProfile();
  clearCachedUserActivity();
  uni.removeStorageSync('currentMusicSpaceId');
  uni.removeStorageSync('zhiyinTimer');
  uni.$emit('zhiyin:account-deleted');
}

function requireLegalDocuments(value: unknown): LegalDocument[] {
  if (!Array.isArray(value)) throw new Error('LEGAL_DOCUMENT_RESPONSE_INVALID');
  const documents = value.map((item) => requireLegalDocument(item, false));
  if (!(['privacy', 'terms', 'minors'] as const).every((type) => documents.some((item) => item.documentType === type))) {
    throw new Error('LEGAL_DOCUMENT_RESPONSE_INCOMPLETE');
  }
  return documents;
}
function requireLegalDocument(value: unknown, requireBody: boolean): LegalDocument {
  const record = asRecord(value, 'LEGAL_DOCUMENT_RESPONSE_INVALID');
  const id = enumValue(record.id, ['privacy-policy', 'terms-of-service', 'minors-protection'] as const, 'LEGAL_DOCUMENT_RESPONSE_INVALID');
  return {
    id,
    documentType: documentType(id),
    version: requiredText(record.version, 'LEGAL_DOCUMENT_RESPONSE_INVALID'),
    title: requiredText(record.title, 'LEGAL_DOCUMENT_RESPONSE_INVALID'),
    effectiveDate: requiredText(record.effectiveDate, 'LEGAL_DOCUMENT_RESPONSE_INVALID'),
    ...(requireBody ? { body: requiredText(record.body, 'LEGAL_DOCUMENT_RESPONSE_INVALID') } : {}),
    reviewStatus: enumValue(record.status, ['draft', 'approved'] as const, 'LEGAL_DOCUMENT_RESPONSE_INVALID')
  };
}
function requirePersonalDataExport(value: unknown): PersonalDataExport {
  const record = asRecord(value, 'PERSONAL_DATA_EXPORT_RESPONSE_INVALID');
  const forbidden = /token|loginCode|providerUserId|session[_]key|rawPayload|auditMetadata/iu;
  if (containsForbiddenKey(record, forbidden)) throw new Error('PERSONAL_DATA_EXPORT_RESPONSE_INVALID');
  return {
    generatedAt: requiredText(record.generatedAt, 'PERSONAL_DATA_EXPORT_RESPONSE_INVALID'),
    requestId: requiredText(record.requestId, 'PERSONAL_DATA_EXPORT_RESPONSE_INVALID'),
    profile: validateExportProfile(asRecord(record.profile, 'PERSONAL_DATA_EXPORT_RESPONSE_INVALID')),
    activity: validateActivity(asRecord(record.activity, 'PERSONAL_DATA_EXPORT_RESPONSE_INVALID')),
    orders: array(record.orders), legalAcceptances: array(record.legalAcceptances)
  };
}
function requireDeletionResult(value: unknown): { deleted: true; requestId: string } {
  const record = asRecord(value, 'ACCOUNT_DELETION_RESPONSE_INVALID');
  if (record.deleted !== true) throw new Error('ACCOUNT_DELETION_RESPONSE_INVALID');
  return { deleted: true, requestId: requiredText(record.requestId, 'ACCOUNT_DELETION_RESPONSE_INVALID') };
}
function asRecord(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(code);
  return value as Record<string, unknown>;
}
function requiredText(value: unknown, code: string): string { if (typeof value !== 'string' || !value.trim()) throw new Error(code); return value; }
function enumValue<T extends string>(value: unknown, values: readonly T[], code: string): T { if (typeof value !== 'string' || !values.includes(value as T)) throw new Error(code); return value as T; }
function array(value: unknown): unknown[] { if (!Array.isArray(value)) throw new Error('PERSONAL_DATA_EXPORT_RESPONSE_INVALID'); return value; }
function containsForbiddenKey(value: unknown, pattern: RegExp): boolean {
  if (Array.isArray(value)) return value.some((item) => containsForbiddenKey(item, pattern));
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value as Record<string, unknown>).some(([key, item]) => pattern.test(key) || containsForbiddenKey(item, pattern));
}
function documentId(type: LegalDocumentType): LegalDocument['id'] { return type === 'privacy' ? 'privacy-policy' : type === 'terms' ? 'terms-of-service' : 'minors-protection'; }
function documentType(id: LegalDocument['id']): LegalDocumentType { return id === 'privacy-policy' ? 'privacy' : id === 'terms-of-service' ? 'terms' : 'minors'; }
function validateExportProfile(profile: Record<string, unknown>): Record<string, unknown> {
  const providers = profile.identityProviders;
  if (!Array.isArray(providers) || providers.some((item) => item !== 'wechat' && item !== 'douyin')) throw new Error('PERSONAL_DATA_EXPORT_RESPONSE_INVALID');
  return profile;
}
function validateActivity(activity: Record<string, unknown>): PersonalDataExport['activity'] {
  if (!Array.isArray(activity.favoriteIds) || activity.favoriteIds.some((item) => typeof item !== 'string') || !Array.isArray(activity.history) ||
      !activity.reactions || typeof activity.reactions !== 'object' || Array.isArray(activity.reactions)) throw new Error('PERSONAL_DATA_EXPORT_RESPONSE_INVALID');
  return { favoriteIds: activity.favoriteIds as string[], history: activity.history, reactions: activity.reactions as Record<string, unknown> };
}
