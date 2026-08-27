import type { components } from '@qingxu/contracts';

export type LegalDocuments = components['schemas']['LegalDocumentsResponse']['data'];
export type LegalDocument = LegalDocuments[keyof LegalDocuments];
export type WechatLoginInput = components['schemas']['WechatLoginRequest'];
export type WechatAuthData = components['schemas']['WechatAuthResponse']['data'];
export type CustomerSession = components['schemas']['StoreSessionView'];
export type CustomerProfile = components['schemas']['ProfileView'];
export type ProfileUpdateInput = components['schemas']['ProfileUpdateRequest'];
export type PhoneAuthorizationInput = components['schemas']['PhoneAuthorizationRequest'];
export type AttributionCandidate = components['schemas']['AttributionCandidateView'];
export type AttributionCandidateCreate = components['schemas']['AttributionCandidateCreateResponse']['data'];
export type AttributionCandidateInput = components['schemas']['AttributionCandidateRequest'];
export type ServiceAgent = components['schemas']['StoreServiceAgentView'];
export type DeletionPreview = components['schemas']['DeletionPreviewResponse']['data'];
export type DeletionConfirmInput = components['schemas']['DeletionConfirmRequest'];
export type DeletionResult = components['schemas']['DeletionRequestView'];
