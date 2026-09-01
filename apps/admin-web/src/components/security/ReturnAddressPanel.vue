<script setup lang="ts">
import { EditPen, Location, RefreshRight, Warning } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';

import { AdminApiError, newIdempotencyKey } from '../../services/admin-api';
import {
  confirmAdminReturnAddress,
  getAdminReturnAddress,
  previewAdminReturnAddress,
} from '../../services/admin-settings';
import type {
  HighRiskPreview,
  ReturnAddress,
  ReturnAddressInput,
} from '../../services/admin-settings';
import { formatChinaDateTime } from '../../utils/time';

const emit = defineEmits<{
  'auth-expired': [error: AdminApiError];
}>();

interface Attempt {
  key: string;
  input: ReturnAddressInput;
}

const address = ref<ReturnAddress | null>(null);
const loading = ref(true);
const loadSlow = ref(false);
const loadError = ref('');
const dialogOpen = ref(false);
const pending = ref(false);
const pendingSlow = ref(false);
const uncertain = ref(false);
const errorMessage = ref('');
const conflictMessage = ref('');
const preview = ref<HighRiskPreview | null>(null);
const previewInput = ref<ReturnAddressInput | null>(null);
const form = reactive({
  city: '',
  detail: '',
  district: '',
  phone: '',
  province: '',
  reason: '',
  recipientName: '',
});
let loadController: AbortController | null = null;
let commandController: AbortController | null = null;
let loadSlowTimer: ReturnType<typeof setTimeout> | null = null;
let commandSlowTimer: ReturnType<typeof setTimeout> | null = null;
let previewAttempt: Attempt | null = null;
let confirmAttempt: { key: string; previewToken: string } | null = null;

const previewExpired = computed(() => {
  const value = preview.value;
  return value !== null && Date.parse(value.expires_at) <= Date.now();
});

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
  });
}

const formValid = computed(() => {
  const values = [
    [form.recipientName, 1, 80],
    [form.province, 1, 80],
    [form.city, 1, 80],
    [form.district, 1, 80],
    [form.detail, 1, 300],
    [form.reason, 2, 500],
  ] as const;
  return values.every(([value, minimum, maximum]) => {
    const normalized = value.trim();
    const length = Array.from(normalized).length;
    return length >= minimum && length <= maximum && !hasControlCharacter(normalized);
  }) && /^[0-9+ -]{6,30}$/.test(form.phone.trim());
});

function clearTimer(kind: 'command' | 'load'): void {
  const timer = kind === 'load' ? loadSlowTimer : commandSlowTimer;
  if (timer !== null) clearTimeout(timer);
  if (kind === 'load') {
    loadSlowTimer = null;
    loadSlow.value = false;
  } else {
    commandSlowTimer = null;
    pendingSlow.value = false;
  }
}

function startSlowTimer(kind: 'command' | 'load'): void {
  clearTimer(kind);
  const timer = setTimeout(() => {
    if (kind === 'load') loadSlow.value = true;
    else pendingSlow.value = true;
  }, 1_200);
  if (kind === 'load') loadSlowTimer = timer;
  else commandSlowTimer = timer;
}

function clearPreview(): void {
  preview.value = null;
  previewInput.value = null;
  previewAttempt = null;
  confirmAttempt = null;
  uncertain.value = false;
}

function clearPlaintextForm(): void {
  form.city = '';
  form.detail = '';
  form.district = '';
  form.phone = '';
  form.province = '';
  form.reason = '';
  form.recipientName = '';
}

function closeAndClear(): void {
  commandController?.abort();
  commandController = null;
  clearTimer('command');
  pending.value = false;
  errorMessage.value = '';
  conflictMessage.value = '';
  clearPreview();
  clearPlaintextForm();
}

function readableLoadError(error: unknown): string {
  if (!(error instanceof AdminApiError)) return '退货地址配置加载失败，请稍后重试';
  if (error.status === 0) return '网络连接失败，未能读取退货地址配置';
  if (error.status === 403) return '当前账号无权读取退货地址配置';
  if (error.status === 429) {
    return error.retryAfterSeconds
      ? `读取过于频繁，请在 ${error.retryAfterSeconds} 秒后重试`
      : '读取过于频繁，请稍后重试';
  }
  return '退货地址配置加载失败，请稍后重试';
}

function readableCommandError(error: unknown): string {
  if (!(error instanceof AdminApiError)) return '服务响应无法安全确认，请稍后使用同一请求标识重试';
  if (error.status === 0) return '网络连接中断，操作结果尚未确认，请使用同一请求标识重试';
  if (error.status === 403) return '当前账号无权发布总部退货地址';
  if (error.status === 404) return '当前地址基线已不存在，请刷新后重新预览';
  if (error.status === 422) return '地址内容未通过业务校验，请检查后重新预览';
  if (error.status === 429) {
    return error.retryAfterSeconds
      ? `操作过于频繁，请在 ${error.retryAfterSeconds} 秒后重试`
      : '操作过于频繁，请稍后重试';
  }
  if (error.status >= 500) return '服务暂时不可用，操作结果尚未确认，请使用同一请求标识重试';
  return '退货地址操作未完成，请刷新后重试';
}

function isUncertain(error: unknown): boolean {
  return !(error instanceof AdminApiError) || error.status === 0 || error.status >= 500;
}

async function loadAddress(): Promise<void> {
  loadController?.abort();
  const current = new AbortController();
  loadController = current;
  loading.value = true;
  loadError.value = '';
  startSlowTimer('load');
  try {
    address.value = await getAdminReturnAddress(current.signal);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    if (error instanceof AdminApiError && error.status === 401) {
      emit('auth-expired', error);
      return;
    }
    if (error instanceof AdminApiError && error.status === 404) {
      address.value = null;
      return;
    }
    loadError.value = readableLoadError(error);
  } finally {
    if (loadController === current) {
      loadController = null;
      loading.value = false;
      clearTimer('load');
    }
  }
}

function openEditor(): void {
  clearPlaintextForm();
  clearPreview();
  errorMessage.value = '';
  conflictMessage.value = '';
  form.recipientName = address.value?.recipient_name ?? '';
  form.province = address.value?.province ?? '';
  form.city = address.value?.city ?? '';
  form.district = address.value?.district ?? '';
  dialogOpen.value = true;
}

function input(): ReturnAddressInput {
  return {
    city: form.city.trim(),
    detail: form.detail.trim(),
    district: form.district.trim(),
    phone: form.phone.trim(),
    province: form.province.trim(),
    reason: form.reason.trim(),
    recipient_name: form.recipientName.trim(),
  };
}

function sameInput(left: ReturnAddressInput, right: ReturnAddressInput): boolean {
  return left.city === right.city && left.detail === right.detail && left.district === right.district &&
    left.phone === right.phone && left.province === right.province && left.reason === right.reason &&
    left.recipient_name === right.recipient_name;
}

async function handleConflict(): Promise<void> {
  clearPreview();
  errorMessage.value = '';
  conflictMessage.value = '当前地址版本或预览事实已变化，已刷新最新配置；请重新预览并确认。';
  await loadAddress();
}

async function runPreview(): Promise<void> {
  if (pending.value || !formValid.value) return;
  const body = input();
  if (previewAttempt === null || !sameInput(previewAttempt.input, body)) {
    previewAttempt = { input: body, key: newIdempotencyKey() };
  }
  pending.value = true;
  uncertain.value = false;
  errorMessage.value = '';
  conflictMessage.value = '';
  commandController?.abort();
  const current = new AbortController();
  commandController = current;
  startSlowTimer('command');
  try {
    const result = await previewAdminReturnAddress(body, previewAttempt.key, current.signal);
    if (Date.parse(result.expires_at) <= Date.now()) {
      previewAttempt = null;
      errorMessage.value = '预览已过期，请重新生成';
      return;
    }
    preview.value = result;
    previewInput.value = body;
    previewAttempt = null;
    confirmAttempt = null;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    if (error instanceof AdminApiError && error.status === 401) {
      emit('auth-expired', error);
      return;
    }
    if (error instanceof AdminApiError && (error.status === 404 || error.status === 409)) {
      await handleConflict();
      return;
    }
    const responseCannotBeReplayed = isUncertain(error);
    previewAttempt = null;
    uncertain.value = false;
    errorMessage.value = responseCannotBeReplayed
      ? '预览结果无法安全重放，请重新生成预览'
      : readableCommandError(error);
  } finally {
    if (commandController === current) {
      commandController = null;
      pending.value = false;
      clearTimer('command');
    }
  }
}

async function confirmPublish(): Promise<void> {
  const currentPreview = preview.value;
  const body = previewInput.value;
  if (pending.value || currentPreview === null || body === null) return;
  if (Date.parse(currentPreview.expires_at) <= Date.now()) {
    clearPreview();
    errorMessage.value = '预览已过期，请重新生成后确认';
    return;
  }
  if (confirmAttempt?.previewToken !== currentPreview.preview_token) {
    confirmAttempt = { key: newIdempotencyKey(), previewToken: currentPreview.preview_token };
  }
  pending.value = true;
  uncertain.value = false;
  errorMessage.value = '';
  commandController?.abort();
  const current = new AbortController();
  commandController = current;
  startSlowTimer('command');
  try {
    address.value = await confirmAdminReturnAddress(body, currentPreview, confirmAttempt.key, current.signal);
    confirmAttempt = null;
    dialogOpen.value = false;
    ElMessage.success('总部退货地址新版本已发布');
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    if (error instanceof AdminApiError && error.status === 401) {
      emit('auth-expired', error);
      return;
    }
    if (error instanceof AdminApiError && (error.status === 404 || error.status === 409)) {
      await handleConflict();
      return;
    }
    uncertain.value = isUncertain(error);
    if (!uncertain.value) confirmAttempt = null;
    errorMessage.value = readableCommandError(error);
  } finally {
    if (commandController === current) {
      commandController = null;
      pending.value = false;
      clearTimer('command');
    }
  }
}

function revisePreview(): void {
  clearPreview();
  errorMessage.value = '';
}

function closeDialog(): void {
  if (pending.value || uncertain.value) return;
  dialogOpen.value = false;
}

async function abandonAndRefresh(): Promise<void> {
  if (pending.value) return;
  uncertain.value = false;
  previewAttempt = null;
  confirmAttempt = null;
  dialogOpen.value = false;
  ElMessage.warning('已放弃本次未确认请求并清除地址明文，正在刷新服务端状态');
  await loadAddress();
}

onMounted(loadAddress);
onBeforeUnmount(() => {
  loadController?.abort();
  commandController?.abort();
  clearTimer('load');
  closeAndClear();
  address.value = null;
});
</script>

<template>
  <section
    class="return-address-panel"
    data-testid="return-address-panel"
    aria-labelledby="return-address-title"
  >
    <header class="panel-heading">
      <div>
        <p>售后设置</p>
        <h2 id="return-address-title">
          总部退货地址
        </h2>
        <span>新地址只影响后续批准的退货售后，历史售后继续使用原地址快照。</span>
      </div>
      <div class="panel-actions">
        <el-button
          :icon="RefreshRight"
          :loading="loading"
          aria-label="刷新总部退货地址"
          @click="loadAddress"
        />
        <el-button
          type="primary"
          :icon="EditPen"
          :disabled="loading || Boolean(loadError)"
          @click="openEditor"
        >
          {{ address ? '发布新版本' : '配置地址' }}
        </el-button>
      </div>
    </header>

    <el-alert
      v-if="loadSlow"
      title="地址配置加载时间较长，请保持页面打开。"
      type="info"
      :closable="false"
      show-icon
    />
    <el-alert
      v-if="loadError"
      :title="loadError"
      type="error"
      :closable="false"
      show-icon
    >
      <el-button
        link
        type="primary"
        @click="loadAddress"
      >
        重新加载
      </el-button>
    </el-alert>

    <div
      v-loading="loading"
      class="address-projection"
      :class="{ empty: !address }"
    >
      <template v-if="address">
        <span class="address-mark"><el-icon><Location /></el-icon></span>
        <div class="address-main">
          <strong>{{ address.recipient_name }} · {{ address.phone_masked }}</strong>
          <p>{{ address.province }} {{ address.city }} {{ address.district }} {{ address.detail_masked }}</p>
          <small>版本 {{ address.version_no }} · {{ formatChinaDateTime(address.effective_at) }}（北京时间）</small>
        </div>
        <el-tag
          type="success"
          effect="plain"
        >
          当前生效
        </el-tag>
      </template>
      <template v-else-if="!loading && !loadError">
        <span class="address-mark muted"><el-icon><Location /></el-icon></span>
        <div class="address-main">
          <strong>尚未配置总部退货地址</strong>
          <p>配置完成前，涉及退货寄回的售后不能批准。</p>
        </div>
        <el-tag
          type="warning"
          effect="plain"
        >
          未配置
        </el-tag>
      </template>
    </div>

    <el-dialog
      v-model="dialogOpen"
      data-testid="return-address-dialog"
      width="min(680px, calc(100vw - 24px))"
      :close-on-click-modal="false"
      :close-on-press-escape="!pending && !uncertain"
      :show-close="!pending && !uncertain"
      @closed="closeAndClear"
    >
      <template #header>
        <div class="dialog-heading">
          <span class="address-mark"><el-icon><Location /></el-icon></span>
          <div>
            <strong>{{ address ? '发布总部退货地址新版本' : '配置总部退货地址' }}</strong>
            <p>手机和详细地址不会回显，也不会保存在浏览器中。</p>
          </div>
        </div>
      </template>

      <div class="dialog-body">
        <el-alert
          v-if="conflictMessage"
          data-testid="return-address-conflict"
          :title="conflictMessage"
          type="warning"
          :closable="false"
          show-icon
        />
        <el-alert
          v-if="pendingSlow"
          title="请求处理时间较长，请勿重复操作。"
          type="info"
          :closable="false"
          show-icon
        />
        <el-alert
          v-if="uncertain"
          title="上次请求结果尚未确认。保持内容不变重试会复用同一请求标识。"
          type="warning"
          :closable="false"
          show-icon
        />
        <el-alert
          v-if="errorMessage"
          data-testid="return-address-error"
          :title="errorMessage"
          type="error"
          :closable="false"
          show-icon
        />

        <el-form
          v-if="preview === null"
          class="address-form"
          label-position="top"
          @submit.prevent="runPreview"
        >
          <div class="field-grid">
            <el-form-item
              label="收件人"
              required
            >
              <el-input
                v-model="form.recipientName"
                maxlength="80"
                autocomplete="off"
                :disabled="pending"
              />
            </el-form-item>
            <el-form-item
              label="手机号"
              required
            >
              <el-input
                v-model="form.phone"
                data-testid="return-address-phone"
                maxlength="30"
                inputmode="tel"
                autocomplete="off"
                :disabled="pending"
                placeholder="请输入完整号码，不会回显"
              />
            </el-form-item>
            <el-form-item
              label="省"
              required
            >
              <el-input
                v-model="form.province"
                maxlength="80"
                autocomplete="off"
                :disabled="pending"
              />
            </el-form-item>
            <el-form-item
              label="市"
              required
            >
              <el-input
                v-model="form.city"
                maxlength="80"
                autocomplete="off"
                :disabled="pending"
              />
            </el-form-item>
            <el-form-item
              label="区 / 县"
              required
            >
              <el-input
                v-model="form.district"
                maxlength="80"
                autocomplete="off"
                :disabled="pending"
              />
            </el-form-item>
          </div>
          <el-form-item
            label="详细地址"
            required
          >
            <el-input
              v-model="form.detail"
              data-testid="return-address-detail"
              type="textarea"
              :rows="3"
              maxlength="300"
              show-word-limit
              autocomplete="off"
              :disabled="pending"
              placeholder="请输入完整详细地址，不会回显"
            />
          </el-form-item>
          <el-form-item
            label="发布原因（2-500 字符）"
            required
          >
            <el-input
              v-model="form.reason"
              type="textarea"
              :rows="2"
              maxlength="500"
              show-word-limit
              autocomplete="off"
              :disabled="pending"
            />
          </el-form-item>
        </el-form>

        <section
          v-else
          class="preview-impact"
          data-testid="return-address-preview"
        >
          <div class="preview-title">
            <span class="address-mark warning"><el-icon><Warning /></el-icon></span>
            <div>
              <strong>确认发布影响</strong>
              <p>影响 {{ preview.impact.affected_count }} 项当前配置；确认后生成不可变新版本。</p>
            </div>
          </div>
          <dl
            v-if="preview.impact.metrics.length"
            class="metric-list"
          >
            <div
              v-for="metric in preview.impact.metrics"
              :key="metric.key"
            >
              <dt>{{ metric.label }}</dt>
              <dd><span>{{ metric.before ?? '无' }}</span><b>→</b><strong>{{ metric.after ?? '无' }}</strong></dd>
            </div>
          </dl>
          <el-alert
            v-for="warning in preview.impact.warnings"
            :key="warning"
            :title="warning"
            type="warning"
            :closable="false"
            show-icon
          />
          <small>预览有效至 {{ formatChinaDateTime(preview.expires_at) }}（北京时间）</small>
        </section>
      </div>

      <template #footer>
        <div class="dialog-footer">
          <el-button
            v-if="uncertain"
            type="warning"
            plain
            @click="abandonAndRefresh"
          >
            放弃并刷新
          </el-button>
          <el-button
            v-if="preview"
            :disabled="pending"
            @click="revisePreview"
          >
            修改内容
          </el-button>
          <el-button
            :disabled="pending || uncertain"
            @click="closeDialog"
          >
            取消
          </el-button>
          <el-button
            v-if="preview === null"
            type="primary"
            data-testid="return-address-preview-submit"
            :loading="pending"
            :disabled="!formValid"
            @click="runPreview"
          >
            {{ uncertain ? '使用同一请求标识重试预览' : '预览影响' }}
          </el-button>
          <el-button
            v-else
            type="primary"
            data-testid="return-address-confirm-submit"
            :loading="pending"
            :disabled="previewExpired"
            @click="confirmPublish"
          >
            {{ uncertain ? '使用同一请求标识重试确认' : '确认发布' }}
          </el-button>
        </div>
      </template>
    </el-dialog>
  </section>
</template>

<style scoped>
.return-address-panel {
  display: grid;
  gap: 16px;
  margin-top: 26px;
  padding-top: 24px;
  border-top: 1px solid var(--admin-border);
}

.panel-heading,
.panel-actions,
.dialog-heading,
.preview-title {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.panel-heading {
  justify-content: space-between;
}

.panel-heading p,
.panel-heading h2,
.panel-heading span,
.dialog-heading p,
.dialog-heading strong,
.preview-title p,
.preview-title strong {
  margin: 0;
}

.panel-heading p {
  color: var(--admin-brand);
  font-size: 11px;
  font-weight: 700;
}

.panel-heading h2 {
  margin: 4px 0;
  font-size: 18px;
}

.panel-heading span,
.dialog-heading p,
.preview-title p {
  color: var(--admin-muted);
  font-size: 12px;
  line-height: 1.55;
}

.panel-actions {
  flex: 0 0 auto;
}

.address-projection {
  display: grid;
  min-height: 100px;
  align-items: center;
  gap: 14px;
  padding: 18px;
  border: 1px solid var(--admin-border);
  border-radius: 8px;
  background: #fff;
  grid-template-columns: 42px minmax(0, 1fr) auto;
}

.address-projection.empty {
  border-style: dashed;
  background: #fafcfb;
}

.address-main {
  min-width: 0;
}

.address-main strong,
.address-main p,
.address-main small {
  display: block;
  margin: 0;
  overflow-wrap: anywhere;
}

.address-main p {
  margin: 5px 0;
  font-size: 13px;
  line-height: 1.55;
}

.address-main small {
  color: var(--admin-muted);
  font-size: 11px;
}

.address-mark {
  display: grid;
  width: 42px;
  height: 42px;
  flex: 0 0 42px;
  border-radius: 7px;
  color: var(--admin-brand);
  background: #e8f2ed;
  place-items: center;
}

.address-mark.muted {
  color: var(--admin-muted);
  background: #eef1ef;
}

.address-mark.warning {
  color: #94630b;
  background: #fff4da;
}

.dialog-heading > div,
.preview-title > div {
  display: grid;
  gap: 4px;
}

.dialog-body {
  display: grid;
  gap: 14px;
}

.address-form {
  display: grid;
  gap: 2px;
}

.field-grid {
  display: grid;
  column-gap: 14px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.preview-impact {
  display: grid;
  gap: 14px;
  padding: 16px;
  border: 1px solid #ead9aa;
  border-radius: 8px;
  background: #fffdf7;
}

.preview-impact > small {
  color: var(--admin-muted);
  font-size: 11px;
}

.metric-list {
  display: grid;
  gap: 8px;
  margin: 0;
}

.metric-list > div {
  display: grid;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid var(--admin-border);
  border-radius: 6px;
  background: #fff;
  grid-template-columns: minmax(100px, 0.7fr) minmax(0, 1.3fr);
}

.metric-list dt,
.metric-list dd {
  margin: 0;
  font-size: 12px;
}

.metric-list dd {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  overflow-wrap: anywhere;
}

.metric-list dd span,
.metric-list dd b {
  color: var(--admin-muted);
  font-weight: 400;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

@media (max-width: 620px) {
  .panel-heading {
    align-items: stretch;
    flex-direction: column;
  }

  .panel-actions .el-button:last-child {
    flex: 1;
  }

  .address-projection {
    align-items: flex-start;
    grid-template-columns: 42px minmax(0, 1fr);
  }

  .address-projection .el-tag {
    grid-column: 2;
    justify-self: flex-start;
  }

  .field-grid,
  .metric-list > div {
    grid-template-columns: 1fr;
  }

  .metric-list dd {
    justify-content: flex-start;
  }

  .dialog-footer {
    display: grid;
    grid-template-columns: 1fr;
  }

  .dialog-footer .el-button {
    width: 100%;
    margin: 0;
  }
}
</style>
