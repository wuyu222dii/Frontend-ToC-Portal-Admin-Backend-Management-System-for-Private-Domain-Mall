<script setup lang="ts">
/* global uni */
import { onLoad, onShow, onUnload } from '@dcloudio/uni-app';
import { computed, reactive, ref, watch } from 'vue';

import {
  createIdempotencyKey,
  getStoreOrder,
  previewStoreAftersale,
  uploadStoreAftersaleEvidence,
} from '../../api';
import { StoreApiError } from '../../api/store-client';
import QxAccountHeader from '../../components/storefront/QxAccountHeader.vue';
import QxCatalogState from '../../components/storefront/QxCatalogState.vue';
import QxStoreShell from '../../components/storefront/QxStoreShell.vue';
import type {
  StoreAftersalePreview,
  StoreAftersalePreviewInput,
} from '../../types/store-aftersales';
import type { StoreOrderDetail } from '../../types/store-orders';
import {
  AftersaleConfirmJournalError,
  executeAftersaleConfirmJournal,
  isCertainAftersaleConfirmFailure,
  prepareAftersaleConfirmJournal,
  recoverAftersaleConfirmJournal,
  recoverVolatileAftersaleConfirmRequest,
  type AftersaleConfirmJournal,
} from '../../utils/aftersale-confirm-journal';
import { clearCustomerSession } from '../../utils/customer-session';
import { replaceWithLoginForAction } from '../../utils/protected-action';
import { openAftersaleDetail } from '../../utils/store-navigation';

type PageState = 'loading' | 'ready' | 'invalid' | 'unavailable' | 'not-found' | 'auth-required' | 'error' | 'rate-limited';
type ReasonCode = StoreAftersalePreviewInput['reason_code'];

interface EvidenceItem {
  fileId: string;
  name: string;
}

const reasonOptions: ReadonlyArray<{ label: string; value: ReasonCode }> = [
  { label: '未发货，不再需要', value: 'UNSHIPPED_NO_LONGER_NEEDED' },
  { label: '商品破损', value: 'ITEM_DAMAGED' },
  { label: '商品与描述不符', value: 'ITEM_NOT_AS_DESCRIBED' },
  { label: '收到错误商品', value: 'WRONG_ITEM' },
  { label: '商品缺失', value: 'MISSING_ITEM' },
  { label: '质量问题', value: 'QUALITY_ISSUE' },
  { label: '其他原因', value: 'OTHER' },
];

const state = ref<PageState>('loading');
const orderId = ref('');
const order = ref<StoreOrderDetail | null>(null);
const type = ref<'REFUND_ONLY' | 'RETURN_REFUND'>('REFUND_ONLY');
const reasonCode = ref<ReasonCode>('UNSHIPPED_NO_LONGER_NEEDED');
const reasonText = ref('');
const quantities = reactive<Record<string, number>>({});
const evidence = ref<EvidenceItem[]>([]);
const preview = ref<StoreAftersalePreview | null>(null);
const pendingJournal = ref<AftersaleConfirmJournal | null>(null);
const previewPending = ref(false);
const confirmPending = ref(false);
const uploadPending = ref(false);
const message = ref('');
const retryAfterSeconds = ref(0);
const slowRequest = ref(false);
let generation = 0;
let showGeneration = 0;
let slowTimer: ReturnType<typeof setTimeout> | undefined;
let previewAttempt: { fingerprint: string; key: string } | null = null;
let authenticationRequired = false;

const eligibleItems = computed(() => order.value?.items.map((item) => ({
  ...item,
  visibleMaximum: Math.max(0, item.quantity - item.refunded_quantity - item.reserved_aftersale_quantity),
})) ?? []);
const selectedCount = computed(() => Object.values(quantities).reduce((sum, value) => sum + value, 0));
const formLocked = computed(() => previewPending.value || confirmPending.value || uploadPending.value ||
  pendingJournal.value !== null);
const pendingReasonRequired = computed(() => pendingJournal.value?.command.reason_text_present === true);
const reasonLocked = computed(() => previewPending.value || confirmPending.value || uploadPending.value ||
  (pendingJournal.value !== null && !pendingReasonRequired.value));
const canRetryPending = computed(() => pendingJournal.value !== null && !confirmPending.value &&
  (!pendingReasonRequired.value || Array.from(reasonText.value.trim()).length >= 2));
const canPreview = computed(() => selectedCount.value > 0 && !formLocked.value &&
  (reasonCode.value !== 'OTHER' || Array.from(reasonText.value.trim()).length >= 2));

function isUlid(value: string): boolean {
  return /^[0-9A-HJKMNP-TV-Z]{26}$/.test(value);
}

function clearSlowTimer(): void {
  if (slowTimer !== undefined) clearTimeout(slowTimer);
  slowTimer = undefined;
}

function requireLogin(): void {
  authenticationRequired = true;
  state.value = 'auth-required';
  clearCustomerSession();
  replaceWithLoginForAction({ type: 'ORDER_DETAIL', order_id: orderId.value });
}

async function loadOrder(): Promise<void> {
  if (!isUlid(orderId.value)) {
    state.value = 'invalid';
    return;
  }
  const currentGeneration = ++generation;
  state.value = 'loading';
  message.value = '';
  retryAfterSeconds.value = 0;
  slowRequest.value = false;
  clearSlowTimer();
  slowTimer = setTimeout(() => {
    if (generation === currentGeneration && state.value === 'loading') slowRequest.value = true;
  }, 800);
  try {
    const next = await getStoreOrder(orderId.value);
    if (generation !== currentGeneration) return;
    order.value = next;
    const currentItemIds = new Set(next.items.map(({ order_item_id }) => order_item_id));
    for (const itemId of Object.keys(quantities)) {
      if (!currentItemIds.has(itemId)) delete quantities[itemId];
    }
    const pendingQuantities = new Map(pendingJournal.value?.command.items
      .map(({ order_item_id, quantity }) => [order_item_id, quantity] as const) ?? []);
    for (const item of next.items) {
      const maximum = Math.max(0, item.quantity - item.refunded_quantity - item.reserved_aftersale_quantity);
      quantities[item.order_item_id] = pendingQuantities.get(item.order_item_id) ??
        Math.min(maximum, Math.max(0, quantities[item.order_item_id] ?? 0));
    }
    if (!next.available_actions.includes('APPLY_AFTERSALE') &&
      pendingJournal.value?.command.order_id !== next.order_id) {
      state.value = 'unavailable';
      return;
    }
    state.value = 'ready';
  } catch (error) {
    if (generation !== currentGeneration) return;
    order.value = null;
    if (error instanceof StoreApiError && error.status === 401) requireLogin();
    else if (error instanceof StoreApiError && error.status === 404) state.value = 'not-found';
    else if (error instanceof StoreApiError && error.status === 429) {
      retryAfterSeconds.value = error.retryAfterSeconds ?? 1;
      state.value = 'rate-limited';
    } else state.value = 'error';
  } finally {
    if (generation === currentGeneration) {
      clearSlowTimer();
      slowRequest.value = false;
    }
  }
}

function businessInput(): StoreAftersalePreviewInput {
  const items = eligibleItems.value
    .map((item) => ({
      order_item_id: item.order_item_id,
      quantity: Math.min(item.visibleMaximum, Math.max(0, quantities[item.order_item_id] ?? 0)),
    }))
    .filter((item) => item.quantity > 0);
  const shared = {
    action: 'PREVIEW',
    evidence_file_ids: evidence.value.map(({ fileId }) => fileId),
    items,
    order_id: orderId.value,
    type: type.value,
  } as const;
  const currentReasonCode = reasonCode.value;
  const normalizedReason = reasonText.value.trim();
  if (currentReasonCode === 'OTHER') {
    return { ...shared, reason_code: 'OTHER', reason_text: normalizedReason };
  }
  return normalizedReason
    ? { ...shared, reason_code: currentReasonCode, reason_text: normalizedReason }
    : { ...shared, reason_code: currentReasonCode };
}

function formFingerprint(): string {
  return JSON.stringify(businessInput());
}

function increase(orderItemId: string, maximum: number): void {
  if (formLocked.value) return;
  quantities[orderItemId] = Math.min(maximum, (quantities[orderItemId] ?? 0) + 1);
}

function decrease(orderItemId: string): void {
  if (formLocked.value) return;
  quantities[orderItemId] = Math.max(0, (quantities[orderItemId] ?? 0) - 1);
}

function readableBlocker(value: StoreAftersalePreview['blockers'][number]): string {
  return ({
    AFTERSALE_QUOTA_EXCEEDED: '当前可退数量或金额已被其他售后占用',
    EVIDENCE_UNAVAILABLE: '部分凭证已不可用，请移除后重新上传',
    ITEM_UNAVAILABLE: '所选商品当前不可申请售后',
    ORDER_NOT_ELIGIBLE: '订单当前不满足售后条件',
  })[value];
}

async function requestPreview(): Promise<void> {
  if (!canPreview.value) return;
  const input = businessInput();
  const fingerprint = JSON.stringify(input);
  if (previewAttempt?.fingerprint !== fingerprint) previewAttempt = { fingerprint, key: createIdempotencyKey() };
  previewPending.value = true;
  message.value = '';
  try {
    preview.value = await previewStoreAftersale(input, previewAttempt.key);
    previewAttempt = null;
    if (!preview.value.can_submit) message.value = preview.value.blockers.map(readableBlocker).join('；');
  } catch (error) {
    previewAttempt = null;
    if (error instanceof StoreApiError && error.status === 401) {
      requireLogin();
    } else if (error instanceof StoreApiError && error.status === 404) {
      state.value = 'not-found';
    } else if (error instanceof StoreApiError && error.status === 429) {
      retryAfterSeconds.value = error.retryAfterSeconds ?? 1;
      message.value = `请求较频繁，请在 ${retryAfterSeconds.value} 秒后重试。`;
    } else if (error instanceof StoreApiError && error.status !== 0 && error.status < 500) {
      message.value = '售后试算未通过，请检查选择后重试。';
    } else message.value = '试算凭证无法安全重放，请重新发起试算。';
  } finally {
    previewPending.value = false;
  }
}

async function confirmApplication(): Promise<void> {
  const current = preview.value;
  if (current === null || !current.can_submit || current.preview_token === null ||
    current.confirmation_hash === null || confirmPending.value) return;
  const input = businessInput();
  const confirmInput = {
    ...input,
    action: 'CONFIRM' as const,
    confirmation_hash: current.confirmation_hash,
    preview_token: current.preview_token,
  };
  confirmPending.value = true;
  message.value = '';
  try {
    const journal = await prepareAftersaleConfirmJournal(confirmInput);
    pendingJournal.value = journal;
    const result = await executeAftersaleConfirmJournal(journal);
    pendingJournal.value = null;
    preview.value = null;
    openAftersaleDetail(result.aftersale_id);
  } catch (error) {
    await handleConfirmError(error);
  } finally {
    confirmPending.value = false;
  }
}

function restorePendingForm(journal: AftersaleConfirmJournal): void {
  pendingJournal.value = journal;
  preview.value = null;
  type.value = journal.command.type;
  reasonCode.value = journal.command.reason_code;
  const recovered = recoverVolatileAftersaleConfirmRequest(journal);
  reasonText.value = typeof recovered?.reason_text === 'string' ? recovered.reason_text : '';
  for (const itemId of Object.keys(quantities)) delete quantities[itemId];
  for (const item of journal.command.items) quantities[item.order_item_id] = item.quantity;
  evidence.value = journal.command.evidence_file_ids.map((fileId, index) => ({
    fileId,
    name: `已上传凭证 ${index + 1}`,
  }));
  message.value = journal.command.reason_text_present && recovered === null
    ? '上次提交结果尚未确认。补充说明未保存在本机，请重新输入原文后继续确认。'
    : '上次提交结果尚未确认，可继续使用原确认操作核验结果。';
}

async function restorePendingApplication(): Promise<boolean> {
  try {
    const recovered = await recoverAftersaleConfirmJournal();
    if (recovered === null) {
      pendingJournal.value = null;
      return true;
    }
    if (recovered.command.order_id !== orderId.value) {
      void uni.redirectTo({
        url: `/pages/aftersales/apply?order_id=${encodeURIComponent(recovered.command.order_id)}`,
      });
      return false;
    }
    restorePendingForm(recovered);
    return true;
  } catch (error) {
    if (error instanceof StoreApiError && error.status === 401) {
      requireLogin();
      return false;
    }
    pendingJournal.value = null;
    state.value = 'error';
    message.value = '暂时无法核验上次提交记录，为避免重复提交，请稍后重试。';
    return false;
  }
}

async function restoreAndLoadApplication(): Promise<void> {
  if (!isUlid(orderId.value)) return;
  const currentShow = ++showGeneration;
  if (!await restorePendingApplication() || currentShow !== showGeneration) return;
  await loadOrder();
}

async function retryPendingApplication(): Promise<void> {
  const journal = pendingJournal.value;
  if (journal === null || !canRetryPending.value) return;
  confirmPending.value = true;
  message.value = '';
  try {
    const result = await executeAftersaleConfirmJournal(
      journal,
      journal.command.reason_text_present ? reasonText.value.trim() : undefined,
    );
    pendingJournal.value = null;
    openAftersaleDetail(result.aftersale_id);
  } catch (error) {
    await handleConfirmError(error);
  } finally {
    confirmPending.value = false;
  }
}

async function handleConfirmError(error: unknown): Promise<void> {
  if (error instanceof StoreApiError && error.status === 401) {
    requireLogin();
    return;
  }
  if (error instanceof StoreApiError && error.code !== 'SESSION_CHANGED' &&
    error.code !== 'STATE_CONFLICT' &&
    [404, 409, 422].includes(error.status)) {
    pendingJournal.value = null;
    preview.value = null;
    await loadOrder();
    message.value = error.status === 409
      ? '订单或可退额度已变化，请按最新投影重新试算并确认。'
      : '当前申请条件已变化，请重新选择。';
    return;
  }
  if (isCertainAftersaleConfirmFailure(error)) pendingJournal.value = null;
  if (error instanceof AftersaleConfirmJournalError && error.code === 'REQUEST_MISMATCH') {
    message.value = '补充说明与上次确认内容不一致，请输入原文后重试。';
  } else if (error instanceof AftersaleConfirmJournalError && error.code === 'PENDING_COMMAND') {
    message.value = '已有一笔售后提交结果尚未确认，请先恢复原确认操作。';
  } else if (error instanceof StoreApiError && error.status === 429) {
    retryAfterSeconds.value = error.retryAfterSeconds ?? 1;
    message.value = `请求较频繁，请在 ${retryAfterSeconds.value} 秒后使用当前确认操作重试。`;
  } else {
    message.value = '提交结果暂时无法确认，原确认操作已保留，请勿重新试算。';
  }
}

async function uploadEvidenceBytes(
  filename: string,
  mimeType: 'image/jpeg' | 'image/png',
  bytes: ArrayBuffer | Uint8Array,
): Promise<void> {
  if (uploadPending.value || evidence.value.length >= 9) return;
  uploadPending.value = true;
  message.value = '';
  try {
    const uploaded = await uploadStoreAftersaleEvidence({
      bytes,
      filename,
      mime_type: mimeType,
    });
    evidence.value = [...evidence.value, { fileId: uploaded.file_id, name: filename }];
  } catch (error) {
    if (error instanceof StoreApiError && error.status === 401) requireLogin();
    else if (error instanceof StoreApiError && error.status === 429) {
      retryAfterSeconds.value = error.retryAfterSeconds ?? 1;
      message.value = `上传较频繁，请在 ${retryAfterSeconds.value} 秒后重试。`;
    } else message.value = '凭证上传失败，请重新选择 JPEG/PNG 图片。已成功上传的凭证仍会保留。';
  } finally {
    uploadPending.value = false;
  }
}

function chooseEvidence(): void {
  if (formLocked.value || evidence.value.length >= 9) return;
  uni.chooseImage({
    count: 1,
    sizeType: ['compressed'],
    success: (result) => {
      const browserFile = (result as unknown as { tempFiles?: unknown[] }).tempFiles?.[0];
      if (typeof File !== 'undefined' && browserFile instanceof File) {
        if (browserFile.type !== 'image/jpeg' && browserFile.type !== 'image/png') {
          message.value = '仅支持 JPEG 或 PNG 凭证。';
          return;
        }
        const mimeType = browserFile.type as 'image/jpeg' | 'image/png';
        void browserFile.arrayBuffer().then((bytes) =>
          uploadEvidenceBytes(browserFile.name, mimeType, bytes));
        return;
      }
      const path = result.tempFilePaths[0];
      if (!path) return;
      const name = path.split('/').at(-1) || 'evidence.jpg';
      const mimeType = name.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
      const manager = (uni as unknown as { getFileSystemManager: () => {
        readFile: (options: { filePath: string; success: (value: { data: ArrayBuffer }) => void; fail: () => void }) => void;
      } }).getFileSystemManager();
      manager.readFile({
        filePath: path,
        success: ({ data }) => {
          void uploadEvidenceBytes(name, mimeType, data);
        },
        fail: () => { message.value = '无法读取所选凭证，请重新选择。'; },
      });
    },
  });
}

function removeEvidence(fileId: string): void {
  if (formLocked.value) return;
  evidence.value = evidence.value.filter((item) => item.fileId !== fileId);
}

watch(formFingerprint, () => {
  if (pendingJournal.value !== null) return;
  preview.value = null;
  previewAttempt = null;
  message.value = '';
});

onLoad((query) => {
  orderId.value = typeof query?.order_id === 'string' ? query.order_id : '';
  if (!isUlid(orderId.value)) state.value = 'invalid';
});
onShow(() => {
  if (!isUlid(orderId.value)) return;
  if (authenticationRequired) authenticationRequired = false;
  void restoreAndLoadApplication();
});
onUnload(() => {
  ++showGeneration;
  ++generation;
  clearSlowTimer();
  preview.value = null;
});
</script>

<template>
  <QxStoreShell>
    <view class="aftersale-apply-page">
      <QxAccountHeader title="申请售后" />
      <QxCatalogState
        v-if="state === 'loading'"
        kind="loading"
        data-testid="aftersale-apply-loading"
        title="正在读取可退额度"
        :description="slowRequest ? '网络响应较慢，仍在读取服务端额度。' : '金额和数量将由服务端重新计算。'"
      />
      <QxCatalogState
        v-else-if="['invalid', 'not-found'].includes(state)"
        kind="empty"
        data-testid="aftersale-apply-not-found"
        title="订单不存在"
        description="订单编号无效，或该订单不属于当前账户。"
      />
      <QxCatalogState
        v-else-if="state === 'unavailable'"
        kind="empty"
        data-testid="aftersale-apply-unavailable"
        title="当前不能申请售后"
        description="请返回订单详情查看服务端当前允许的操作。"
      />
      <QxCatalogState
        v-else-if="state === 'auth-required'"
        kind="empty"
        title="登录后申请售后"
        description="售后申请只对订单本人开放。"
        action-label="重新登录"
        @action="requireLogin"
      />
      <QxCatalogState
        v-else-if="state === 'error' || state === 'rate-limited'"
        :kind="state === 'rate-limited' ? 'rate-limited' : 'error'"
        :retry-after-seconds="retryAfterSeconds"
        title="售后信息加载失败"
        description="暂时无法读取订单，请稍后重试。"
        action-label="重新加载"
        @action="restoreAndLoadApplication"
      />

      <view
        v-else-if="state === 'ready' && order"
        class="aftersale-apply-body"
        data-testid="aftersale-apply-ready"
      >
        <text
          v-if="message"
          class="aftersale-notice"
          role="status"
        >
          {{ message }}
        </text>
        <section class="apply-panel apply-order">
          <view><text>{{ order.order_no }}</text><text>{{ order.display_status }}</text></view>
          <text>仅选择数量，退款金额以服务端试算为准。</text>
        </section>

        <section class="apply-panel">
          <text class="apply-title">
            售后类型
          </text>
          <view
            class="segmented-control"
            role="radiogroup"
            aria-label="售后类型"
          >
            <button
              :class="{ active: type === 'REFUND_ONLY' }"
              :disabled="formLocked"
              @click="type = 'REFUND_ONLY'"
            >
              仅退款
            </button>
            <button
              :class="{ active: type === 'RETURN_REFUND' }"
              :disabled="formLocked"
              @click="type = 'RETURN_REFUND'"
            >
              退货退款
            </button>
          </view>
        </section>

        <section class="apply-panel">
          <text class="apply-title">
            选择商品与数量
          </text>
          <article
            v-for="item in eligibleItems"
            :key="item.order_item_id"
            class="apply-item"
          >
            <view><text>{{ item.product_name }}</text><text>{{ item.sku_name }} · 已购 {{ item.quantity }} · 当前可选 {{ item.visibleMaximum }}</text></view>
            <view class="quantity-stepper">
              <button
                aria-label="减少数量"
                :disabled="formLocked || !quantities[item.order_item_id]"
                @click="decrease(item.order_item_id)"
              >
                −
              </button>
              <text :data-testid="`aftersale-quantity-${item.order_item_id}`">
                {{ quantities[item.order_item_id] || 0 }}
              </text>
              <button
                aria-label="增加数量"
                :disabled="formLocked || (quantities[item.order_item_id] || 0) >= item.visibleMaximum"
                @click="increase(item.order_item_id, item.visibleMaximum)"
              >
                ＋
              </button>
            </view>
          </article>
        </section>

        <section class="apply-panel apply-reason">
          <label><text class="apply-title">申请原因</text>
            <picker
              :range="reasonOptions"
              range-key="label"
              :disabled="formLocked"
              @change="reasonCode = reasonOptions[Number(($event.detail as { value: string }).value)]?.value ?? reasonCode"
            >
              <view class="picker-value">{{ reasonOptions.find((item) => item.value === reasonCode)?.label }} ›</view>
            </picker>
          </label>
          <label><text>补充说明{{ reasonCode === 'OTHER' ? '（必填）' : '（选填）' }}</text>
            <textarea
              v-model="reasonText"
              :disabled="reasonLocked"
              maxlength="500"
              placeholder="请说明问题，勿填写手机号或地址"
            />
          </label>
        </section>

        <section class="apply-panel">
          <view class="evidence-heading">
            <text class="apply-title">
              问题凭证
            </text><text>{{ evidence.length }} / 9</text>
          </view>
          <view class="evidence-list">
            <view
              v-for="item in evidence"
              :key="item.fileId"
            >
              <text>{{ item.name }}</text><button
                :disabled="formLocked"
                aria-label="移除凭证"
                @click="removeEvidence(item.fileId)"
              >
                移除
              </button>
            </view>
          </view>
          <button
            class="evidence-upload"
            data-testid="aftersale-evidence-upload"
            :disabled="formLocked || evidence.length >= 9"
            @click="chooseEvidence"
          >
            {{ uploadPending ? '正在上传…' : '上传 JPEG / PNG 凭证' }}
          </button>
        </section>

        <section
          v-if="pendingJournal"
          class="apply-panel pending-confirm-panel"
          data-testid="aftersale-confirm-recovery"
        >
          <text class="apply-title">
            待核验的售后提交
          </text>
          <text>原确认编号已在本机安全保留，重试只会核验同一笔提交。</text>
        </section>

        <section
          v-if="preview && !pendingJournal"
          class="apply-panel preview-panel"
          data-testid="aftersale-preview"
        >
          <view>
            <text class="apply-title">
              服务端试算
            </text><strong>¥{{ preview.requested_amount }}</strong>
          </view>
          <view
            v-for="item in preview.items"
            :key="item.order_item_id"
            class="preview-line"
          >
            <text>申请 {{ item.requested_quantity }} 件 · 当前剩余 {{ item.remaining_refundable_quantity }} 件</text>
            <text>¥{{ item.allocated_amount }}</text>
          </view>
          <text
            v-if="preview.can_submit"
            class="preview-valid"
          >
            确认凭证仅在当前页面短时有效。
          </text>
        </section>
      </view>

      <view
        v-if="state === 'ready' && order"
        class="apply-actions"
      >
        <button
          v-if="pendingJournal"
          data-testid="aftersale-confirm-retry"
          :disabled="!canRetryPending"
          @click="retryPendingApplication"
        >
          {{ confirmPending ? '正在核验…' : '继续原确认操作' }}
        </button>
        <button
          v-else-if="!preview?.can_submit"
          data-testid="aftersale-preview-submit"
          :disabled="!canPreview"
          @click="requestPreview"
        >
          {{ previewPending ? '正在试算…' : '预览退款影响' }}
        </button>
        <button
          v-else
          data-testid="aftersale-confirm-submit"
          :disabled="confirmPending"
          @click="confirmApplication"
        >
          {{ confirmPending ? '正在提交…' : '确认提交售后' }}
        </button>
      </view>
    </view>
  </QxStoreShell>
</template>

<style scoped>
.aftersale-apply-page { min-height: 100vh; padding-bottom: calc(112rpx + env(safe-area-inset-bottom)); background: var(--qx-store-background); }
.aftersale-apply-body { display: grid; gap: 18rpx; padding: 22rpx 22rpx 42rpx; }
.aftersale-notice { display: block; padding: 18rpx 20rpx; border-radius: 9rpx; color: var(--qx-store-warning); background: #fff5df; font-size: 20rpx; line-height: 1.55; overflow-wrap: anywhere; }
.apply-panel { min-width: 0; padding: 24rpx; border: 1px solid var(--qx-store-line); border-radius: 12rpx; background: #fff; }
.apply-title { display: block; margin-bottom: 16rpx; font-size: 24rpx; font-weight: 800; }
.apply-order { display: grid; gap: 12rpx; }
.apply-order view { display: flex; justify-content: space-between; gap: 16rpx; font-size: 22rpx; font-weight: 750; }
.apply-order > text { color: var(--qx-store-muted); font-size: 18rpx; }
.segmented-control { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); padding: 4rpx; border-radius: 9rpx; background: var(--qx-store-surface-soft); }
.segmented-control button { min-height: 66rpx; border: 0; border-radius: 7rpx; color: var(--qx-store-text-soft); background: transparent; font-size: 21rpx; }
.segmented-control button.active { color: #fff; background: var(--qx-store-brand-strong); font-weight: 750; }
.apply-item { display: flex; min-width: 0; align-items: center; justify-content: space-between; gap: 20rpx; padding: 18rpx 0; border-bottom: 1px solid var(--qx-store-line); }
.apply-item:last-child { border-bottom: 0; }
.apply-item > view:first-child { display: grid; min-width: 0; gap: 7rpx; }
.apply-item > view:first-child text:first-child { font-size: 21rpx; font-weight: 750; }
.apply-item > view:first-child text:last-child { color: var(--qx-store-muted); font-size: 18rpx; overflow-wrap: anywhere; }
.quantity-stepper { display: grid; flex: 0 0 auto; grid-template-columns: 58rpx 54rpx 58rpx; align-items: center; text-align: center; }
.quantity-stepper button { min-height: 58rpx; border: 1px solid var(--qx-store-line); color: var(--qx-store-text); background: #fff; font-size: 24rpx; }
.quantity-stepper text { font-size: 21rpx; }
.apply-reason { display: grid; gap: 22rpx; }
.apply-reason label > text { display: block; margin-bottom: 10rpx; font-size: 20rpx; }
.picker-value { min-height: 70rpx; padding: 19rpx; border: 1px solid var(--qx-store-line); border-radius: 8rpx; font-size: 21rpx; }
.apply-reason textarea { box-sizing: border-box; width: 100%; min-height: 150rpx; padding: 18rpx; border: 1px solid var(--qx-store-line); border-radius: 8rpx; background: var(--qx-store-surface-soft); font-size: 20rpx; line-height: 1.55; }
.evidence-heading, .preview-panel > view:first-child { display: flex; align-items: center; justify-content: space-between; gap: 16rpx; }
.evidence-heading .apply-title, .preview-panel .apply-title { margin-bottom: 0; }
.evidence-heading > text:last-child { color: var(--qx-store-muted); font-size: 18rpx; }
.evidence-list { display: grid; gap: 8rpx; margin-top: 14rpx; }
.evidence-list view { display: flex; min-width: 0; align-items: center; justify-content: space-between; gap: 12rpx; padding: 12rpx 14rpx; border-radius: 7rpx; background: var(--qx-store-surface-soft); }
.evidence-list text { min-width: 0; overflow: hidden; font-size: 18rpx; text-overflow: ellipsis; white-space: nowrap; }
.evidence-list button { flex: 0 0 auto; border: 0; color: var(--qx-store-danger); background: transparent; font-size: 18rpx; }
.evidence-upload { width: 100%; min-height: 66rpx; margin-top: 16rpx; border: 1px dashed var(--qx-store-brand) !important; color: var(--qx-store-brand); background: #fff; font-size: 20rpx; }
.preview-panel { display: grid; gap: 14rpx; border-color: #bad6c9; background: #f5faf7; }
.pending-confirm-panel { display: grid; gap: 10rpx; border-color: #d8bc78; background: #fff9ec; }
.pending-confirm-panel .apply-title { margin-bottom: 0; }
.pending-confirm-panel > text:last-child { color: var(--qx-store-text-soft); font-size: 19rpx; line-height: 1.55; }
.preview-panel strong { color: var(--qx-store-danger); font-size: 28rpx; }
.preview-line { display: flex; justify-content: space-between; gap: 12rpx; padding-top: 12rpx; border-top: 1px solid #dbe9e2; font-size: 19rpx; }
.preview-valid { color: var(--qx-store-brand-strong); font-size: 18rpx; }
.apply-actions { position: fixed; z-index: 30; right: 0; bottom: 0; left: 0; width: 100%; max-width: 414px; margin: 0 auto; padding: 14rpx 22rpx calc(14rpx + env(safe-area-inset-bottom)); border-top: 1px solid var(--qx-store-line); background: rgba(255,255,255,.98); }
.apply-actions button { width: 100%; min-height: 76rpx; border: 0; border-radius: 9rpx; color: #fff; background: var(--qx-store-brand-strong); font-size: 22rpx; font-weight: 800; }
.apply-actions button[disabled] { color: var(--qx-store-muted); background: var(--qx-store-surface-soft); }
</style>
