<script setup lang="ts">
import { ArrowLeft, Document, Download, Refresh, ShoppingBag } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import AftersaleCommandDialog, {
  type AftersaleCommandMode,
} from '../../components/aftersales/AftersaleCommandDialog.vue';
import AdminShell from '../../layouts/AdminShell.vue';
import { AdminApiError } from '../../services/admin-api';
import {
  getAdminAftersale,
  type AdminAftersaleDetail,
} from '../../services/admin-aftersales';
import { getAdminFileDownloadUrl } from '../../services/admin-files';
import { recoverAdminRefundCommandJournal } from '../../services/admin-refund-command-journal';
import { authSession } from '../../stores/auth-session';
import { formatChinaDateTime } from '../../utils/time';

const route = useRoute();
const router = useRouter();
const detail = ref<AdminAftersaleDetail | null>(null);
const loading = ref(false);
const errorMessage = ref('');
const commandOpen = ref(false);
const commandMode = ref<AftersaleCommandMode | null>(null);
const downloading = ref(new Set<string>());
const evidenceControllers = new Map<string, AbortController>();
let sequence = 0;
let controller: AbortController | null = null;
let active = true;

const aftersaleId = computed(() => String(route.params.aftersale_id ?? ''));

function abortEvidenceDownloads(): void {
  for (const current of evidenceControllers.values()) current.abort();
  evidenceControllers.clear();
  downloading.value = new Set();
}

function statusLabel(value: AdminAftersaleDetail['status']): string {
  return ({
    CANCELLED: '已取消',
    COMPLETED: '已完成',
    PENDING_REVIEW: '待审核',
    REFUNDING: '退款处理中',
    REFUNDING_AFTER_RETURN: '退货退款中',
    REFUND_FAILED: '退款失败',
    REJECTED: '审核已拒绝',
    REJECTED_AFTER_RETURN: '验货后拒绝',
    RETURN_EXCEPTION: '验货异常',
    WAITING_RECEIPT: '等待总部收货',
    WAITING_RETURN: '等待客户退货',
  })[value];
}

function statusTone(value: AdminAftersaleDetail['status']): 'danger' | 'info' | 'success' | 'warning' {
  if (value === 'COMPLETED') return 'success';
  if (['REFUND_FAILED', 'RETURN_EXCEPTION'].includes(value)) return 'danger';
  if (['CANCELLED', 'REJECTED', 'REJECTED_AFTER_RETURN'].includes(value)) return 'info';
  return 'warning';
}

function actionLabel(action: AdminAftersaleDetail['available_actions'][number]): string {
  return ({
    APPROVE: '通过初审',
    CONTINUE_REFUND: '继续退款',
    CREATE_REFUND: '创建退款',
    RECORD_INSPECTION: '记录验货',
    REJECT: '拒绝申请',
    REJECT_AFTER_RETURN: '验货后拒绝',
    RETRY_REFUND: '重试退款',
    VIEW_ORDER: '查看订单',
  })[action];
}

function readableError(error: unknown): string {
  if (!(error instanceof AdminApiError)) return '售后详情加载失败，请稍后重试';
  if (error.status === 0) return '网络连接失败，请检查网络后重试';
  if (error.status === 400) return '售后标识无效';
  if (error.status === 403) return '当前账号无权查看该售后记录';
  if (error.status === 404) return '售后记录不存在或已不可访问';
  if (error.status === 429) return error.retryAfterSeconds
    ? `查询过于频繁，请在 ${error.retryAfterSeconds} 秒后重试`
    : '查询过于频繁，请稍后重试';
  return '售后详情加载失败，请稍后重试';
}

async function handleSessionError(error: unknown): Promise<boolean> {
  if (!(error instanceof AdminApiError) || error.status !== 401) return false;
  ++sequence;
  controller?.abort();
  abortEvidenceDownloads();
  commandOpen.value = false;
  authSession.clearSession();
  await router.replace('/login');
  return true;
}

async function loadDetail(): Promise<void> {
  const currentSequence = ++sequence;
  controller?.abort();
  abortEvidenceDownloads();
  const current = new AbortController();
  controller = current;
  loading.value = true;
  errorMessage.value = '';
  try {
    try {
      const journal = await recoverAdminRefundCommandJournal();
      if (currentSequence !== sequence) return;
      if (journal !== null) {
        commandOpen.value = false;
        commandMode.value = null;
        await router.replace({ name: 'order-detail', params: { order_id: journal.order_id } });
        return;
      }
    } catch {
      if (currentSequence === sequence) {
        detail.value = null;
        errorMessage.value = '待确认资金操作的本机记录无法安全读取，售后操作已禁用。';
      }
      return;
    }
    const result = await getAdminAftersale(aftersaleId.value, current.signal);
    if (currentSequence !== sequence) return;
    detail.value = result;
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

function openCommand(mode: AftersaleCommandMode): void {
  commandMode.value = mode;
  commandOpen.value = true;
}

async function commandCompleted(message: string): Promise<void> {
  ElMessage.success(message);
  await loadDetail();
}

async function commandConflict(): Promise<void> {
  commandOpen.value = false;
  commandMode.value = null;
  await loadDetail();
  ElMessage.warning('售后事实或版本已变化，已刷新最新投影，请重新预览并确认');
}

async function downloadEvidence(fileId: string): Promise<void> {
  if (downloading.value.has(fileId)) return;
  const downloadController = new AbortController();
  const currentSequence = sequence;
  const currentAftersaleId = aftersaleId.value;
  const currentSessionId = authSession.state.session?.session_id ?? null;
  evidenceControllers.set(fileId, downloadController);
  downloading.value = new Set(downloading.value).add(fileId);
  try {
    const result = await getAdminFileDownloadUrl(fileId, downloadController.signal);
    if (!active || downloadController.signal.aborted || currentSequence !== sequence ||
      currentAftersaleId !== aftersaleId.value || currentSessionId === null ||
      currentSessionId !== authSession.state.session?.session_id) return;
    const anchor = document.createElement('a');
    anchor.href = result.download_url;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    anchor.referrerPolicy = 'no-referrer';
    anchor.click();
    anchor.removeAttribute('href');
  } catch (error) {
    if (downloadController.signal.aborted) return;
    if (await handleSessionError(error)) return;
    ElMessage.error(error instanceof AdminApiError && error.status === 403
      ? '当前账号无权读取该证据'
      : '证据下载地址获取失败，请稍后重试');
  } finally {
    if (evidenceControllers.get(fileId) === downloadController) evidenceControllers.delete(fileId);
    const next = new Set(downloading.value);
    next.delete(fileId);
    downloading.value = next;
  }
}

function evidenceLabel(index: number): string {
  return `证据 ${String(index + 1).padStart(2, '0')}`;
}

watch(aftersaleId, () => {
  abortEvidenceDownloads();
  commandOpen.value = false;
  commandMode.value = null;
  detail.value = null;
  void loadDetail();
}, { immediate: true });

watch(() => authSession.state.session?.session_id ?? null, (current, previous) => {
  if (previous !== undefined && current !== previous) {
    ++sequence;
    controller?.abort();
    abortEvidenceDownloads();
    commandOpen.value = false;
    if (current === null && route.name !== 'login') void router.replace('/login');
  }
});

onBeforeUnmount(() => {
  active = false;
  ++sequence;
  controller?.abort();
  abortEvidenceDownloads();
  commandOpen.value = false;
});
</script>

<template>
  <AdminShell>
    <div
      class="aftersale-detail-page"
      data-testid="admin-aftersale-detail-page"
    >
      <section class="detail-heading">
        <div>
          <el-button
            text
            data-testid="admin-aftersale-back"
            @click="router.push('/aftersales')"
          >
            <el-icon><ArrowLeft /></el-icon>返回售后列表
          </el-button>
          <p>服务管理 · ADM-12 / ADM-13</p>
          <h1>{{ detail?.aftersale_no || '售后详情' }}</h1>
          <span v-if="detail">{{ statusLabel(detail.status) }} · 售后版本 {{ detail.version }}</span>
        </div>
        <el-button
          :loading="loading"
          :disabled="commandOpen"
          data-testid="admin-aftersale-refresh"
          @click="loadDetail"
        >
          <el-icon><Refresh /></el-icon>刷新投影
        </el-button>
      </section>

      <div
        v-if="loading"
        class="detail-state"
        data-testid="admin-aftersale-detail-loading"
      >
        <el-skeleton
          :rows="10"
          animated
        />
      </div>
      <div
        v-else-if="errorMessage"
        class="detail-state centered"
        data-testid="admin-aftersale-detail-error"
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
          class="action-strip"
          data-testid="admin-aftersale-actions"
        >
          <div>
            <el-tag
              :type="statusTone(detail.status)"
              effect="plain"
            >
              {{ statusLabel(detail.status) }}
            </el-tag>
            <small>仅展示服务端当前允许的操作，状态变化后必须重新确认。</small>
          </div>
          <div class="action-buttons">
            <template
              v-for="action in detail.available_actions"
              :key="action"
            >
              <el-button
                v-if="action === 'VIEW_ORDER'"
                data-testid="admin-aftersale-view-order"
                @click="router.push(`/orders/${detail.order.order_id}`)"
              >
                <el-icon><ShoppingBag /></el-icon>{{ actionLabel(action) }}
              </el-button>
              <el-button
                v-else-if="action === 'RETRY_REFUND'"
                type="primary"
                plain
                data-testid="admin-aftersale-retry_refund"
                @click="router.push(`/orders/${detail.order.order_id}`)"
              >
                {{ actionLabel(action) }}
              </el-button>
              <el-button
                v-else
                :type="['REJECT', 'REJECT_AFTER_RETURN'].includes(action) ? 'danger' : 'primary'"
                :plain="['REJECT', 'REJECT_AFTER_RETURN'].includes(action)"
                :data-testid="`admin-aftersale-${action.toLowerCase()}`"
                @click="openCommand(action)"
              >
                {{ actionLabel(action) }}
              </el-button>
            </template>
          </div>
        </section>

        <section
          class="detail-grid"
          data-testid="admin-aftersale-detail-content"
        >
          <article class="detail-card summary-card">
            <header><strong>申请摘要</strong><span>{{ detail.type === 'RETURN_REFUND' ? '退货退款' : '仅退款' }}</span></header>
            <dl>
              <div><dt>申请原因</dt><dd>{{ detail.reason }}</dd></div>
              <div><dt>申请时间</dt><dd>{{ formatChinaDateTime(detail.created_at) }}</dd></div>
              <div><dt>订单</dt><dd>{{ detail.order.order_no }}</dd></div>
              <div><dt>客户</dt><dd>{{ detail.customer.customer_alias }} · {{ detail.customer.phone_masked || '未提供联系方式' }}</dd></div>
            </dl>
          </article>

          <article class="detail-card state-card">
            <header><strong>订单状态轴</strong><span>只读快照</span></header>
            <dl>
              <div><dt>订单 / 支付</dt><dd>{{ detail.order.state.order_status }} / {{ detail.order.state.payment_status }}</dd></div>
              <div><dt>退款进度 / 处理</dt><dd>{{ detail.order.state.refund_progress_status }} / {{ detail.order.state.refund_processing_status }}</dd></div>
              <div><dt>履约</dt><dd>{{ detail.order.state.fulfillment_status }}</dd></div>
              <div><dt>支付处置</dt><dd>{{ detail.order.state.payment_resolution }}</dd></div>
            </dl>
          </article>

          <article class="detail-card wide-card">
            <header><strong>申请商品</strong><span>{{ detail.items.length }} 项</span></header>
            <div class="item-table">
              <div class="item-head">
                <span>商品 / SKU</span><span>申请</span><span>已批准</span><span>已退款</span><span>分配金额</span>
              </div>
              <div
                v-for="item in detail.items"
                :key="item.aftersale_item_id"
                class="item-row"
              >
                <div data-label="商品 / SKU">
                  <strong>{{ item.product_name }}</strong><small>{{ item.sku_name }}</small>
                </div>
                <div data-label="申请">
                  {{ item.requested_quantity }}
                </div>
                <div data-label="已批准">
                  {{ item.approved_refund_quantity ?? '待定' }}
                </div>
                <div data-label="已退款">
                  {{ item.refunded_quantity }}
                </div>
                <div data-label="分配金额">
                  ¥{{ item.allocated_amount }}
                </div>
              </div>
            </div>
          </article>

          <article class="detail-card evidence-card">
            <header><strong>申请证据</strong><span>短时鉴权下载</span></header>
            <div
              v-if="detail.application_evidence_file_ids.length"
              class="evidence-list"
            >
              <el-button
                v-for="(fileId, index) in detail.application_evidence_file_ids"
                :key="fileId"
                :loading="downloading.has(fileId)"
                :data-testid="`admin-aftersale-application-evidence-${index}`"
                @click="downloadEvidence(fileId)"
              >
                <el-icon><Download /></el-icon>{{ evidenceLabel(index) }}
              </el-button>
            </div>
            <p
              v-else
              class="muted-copy"
            >
              本次申请未提交图片证据。
            </p>
          </article>

          <article class="detail-card return-card">
            <header><strong>退货信息</strong><span>{{ detail.return_shipment ? '已提交物流' : '暂无物流' }}</span></header>
            <dl v-if="detail.return_address_snapshot">
              <div><dt>退货联系人</dt><dd>{{ detail.return_address_snapshot.recipient_name }} · {{ detail.return_address_snapshot.phone }}</dd></div>
              <div><dt>退货地址</dt><dd>{{ detail.return_address_snapshot.province }} {{ detail.return_address_snapshot.city }} {{ detail.return_address_snapshot.district }} {{ detail.return_address_snapshot.detail }}</dd></div>
            </dl>
            <dl
              v-if="detail.return_shipment"
              class="shipment-summary"
            >
              <div><dt>承运方</dt><dd>{{ detail.return_shipment.carrier_name }}（{{ detail.return_shipment.carrier_code }}）</dd></div>
              <div><dt>运单号</dt><dd>{{ detail.return_shipment.tracking_no }}</dd></div>
              <div><dt>提交时间</dt><dd>{{ formatChinaDateTime(detail.return_shipment.submitted_at) }}</dd></div>
            </dl>
            <p
              v-if="!detail.return_address_snapshot && !detail.return_shipment"
              class="muted-copy"
            >
              当前流程尚未产生退货地址快照。
            </p>
          </article>

          <article
            v-if="detail.inspection"
            class="detail-card wide-card inspection-card"
            data-testid="admin-aftersale-inspection"
          >
            <header><strong>验货记录</strong><span>{{ detail.inspection.result }} · {{ detail.inspection.inspected_by.display_name }}</span></header>
            <el-alert
              v-if="detail.inspection.abnormal_reason"
              type="warning"
              :closable="false"
              :title="detail.inspection.abnormal_reason"
            />
            <div class="inspection-lines">
              <div
                v-for="line in detail.inspection.items"
                :key="line.order_item_id"
              >
                <strong>{{ detail.items.find((item) => item.order_item_id === line.order_item_id)?.product_name || line.order_item_id }}</strong>
                <span>实收 {{ line.received_qty }} · 批准 {{ line.approved_refund_qty }} · 回库 {{ line.restock_qty }} · 损坏 {{ line.damaged_qty }} · 报废 {{ line.scrap_qty }} · 退回客户 {{ line.return_to_customer_qty }}</span>
              </div>
            </div>
            <div
              v-if="detail.inspection.evidence_file_ids.length"
              class="evidence-list inspection-evidence"
            >
              <el-button
                v-for="(fileId, index) in detail.inspection.evidence_file_ids"
                :key="fileId"
                :loading="downloading.has(fileId)"
                @click="downloadEvidence(fileId)"
              >
                <el-icon><Download /></el-icon>验货{{ evidenceLabel(index) }}
              </el-button>
            </div>
            <p
              v-if="detail.inspection.resolution"
              class="resolution-copy"
            >
              处置：{{ detail.inspection.resolution }} · {{ detail.inspection.resolution_reason }}
            </p>
          </article>

          <article class="detail-card refund-card">
            <header><strong>退款尝试</strong><span>{{ detail.refund_attempts.length }} 条</span></header>
            <div
              v-if="detail.refund_attempts.length"
              class="stack-list"
            >
              <div
                v-for="attempt in detail.refund_attempts"
                :key="`${attempt.refund_id}:${attempt.attempt_no}`"
              >
                <div><strong>{{ attempt.refund_no }}</strong><span>第 {{ attempt.attempt_no }} 次 · {{ attempt.status }}</span></div>
                <strong>¥{{ attempt.amount }}</strong>
              </div>
            </div>
            <p
              v-else
              class="muted-copy"
            >
              尚未创建退款。
            </p>
          </article>

          <article class="detail-card impact-card">
            <header><strong>事实影响</strong><span>库存与佣金只读</span></header>
            <div class="impact-columns">
              <div>
                <strong>库存</strong><span
                  v-for="item in detail.inventory_impact"
                  :key="item.sku_id"
                >{{ item.sku_id }} · 在手 {{ item.on_hand_change }} / 可售 {{ item.available_change }}</span><span v-if="!detail.inventory_impact.length">暂无变化</span>
              </div>
              <div>
                <strong>佣金</strong><span
                  v-for="item in detail.commission_impact"
                  :key="item.commission_snapshot_id"
                >订单项 {{ item.order_item_id }} · 已冲正 ¥{{ item.reversed_total }}</span><span v-if="!detail.commission_impact.length">暂无变化</span>
              </div>
            </div>
          </article>

          <article class="detail-card wide-card timeline-card">
            <header><strong>售后时间线</strong><span>服务端事实顺序</span></header>
            <div class="timeline-list">
              <div
                v-for="event in detail.timeline"
                :key="event.event_id"
              >
                <span>{{ event.operator_role }}</span>
                <div><strong>{{ event.event }}</strong><p>{{ event.from_status || '开始' }} → {{ event.to_status }}</p></div>
                <small>{{ formatChinaDateTime(event.occurred_at) }}</small>
              </div>
            </div>
            <el-alert
              v-for="entry in detail.errors"
              :key="`${entry.error_code}:${entry.occurred_at}`"
              class="safe-error"
              type="error"
              :closable="false"
              :title="`${entry.error_code}：${entry.message}`"
            />
          </article>
        </section>
      </template>
    </div>

    <AftersaleCommandDialog
      v-if="detail"
      v-model:open="commandOpen"
      :detail="detail"
      :mode="commandMode"
      @auth-expired="handleSessionError"
      @completed="commandCompleted"
      @conflict="commandConflict"
    />
  </AdminShell>
</template>

<style scoped>
.aftersale-detail-page { min-width: 0; }
.detail-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; margin-bottom: 20px; }
.detail-heading > div { min-width: 0; }
.detail-heading p { margin: 12px 0 0; color: var(--admin-brand); font-size: 11px; font-weight: 700; }
.detail-heading h1 { margin: 5px 0 4px; overflow-wrap: anywhere; font-size: 25px; }
.detail-heading span { color: var(--admin-muted); font-size: 13px; }
.detail-state { display: grid; min-height: 520px; align-content: center; gap: 14px; padding: 24px; border: 1px solid var(--admin-border); border-radius: 7px; background: #fff; }
.detail-state.centered { justify-items: center; text-align: center; }
.detail-state.centered > .el-icon { color: var(--admin-muted); font-size: 36px; }
.action-strip { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 13px 15px; border: 1px solid var(--admin-border); border-radius: 7px; background: #fff; }
.action-strip > div:first-child { display: grid; gap: 5px; }
.action-strip small, .detail-card header span, .detail-card dt, .item-row small, .timeline-list small, .muted-copy { color: var(--admin-muted); font-size: 11px; }
.action-buttons, .evidence-list { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 7px; }
.detail-grid { display: grid; gap: 12px; margin-top: 12px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
.detail-card { min-width: 0; padding: 16px; border: 1px solid var(--admin-border); border-radius: 7px; background: #fff; }
.detail-card header { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
.wide-card { grid-column: 1 / -1; }
.detail-card dl, .detail-card dt, .detail-card dd { margin: 0; }
.detail-card dl { display: grid; gap: 9px; }
.detail-card dl div { display: grid; gap: 3px; }
.detail-card dd { font-size: 13px; overflow-wrap: anywhere; }
.shipment-summary { margin-top: 12px !important; padding-top: 12px; border-top: 1px solid var(--admin-border); }
.item-table { overflow: hidden; border: 1px solid var(--admin-border); border-radius: 6px; }
.item-head, .item-row { display: grid; align-items: center; gap: 12px; grid-template-columns: minmax(220px, 2fr) repeat(4, minmax(70px, .6fr)); }
.item-head { padding: 9px 12px; color: var(--admin-muted); background: #f7faf8; font-size: 10px; font-weight: 700; }
.item-row { padding: 11px 12px; border-top: 1px solid var(--admin-border); font-size: 12px; }
.item-row > div { display: grid; min-width: 0; gap: 2px; }
.item-row strong, .item-row small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.evidence-list { justify-content: flex-start; }
.inspection-lines, .stack-list, .timeline-list { display: grid; gap: 0; }
.inspection-lines > div { display: grid; gap: 4px; padding: 10px 0; border-top: 1px solid var(--admin-border); }
.inspection-lines span, .resolution-copy { color: var(--admin-text-soft); font-size: 12px; line-height: 1.55; overflow-wrap: anywhere; }
.inspection-evidence { margin-top: 12px; }
.resolution-copy { margin: 12px 0 0; padding: 10px; border-radius: 5px; background: #f4f8f6; }
.stack-list > div { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 0; border-top: 1px solid var(--admin-border); }
.stack-list > div > div { display: grid; gap: 3px; }
.stack-list span { color: var(--admin-muted); font-size: 11px; }
.impact-columns { display: grid; gap: 12px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
.impact-columns > div { display: grid; gap: 7px; padding: 10px; border-radius: 6px; background: #f7faf8; }
.impact-columns span { color: var(--admin-text-soft); font-size: 11px; overflow-wrap: anywhere; }
.timeline-list > div { display: grid; align-items: center; gap: 12px; padding: 10px 0; border-top: 1px solid var(--admin-border); grid-template-columns: 110px minmax(0, 1fr) 150px; }
.timeline-list > div:first-child { border-top: 0; }
.timeline-list > div > span { width: fit-content; padding: 3px 6px; border-radius: 4px; color: var(--admin-brand); background: #e8f2ed; font-size: 10px; font-weight: 700; }
.timeline-list p { margin: 3px 0 0; color: var(--admin-text-soft); font-size: 12px; }
.safe-error { margin-top: 9px; }
.muted-copy { margin: 0; line-height: 1.6; }
@media (max-width: 1000px) {
  .action-strip { align-items: flex-start; flex-direction: column; }
  .action-buttons { justify-content: flex-start; }
  .detail-grid { grid-template-columns: 1fr; }
  .wide-card { grid-column: auto; }
  .item-table { overflow: visible; border: 0; }
  .item-head { display: none; }
  .item-row { grid-template-columns: repeat(4, minmax(0, 1fr)); border: 1px solid var(--admin-border); border-radius: 6px; }
  .item-row > div:first-child { grid-column: 1 / -1; }
  .item-row [data-label]::before { color: var(--admin-muted); content: attr(data-label); font-size: 10px; font-weight: 700; }
}
@media (max-width: 620px) {
  .detail-heading { flex-direction: column; }
  .action-buttons { display: grid; width: 100%; grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .item-row, .impact-columns { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .timeline-list > div { align-items: flex-start; grid-template-columns: 86px minmax(0, 1fr); }
  .timeline-list small { grid-column: 2; }
}
</style>
