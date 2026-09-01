<script setup lang="ts">
import { onLoad, onShow, onUnload } from '@dcloudio/uni-app';
import { computed, reactive, ref } from 'vue';

import {
  cancelStoreAftersale,
  createIdempotencyKey,
  getStoreAftersale,
  submitStoreAftersaleReturnShipment,
} from '../../api';
import { StoreApiError } from '../../api/store-client';
import QxAccountHeader from '../../components/storefront/QxAccountHeader.vue';
import QxCatalogState from '../../components/storefront/QxCatalogState.vue';
import QxStoreShell from '../../components/storefront/QxStoreShell.vue';
import type { StoreAftersaleDetail } from '../../types/store-aftersales';
import { clearCustomerSession } from '../../utils/customer-session';
import { sumMoney } from '../../utils/money';
import { replaceWithLoginForAction } from '../../utils/protected-action';
import { openOrder } from '../../utils/store-navigation';

type PageState = 'loading' | 'ready' | 'invalid' | 'not-found' | 'auth-required' | 'error' | 'rate-limited';
type DialogMode = 'CANCEL' | 'SHIPMENT' | null;

const state = ref<PageState>('loading');
const aftersaleId = ref('');
const detail = ref<StoreAftersaleDetail | null>(null);
const message = ref('');
const retryAfterSeconds = ref(0);
const slowRequest = ref(false);
const dialogMode = ref<DialogMode>(null);
const commandPending = ref(false);
const cancelReason = ref('');
const shipment = reactive({ carrierCode: '', carrierName: '', trackingNo: '' });
let generation = 0;
let slowTimer: ReturnType<typeof setTimeout> | undefined;
let commandAttempt: { fingerprint: string; key: string } | null = null;
let authenticationRequired = false;

const canCancel = computed(() => detail.value?.available_actions.includes('CANCEL') === true);
const canSubmitShipment = computed(() => detail.value?.available_actions.includes('SUBMIT_RETURN_SHIPMENT') === true);
const requestedAmount = computed(() => sumMoney(detail.value?.items.map(({ allocated_amount }) => allocated_amount) ?? []));
const dialogValid = computed(() => {
  if (dialogMode.value === 'CANCEL') {
    const length = Array.from(cancelReason.value.trim()).length;
    return length === 0 || (length >= 2 && length <= 500);
  }
  if (dialogMode.value === 'SHIPMENT') {
    return /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/.test(shipment.carrierCode.trim()) &&
      Array.from(shipment.carrierName.trim()).length >= 1 && Array.from(shipment.carrierName.trim()).length <= 80 &&
      /^[A-Za-z0-9][A-Za-z0-9._/-]{0,119}$/.test(shipment.trackingNo.trim());
  }
  return false;
});

function isUlid(value: string): boolean {
  return /^[0-9A-HJKMNP-TV-Z]{26}$/.test(value);
}

function clearSlowTimer(): void {
  if (slowTimer !== undefined) clearTimeout(slowTimer);
  slowTimer = undefined;
}

function formattedDate(value: string): string {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function statusLabel(status: StoreAftersaleDetail['status']): string {
  return ({
    CANCELLED: '已取消', COMPLETED: '已完成', PENDING_REVIEW: '待审核', REFUNDING: '退款处理中',
    REFUNDING_AFTER_RETURN: '退货退款中', REFUND_FAILED: '退款失败', REJECTED: '审核已拒绝',
    REJECTED_AFTER_RETURN: '验货后拒绝', RETURN_EXCEPTION: '验货异常', WAITING_RECEIPT: '等待总部收货',
    WAITING_RETURN: '等待退货',
  })[status];
}

function requireLogin(): void {
  authenticationRequired = true;
  state.value = 'auth-required';
  clearCustomerSession();
  replaceWithLoginForAction({ type: 'ORDERS' });
}

async function load(successMessage = ''): Promise<void> {
  if (!isUlid(aftersaleId.value)) {
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
    const next = await getStoreAftersale(aftersaleId.value);
    if (generation !== currentGeneration) return;
    detail.value = next;
    state.value = 'ready';
    message.value = successMessage;
  } catch (error) {
    if (generation !== currentGeneration) return;
    detail.value = null;
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

function openDialog(mode: Exclude<DialogMode, null>): void {
  if (commandPending.value) return;
  dialogMode.value = mode;
  cancelReason.value = '';
  shipment.carrierCode = '';
  shipment.carrierName = '';
  shipment.trackingNo = '';
  commandAttempt = null;
}

function closeDialog(): void {
  if (commandPending.value) return;
  dialogMode.value = null;
  commandAttempt = null;
}

function commandFingerprint(current: StoreAftersaleDetail): string {
  if (dialogMode.value === 'CANCEL') {
    return JSON.stringify({ action: 'CANCEL', reason: cancelReason.value.trim() || null, version: current.version });
  }
  return JSON.stringify({
    action: 'SHIPMENT', carrier_code: shipment.carrierCode.trim(), carrier_name: shipment.carrierName.trim(),
    tracking_no: shipment.trackingNo.trim(), version: current.version,
  });
}

async function submitCommand(): Promise<void> {
  const current = detail.value;
  const mode = dialogMode.value;
  if (current === null || mode === null || !dialogValid.value || commandPending.value) return;
  const fingerprint = commandFingerprint(current);
  if (commandAttempt?.fingerprint !== fingerprint) commandAttempt = { fingerprint, key: createIdempotencyKey() };
  commandPending.value = true;
  message.value = '';
  try {
    if (mode === 'CANCEL') {
      const reason = cancelReason.value.trim();
      await cancelStoreAftersale(current.aftersale_id, current.version, reason ? { reason } : {}, commandAttempt.key);
    } else {
      await submitStoreAftersaleReturnShipment(current.aftersale_id, {
        carrier_code: shipment.carrierCode.trim(),
        carrier_name: shipment.carrierName.trim(),
        tracking_no: shipment.trackingNo.trim(),
      }, current.version, commandAttempt.key);
    }
    commandAttempt = null;
    dialogMode.value = null;
    await load(mode === 'CANCEL' ? '售后申请已取消。' : '退货物流已提交，请保留寄件凭证。');
  } catch (error) {
    if (error instanceof StoreApiError && error.status === 401) {
      commandAttempt = null;
      dialogMode.value = null;
      requireLogin();
    } else if (error instanceof StoreApiError && error.status === 404) {
      commandAttempt = null;
      dialogMode.value = null;
      state.value = 'not-found';
      detail.value = null;
    } else if (error instanceof StoreApiError && [409, 422].includes(error.status)) {
      commandAttempt = null;
      dialogMode.value = null;
      await load(error.status === 409
        ? '售后状态已变化，已刷新；请根据最新动作重新操作。'
        : '当前操作条件不再满足，已刷新最新状态。');
    } else if (error instanceof StoreApiError && error.status === 429) {
      retryAfterSeconds.value = error.retryAfterSeconds ?? 1;
      message.value = `请求较频繁，请在 ${retryAfterSeconds.value} 秒后保持表单不变重试。`;
    } else message.value = '操作结果暂时无法确认，请保持表单不变并使用同一按钮重试。';
  } finally {
    commandPending.value = false;
  }
}

onLoad((query) => {
  aftersaleId.value = typeof query?.aftersale_id === 'string' ? query.aftersale_id : '';
  if (!isUlid(aftersaleId.value)) state.value = 'invalid';
});
onShow(() => {
  if (!isUlid(aftersaleId.value)) return;
  if (authenticationRequired) authenticationRequired = false;
  void load();
});
onUnload(() => {
  ++generation;
  clearSlowTimer();
  commandAttempt = null;
});
</script>

<template>
  <QxStoreShell>
    <view class="aftersale-detail-page">
      <QxAccountHeader title="售后详情" />
      <QxCatalogState
        v-if="state === 'loading'"
        kind="loading"
        data-testid="aftersale-detail-loading"
        title="正在读取售后进度"
        :description="slowRequest ? '网络响应较慢，仍在读取退款和验货投影。' : '正在读取服务端最新状态。'"
      />
      <QxCatalogState
        v-else-if="state === 'invalid' || state === 'not-found'"
        kind="empty"
        data-testid="aftersale-detail-not-found"
        title="售后记录不存在"
        description="编号无效，或该记录不属于当前账户。"
      />
      <QxCatalogState
        v-else-if="state === 'auth-required'"
        kind="empty"
        title="登录后查看售后"
        description="售后详情只对当前账户本人开放。"
        action-label="重新登录"
        @action="requireLogin"
      />
      <QxCatalogState
        v-else-if="state === 'error' || state === 'rate-limited'"
        :kind="state === 'rate-limited' ? 'rate-limited' : 'error'"
        :retry-after-seconds="retryAfterSeconds"
        title="售后详情加载失败"
        description="暂时无法读取售后进度，请稍后重试。"
        action-label="重新加载"
        @action="load()"
      />

      <view
        v-else-if="state === 'ready' && detail"
        class="aftersale-detail-body"
        data-testid="aftersale-detail-ready"
      >
        <text
          v-if="message"
          class="aftersale-notice"
          role="status"
        >
          {{ message }}
        </text>
        <section
          class="status-panel"
          :class="{ danger: detail.status === 'REFUND_FAILED' || detail.status === 'RETURN_EXCEPTION' }"
        >
          <text>{{ statusLabel(detail.status) }}</text>
          <text>{{ detail.aftersale_no }} · {{ detail.type === 'RETURN_REFUND' ? '退货退款' : '仅退款' }}</text>
        </section>

        <section class="detail-panel">
          <view class="panel-heading">
            <text>申请商品</text><text data-testid="aftersale-requested-total">
              申请 ¥{{ requestedAmount }}
            </text>
          </view>
          <article
            v-for="item in detail.items"
            :key="item.aftersale_item_id"
            class="item-row"
          >
            <view><text>{{ item.product_name }}</text><text>{{ item.sku_name }}</text></view>
            <view><text>申请 {{ item.requested_quantity }} 件</text><text>已退 {{ item.refunded_quantity }} 件</text></view>
          </article>
          <text class="reason-copy">
            申请原因：{{ detail.reason }}
          </text>
        </section>

        <section
          v-if="detail.return_address"
          class="detail-panel"
          data-testid="aftersale-return-address"
        >
          <view class="panel-heading">
            <text>总部退货地址</text><text>仅用于本次退货</text>
          </view>
          <text class="address-person">
            {{ detail.return_address.recipient_name }} · {{ detail.return_address.phone }}
          </text>
          <text class="address-copy">
            {{ detail.return_address.province }} {{ detail.return_address.city }} {{ detail.return_address.district }} {{ detail.return_address.detail }}
          </text>
        </section>

        <section
          v-if="detail.return_shipment"
          class="detail-panel shipment-panel"
        >
          <view class="panel-heading">
            <text>退货物流</text><text>{{ formattedDate(detail.return_shipment.submitted_at) }}</text>
          </view>
          <view><text>承运方</text><text>{{ detail.return_shipment.carrier_name }}</text></view>
          <view><text>运单号</text><text>{{ detail.return_shipment.tracking_no }}</text></view>
        </section>

        <section
          v-if="detail.inspection"
          class="detail-panel inspection-panel"
          data-testid="aftersale-inspection"
        >
          <view class="panel-heading">
            <text>总部验货</text><text>{{ detail.inspection.result === 'PASS' ? '验货通过' : '验货异常' }}</text>
          </view>
          <text
            v-if="detail.inspection.abnormal_reason"
            class="inspection-warning"
          >
            {{ detail.inspection.abnormal_reason }}
          </text>
          <view
            v-for="item in detail.inspection.items"
            :key="item.order_item_id"
            class="inspection-line"
          >
            <text>实收 {{ item.received_qty }} · 批准退款 {{ item.approved_refund_qty }}</text>
            <text>回库 {{ item.restock_qty }} · 损坏 {{ item.damaged_qty }} · 报废 {{ item.scrap_qty }} · 退回 {{ item.return_to_customer_qty }}</text>
          </view>
          <view
            class="inspection-evidence-summary"
            data-testid="aftersale-inspection-evidence-summary"
          >
            <text>验货证据</text>
            <text>{{ detail.inspection.evidence_file_ids.length > 0 ? `${detail.inspection.evidence_file_ids.length} 份受控留存` : '无证据' }}</text>
          </view>
          <text
            v-if="detail.inspection.resolution"
            class="resolution-copy"
          >
            处理：{{ detail.inspection.resolution }} · {{ detail.inspection.resolution_reason }}
          </text>
        </section>

        <section
          v-if="detail.refund_attempts.length || detail.errors.length"
          class="detail-panel refund-panel"
        >
          <text class="panel-title">
            退款处理
          </text>
          <view
            v-for="attempt in detail.refund_attempts"
            :key="`${attempt.refund_id}:${attempt.attempt_no}`"
            class="refund-line"
          >
            <view><text>{{ attempt.refund_no }}</text><text>第 {{ attempt.attempt_no }} 次 · {{ attempt.status }}</text></view><strong>¥{{ attempt.amount }}</strong>
          </view>
          <text
            v-for="entry in detail.errors"
            :key="`${entry.error_code}:${entry.occurred_at}`"
            class="safe-error"
          >
            {{ entry.message }}
          </text>
        </section>

        <section class="detail-panel timeline-panel">
          <text class="panel-title">
            处理时间线
          </text>
          <view
            v-for="event in detail.timeline"
            :key="event.event_id"
            class="timeline-row"
          >
            <view class="timeline-dot" /><view><text>{{ event.event }}</text><text>{{ event.from_status || '开始' }} → {{ event.to_status }} · {{ formattedDate(event.occurred_at) }}</text></view>
          </view>
        </section>
      </view>

      <view
        v-if="state === 'ready' && detail"
        class="detail-actions"
      >
        <button
          class="secondary"
          @click="openOrder(detail.order.order_id)"
        >
          查看订单
        </button>
        <button
          v-if="canCancel"
          class="danger"
          data-testid="aftersale-cancel"
          :disabled="commandPending"
          @click="openDialog('CANCEL')"
        >
          取消申请
        </button>
        <button
          v-if="canSubmitShipment"
          data-testid="aftersale-submit-shipment"
          :disabled="commandPending"
          @click="openDialog('SHIPMENT')"
        >
          填写退货物流
        </button>
      </view>

      <view
        v-if="dialogMode"
        class="command-sheet"
        role="dialog"
        aria-modal="true"
        @click.self="closeDialog"
      >
        <view class="command-sheet__panel">
          <text class="command-sheet__title">
            {{ dialogMode === 'CANCEL' ? '取消售后申请' : '填写退货物流' }}
          </text>
          <template v-if="dialogMode === 'CANCEL'">
            <text class="command-sheet__copy">
              取消后将释放尚未消费的售后占用，是否可再次申请以服务端为准。
            </text>
            <textarea
              v-model="cancelReason"
              :disabled="commandPending"
              maxlength="500"
              placeholder="取消原因（选填，填写时至少 2 个字符）"
            />
          </template>
          <template v-else>
            <label><text>承运商编码</text><input
              v-model="shipment.carrierCode"
              :disabled="commandPending"
              maxlength="40"
              placeholder="例如 SF"
            ></label>
            <label><text>承运商名称</text><input
              v-model="shipment.carrierName"
              :disabled="commandPending"
              maxlength="80"
              placeholder="例如 顺丰速运"
            ></label>
            <label><text>运单号</text><input
              v-model="shipment.trackingNo"
              :disabled="commandPending"
              maxlength="120"
              placeholder="请输入退货运单号"
            ></label>
          </template>
          <view class="command-sheet__actions">
            <button
              :disabled="commandPending"
              @click="closeDialog"
            >
              返回
            </button><button
              class="submit"
              :disabled="!dialogValid || commandPending"
              data-testid="aftersale-command-submit"
              @click="submitCommand"
            >
              {{ commandPending ? '正在提交…' : '确认提交' }}
            </button>
          </view>
        </view>
      </view>
    </view>
  </QxStoreShell>
</template>

<style scoped>
.aftersale-detail-page { min-height: 100vh; padding-bottom: calc(112rpx + env(safe-area-inset-bottom)); background: var(--qx-store-background); }
.aftersale-detail-body { display: grid; gap: 18rpx; padding: 22rpx 22rpx 42rpx; }
.aftersale-notice { display: block; padding: 18rpx 20rpx; border-radius: 9rpx; color: var(--qx-store-warning); background: #fff5df; font-size: 20rpx; line-height: 1.55; overflow-wrap: anywhere; }
.status-panel { display: grid; gap: 8rpx; padding: 28rpx; border-radius: 12rpx; color: #fff; background: var(--qx-store-brand-strong); }
.status-panel.danger { background: #9d4848; }
.status-panel text:first-child { font-size: 32rpx; font-weight: 800; }
.status-panel text:last-child { color: rgba(255,255,255,.78); font-size: 18rpx; overflow-wrap: anywhere; }
.detail-panel { min-width: 0; padding: 24rpx; border: 1px solid var(--qx-store-line); border-radius: 12rpx; background: #fff; }
.panel-heading { display: flex; align-items: center; justify-content: space-between; gap: 16rpx; margin-bottom: 16rpx; }
.panel-heading text:first-child, .panel-title { font-size: 24rpx; font-weight: 800; }
.panel-heading text:last-child { color: var(--qx-store-muted); font-size: 18rpx; text-align: right; }
.item-row { display: flex; min-width: 0; justify-content: space-between; gap: 16rpx; padding: 16rpx 0; border-top: 1px solid var(--qx-store-line); }
.item-row view { display: grid; min-width: 0; gap: 5rpx; }
.item-row view:last-child { flex: 0 0 auto; text-align: right; }
.item-row text { font-size: 19rpx; overflow-wrap: anywhere; }
.item-row view text:first-child { font-weight: 750; }
.item-row view text:last-child, .reason-copy { color: var(--qx-store-muted); font-size: 18rpx; }
.reason-copy { display: block; padding-top: 14rpx; border-top: 1px solid var(--qx-store-line); line-height: 1.55; overflow-wrap: anywhere; }
.address-person, .address-copy { display: block; overflow-wrap: anywhere; }
.address-person { font-size: 21rpx; font-weight: 750; }
.address-copy { margin-top: 9rpx; color: var(--qx-store-text-soft); font-size: 19rpx; line-height: 1.55; }
.shipment-panel, .inspection-panel, .refund-panel, .timeline-panel { display: grid; gap: 14rpx; }
.shipment-panel > view:not(.panel-heading), .inspection-line { display: flex; justify-content: space-between; gap: 14rpx; font-size: 19rpx; }
.shipment-panel > view:not(.panel-heading) text:first-child { color: var(--qx-store-muted); }
.inspection-warning, .safe-error { display: block; padding: 14rpx; border-radius: 7rpx; color: var(--qx-store-danger); background: #fff1f0; font-size: 19rpx; line-height: 1.5; }
.inspection-line { display: grid; padding-top: 12rpx; border-top: 1px solid var(--qx-store-line); }
.inspection-line text:last-child, .resolution-copy { color: var(--qx-store-muted); font-size: 18rpx; overflow-wrap: anywhere; }
.inspection-evidence-summary { display: flex; align-items: center; justify-content: space-between; gap: 14rpx; padding-top: 12rpx; border-top: 1px solid var(--qx-store-line); font-size: 19rpx; }
.inspection-evidence-summary text:last-child { color: var(--qx-store-muted); font-size: 18rpx; text-align: right; }
.refund-line { display: flex; align-items: center; justify-content: space-between; gap: 14rpx; padding-top: 12rpx; border-top: 1px solid var(--qx-store-line); }
.refund-line view { display: grid; gap: 5rpx; }
.refund-line text { font-size: 19rpx; }
.refund-line view text:last-child { color: var(--qx-store-muted); font-size: 17rpx; }
.refund-line strong { color: var(--qx-store-danger); }
.timeline-row { display: grid; min-width: 0; grid-template-columns: 18rpx minmax(0, 1fr); gap: 12rpx; }
.timeline-dot { width: 14rpx; height: 14rpx; margin-top: 5rpx; border-radius: 50%; background: var(--qx-store-brand); }
.timeline-row > view:last-child { display: grid; gap: 5rpx; }
.timeline-row text:first-child { font-size: 20rpx; font-weight: 750; }
.timeline-row text:last-child { color: var(--qx-store-muted); font-size: 17rpx; overflow-wrap: anywhere; }
.detail-actions { position: fixed; z-index: 30; right: 0; bottom: 0; left: 0; display: flex; width: 100%; max-width: 414px; gap: 10rpx; margin: 0 auto; padding: 14rpx 20rpx calc(14rpx + env(safe-area-inset-bottom)); border-top: 1px solid var(--qx-store-line); background: rgba(255,255,255,.98); }
.detail-actions button { min-width: 0; min-height: 72rpx; flex: 1; padding: 0 14rpx; border: 1px solid var(--qx-store-brand-strong) !important; border-radius: 8rpx; color: #fff; background: var(--qx-store-brand-strong); font-size: 20rpx; font-weight: 750; }
.detail-actions .secondary { color: var(--qx-store-brand); background: #fff; }
.detail-actions .danger { border-color: var(--qx-store-danger) !important; color: var(--qx-store-danger); background: #fff; }
.command-sheet { position: fixed; z-index: 60; inset: 0; display: flex; width: 100%; max-width: 414px; align-items: flex-end; margin: 0 auto; padding: 20rpx 20rpx calc(20rpx + env(safe-area-inset-bottom)); background: rgba(20,29,25,.48); }
.command-sheet__panel { display: grid; width: 100%; gap: 18rpx; padding: 28rpx; border-radius: 12rpx; background: #fff; }
.command-sheet__title { font-size: 27rpx; font-weight: 800; }
.command-sheet__copy { color: var(--qx-store-text-soft); font-size: 19rpx; line-height: 1.55; }
.command-sheet textarea, .command-sheet input { box-sizing: border-box; width: 100%; min-height: 70rpx; padding: 16rpx; border: 1px solid var(--qx-store-line); border-radius: 8rpx; font-size: 20rpx; }
.command-sheet textarea { min-height: 130rpx; }
.command-sheet label { display: grid; gap: 8rpx; font-size: 19rpx; }
.command-sheet__actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12rpx; }
.command-sheet__actions button { min-height: 70rpx; border: 1px solid var(--qx-store-line) !important; border-radius: 8rpx; color: var(--qx-store-text-soft); background: #fff; font-size: 20rpx; }
.command-sheet__actions .submit { border-color: var(--qx-store-brand-strong) !important; color: #fff; background: var(--qx-store-brand-strong); }
</style>
