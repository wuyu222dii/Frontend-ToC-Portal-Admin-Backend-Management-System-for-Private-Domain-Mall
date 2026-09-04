<script setup lang="ts">
import {
  ArrowLeft,
  Box,
  Check,
  DataAnalysis,
  Document,
  Location,
  Refresh,
  Van,
} from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import FulfillmentAddressDialog from '../../components/orders/FulfillmentAddressDialog.vue';
import OrderFulfillmentCommandDialog from '../../components/orders/OrderFulfillmentCommandDialog.vue';
import OrderRefundCommandDialog, {
  type OrderRefundCommandMode,
} from '../../components/orders/OrderRefundCommandDialog.vue';
import AdminShell from '../../layouts/AdminShell.vue';
import { AdminApiError } from '../../services/admin-api';
import { getAdminOrder } from '../../services/admin-orders';
import { recoverAdminRefundCommandJournal } from '../../services/admin-refund-command-journal';
import { authSession } from '../../stores/auth-session';
import type { AdminOrderDetail } from '../../types/orders';
import { formatChinaDateTime } from '../../utils/time';

type CommandMode = 'COMPLETE' | 'LOGISTICS' | 'SHIP';

const route = useRoute();
const router = useRouter();
const detail = ref<AdminOrderDetail | null>(null);
const loading = ref(false);
const errorMessage = ref('');
const addressOpen = ref(false);
const commandOpen = ref(false);
const commandMode = ref<CommandMode>('SHIP');
const refundCommandOpen = ref(false);
const refundCommandMode = ref<OrderRefundCommandMode>('MANUAL_COMPENSATION');
const refundJournalBlocked = ref(false);
let sequence = 0;
let controller: AbortController | null = null;

const orderId = computed(() => String(route.params.order_id ?? ''));
const shipment = computed(() => detail.value?.packages[0] ?? null);
const shipmentVersion = computed(() => shipment.value?.version);

function hasAction(action: AdminOrderDetail['available_actions'][number]): boolean {
  return detail.value?.available_actions.includes(action) === true;
}

function readableError(error: unknown): string {
  if (!(error instanceof AdminApiError)) return '订单详情加载失败，请稍后重试';
  if (error.status === 0) return '网络连接失败，请检查网络后重试';
  if (error.status === 400) return '订单标识无效';
  if (error.status === 403) return '当前账号无权查看该订单';
  if (error.status === 404) return '订单不存在或已不可访问';
  if (error.status === 429) {
    return error.retryAfterSeconds
      ? `查询过于频繁，请在 ${error.retryAfterSeconds} 秒后重试`
      : '查询过于频繁，请稍后重试';
  }
  return '订单详情加载失败，请稍后重试';
}

async function handleSessionError(error: unknown): Promise<boolean> {
  if (authSession.state.session && (!(error instanceof AdminApiError) || error.status !== 401)) return false;
  ++sequence;
  controller?.abort();
  addressOpen.value = false;
  commandOpen.value = false;
  refundCommandOpen.value = false;
  authSession.clearSession();
  await router.replace('/login');
  return true;
}

async function loadDetail(): Promise<void> {
  const currentSequence = ++sequence;
  controller?.abort();
  const current = new AbortController();
  controller = current;
  loading.value = true;
  errorMessage.value = '';
  refundJournalBlocked.value = false;
  try {
    const result = await getAdminOrder(orderId.value, current.signal);
    if (currentSequence !== sequence) return;
    detail.value = result;
    try {
      const journal = await recoverAdminRefundCommandJournal();
      if (currentSequence === sequence && journal !== null) {
        if (journal.order_id !== result.order_id) {
          refundJournalBlocked.value = true;
          await router.replace({ name: 'order-detail', params: { order_id: journal.order_id } });
          return;
        }
        refundCommandMode.value = journal.mode;
        refundCommandOpen.value = true;
      }
    } catch {
      if (currentSequence === sequence) {
        refundJournalBlocked.value = true;
        errorMessage.value = '待确认资金操作的本机记录无法安全读取，确认操作已禁用。';
      }
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    if (currentSequence !== sequence || await handleSessionError(error)) return;
    detail.value = null;
    errorMessage.value = readableError(error);
  } finally {
    if (currentSequence === sequence) {
      loading.value = false;
      controller = null;
    }
  }
}

function openCommand(mode: CommandMode): void {
  commandMode.value = mode;
  commandOpen.value = true;
}

function openRefundCommand(mode: OrderRefundCommandMode): void {
  if (refundJournalBlocked.value) return;
  refundCommandMode.value = mode;
  refundCommandOpen.value = true;
}

async function commandCompleted(message: string): Promise<void> {
  ElMessage.success(message);
  await loadDetail();
}

async function commandConflict(): Promise<void> {
  addressOpen.value = false;
  commandOpen.value = false;
  refundCommandOpen.value = false;
  await loadDetail();
  ElMessage.warning('订单或包裹版本已变化，已刷新最新投影，请重新确认后操作');
}

async function authExpired(error: AdminApiError): Promise<void> {
  await handleSessionError(error);
}

function orderStatusTone(value: AdminOrderDetail['order_status']): string {
  if (value === 'COMPLETED') return 'success';
  if (value === 'CLOSED') return 'danger';
  if (value === 'SHIPPING') return 'info';
  return 'pending';
}

function axisLabel(value: AdminOrderDetail['timeline'][number]['axis']): string {
  return ({ AFTERSALE: '售后', FULFILLMENT: '履约', ORDER: '订单', PAYMENT: '支付', REFUND: '退款' })[value];
}

watch(orderId, () => {
  addressOpen.value = false;
  commandOpen.value = false;
  refundCommandOpen.value = false;
  detail.value = null;
  void loadDetail();
}, { immediate: true });
onBeforeUnmount(() => {
  ++sequence;
  controller?.abort();
  addressOpen.value = false;
  commandOpen.value = false;
  refundCommandOpen.value = false;
});
</script>

<template>
  <AdminShell>
    <div
      class="order-detail-page"
      data-testid="admin-order-detail-page"
    >
      <section class="detail-heading">
        <div>
          <el-button
            text
            data-testid="admin-order-back"
            @click="router.push('/orders')"
          >
            <el-icon><ArrowLeft /></el-icon>返回订单列表
          </el-button>
          <p>订单履约 · ADM-10 / ADM-11</p>
          <h1>{{ detail?.order_no || '订单详情' }}</h1>
          <span v-if="detail">{{ detail.display_status }} · 订单版本 {{ detail.version }}</span>
        </div>
        <el-button
          data-testid="admin-order-refresh"
          :loading="loading"
          :disabled="commandOpen || addressOpen || refundCommandOpen"
          @click="loadDetail"
        >
          <el-icon><Refresh /></el-icon>刷新投影
        </el-button>
      </section>

      <div
        v-if="loading"
        class="detail-state"
        data-testid="admin-order-detail-loading"
      >
        <el-skeleton
          :rows="10"
          animated
        />
      </div>
      <div
        v-else-if="errorMessage"
        class="detail-state centered"
        data-testid="admin-order-detail-error"
      >
        <el-icon><Document /></el-icon>
        <strong>{{ errorMessage }}</strong>
        <el-button
          type="primary"
          @click="loadDetail"
        >
          重新加载
        </el-button>
      </div>

      <template v-else-if="detail">
        <section
          class="order-actions"
          data-testid="admin-order-actions"
        >
          <div>
            <span
              class="order-status"
              :class="orderStatusTone(detail.order_status)"
            >{{ detail.display_status }}</span>
            <small>只显示服务端当前允许的履约命令</small>
          </div>
          <div class="action-buttons">
            <el-button
              v-if="hasAction('READ_FULFILLMENT_ADDRESS')"
              data-testid="admin-order-read-address"
              @click="addressOpen = true"
            >
              <el-icon><Location /></el-icon>受控读取地址
            </el-button>
            <el-button
              v-if="hasAction('SHIP')"
              type="primary"
              data-testid="admin-order-ship"
              @click="openCommand('SHIP')"
            >
              <el-icon><Van /></el-icon>整单发货
            </el-button>
            <el-button
              v-if="hasAction('ADD_LOGISTICS_EVENT')"
              type="primary"
              plain
              data-testid="admin-order-logistics"
              @click="openCommand('LOGISTICS')"
            >
              <el-icon><Van /></el-icon>维护物流
            </el-button>
            <el-button
              v-if="hasAction('COMPLETE')"
              type="warning"
              plain
              data-testid="admin-order-complete"
              @click="openCommand('COMPLETE')"
            >
              <el-icon><Check /></el-icon>兜底完成
            </el-button>
            <el-button
              v-if="hasAction('RECONCILE_PAYMENT')"
              data-testid="admin-order-reconcile-link"
              @click="router.push('/orders/reconciliation')"
            >
              查看支付对账
            </el-button>
            <el-button
              v-if="detail.payment_status === 'PAID' && detail.attribution.source === 'AGENT'"
              data-testid="admin-order-commission-explanation"
              @click="router.push({ name: 'commission-rules', query: { order_id: detail.order_id } })"
            >
              <el-icon><DataAnalysis /></el-icon>佣金解释
            </el-button>
            <el-button
              v-if="hasAction('RETRY_REFUND')"
              type="warning"
              plain
              :disabled="refundJournalBlocked"
              data-testid="admin-order-retry-refund"
              @click="openRefundCommand('RETRY_REFUND')"
            >
              重试失败退款
            </el-button>
            <el-button
              v-if="hasAction('MANUAL_COMPENSATION')"
              type="danger"
              plain
              :disabled="refundJournalBlocked"
              data-testid="admin-order-manual-compensation"
              @click="openRefundCommand('MANUAL_COMPENSATION')"
            >
              金额补偿
            </el-button>
          </div>
        </section>

        <section
          class="axis-strip"
          aria-label="订单状态轴"
        >
          <div><span>订单</span><strong>{{ detail.order_status }}</strong></div>
          <div><span>支付</span><strong>{{ detail.payment_status }}</strong></div>
          <div><span>退款进度</span><strong>{{ detail.refund_progress_status }}</strong></div>
          <div><span>退款处理</span><strong>{{ detail.refund_processing_status }}</strong></div>
          <div><span>履约</span><strong>{{ detail.fulfillment_status }}</strong></div>
          <div><span>支付处置</span><strong>{{ detail.payment_resolution }}</strong></div>
        </section>

        <section
          class="detail-grid"
          data-testid="admin-order-detail-content"
        >
          <article class="detail-card amounts-card">
            <header><strong>金额快照</strong><span>历史只读</span></header>
            <div class="amount-grid">
              <div><span>商品</span><strong>¥{{ detail.amounts.goods }}</strong></div>
              <div><span>运费</span><strong>¥{{ detail.amounts.shipping }}</strong></div>
              <div><span>应付</span><strong>¥{{ detail.amounts.payable }}</strong></div>
              <div><span>已付</span><strong>¥{{ detail.amounts.paid }}</strong></div>
              <div><span>已退</span><strong>¥{{ detail.amounts.refunded }}</strong></div>
            </div>
          </article>

          <article class="detail-card identity-card">
            <header><strong>客户与归因</strong><span>掩码经营投影</span></header>
            <dl>
              <div><dt>客户</dt><dd>{{ detail.customer.customer_alias }}</dd></div>
              <div><dt>联系方式</dt><dd>{{ detail.customer.phone_masked || '未提供' }}</dd></div>
              <div><dt>归因</dt><dd>{{ detail.attribution.agent_name || '直营' }}</dd></div>
              <div><dt>冻结时间</dt><dd>{{ detail.attribution.frozen_at ? formatChinaDateTime(detail.attribution.frozen_at) : '不适用' }}</dd></div>
            </dl>
          </article>

          <article
            class="detail-card address-card"
            data-testid="admin-order-masked-address"
          >
            <header><strong>履约地址</strong><span>普通详情只返回掩码</span></header>
            <dl>
              <div><dt>收件人</dt><dd>{{ detail.shipping_address_masked.recipient_name_masked }}</dd></div>
              <div><dt>手机号</dt><dd>{{ detail.shipping_address_masked.phone_masked }}</dd></div>
              <div><dt>地区</dt><dd>{{ detail.shipping_address_masked.region_summary }}</dd></div>
              <div><dt>地址</dt><dd>{{ detail.shipping_address_masked.detail_masked }}</dd></div>
            </dl>
          </article>

          <article class="detail-card items-card">
            <header><strong>订单商品</strong><span>{{ detail.items.length }} 个 SKU</span></header>
            <div class="item-table">
              <div class="item-table-head">
                <span>商品 / SKU</span><span>单价</span><span>购买</span><span>已退</span><span>售后占用</span><span>已发</span>
              </div>
              <div
                v-for="item in detail.items"
                :key="item.order_item_id"
                class="item-row"
              >
                <div data-label="商品 / SKU">
                  <strong>{{ item.product_name }}</strong><small>{{ item.sku_name }}</small>
                </div>
                <div data-label="单价">
                  ¥{{ item.unit_price }}
                </div>
                <div data-label="购买">
                  {{ item.quantity }}
                </div>
                <div data-label="已退">
                  {{ item.refunded_quantity }}
                </div>
                <div data-label="售后占用">
                  {{ item.reserved_aftersale_quantity }}
                </div>
                <div data-label="已发">
                  {{ item.shipped_quantity }}
                </div>
              </div>
            </div>
          </article>

          <article
            class="detail-card package-card"
            data-testid="admin-order-package"
          >
            <header><strong>唯一包裹</strong><span>{{ shipment ? shipment.status : '尚未发货' }}</span></header>
            <div
              v-if="!shipment"
              class="inline-empty"
            >
              <el-icon><Box /></el-icon><span>当前订单没有包裹。</span>
            </div>
            <template v-else>
              <dl class="package-summary">
                <div><dt>承运商</dt><dd>{{ shipment.carrier_name }}</dd></div>
                <div><dt>运单号</dt><dd>{{ shipment.tracking_no }}</dd></div>
                <div><dt>包裹版本</dt><dd>{{ shipment.version }}</dd></div>
                <div><dt>发货时间</dt><dd>{{ shipment.shipped_at ? formatChinaDateTime(shipment.shipped_at) : '—' }}</dd></div>
              </dl>
              <div
                class="logistics-events"
                data-testid="admin-order-logistics-timeline"
              >
                <div
                  v-for="event in shipment.events"
                  :key="event.event_id"
                >
                  <span
                    class="event-dot"
                    aria-hidden="true"
                  />
                  <div>
                    <strong>{{ event.event_type === 'STATUS' ? event.status_code : '承运信息纠错' }}</strong>
                    <p>
                      {{ event.description }}<template v-if="event.location">
                        · {{ event.location }}
                      </template>
                    </p>
                    <small>{{ formatChinaDateTime(event.occurred_at) }}</small>
                  </div>
                </div>
                <p
                  v-if="shipment.events.length === 0"
                  class="muted-copy"
                >
                  暂无人工物流节点。
                </p>
              </div>
            </template>
          </article>

          <article class="detail-card timeline-card">
            <header><strong>订单时间线</strong><span>按服务端时间稳定排序</span></header>
            <div class="order-timeline">
              <div
                v-for="event in detail.timeline"
                :key="event.event_id"
              >
                <span class="axis-label">{{ axisLabel(event.axis) }}</span>
                <div>
                  <strong>{{ event.event }}</strong>
                  <p>{{ event.from_status || '初始' }} → {{ event.to_status }}</p>
                </div>
                <small>{{ formatChinaDateTime(event.occurred_at) }}</small>
              </div>
            </div>
          </article>

          <article
            v-if="detail.aftersales.length || detail.errors.length"
            class="detail-card exception-card"
          >
            <header><strong>关联阻断与异常</strong><span>只读，不提供普通售后操作</span></header>
            <div class="exception-list">
              <div
                v-for="item in detail.aftersales"
                :key="item.aftersale_id"
              >
                <strong>{{ item.aftersale_no }} · {{ item.status }}</strong>
                <span>{{ item.type }} · ¥{{ item.requested_amount }}</span>
              </div>
              <div
                v-for="error in detail.errors"
                :key="`${error.error_code}:${error.occurred_at}`"
              >
                <strong>{{ error.error_code }}</strong>
                <span>{{ error.message }}</span>
              </div>
            </div>
          </article>
        </section>
      </template>
    </div>

    <FulfillmentAddressDialog
      v-if="detail"
      v-model:open="addressOpen"
      :order-id="detail.order_id"
      :order-no="detail.order_no"
      @auth-expired="authExpired"
    />
    <OrderFulfillmentCommandDialog
      v-if="detail"
      v-model:open="commandOpen"
      :mode="commandMode"
      :order="detail"
      :shipment-version="shipmentVersion"
      @completed="commandCompleted"
      @conflict="commandConflict"
      @auth-expired="authExpired"
    />
    <OrderRefundCommandDialog
      v-if="detail"
      v-model:open="refundCommandOpen"
      :mode="refundCommandMode"
      :order="detail"
      @auth-expired="authExpired"
      @completed="commandCompleted"
      @conflict="commandConflict"
    />
  </AdminShell>
</template>

<style scoped>
.order-detail-page {
  min-width: 0;
}

.detail-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 20px;
}

.detail-heading > div {
  min-width: 0;
}

.detail-heading p {
  margin: 12px 0 0;
  color: var(--admin-brand);
  font-size: 11px;
  font-weight: 700;
}

.detail-heading h1 {
  margin: 5px 0 4px;
  max-width: 100%;
  overflow-wrap: anywhere;
  font-size: 25px;
  word-break: break-word;
}

.detail-heading span {
  color: var(--admin-muted);
  font-size: 13px;
}

.detail-state {
  display: grid;
  min-height: 520px;
  align-content: center;
  gap: 14px;
  padding: 24px;
  border: 1px solid var(--admin-border);
  border-radius: 7px;
  background: #fff;
}

.detail-state.centered {
  justify-items: center;
  text-align: center;
}

.detail-state.centered > .el-icon {
  color: var(--admin-muted);
  font-size: 36px;
}

.order-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 13px 15px;
  border: 1px solid var(--admin-border);
  border-radius: 7px;
  background: #fff;
}

.order-actions > div:first-child {
  display: grid;
  gap: 4px;
}

.order-actions small,
.detail-card header span,
.amount-grid span,
.detail-card dt,
.item-row small,
.logistics-events small,
.order-timeline small,
.muted-copy {
  color: var(--admin-muted);
  font-size: 11px;
}

.order-status {
  display: inline-flex;
  width: fit-content;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 700;
}

.order-status.success { color: #27654f; background: #e5f3ed; }
.order-status.danger { color: #8c4141; background: #f5eaea; }
.order-status.info { color: #315f91; background: #eaf2fa; }
.order-status.pending { color: #8b651e; background: #fbf1df; }

.action-buttons {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 7px;
}

.axis-strip {
  display: grid;
  gap: 1px;
  margin-top: 12px;
  overflow: hidden;
  border: 1px solid var(--admin-border);
  border-radius: 7px;
  background: var(--admin-border);
  grid-template-columns: repeat(6, minmax(0, 1fr));
}

.axis-strip div {
  display: grid;
  min-width: 0;
  gap: 4px;
  padding: 11px 12px;
  background: #f8faf9;
}

.axis-strip span {
  color: var(--admin-muted);
  font-size: 10px;
}

.axis-strip strong {
  overflow: hidden;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.detail-grid {
  display: grid;
  gap: 12px;
  margin-top: 12px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.detail-card {
  min-width: 0;
  padding: 16px;
  border: 1px solid var(--admin-border);
  border-radius: 7px;
  background: #fff;
}

.detail-card header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}

.items-card,
.timeline-card,
.exception-card {
  grid-column: 1 / -1;
}

.amount-grid {
  display: grid;
  gap: 10px;
  grid-template-columns: repeat(5, minmax(0, 1fr));
}

.amount-grid div {
  display: grid;
  gap: 4px;
}

.amount-grid strong {
  font-size: 16px;
  font-variant-numeric: tabular-nums;
}

.detail-card dl,
.detail-card dt,
.detail-card dd {
  margin: 0;
}

.detail-card dl {
  display: grid;
  gap: 9px;
}

.detail-card dl div {
  display: grid;
  gap: 3px;
}

.detail-card dd {
  font-size: 13px;
  overflow-wrap: anywhere;
}

.item-table {
  overflow: hidden;
  border: 1px solid var(--admin-border);
  border-radius: 6px;
}

.item-table-head,
.item-row {
  display: grid;
  align-items: center;
  gap: 12px;
  grid-template-columns: minmax(220px, 2fr) repeat(5, minmax(60px, 0.55fr));
}

.item-table-head {
  padding: 9px 12px;
  color: var(--admin-muted);
  background: #f7faf8;
  font-size: 10px;
  font-weight: 700;
}

.item-row {
  padding: 11px 12px;
  border-top: 1px solid var(--admin-border);
  font-size: 12px;
}

.item-row > div {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.item-row strong,
.item-row small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.inline-empty {
  display: flex;
  min-height: 150px;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--admin-muted);
  font-size: 13px;
}

.inline-empty .el-icon {
  font-size: 24px;
}

.package-summary {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.logistics-events,
.order-timeline,
.exception-list {
  display: grid;
  gap: 0;
  margin-top: 14px;
}

.logistics-events > div {
  display: grid;
  gap: 10px;
  padding: 10px 0;
  border-top: 1px solid var(--admin-border);
  grid-template-columns: 8px minmax(0, 1fr);
}

.event-dot {
  width: 8px;
  height: 8px;
  margin-top: 5px;
  border-radius: 50%;
  background: var(--admin-brand);
}

.logistics-events p,
.order-timeline p {
  margin: 3px 0;
  color: var(--admin-text-soft);
  font-size: 12px;
  line-height: 1.55;
}

.order-timeline > div {
  display: grid;
  align-items: center;
  gap: 12px;
  padding: 10px 0;
  border-top: 1px solid var(--admin-border);
  grid-template-columns: 68px minmax(0, 1fr) 150px;
}

.order-timeline > div:first-child,
.exception-list > div:first-child {
  border-top: 0;
}

.axis-label {
  display: inline-flex;
  width: fit-content;
  padding: 3px 6px;
  border-radius: 4px;
  color: var(--admin-brand);
  background: #e8f2ed;
  font-size: 10px;
  font-weight: 700;
}

.exception-list > div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 0;
  border-top: 1px solid var(--admin-border);
  font-size: 12px;
}

.exception-list span {
  color: var(--admin-muted);
  text-align: right;
}

@media (max-width: 1000px) {
  .order-actions {
    align-items: flex-start;
    flex-direction: column;
  }

  .action-buttons {
    justify-content: flex-start;
  }

  .axis-strip {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .detail-grid {
    grid-template-columns: 1fr;
  }

  .items-card,
  .timeline-card,
  .exception-card {
    grid-column: auto;
  }

  .item-table {
    overflow: visible;
    border: 0;
  }

  .item-table-head {
    display: none;
  }

  .item-row {
    grid-template-columns: repeat(5, minmax(0, 1fr));
    border: 1px solid var(--admin-border);
    border-radius: 6px;
  }

  .item-row > div:first-child {
    grid-column: 1 / -1;
  }

  .item-row [data-label]::before {
    color: var(--admin-muted);
    content: attr(data-label);
    font-size: 10px;
    font-weight: 700;
  }
}

@media (max-width: 620px) {
  .detail-heading {
    flex-direction: column;
  }

  .action-buttons {
    display: grid;
    width: 100%;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .axis-strip {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .amount-grid,
  .item-row {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .item-row > div:first-child {
    grid-column: 1 / -1;
  }

  .package-summary {
    grid-template-columns: 1fr;
  }

  .order-timeline > div {
    align-items: flex-start;
    grid-template-columns: 62px minmax(0, 1fr);
  }

  .order-timeline small {
    grid-column: 2;
  }

  .exception-list > div {
    align-items: flex-start;
    flex-direction: column;
  }

  .exception-list span {
    text-align: left;
  }
}
</style>
