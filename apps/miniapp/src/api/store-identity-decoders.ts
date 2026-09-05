import type {
  AttributionCandidate,
  AttributionCandidateCreate,
  CustomerProfile,
  CustomerSession,
  DeletionPreview,
  DeletionResult,
  LegalDocuments,
  ServiceAgent,
  WechatAuthData,
} from '../types/store-identity';
import type { components } from '@qingxu/contracts';
import { StoreEnvelopeFormatError } from './store-client';

type RecordValue = Record<string, unknown>;
type CommandData = components['schemas']['CommandResponse']['data'];
type CandidateRejectData = components['schemas']['AttributionCandidateRejectResponse']['data'];

const impactOrder = [
  'REVOKE_ALL_SESSIONS',
  'END_SERVICE_AGENT_BINDING',
  'INVALIDATE_ATTRIBUTION_CANDIDATES',
  'ANONYMIZE_ACCOUNT_PROFILE',
  'DELETE_NON_TRANSACTIONAL_PII',
  'ANONYMIZE_AGENT_HISTORY',
  'RETAIN_REQUIRED_TRANSACTION_FACTS',
] as const;
const impactValues = new Set<string>(impactOrder);
const blockerOrder = ['ORDER', 'AFTERSALE', 'PAYMENT', 'REFUND', 'FINANCIAL_ANOMALY'] as const;
const blockerValues = new Set<string>(blockerOrder);

function invalid(): never {
  throw new StoreEnvelopeFormatError();
}

function record(value: unknown, required: readonly string[]): RecordValue {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalid();
  const current = value as RecordValue;
  const keys = Object.keys(current);
  if (keys.length !== required.length || !required.every((key) => Object.hasOwn(current, key))) {
    invalid();
  }
  return current;
}

function text(value: unknown, minimum = 1, maximum = Number.MAX_SAFE_INTEGER): string {
  if (typeof value !== 'string' || value.length < minimum || value.length > maximum) invalid();
  return value;
}

function nullableText(value: unknown): string | null {
  return value === null ? null : text(value);
}

function dateTime(value: unknown): string {
  const current = text(value);
  if (!Number.isFinite(Date.parse(current))) invalid();
  return current;
}

function integer(value: unknown, minimum = 0): number {
  if (!Number.isInteger(value) || (value as number) < minimum) invalid();
  return value as number;
}

function webUrl(value: unknown, allowLoopbackHttp = false): string {
  const current = text(value, 1, 500);
  const match = /^(https?):\/\/(\[[0-9a-f:.]+\]|[a-z0-9.-]+)(?::([0-9]{1,5}))?(?:[/?#][^\s]*)?$/i
    .exec(current);
  if (!match) invalid();
  const hostname = match[2]?.toLowerCase();
  const loopback = hostname === 'localhost' || hostname?.endsWith('.localhost') === true ||
    hostname === '127.0.0.1' || hostname === '[::1]';
  if (match[1]?.toLowerCase() !== 'https' && (!allowLoopbackHttp || !loopback)) invalid();
  if (match[3] !== undefined) {
    const port = Number(match[3]);
    if (!Number.isInteger(port) || port < 1 || port > 65_535) invalid();
  }
  return current;
}

export function decodeCustomerSession(value: unknown): CustomerSession {
  const current = record(value, [
    'access_token',
    'refresh_token',
    'role',
    'assurance',
    'access_expires_at',
    'refresh_expires_at',
  ]);
  const session = {
    access_token: text(current.access_token, 20, 512),
    refresh_token: text(current.refresh_token, 20, 512),
    role: current.role,
    assurance: current.assurance,
    access_expires_at: dateTime(current.access_expires_at),
    refresh_expires_at: dateTime(current.refresh_expires_at),
  };
  if (session.role !== 'CUSTOMER' || session.assurance !== 'WECHAT') invalid();
  return session as CustomerSession;
}

function decodeLegalDocument<T extends 'PHONE_AUTHORIZATION' | 'PRIVACY_POLICY' | 'USER_AGREEMENT'>(
  value: unknown,
  expectedType: T,
) {
  const current = record(value, ['type', 'document_version', 'title', 'content_url', 'required']);
  if (current.type !== expectedType || current.required !== true) invalid();
  return {
    type: expectedType,
    document_version: text(current.document_version, 1, 80),
    title: text(current.title, 1, 120),
    content_url: webUrl(current.content_url),
    required: true as const,
  };
}

export function decodeLegalDocuments(value: unknown): LegalDocuments {
  const current = record(value, ['user_agreement', 'privacy_policy', 'phone_authorization']);
  return {
    user_agreement: decodeLegalDocument(current.user_agreement, 'USER_AGREEMENT'),
    privacy_policy: decodeLegalDocument(current.privacy_policy, 'PRIVACY_POLICY'),
    phone_authorization: decodeLegalDocument(current.phone_authorization, 'PHONE_AUTHORIZATION'),
  };
}

function decodeLoginCandidate(value: unknown) {
  const current = record(value, [
    'candidate_id', 'agent_id', 'display_name', 'expires_at', 'attribution_eligible',
    'public_target_url',
  ]);
  if (current.attribution_eligible !== true) invalid();
  return {
    candidate_id: text(current.candidate_id),
    agent_id: text(current.agent_id),
    display_name: text(current.display_name),
    expires_at: dateTime(current.expires_at),
    attribution_eligible: true as const,
    public_target_url: webUrl(current.public_target_url, true),
  };
}

export function decodeWechatAuthData(value: unknown): WechatAuthData {
  const current = record(value, ['session', 'confirmation_required', 'candidate']);
  const session = decodeCustomerSession(current.session);
  if (current.confirmation_required === true) {
    return { session, confirmation_required: true, candidate: decodeLoginCandidate(current.candidate) };
  }
  if (current.confirmation_required === false && current.candidate === null) {
    return { session, confirmation_required: false, candidate: null };
  }
  return invalid();
}

export function decodeCustomerProfile(value: unknown): CustomerProfile {
  const current = record(value, [
    'customer_id', 'nickname', 'avatar_url', 'city', 'phone_tail', 'phone_masked',
    'phone_source', 'phone_verified_at', 'version',
  ]);
  const base = {
    customer_id: text(current.customer_id),
    nickname: nullableText(current.nickname),
    avatar_url: current.avatar_url === null ? null : webUrl(current.avatar_url),
    city: nullableText(current.city),
    version: integer(current.version, 1),
  };
  const phoneValues = [current.phone_tail, current.phone_masked, current.phone_source,
    current.phone_verified_at];
  if (phoneValues.every((entry) => entry === null)) {
    return { ...base, phone_tail: null, phone_masked: null, phone_source: null,
      phone_verified_at: null } as CustomerProfile;
  }
  if (phoneValues.some((entry) => entry === null) ||
    (current.phone_source !== 'MOCK' && current.phone_source !== 'WECHAT')) invalid();
  const phoneTail = text(current.phone_tail, 4, 4);
  const phoneMasked = text(current.phone_masked);
  if (!/^[0-9]{4}$/.test(phoneTail) || !/^[0-9]{3} \*{4} [0-9]{4}$/.test(phoneMasked) ||
    !phoneMasked.endsWith(phoneTail)) invalid();
  return {
    ...base,
    phone_tail: phoneTail,
    phone_masked: phoneMasked,
    phone_source: current.phone_source,
    phone_verified_at: dateTime(current.phone_verified_at),
  } as CustomerProfile;
}

export function decodeAttributionCandidate(value: unknown): AttributionCandidate {
  const current = record(value, [
    'candidate_id', 'agent_id', 'display_name', 'confirmation_required',
    'attribution_eligible', 'public_target_url', 'expires_at', 'remaining_seconds',
  ]);
  if (current.confirmation_required !== true || current.attribution_eligible !== true) invalid();
  return {
    candidate_id: text(current.candidate_id),
    agent_id: text(current.agent_id),
    display_name: text(current.display_name),
    confirmation_required: true,
    attribution_eligible: true,
    public_target_url: webUrl(current.public_target_url, true),
    expires_at: dateTime(current.expires_at),
    remaining_seconds: integer(current.remaining_seconds),
  };
}

export function decodeNullableAttributionCandidate(value: unknown): AttributionCandidate | null {
  return value === null ? null : decodeAttributionCandidate(value);
}

export function decodeAttributionCandidateCreate(value: unknown): AttributionCandidateCreate {
  const current = record(value, ['candidate', 'candidate_token', 'service_agent', 'public_fallback']);
  if (current.candidate !== null) {
    const candidate = decodeAttributionCandidate(current.candidate);
    const token = current.candidate_token === null
      ? null
      : text(current.candidate_token, 32, 512);
    if (current.service_agent !== null || current.public_fallback !== null) invalid();
    return { candidate, candidate_token: token, service_agent: null, public_fallback: null };
  }
  if (current.candidate_token !== null) invalid();
  if (current.service_agent !== null) {
    if (current.public_fallback !== null) invalid();
    return {
      candidate: null,
      candidate_token: null,
      service_agent: decodeServiceAgent(current.service_agent),
      public_fallback: null,
    };
  }
  const fallback = record(current.public_fallback, ['attribution_eligible', 'public_target_url']);
  if (fallback.attribution_eligible !== false) invalid();
  return {
    candidate: null,
    candidate_token: null,
    service_agent: null,
    public_fallback: {
      attribution_eligible: false,
      public_target_url: webUrl(fallback.public_target_url, true),
    },
  };
}

export function decodeServiceAgent(value: unknown): ServiceAgent {
  const current = record(value, ['agent_id', 'display_name', 'bound_at']);
  return {
    agent_id: text(current.agent_id),
    display_name: text(current.display_name),
    bound_at: dateTime(current.bound_at),
  };
}

export function decodeNullableServiceAgent(value: unknown): ServiceAgent | null {
  return value === null ? null : decodeServiceAgent(value);
}

function decodeImpacts(value: unknown): DeletionPreview['impacts'] {
  if (!Array.isArray(value) || value.length !== impactValues.size ||
    new Set(value).size !== impactValues.size ||
    value.some((entry, index) => typeof entry !== 'string' || !impactValues.has(entry) ||
      entry !== impactOrder[index])) invalid();
  return value as DeletionPreview['impacts'];
}

export function decodeDeletionPreview(value: unknown): DeletionPreview {
  const current = record(value, [
    'eligible', 'blockers', 'impacts', 'preview_token', 'confirmation_hash',
    'expires_at', 'account_version',
  ]);
  const impacts = decodeImpacts(current.impacts);
  const accountVersion = integer(current.account_version, 1);
  if (current.eligible === true) {
    if (!Array.isArray(current.blockers) || current.blockers.length !== 0) invalid();
    const hash = text(current.confirmation_hash, 64, 64);
    if (!/^[0-9a-f]{64}$/.test(hash)) invalid();
    return {
      eligible: true,
      blockers: [],
      impacts,
      preview_token: text(current.preview_token, 32, 512),
      confirmation_hash: hash,
      expires_at: dateTime(current.expires_at),
      account_version: accountVersion,
    };
  }
  if (current.eligible !== false || current.preview_token !== null ||
    current.confirmation_hash !== null || current.expires_at !== null ||
    !Array.isArray(current.blockers) || current.blockers.length === 0) invalid();
  const seenBlockers = new Set<string>();
  let previousBlockerIndex = -1;
  const blockers = current.blockers.map((entry) => {
    const blocker = record(entry, ['resource_type', 'count']);
    if (typeof blocker.resource_type !== 'string' || !blockerValues.has(blocker.resource_type)) {
      invalid();
    }
    const blockerIndex = blockerOrder.indexOf(blocker.resource_type as typeof blockerOrder[number]);
    if (seenBlockers.has(blocker.resource_type) || blockerIndex <= previousBlockerIndex) invalid();
    seenBlockers.add(blocker.resource_type);
    previousBlockerIndex = blockerIndex;
    return { resource_type: blocker.resource_type, count: integer(blocker.count, 1) };
  });
  return {
    eligible: false,
    blockers: blockers as Extract<DeletionPreview, { eligible: false }>['blockers'],
    impacts,
    preview_token: null,
    confirmation_hash: null,
    expires_at: null,
    account_version: accountVersion,
  };
}

export function decodeDeletionResult(value: unknown): DeletionResult {
  const current = record(value, ['request_id', 'status', 'submitted_at', 'completed_at']);
  if (current.status !== 'COMPLETED') invalid();
  return {
    request_id: text(current.request_id),
    status: 'COMPLETED',
    submitted_at: dateTime(current.submitted_at),
    completed_at: dateTime(current.completed_at),
  };
}

export function decodeCommandData(value: unknown): CommandData {
  const current = record(value, [
    'resource_type', 'resource_id', 'status', 'version', 'occurred_at',
  ]);
  return {
    resource_type: text(current.resource_type),
    resource_id: text(current.resource_id),
    status: text(current.status),
    version: integer(current.version),
    occurred_at: dateTime(current.occurred_at),
  };
}

export function decodeCandidateRejectData(value: unknown): CandidateRejectData {
  const current = record(value, ['candidate_id', 'status', 'rejected_at']);
  if (current.status !== 'REJECTED') invalid();
  return {
    candidate_id: text(current.candidate_id),
    status: 'REJECTED',
    rejected_at: dateTime(current.rejected_at),
  };
}
