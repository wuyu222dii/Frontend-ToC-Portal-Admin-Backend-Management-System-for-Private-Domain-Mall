<script setup lang="ts">
import { EditPen, RefreshRight, Setting } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';

import HighRiskCommandDialog from '../b13/HighRiskCommandDialog.vue';
import { AdminApiError } from '../../services/admin-api';
import {
  confirmAdminBusinessRules,
  getAdminBusinessRules,
  previewAdminBusinessRules,
} from '../../services/admin-settings';
import type { BusinessRuleInput, BusinessRules, HighRiskPreview } from '../../types/admin-b13';
import { formatChinaDateTime } from '../../utils/time';

const emit = defineEmits<{
  'auth-expired': [error: AdminApiError];
}>();

const rules = ref<BusinessRules | null>(null);
const loading = ref(true);
const loadError = ref('');
const dialogOpen = ref(false);
const form = reactive({ aftersaleWindowDays: 1, minimumWithdrawalAmount: '' });
let sequence = 0;
let controller: AbortController | null = null;

const minimumValid = computed(() => /^(?:0\.(?:0[1-9]|[1-9][0-9])|[1-9][0-9]{0,15}\.[0-9]{2})$/.test(form.minimumWithdrawalAmount.trim()));
const daysValid = computed(() => Number.isSafeInteger(form.aftersaleWindowDays) && form.aftersaleWindowDays >= 1 && form.aftersaleWindowDays <= 365);
const changed = computed(() => rules.value !== null && (
  form.minimumWithdrawalAmount.trim() !== rules.value.minimum_withdrawal_amount ||
  form.aftersaleWindowDays !== rules.value.aftersale_window_days
));
const formValid = computed(() => minimumValid.value && daysValid.value && changed.value);

function syncForm(): void {
  if (!rules.value) return;
  form.minimumWithdrawalAmount = rules.value.minimum_withdrawal_amount;
  form.aftersaleWindowDays = rules.value.aftersale_window_days;
}

function readableError(error: unknown): string {
  if (!(error instanceof AdminApiError)) return '业务规则加载失败，请稍后重试';
  if (error.status === 0) return '网络连接失败，未能读取当前业务规则';
  if (error.status === 403) return '当前账号无权读取业务规则';
  if (error.status === 429) {
    return error.retryAfterSeconds
      ? `读取过于频繁，请在 ${error.retryAfterSeconds} 秒后重试`
      : '读取过于频繁，请稍后重试';
  }
  if (error.status >= 500) return '业务规则服务暂时不可用，请稍后重试';
  return '业务规则加载失败，请稍后重试';
}

async function loadRules(): Promise<void> {
  const currentSequence = ++sequence;
  controller?.abort();
  const current = new AbortController();
  controller = current;
  loading.value = true;
  loadError.value = '';
  try {
    const result = await getAdminBusinessRules(current.signal);
    if (currentSequence !== sequence) return;
    rules.value = result;
    syncForm();
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    if (currentSequence !== sequence) return;
    if (error instanceof AdminApiError && error.status === 401) {
      emit('auth-expired', error);
      return;
    }
    rules.value = null;
    loadError.value = readableError(error);
  } finally {
    if (currentSequence === sequence) {
      loading.value = false;
      controller = null;
    }
  }
}

function commandInput(reason: string): BusinessRuleInput {
  const current = rules.value;
  if (!current) throw new TypeError('Business rules are unavailable');
  const changes: BusinessRuleInput['changes'] = {};
  const minimum = form.minimumWithdrawalAmount.trim();
  if (minimum !== current.minimum_withdrawal_amount) changes.minimum_withdrawal_amount = minimum;
  if (form.aftersaleWindowDays !== current.aftersale_window_days) {
    changes.aftersale_window_days = form.aftersaleWindowDays;
  }
  return { changes, reason };
}

function previewRules(reason: string, key: string, signal: AbortSignal): Promise<HighRiskPreview> {
  return previewAdminBusinessRules(commandInput(reason), key, signal);
}

async function confirmRules(
  reason: string,
  preview: HighRiskPreview,
  key: string,
  signal: AbortSignal,
): Promise<BusinessRules> {
  const result = await confirmAdminBusinessRules(commandInput(reason), preview, key, signal);
  rules.value = result;
  syncForm();
  return result;
}

function completed(): void {
  ElMessage.success('业务规则新版本已发布');
}

async function conflict(): Promise<void> {
  dialogOpen.value = false;
  await loadRules();
  ElMessage.warning('业务规则版本已变化，已刷新当前生效版本');
}

onMounted(loadRules);
onBeforeUnmount(() => {
  ++sequence;
  controller?.abort();
  dialogOpen.value = false;
  rules.value = null;
});
</script>

<template>
  <section class="business-rules-panel" data-testid="business-rules-panel" aria-labelledby="business-rules-title">
    <header class="rules-heading">
      <div>
        <p>经营规则</p>
        <h2 id="business-rules-title">提现与售后规则</h2>
        <span>发布新版本只影响后续提现申请和之后完成订单的售后期限，不回写历史事实。</span>
      </div>
      <div class="rules-actions">
        <el-button :icon="RefreshRight" :loading="loading" aria-label="刷新业务规则" @click="loadRules" />
        <el-button
          type="primary"
          :icon="EditPen"
          data-testid="business-rules-open"
          :disabled="loading || Boolean(loadError) || !formValid || dialogOpen"
          @click="dialogOpen = true"
        >
          预览发布
        </el-button>
      </div>
    </header>

    <el-alert v-if="loadError" data-testid="business-rules-error" :title="loadError" type="error" :closable="false" show-icon>
      <el-button link type="primary" @click="loadRules">重新加载</el-button>
    </el-alert>
    <div v-if="loading" class="rules-loading" data-testid="business-rules-loading"><el-skeleton :rows="4" animated /></div>
    <template v-else-if="rules">
      <div class="rules-grid">
        <el-form-item label="最低提现金额（元）" :error="minimumValid ? '' : '请输入大于 0 且保留两位小数的金额'">
          <el-input
            v-model="form.minimumWithdrawalAmount"
            data-testid="business-rules-minimum"
            inputmode="decimal"
            maxlength="19"
            :disabled="dialogOpen"
            placeholder="100.00"
          >
            <template #prefix>¥</template>
          </el-input>
        </el-form-item>
        <el-form-item label="售后申请期（自然日）" :error="daysValid ? '' : '请输入 1-365 的整数'">
          <el-input-number
            v-model="form.aftersaleWindowDays"
            data-testid="business-rules-aftersale-days"
            :min="1"
            :max="365"
            :precision="0"
            :disabled="dialogOpen"
            controls-position="right"
          />
        </el-form-item>
      </div>

      <div class="readonly-rules">
        <article><span class="rule-icon"><el-icon><Setting /></el-icon></span><div><small>订单支付超时</small><strong>{{ rules.order_payment_timeout_minutes }} 分钟</strong><p>数据库固定口径，后台不可修改</p></div></article>
        <article><span class="rule-icon"><el-icon><Setting /></el-icon></span><div><small>法定记录保留</small><strong>{{ rules.legal_record_retention_years }} 年</strong><p>外部合规配置快照，后台只读</p></div></article>
      </div>
      <small class="rule-version">当前版本 v{{ rules.version_no }} · {{ formatChinaDateTime(rules.effective_at) }}（北京时间）</small>
    </template>

    <HighRiskCommandDialog
      v-model:open="dialogOpen"
      title="发布业务规则新版本"
      description="请确认最低提现金额或售后申请期的变化。新版本仅作用于之后产生的业务事实。"
      confirm-label="确认发布"
      :preview-command="previewRules"
      :confirm-command="confirmRules"
      @completed="completed"
      @conflict="conflict"
      @auth-expired="emit('auth-expired', $event)"
    />
  </section>
</template>

<style scoped>
.business-rules-panel { display: grid; gap: 16px; margin-top: 26px; padding-top: 24px; border-top: 1px solid var(--admin-border); }
.rules-heading, .rules-actions { display: flex; align-items: flex-start; gap: 12px; }
.rules-heading { justify-content: space-between; }
.rules-heading p, .rules-heading h2, .rules-heading span { margin: 0; }
.rules-heading p { color: var(--admin-brand); font-size: 11px; font-weight: 700; }
.rules-heading h2 { margin: 4px 0; font-size: 18px; }
.rules-heading span, .rule-version, .readonly-rules p, .readonly-rules small { color: var(--admin-muted); font-size: 12px; }
.rules-loading { min-height: 180px; }
.rules-grid { display: grid; gap: 18px; padding: 18px; border: 1px solid var(--admin-border); background: #fff; grid-template-columns: repeat(2, minmax(0, 1fr)); }
.rules-grid .el-form-item { margin: 0; }
.rules-grid :deep(.el-input-number) { width: 100%; }
.readonly-rules { display: grid; gap: 12px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
.readonly-rules article { display: flex; align-items: center; gap: 12px; padding: 16px; border: 1px solid var(--admin-border); background: #f8faf9; }
.readonly-rules article > div { display: grid; gap: 3px; }
.readonly-rules p { margin: 0; }
.readonly-rules strong { font-size: 16px; }
.rule-icon { display: grid; width: 36px; height: 36px; flex: 0 0 36px; border-radius: 7px; color: var(--admin-brand); background: #e8f2ed; place-items: center; }
.rule-version { justify-self: end; }
@media (max-width: 680px) { .rules-heading { align-items: stretch; flex-direction: column; } .rules-actions { width: 100%; } .rules-actions .el-button:last-child { flex: 1; } .rules-grid, .readonly-rules { grid-template-columns: 1fr; } .rule-version { justify-self: start; } }
</style>
