<script setup lang="ts">
import { CircleCheck, Refresh, Search, WarningFilled } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';

import AdminShell from '../../layouts/AdminShell.vue';
import { AdminApiError, newIdempotencyKey } from '../../services/admin-api';
import {
  listPaymentReconciliationTasks,
  reconcilePaymentIntent,
} from '../../services/admin-payments';
import { authSession } from '../../stores/auth-session';
import type {
  PaymentIntentReconciliationStatus,
  PaymentReconciliationListQuery,
  PaymentReconciliationResolution,
  PaymentReconciliationTask,
  PaymentReconciliationTaskType,
  PaymentRefundReconciliationStatus,
} from '../../types/payments';
import {
  beginPaymentReconciliationAttempt,
  markPaymentReconciliationAttemptUncertain,
  type PaymentReconciliationAttempt,
} from '../../utils/payment-reconciliation-attempt';
import { formatChinaDateTime } from '../../utils/time';

type OptionalTaskType = '' | PaymentReconciliationTaskType;
type OptionalIntentStatus = '' | PaymentIntentReconciliationStatus;
type OptionalRefundStatus = '' | PaymentRefundReconciliationStatus;
type OptionalResolution = '' | PaymentReconciliationResolution;

const router = useRouter();
const items = ref<PaymentReconciliationTask[]>([]);
const loading = ref(false);
const listError = ref('');
const page = ref(1);
const pageSize = 20;
const total = ref(0);
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)));
const taskType = ref<OptionalTaskType>('');
const intentStatus = ref<OptionalIntentStatus>('');
const refundStatus = ref<OptionalRefundStatus>('');
const resolution = ref<OptionalResolution>('');
const errorCode = ref('');
const dueBefore = ref('');
const reconcileStates = reactive<Record<string, PaymentReconciliationAttempt | undefined>>({});
let listSequence = 0;
let listController: AbortController | null = null;

const taskTypeOptions: Array<{ label: string; value: OptionalTaskType }> = [
  { label: '全部待办', value: '' },
  { label: '支付意图', value: 'PAYMENT_INTENT' },
  { label: '支付结算', value: 'PAYMENT_SETTLEMENT' },
  { label: '迟到支付退款', value: 'LATE_PAYMENT_REFUND' },
];
const intentStatusOptions: Array<{ label: string; value: OptionalIntentStatus }> = [
  { label: '全部意图状态', value: '' },
  { label: '创建中', value: 'CREATING' },
  { label: '待支付', value: 'OPEN' },
  { label: '关单确认中', value: 'CLOSE_PENDING' },
];
const refundStatusOptions: Array<{ label: string; value: OptionalRefundStatus }> = [
  { label: '全部退款状态', value: '' },
  { label: '待处理', value: 'PENDING' },
  { label: '处理中', value: 'PROCESSING' },
  { label: '失败', value: 'FAILED' },
];
const resolutionOptions: Array<{ label: string; value: OptionalResolution }> = [
  { label: '全部处理状态', value: '' },
  { label: '迟到支付待退款', value: 'LATE_SUCCESS_REFUND_PENDING' },
  { label: '需要人工处理', value: 'MANUAL_REQUIRED' },
];

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function readableListError(error: unknown): string {
  if (!(error instanceof AdminApiError)) return '对账待办响应无法验证，请稍后重试';
  if (error.status === 0) return '网络连接失败，请检查网络后重试';
  if (error.status === 403) return '当前账号无权查看支付对账待办';
  if (error.status === 429) {
    return error.retryAfterSeconds
      ? `查询过于频繁，请在 ${error.retryAfterSeconds} 秒后重试`
      : '查询过于频繁，请稍后重试';
  }
  return '支付对账待办加载失败，请稍后重试';
}

async function handleSessionError(error: unknown): Promise<boolean> {
  if (authSession.state.session && (!(error instanceof AdminApiError) || error.status !== 401)) return false;
  ++listSequence;
  listController?.abort();
  items.value = [];
  total.value = 0;
  authSession.clearSession();
  await router.replace('/login');
  return true;
}

function filterQuery(): PaymentReconciliationListQuery {
  const query: PaymentReconciliationListQuery = { page: page.value, pageSize };
  if (taskType.value) query.taskType = taskType.value;
  if (intentStatus.value) query.intentStatus = intentStatus.value;
  if (refundStatus.value) query.refundStatus = refundStatus.value;
  if (resolution.value) query.paymentResolution = resolution.value;
  const trimmedErrorCode = errorCode.value.trim();
  if (trimmedErrorCode) query.lastErrorCode = trimmedErrorCode;
  if (dueBefore.value) {
    const date = new Date(dueBefore.value);
    if (!Number.isNaN(date.valueOf())) query.dueBefore = date.toISOString();
  }
  return query;
}

function removeStaleReconcileStates(nextItems: readonly PaymentReconciliationTask[]): void {
  const visibleIds = new Set(nextItems.map((item) => item.payment_intent_id));
  for (const paymentIntentId of Object.keys(reconcileStates)) {
    if (!visibleIds.has(paymentIntentId)) delete reconcileStates[paymentIntentId];
  }
}

async function loadTasks(): Promise<void> {
  const sequence = ++listSequence;
  listController?.abort();
  const controller = new AbortController();
  listController = controller;
  loading.value = true;
  listError.value = '';
  try {
    const result = await listPaymentReconciliationTasks(filterQuery(), controller.signal);
    if (sequence !== listSequence) return;
    items.value = result.items;
    total.value = result.pagination.total;
    page.value = result.pagination.page;
    removeStaleReconcileStates(result.items);
  } catch (error) {
    if (isAbort(error) || sequence !== listSequence) return;
    if (await handleSessionError(error)) return;
    items.value = [];
    total.value = 0;
    listError.value = readableListError(error);
  } finally {
    if (sequence === listSequence) {
      loading.value = false;
      listController = null;
    }
  }
}

function applyFilters(): void {
  page.value = 1;
  void loadTasks();
}

function resetFilters(): void {
  taskType.value = '';
  intentStatus.value = '';
  refundStatus.value = '';
  resolution.value = '';
  errorCode.value = '';
  dueBefore.value = '';
  page.value = 1;
  void loadTasks();
}

function changePage(value: number): void {
  page.value = value;
  void loadTasks();
}

function taskTypeLabel(value: PaymentReconciliationTaskType): string {
  return ({
    LATE_PAYMENT_REFUND: '迟到支付退款',
    PAYMENT_INTENT: '支付意图',
    PAYMENT_SETTLEMENT: '支付结算',
  })[value];
}

function statusLabel(value: PaymentReconciliationTask['status']): string {
  return ({
    CLOSE_PENDING: '关单确认中',
    CREATING: '创建中',
    FAILED: '处理失败',
    OPEN: '待支付',
    PENDING: '待处理',
    PROCESSING: '处理中',
    SUCCEEDED: '已收款待结算',
  })[value];
}

function resolutionLabel(item: PaymentReconciliationTask): string {
  if (item.payment_resolution === 'MANUAL_REQUIRED') return '需要人工处理';
  if (item.payment_resolution === 'LATE_SUCCESS_REFUND_PENDING') return '迟到支付待退款';
  return '支付状态待确认';
}

function nextAttemptLabel(item: PaymentReconciliationTask): string {
  if (item.next_reconcile_at) return formatChinaDateTime(item.next_reconcile_at);
  return item.task_type === 'PAYMENT_SETTLEMENT' ? '等待人工触发' : '尚未安排';
}

function isReconciling(paymentIntentId: string): boolean {
  return reconcileStates[paymentIntentId]?.inFlight === true;
}

function isUncertain(paymentIntentId: string): boolean {
  return reconcileStates[paymentIntentId]?.uncertain === true;
}

async function reconcile(item: PaymentReconciliationTask): Promise<void> {
  const existing = reconcileStates[item.payment_intent_id];
  const state = beginPaymentReconciliationAttempt(existing, newIdempotencyKey);
  if (!state) return;
  reconcileStates[item.payment_intent_id] = state;

  try {
    const result = await reconcilePaymentIntent(item.payment_intent_id, state.idempotencyKey);
    delete reconcileStates[item.payment_intent_id];
    if (result.kind === 'PENDING') {
      const index = items.value.findIndex(({ payment_intent_id }) => payment_intent_id === item.payment_intent_id);
      if (index >= 0) items.value[index] = result.data;
      ElMessage.warning('对账已受理，仍待支付渠道确认');
      return;
    }

    items.value = items.value.filter(({ payment_intent_id }) => payment_intent_id !== item.payment_intent_id);
    total.value = Math.max(0, total.value - 1);
    if (items.value.length === 0 && page.value > 1) page.value -= 1;
    ElMessage.success('支付事实已完成收敛');
    await loadTasks();
  } catch (error) {
    if (await handleSessionError(error)) return;
    if (error instanceof AdminApiError && error.status === 0) {
      reconcileStates[item.payment_intent_id] = markPaymentReconciliationAttemptUncertain(state);
      ElMessage.warning('请求结果未确认，再次重试将使用同一请求标识');
      return;
    }

    delete reconcileStates[item.payment_intent_id];
    if (error instanceof AdminApiError && error.status === 409) {
      await loadTasks();
      ElMessage.warning('待办状态已变化，已刷新数据，请重新确认后触发');
      return;
    }
    if (error instanceof AdminApiError && error.status === 404) {
      await loadTasks();
      ElMessage.warning('该待办已不存在，列表已刷新');
      return;
    }
    if (error instanceof AdminApiError && error.status === 403) {
      ElMessage.error('当前账号无权触发支付对账');
      return;
    }
    if (error instanceof AdminApiError && error.status === 429) {
      ElMessage.warning(
        error.retryAfterSeconds
          ? `操作过于频繁，请在 ${error.retryAfterSeconds} 秒后重试`
          : '操作过于频繁，请稍后重试',
      );
      return;
    }
    ElMessage.error('支付对账未完成，请稍后重试');
  } finally {
    const current = reconcileStates[item.payment_intent_id];
    if (current) current.inFlight = false;
  }
}

onMounted(() => void loadTasks());

onBeforeUnmount(() => {
  ++listSequence;
  listController?.abort();
});
</script>

<template>
  <AdminShell>
    <div
      class="reconciliation-page"
      data-testid="payment-reconciliation-page"
    >
      <section class="page-heading">
        <div>
          <p>财务运营 · ADM-10</p>
          <h1>支付对账</h1>
          <span>支付意图、结算异常与迟到支付退款待办</span>
        </div>
      </section>

      <section
        class="reconciliation-toolbar"
        aria-label="支付对账筛选"
      >
        <el-select
          v-model="taskType"
          data-testid="reconciliation-task-type"
          aria-label="待办类型"
          placeholder="全部待办"
        >
          <el-option
            v-for="option in taskTypeOptions"
            :key="option.value || 'ALL'"
            :label="option.label"
            :value="option.value"
          />
        </el-select>
        <el-select
          v-model="intentStatus"
          clearable
          aria-label="支付意图状态"
          placeholder="全部意图状态"
        >
          <el-option
            v-for="option in intentStatusOptions"
            :key="option.value || 'ALL'"
            :label="option.label"
            :value="option.value"
          />
        </el-select>
        <el-select
          v-model="refundStatus"
          clearable
          aria-label="退款状态"
          placeholder="全部退款状态"
        >
          <el-option
            v-for="option in refundStatusOptions"
            :key="option.value || 'ALL'"
            :label="option.label"
            :value="option.value"
          />
        </el-select>
        <el-select
          v-model="resolution"
          clearable
          aria-label="处理状态"
          placeholder="全部处理状态"
        >
          <el-option
            v-for="option in resolutionOptions"
            :key="option.value || 'ALL'"
            :label="option.label"
            :value="option.value"
          />
        </el-select>
        <el-input
          v-model="errorCode"
          clearable
          aria-label="错误码"
          placeholder="错误码"
          @keyup.enter="applyFilters"
        />
        <el-date-picker
          v-model="dueBefore"
          type="datetime"
          value-format="YYYY-MM-DDTHH:mm:ss"
          format="YYYY-MM-DD HH:mm"
          aria-label="处理时间上限"
          placeholder="处理时间不晚于"
        />
        <div class="toolbar-actions">
          <el-button
            type="primary"
            data-testid="reconciliation-apply-filters"
            @click="applyFilters"
          >
            <el-icon><Search /></el-icon>
            查询
          </el-button>
          <el-button @click="resetFilters">
            <el-icon><Refresh /></el-icon>
            重置
          </el-button>
        </div>
      </section>

      <section
        class="reconciliation-list"
        :class="{ refreshing: loading && items.length }"
      >
        <header class="reconciliation-list-heading">
          <div>
            <strong>共 {{ total }} 个待办</strong>
            <span>第 {{ page }} 页，每页 {{ pageSize }} 条</span>
          </div>
          <el-button
            :icon="Refresh"
            :loading="loading"
            @click="loadTasks"
          >
            刷新
          </el-button>
        </header>

        <div
          v-if="loading && !items.length"
          class="reconciliation-state"
          data-testid="reconciliation-loading"
        >
          <el-skeleton
            :rows="6"
            animated
          />
        </div>
        <div
          v-else-if="listError"
          class="reconciliation-state"
          data-testid="reconciliation-error"
        >
          <el-alert
            :title="listError"
            type="error"
            :closable="false"
            show-icon
          />
          <el-button @click="loadTasks">
            重新加载
          </el-button>
        </div>
        <div
          v-else-if="!items.length"
          class="reconciliation-state empty"
          data-testid="reconciliation-empty"
        >
          <el-icon><CircleCheck /></el-icon>
          <strong>当前没有支付对账待办</strong>
          <el-button @click="resetFilters">
            清除筛选
          </el-button>
        </div>
        <div
          v-else
          v-loading="loading"
          class="reconciliation-table"
          role="table"
          aria-label="支付对账待办列表"
          data-testid="reconciliation-table"
        >
          <div
            class="reconciliation-table-header"
            role="row"
          >
            <span role="columnheader">待办</span>
            <span role="columnheader">状态</span>
            <span role="columnheader">关联记录</span>
            <span role="columnheader">重试信息</span>
            <span role="columnheader">处理时间</span>
            <span role="columnheader">操作</span>
          </div>
          <article
            v-for="item in items"
            :key="item.payment_intent_id"
            class="reconciliation-row"
            role="row"
            :data-testid="`reconciliation-row-${item.payment_intent_id}`"
          >
            <div
              class="task-identity"
              role="cell"
            >
              <span class="task-type">{{ taskTypeLabel(item.task_type) }}</span>
              <strong :title="item.reference_no">{{ item.reference_no }}</strong>
              <small>v{{ item.version }}</small>
            </div>
            <div
              class="task-status"
              role="cell"
              data-label="状态"
            >
              <span
                class="status-badge"
                :class="`is-${item.status.toLowerCase()}`"
              >
                {{ statusLabel(item.status) }}
              </span>
              <small>{{ resolutionLabel(item) }}</small>
            </div>
            <div
              class="task-identifiers"
              role="cell"
              data-label="关联记录"
            >
              <span><b>订单</b>{{ item.order_id }}</span>
              <span><b>意图</b>{{ item.payment_intent_id }}</span>
              <span v-if="item.refund_id"><b>退款</b>{{ item.refund_id }}</span>
            </div>
            <div
              class="task-retry"
              role="cell"
              data-label="重试信息"
            >
              <strong>{{ item.reconciliation_attempt_count }} 次</strong>
              <small>{{ item.last_error_code ?? '无错误码' }}</small>
            </div>
            <div
              class="task-schedule"
              role="cell"
              data-label="处理时间"
            >
              <span>{{ nextAttemptLabel(item) }}</span>
            </div>
            <div
              class="task-action"
              role="cell"
            >
              <el-popconfirm
                :title="isUncertain(item.payment_intent_id) ? '使用同一请求标识重试？' : '确认触发安全对账？'"
                confirm-button-text="确认"
                cancel-button-text="取消"
                width="230"
                @confirm="reconcile(item)"
              >
                <template #reference>
                  <el-button
                    type="primary"
                    plain
                    :loading="isReconciling(item.payment_intent_id)"
                    :disabled="isReconciling(item.payment_intent_id)"
                    :data-testid="`reconcile-${item.payment_intent_id}`"
                  >
                    <el-icon><Refresh /></el-icon>
                    {{ isUncertain(item.payment_intent_id) ? '重试确认' : '触发对账' }}
                  </el-button>
                </template>
              </el-popconfirm>
              <small
                v-if="isUncertain(item.payment_intent_id)"
                class="uncertain-copy"
                aria-live="polite"
              >
                <el-icon><WarningFilled /></el-icon>
                上次结果未知
              </small>
            </div>
          </article>
        </div>

        <footer
          v-if="total > pageSize && !listError"
          class="reconciliation-pagination"
        >
          <span>第 {{ page }} / {{ totalPages }} 页</span>
          <el-pagination
            background
            layout="prev, pager, next"
            :current-page="page"
            :page-size="pageSize"
            :total="total"
            @current-change="changePage"
          />
        </footer>
      </section>
    </div>
  </AdminShell>
</template>

<style scoped>
.reconciliation-page {
  min-width: 0;
}

.reconciliation-toolbar {
  display: grid;
  align-items: center;
  gap: 10px;
  padding: 14px 0;
  border-top: 1px solid var(--admin-border);
  grid-template-columns: repeat(3, minmax(180px, 1fr));
}

.reconciliation-toolbar :deep(.el-date-editor) {
  width: 100%;
}

.toolbar-actions {
  display: flex;
  gap: 8px;
  grid-column: 1 / -1;
}

.reconciliation-list {
  overflow: hidden;
  border: 1px solid var(--admin-border);
  border-radius: 7px;
  background: #fff;
}

.reconciliation-list.refreshing {
  opacity: 0.82;
}

.reconciliation-list-heading,
.reconciliation-pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 13px 16px;
}

.reconciliation-list-heading {
  border-bottom: 1px solid var(--admin-border);
}

.reconciliation-list-heading > div,
.task-identity,
.task-status,
.task-identifiers,
.task-retry,
.task-schedule,
.task-action {
  display: grid;
  min-width: 0;
  gap: 4px;
}

.reconciliation-list-heading span,
.reconciliation-pagination,
.task-identity small,
.task-status small,
.task-retry small,
.task-schedule,
.task-identifiers {
  color: var(--admin-muted);
  font-size: 12px;
}

.reconciliation-state {
  display: grid;
  min-height: 300px;
  align-content: center;
  gap: 14px;
  padding: 24px;
}

.reconciliation-state.empty {
  justify-items: center;
  color: var(--admin-text-soft);
  text-align: center;
}

.reconciliation-state.empty > .el-icon {
  color: var(--admin-brand);
  font-size: 36px;
}

.reconciliation-table-header,
.reconciliation-row {
  display: grid;
  align-items: center;
  gap: 12px;
  grid-template-columns: minmax(150px, 0.9fr) minmax(130px, 0.8fr) minmax(245px, 1.5fr) minmax(120px, 0.7fr) minmax(130px, 0.8fr) 128px;
}

.reconciliation-table-header {
  padding: 10px 16px;
  color: var(--admin-muted);
  background: #f7faf8;
  font-size: 11px;
  font-weight: 700;
}

.reconciliation-row {
  min-width: 0;
  padding: 14px 16px;
  border-top: 1px solid var(--admin-border);
}

.task-type,
.status-badge {
  display: inline-flex;
  width: fit-content;
  align-items: center;
  padding: 3px 7px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 700;
}

.task-type {
  color: var(--admin-info);
  background: #eaf2fa;
}

.status-badge {
  color: var(--admin-text-soft);
  background: #edf1ef;
}

.status-badge.is-failed,
.status-badge.is-close_pending {
  color: #994141;
  background: #f7e9e9;
}

.status-badge.is-processing,
.status-badge.is-creating {
  color: #855c1d;
  background: #fbf0dc;
}

.task-identity strong,
.task-retry small,
.task-schedule span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-identifiers span {
  display: grid;
  min-width: 0;
  grid-template-columns: 32px minmax(0, 1fr);
}

.task-identifiers b {
  color: var(--admin-text-soft);
  font-size: 11px;
}

.task-identifiers span,
.task-retry small {
  overflow-wrap: anywhere;
}

.task-action {
  justify-items: start;
}

.uncertain-copy {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: #9b681f;
  font-size: 11px;
}

.reconciliation-pagination {
  border-top: 1px solid var(--admin-border);
}

@media (max-width: 1120px) {
  .reconciliation-list {
    overflow: visible;
    border: 0;
    border-radius: 0;
    background: transparent;
  }

  .reconciliation-list-heading,
  .reconciliation-pagination {
    padding-right: 0;
    padding-left: 0;
  }

  .reconciliation-list-heading {
    border-bottom: 0;
  }

  .reconciliation-table-header {
    display: none;
  }

  .reconciliation-table {
    display: grid;
    gap: 10px;
  }

  .reconciliation-row {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    padding: 14px;
    border: 1px solid var(--admin-border);
    border-radius: 7px;
    background: #fff;
  }

  .task-identity,
  .task-identifiers,
  .task-action {
    grid-column: 1 / -1;
  }

  .task-status::before,
  .task-retry::before,
  .task-schedule::before {
    color: var(--admin-muted);
    content: attr(data-label);
    font-size: 10px;
    font-weight: 700;
  }
}

@media (max-width: 760px) {
  .reconciliation-toolbar {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 560px) {
  .reconciliation-toolbar,
  .reconciliation-row {
    grid-template-columns: minmax(0, 1fr);
  }

  .toolbar-actions {
    display: grid;
    grid-column: auto;
    grid-template-columns: 1fr 1fr;
  }

  .task-identity,
  .task-identifiers,
  .task-action {
    grid-column: auto;
  }

  .task-action :deep(.el-button) {
    width: 100%;
  }

  .reconciliation-list-heading,
  .reconciliation-pagination {
    align-items: flex-start;
    flex-direction: column;
  }

  .reconciliation-pagination :deep(.el-pagination) {
    max-width: 100%;
    overflow-x: auto;
  }
}
</style>
