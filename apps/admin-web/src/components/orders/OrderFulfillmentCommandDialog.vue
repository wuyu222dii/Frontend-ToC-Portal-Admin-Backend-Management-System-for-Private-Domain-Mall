<script setup lang="ts">
import { Check, EditPen, Promotion, Warning } from '@element-plus/icons-vue';
import { computed, reactive, ref, watch } from 'vue';

import { AdminApiError, newIdempotencyKey } from '../../services/admin-api';
import {
  appendAdminLogisticsEvent,
  completeAdminOrder,
  createAdminShipment,
} from '../../services/admin-orders';
import type { AdminOrderDetail, CreateShipmentInput, LogisticsEventInput } from '../../types/orders';

type CommandMode = 'COMPLETE' | 'LOGISTICS' | 'SHIP';
type LogisticsMode = 'STATUS' | 'TRACKING_CORRECTION';

const props = defineProps<{
  open: boolean;
  mode: CommandMode;
  order: AdminOrderDetail;
  shipmentVersion: number | undefined;
}>();

const emit = defineEmits<{
  'update:open': [value: boolean];
  completed: [message: string];
  conflict: [];
  'auth-expired': [error: AdminApiError];
}>();

const dialogOpen = computed({
  get: () => props.open,
  set: (value: boolean) => emit('update:open', value),
});
const submitting = ref(false);
const uncertain = ref(false);
const errorMessage = ref('');
const logisticsMode = ref<LogisticsMode>('STATUS');
const form = reactive({
  carrierCode: '',
  carrierName: '',
  trackingNo: '',
  description: '',
  location: '',
  occurredAt: new Date() as Date | null,
  statusCode: 'IN_TRANSIT' as 'DELIVERED' | 'IN_TRANSIT',
  reason: '',
});
let attempt: { key: string; signature: string } | null = null;

const shipment = computed(() => props.order.packages[0] ?? null);
const shippableItems = computed(() => props.order.items
  .map((item) => ({
    order_item_id: item.order_item_id,
    product_name: item.product_name,
    quantity: item.quantity - item.refunded_quantity - item.shipped_quantity,
    sku_name: item.sku_name,
  }))
  .filter(({ quantity }) => quantity > 0));
const nextStatus = computed<'DELIVERED' | 'IN_TRANSIT' | null>(() => {
  if (shipment.value?.status === 'SHIPPED') return 'IN_TRANSIT';
  if (shipment.value?.status === 'IN_TRANSIT') return 'DELIVERED';
  return null;
});
const title = computed(() => ({
  COMPLETE: '兜底完成订单',
  LOGISTICS: '维护人工物流',
  SHIP: '确认整单发货',
})[props.mode]);
const submitLabel = computed(() => {
  if (uncertain.value) return '使用同一请求标识重试';
  return ({ COMPLETE: '确认兜底完成', LOGISTICS: '追加物流事实', SHIP: '确认并发货' })[props.mode];
});

function resetForm(): void {
  form.carrierCode = '';
  form.carrierName = '';
  form.trackingNo = '';
  form.description = '';
  form.location = '';
  form.occurredAt = new Date();
  form.statusCode = nextStatus.value ?? 'IN_TRANSIT';
  form.reason = '';
  logisticsMode.value = nextStatus.value === null ? 'TRACKING_CORRECTION' : 'STATUS';
  errorMessage.value = '';
  uncertain.value = false;
  attempt = null;
}

function normalized(value: string): string {
  return value.trim();
}

function commandBody(): CreateShipmentInput | LogisticsEventInput | { completion_reason: 'ADMIN_FORCED'; reason: string } {
  if (props.mode === 'SHIP') {
    return {
      carrier_code: normalized(form.carrierCode),
      carrier_name: normalized(form.carrierName),
      items: shippableItems.value.map(({ order_item_id, quantity }) => ({ order_item_id, quantity })),
      tracking_no: normalized(form.trackingNo),
    };
  }
  if (props.mode === 'COMPLETE') {
    return { completion_reason: 'ADMIN_FORCED', reason: normalized(form.reason) };
  }
  const base = {
    description: normalized(form.description),
    event_type: logisticsMode.value,
    location: normalized(form.location) || null,
    occurred_at: form.occurredAt?.toISOString() ?? '',
  } as const;
  if (logisticsMode.value === 'STATUS') {
    return { ...base, event_type: 'STATUS', status_code: form.statusCode };
  }
  return {
    ...base,
    carrier_code: normalized(form.carrierCode),
    carrier_name: normalized(form.carrierName),
    event_type: 'TRACKING_CORRECTION',
    reason: normalized(form.reason),
    tracking_no: normalized(form.trackingNo),
  };
}

const valid = computed(() => {
  if (props.mode === 'SHIP') {
    return shippableItems.value.length > 0 &&
      normalized(form.carrierCode).length >= 1 && normalized(form.carrierCode).length <= 40 &&
      normalized(form.carrierName).length >= 1 && normalized(form.carrierName).length <= 80 &&
      normalized(form.trackingNo).length >= 1 && normalized(form.trackingNo).length <= 120;
  }
  if (props.mode === 'COMPLETE') {
    const length = Array.from(normalized(form.reason)).length;
    return length >= 2 && length <= 500;
  }
  if (!form.occurredAt || normalized(form.description).length < 1 || normalized(form.description).length > 300) {
    return false;
  }
  if (logisticsMode.value === 'STATUS') return nextStatus.value !== null && form.statusCode === nextStatus.value;
  const reasonLength = Array.from(normalized(form.reason)).length;
  return normalized(form.carrierCode).length >= 1 && normalized(form.carrierCode).length <= 40 &&
    normalized(form.carrierName).length >= 1 && normalized(form.carrierName).length <= 80 &&
    normalized(form.trackingNo).length >= 1 && normalized(form.trackingNo).length <= 120 &&
    reasonLength >= 2 && reasonLength <= 500;
});

function isUncertainFailure(error: unknown): boolean {
  if (!(error instanceof AdminApiError)) return true;
  return error.status === 0 || error.status >= 500;
}

function readableError(error: unknown): string {
  if (!(error instanceof AdminApiError)) {
    return '服务响应无法安全确认；请使用同一请求标识重试';
  }
  if (error.status === 0) return '网络连接中断，操作结果尚未确认；请使用同一请求标识重试';
  if (error.status === 403) return '当前账号无权执行该履约操作';
  if (error.status === 404) return '订单或包裹已不存在';
  if (error.status === 422) {
    if (error.code === 'ACTIVE_AFTERSALE_BLOCKS_SHIPMENT') return '订单存在活动售后占用，当前不能发货';
    if (error.code === 'SHIPMENT_ITEMS_MISMATCH') return '可发商品数量已变化，请刷新后重新确认';
    return '当前订单不满足该履约操作的业务条件';
  }
  if (error.status === 429) {
    return error.retryAfterSeconds
      ? `操作过于频繁，请在 ${error.retryAfterSeconds} 秒后重试`
      : '操作过于频繁，请稍后重试';
  }
  if (error.status >= 500) return '服务暂时不可用，操作结果尚未确认；请使用同一请求标识重试';
  return '操作未完成，请刷新订单后重试';
}

async function submit(): Promise<void> {
  if (submitting.value || !valid.value) return;
  const body = commandBody();
  const resourceVersion = props.mode === 'LOGISTICS' ? props.shipmentVersion : props.order.version;
  if (resourceVersion === undefined) {
    errorMessage.value = '包裹版本不可用，请刷新订单后重试';
    return;
  }
  const signature = JSON.stringify({ body, mode: props.mode, resourceVersion });
  if (attempt?.signature !== signature) attempt = { key: newIdempotencyKey(), signature };

  submitting.value = true;
  errorMessage.value = '';
  try {
    if (props.mode === 'SHIP') {
      await createAdminShipment(
        props.order.order_id,
        body as CreateShipmentInput,
        props.order.version,
        attempt.key,
      );
    } else if (props.mode === 'COMPLETE') {
      await completeAdminOrder(props.order.order_id, normalized(form.reason), props.order.version, attempt.key);
    } else {
      const packageValue = shipment.value;
      if (!packageValue) throw new Error('Shipment is unavailable');
      await appendAdminLogisticsEvent(
        packageValue.shipment_id,
        body as LogisticsEventInput,
        resourceVersion,
        attempt.key,
      );
    }
    attempt = null;
    uncertain.value = false;
    dialogOpen.value = false;
    emit('completed', ({ COMPLETE: '订单已完成', LOGISTICS: '物流事实已追加', SHIP: '订单已整单发货' })[props.mode]);
  } catch (error) {
    if (error instanceof AdminApiError && error.status === 401) {
      emit('auth-expired', error);
      return;
    }
    if (error instanceof AdminApiError && error.status === 409) {
      attempt = null;
      uncertain.value = false;
      dialogOpen.value = false;
      emit('conflict');
      return;
    }
    uncertain.value = isUncertainFailure(error);
    if (!uncertain.value) attempt = null;
    errorMessage.value = readableError(error);
  } finally {
    submitting.value = false;
  }
}

function abandonAndRefresh(): void {
  attempt = null;
  uncertain.value = false;
  dialogOpen.value = false;
  emit('conflict');
}

function closed(): void {
  if (!uncertain.value) resetForm();
}

watch(() => props.open, (open) => {
  if (!open || uncertain.value) return;
  resetForm();
});

watch(nextStatus, (value) => {
  if (value) form.statusCode = value;
});
</script>

<template>
  <el-dialog
    v-model="dialogOpen"
    :data-testid="`order-${mode.toLowerCase()}-dialog`"
    width="min(620px, calc(100vw - 24px))"
    :close-on-click-modal="false"
    :close-on-press-escape="!submitting && !uncertain"
    :show-close="!submitting && !uncertain"
    @closed="closed"
  >
    <template #header>
      <div class="command-heading">
        <span
          class="command-mark"
          :class="{ warning: mode === 'COMPLETE' }"
        >
          <el-icon><Warning v-if="mode === 'COMPLETE'" /><Promotion v-else /></el-icon>
        </span>
        <div>
          <strong>{{ title }}</strong>
          <p>{{ order.order_no }} · 当前版本 {{ mode === 'LOGISTICS' ? shipmentVersion : order.version }}</p>
        </div>
      </div>
    </template>

    <div class="command-body">
      <el-alert
        v-if="uncertain"
        data-testid="order-command-uncertain"
        title="上次请求结果尚未确认。保持表单不变重试时会复用同一幂等键。"
        type="warning"
        :closable="false"
        show-icon
      />

      <fieldset
        class="command-fields"
        :disabled="submitting || uncertain"
      >
        <template v-if="mode === 'SHIP'">
          <el-alert
            title="将一次创建整单唯一包裹，以下数量由当前订单投影固定计算。"
            type="info"
            :closable="false"
            show-icon
          />
          <div
            class="shipment-lines"
            data-testid="order-shipment-items"
          >
            <div
              v-for="item in shippableItems"
              :key="item.order_item_id"
            >
              <span>{{ item.product_name }} · {{ item.sku_name }}</span>
              <strong>× {{ item.quantity }}</strong>
            </div>
          </div>
          <el-form
            label-position="top"
            class="command-form"
            @submit.prevent="submit"
          >
            <div class="form-grid">
              <el-form-item
                label="承运商编码"
                required
              >
                <el-input
                  v-model="form.carrierCode"
                  data-testid="order-shipment-carrier-code"
                  maxlength="40"
                />
              </el-form-item>
              <el-form-item
                label="承运商名称"
                required
              >
                <el-input
                  v-model="form.carrierName"
                  data-testid="order-shipment-carrier-name"
                  maxlength="80"
                />
              </el-form-item>
            </div>
            <el-form-item
              label="运单号"
              required
            >
              <el-input
                v-model="form.trackingNo"
                data-testid="order-shipment-tracking-no"
                maxlength="120"
              />
            </el-form-item>
          </el-form>
        </template>

        <template v-else-if="mode === 'LOGISTICS'">
          <el-radio-group
            v-model="logisticsMode"
            data-testid="order-logistics-mode"
          >
            <el-radio-button
              value="STATUS"
              :disabled="nextStatus === null"
            >
              推进状态
            </el-radio-button>
            <el-radio-button value="TRACKING_CORRECTION">
              纠正承运信息
            </el-radio-button>
          </el-radio-group>
          <el-form
            label-position="top"
            class="command-form"
            @submit.prevent="submit"
          >
            <el-form-item
              v-if="logisticsMode === 'STATUS'"
              label="下一状态"
              required
            >
              <el-input
                :model-value="nextStatus === 'IN_TRANSIT' ? '运输中' : '已送达'"
                data-testid="order-logistics-next-status"
                readonly
              />
            </el-form-item>
            <template v-else>
              <div class="form-grid">
                <el-form-item
                  label="新承运商编码"
                  required
                >
                  <el-input
                    v-model="form.carrierCode"
                    data-testid="order-logistics-carrier-code"
                    maxlength="40"
                  />
                </el-form-item>
                <el-form-item
                  label="新承运商名称"
                  required
                >
                  <el-input
                    v-model="form.carrierName"
                    data-testid="order-logistics-carrier-name"
                    maxlength="80"
                  />
                </el-form-item>
              </div>
              <el-form-item
                label="新运单号"
                required
              >
                <el-input
                  v-model="form.trackingNo"
                  data-testid="order-logistics-tracking-no"
                  maxlength="120"
                />
              </el-form-item>
              <el-form-item
                label="纠正原因"
                required
              >
                <el-input
                  v-model="form.reason"
                  data-testid="order-logistics-reason"
                  maxlength="500"
                  show-word-limit
                />
              </el-form-item>
            </template>
            <el-form-item
              label="节点说明"
              required
            >
              <el-input
                v-model="form.description"
                data-testid="order-logistics-description"
                maxlength="300"
                show-word-limit
              />
            </el-form-item>
            <div class="form-grid">
              <el-form-item
                label="发生时间"
                required
              >
                <el-date-picker
                  v-model="form.occurredAt"
                  data-testid="order-logistics-occurred-at"
                  type="datetime"
                  placeholder="选择发生时间"
                />
              </el-form-item>
              <el-form-item label="地点（可选）">
                <el-input
                  v-model="form.location"
                  data-testid="order-logistics-location"
                  maxlength="160"
                />
              </el-form-item>
            </div>
          </el-form>
        </template>

        <template v-else>
          <el-alert
            title="该操作会将订单和包裹封存为已完成，并触发冻结规则下的佣金结转。"
            type="warning"
            :closable="false"
            show-icon
          />
          <el-form
            label-position="top"
            class="command-form"
            @submit.prevent="submit"
          >
            <el-form-item
              label="兜底完成原因（2-500 字符）"
              required
            >
              <el-input
                v-model="form.reason"
                data-testid="order-complete-reason"
                type="textarea"
                :rows="4"
                maxlength="500"
                show-word-limit
              />
            </el-form-item>
          </el-form>
        </template>
      </fieldset>

      <el-alert
        v-if="errorMessage"
        data-testid="order-command-error"
        :title="errorMessage"
        type="error"
        :closable="false"
        show-icon
      />
    </div>

    <template #footer>
      <el-button
        v-if="uncertain"
        data-testid="order-command-abandon"
        :disabled="submitting"
        @click="abandonAndRefresh"
      >
        放弃并刷新订单
      </el-button>
      <el-button
        v-else
        :disabled="submitting"
        @click="dialogOpen = false"
      >
        取消
      </el-button>
      <el-button
        type="primary"
        :data-testid="`order-${mode.toLowerCase()}-submit`"
        :loading="submitting"
        :disabled="!valid"
        @click="submit"
      >
        <el-icon><EditPen v-if="uncertain" /><Check v-else /></el-icon>
        {{ submitLabel }}
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.command-heading {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.command-heading strong,
.command-heading p {
  margin: 0;
}

.command-heading p {
  margin-top: 4px;
  color: var(--admin-muted);
  font-size: 12px;
}

.command-mark {
  display: grid;
  width: 36px;
  height: 36px;
  flex: 0 0 36px;
  border-radius: 7px;
  color: var(--admin-brand);
  background: #e8f2ed;
  place-items: center;
}

.command-mark.warning {
  color: #9b681f;
  background: #fbf1df;
}

.command-body,
.command-form {
  display: grid;
  gap: 14px;
}

.command-fields {
  display: grid;
  min-width: 0;
  gap: 14px;
  margin: 0;
  padding: 0;
  border: 0;
}

.command-form .el-form-item {
  margin: 0;
}

.form-grid {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.shipment-lines {
  overflow: hidden;
  border: 1px solid var(--admin-border);
  border-radius: 7px;
}

.shipment-lines div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 11px 13px;
  border-top: 1px solid var(--admin-border);
  font-size: 13px;
}

.shipment-lines div:first-child {
  border-top: 0;
}

.shipment-lines span {
  min-width: 0;
  overflow-wrap: anywhere;
}

.shipment-lines strong {
  white-space: nowrap;
}

.command-form :deep(.el-date-editor) {
  width: 100%;
}

@media (max-width: 560px) {
  .form-grid {
    grid-template-columns: 1fr;
  }
}
</style>
