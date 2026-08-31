<script setup lang="ts">
import { Location, Lock } from '@element-plus/icons-vue';
import { computed, onBeforeUnmount, ref, watch } from 'vue';

import { AdminApiError } from '../../services/admin-api';
import { getAdminFulfillmentAddress } from '../../services/admin-orders';
import type { AdminFulfillmentAddress } from '../../types/orders';

const props = defineProps<{
  open: boolean;
  orderId: string;
  orderNo: string;
}>();

const emit = defineEmits<{
  'update:open': [value: boolean];
  'auth-expired': [error: AdminApiError];
}>();

const dialogOpen = computed({
  get: () => props.open,
  set: (value: boolean) => emit('update:open', value),
});
const reason = ref('');
const address = ref<AdminFulfillmentAddress | null>(null);
const loading = ref(false);
const errorMessage = ref('');
let controller: AbortController | null = null;
let expiryTimer: ReturnType<typeof setTimeout> | null = null;

function clearPlaintext(): void {
  address.value = null;
  if (expiryTimer !== null) clearTimeout(expiryTimer);
  expiryTimer = null;
}

function clearAll(): void {
  controller?.abort();
  controller = null;
  loading.value = false;
  errorMessage.value = '';
  reason.value = '';
  clearPlaintext();
}

function readableError(error: unknown): string {
  if (!(error instanceof AdminApiError)) return '履约地址读取失败，请稍后重试';
  if (error.status === 0) return '网络连接失败，未展示任何地址明文';
  if (error.status === 403) return '当前账号或本次用途无权读取履约地址';
  if (error.status === 404) return '订单或履约地址不存在';
  if (error.status === 429) {
    return error.retryAfterSeconds
      ? `读取过于频繁，请在 ${error.retryAfterSeconds} 秒后重试`
      : '读取过于频繁，请稍后重试';
  }
  return '履约地址读取失败，请稍后重试';
}

async function readAddress(): Promise<void> {
  if (loading.value || reason.value.trim().length < 5 || reason.value.trim().length > 200) return;
  controller?.abort();
  const current = new AbortController();
  controller = current;
  loading.value = true;
  errorMessage.value = '';
  clearPlaintext();
  try {
    const result = await getAdminFulfillmentAddress(props.orderId, reason.value.trim(), current.signal);
    if (controller !== current) return;
    if (Date.parse(result.access_expires_at) <= Date.now()) {
      errorMessage.value = '本次明文查看窗口已过期，请重新发起读取';
      return;
    }
    address.value = result;
    const delay = Math.max(0, Date.parse(result.access_expires_at) - Date.now());
    expiryTimer = setTimeout(() => {
      clearPlaintext();
      errorMessage.value = '本次明文查看窗口已过期，内容已清除';
    }, delay);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    if (error instanceof AdminApiError && error.status === 401) {
      emit('auth-expired', error);
      return;
    }
    errorMessage.value = readableError(error);
  } finally {
    if (controller === current) {
      controller = null;
      loading.value = false;
    }
  }
}

watch(() => props.open, (open) => {
  if (!open) clearAll();
});

onBeforeUnmount(clearAll);
</script>

<template>
  <el-dialog
    v-model="dialogOpen"
    data-testid="fulfillment-address-dialog"
    width="min(560px, calc(100vw - 24px))"
    :close-on-click-modal="false"
    :close-on-press-escape="!loading"
    @closed="clearAll"
  >
    <template #header>
      <div class="dialog-heading">
        <span class="dialog-mark"><el-icon><Lock /></el-icon></span>
        <div>
          <strong>受控读取履约地址</strong>
          <p>{{ orderNo }} · 明文仅在本次短时窗口展示</p>
        </div>
      </div>
    </template>

    <div class="address-dialog-body">
      <el-alert
        title="用途固定为订单履约。请勿截图、导出或将明文写入备注。"
        type="warning"
        :closable="false"
        show-icon
      />

      <el-form
        label-position="top"
        @submit.prevent="readAddress"
      >
        <el-form-item
          label="本次读取原因（5-200 字符）"
          required
        >
          <el-input
            v-model="reason"
            data-testid="fulfillment-address-reason"
            maxlength="200"
            show-word-limit
            :disabled="loading || address !== null"
            placeholder="例如：核对本订单发货收件信息"
          />
        </el-form-item>
        <el-button
          v-if="address === null"
          type="primary"
          data-testid="fulfillment-address-read"
          :loading="loading"
          :disabled="reason.trim().length < 5 || reason.trim().length > 200"
          @click="readAddress"
        >
          <el-icon><Location /></el-icon>
          读取本次履约地址
        </el-button>
      </el-form>

      <el-alert
        v-if="errorMessage"
        data-testid="fulfillment-address-error"
        :title="errorMessage"
        type="error"
        :closable="false"
        show-icon
      />

      <section
        v-if="address"
        class="plaintext-address"
        data-testid="fulfillment-address-plaintext"
        aria-live="polite"
      >
        <div><span>收件人</span><strong>{{ address.recipient_name }}</strong></div>
        <div><span>手机号</span><strong>{{ address.phone }}</strong></div>
        <div>
          <span>收件地址</span>
          <strong>{{ address.province }} {{ address.city }} {{ address.district }} {{ address.detail }}</strong>
        </div>
        <small>窗口到期时间：{{ new Date(address.access_expires_at).toLocaleString('zh-CN', { hour12: false }) }}</small>
      </section>
    </div>

    <template #footer>
      <el-button
        data-testid="fulfillment-address-close"
        :disabled="loading"
        @click="dialogOpen = false"
      >
        关闭并清除
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.dialog-heading {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.dialog-heading p,
.dialog-heading strong {
  margin: 0;
}

.dialog-heading p {
  margin-top: 4px;
  color: var(--admin-muted);
  font-size: 12px;
}

.dialog-mark {
  display: grid;
  width: 36px;
  height: 36px;
  flex: 0 0 36px;
  border-radius: 7px;
  color: var(--admin-brand);
  background: #e8f2ed;
  place-items: center;
}

.address-dialog-body {
  display: grid;
  gap: 16px;
}

.address-dialog-body .el-form-item {
  margin: 0;
}

.plaintext-address {
  display: grid;
  gap: 12px;
  padding: 16px;
  border: 1px solid #b9cec4;
  border-radius: 7px;
  background: #f4f9f6;
}

.plaintext-address div {
  display: grid;
  gap: 3px;
}

.plaintext-address span,
.plaintext-address small {
  color: var(--admin-muted);
  font-size: 11px;
}

.plaintext-address strong {
  font-size: 14px;
  line-height: 1.55;
  overflow-wrap: anywhere;
}
</style>
