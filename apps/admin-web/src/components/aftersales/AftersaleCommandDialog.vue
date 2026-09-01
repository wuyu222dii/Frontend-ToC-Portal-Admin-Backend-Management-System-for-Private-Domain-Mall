<script setup lang="ts">
import { Delete, Upload, Warning } from '@element-plus/icons-vue';
import { computed, ref, watch } from 'vue';

import { AdminApiError, newIdempotencyKey } from '../../services/admin-api';
import {
  approveAdminAftersale,
  confirmAdminAftersaleRefund,
  confirmAdminAftersaleRejection,
  confirmAdminRejectionAfterReturn,
  continueAdminRefundAfterReturn,
  previewAdminAftersaleRefund,
  previewAdminAftersaleRejection,
  previewAdminRejectionAfterReturn,
  recordAdminReturnInspection,
  type AdminAftersaleDetail,
  type HighRiskPreview,
  type ReturnInspectionInput,
} from '../../services/admin-aftersales';
import { uploadAdminImage } from '../../services/admin-files';

export type AftersaleCommandMode =
  | 'APPROVE'
  | 'CONTINUE_REFUND'
  | 'CREATE_REFUND'
  | 'RECORD_INSPECTION'
  | 'REJECT'
  | 'REJECT_AFTER_RETURN';

interface InspectionLineForm {
  approved: number;
  damaged: number;
  note: string;
  orderItemId: string;
  received: number;
  restock: number;
  returnToCustomer: number;
  scrap: number;
}

const props = defineProps<{
  detail: AdminAftersaleDetail;
  mode: AftersaleCommandMode | null;
  open: boolean;
}>();

const emit = defineEmits<{
  'auth-expired': [error: AdminApiError];
  completed: [message: string];
  conflict: [];
  'update:open': [value: boolean];
}>();

const dialogOpen = computed({
  get: () => props.open,
  set: (value: boolean) => {
    if (!value && (pending.value || uncertain.value)) return;
    emit('update:open', value);
  },
});
const reason = ref('');
const note = ref('');
const inspectionResult = ref<'ABNORMAL' | 'PASS'>('PASS');
const abnormalReason = ref('');
const inspectionLines = ref<InspectionLineForm[]>([]);
const evidence = ref<Array<{ fileId: string; name: string }>>([]);
const uploading = ref(false);
const pending = ref(false);
const uncertain = ref(false);
const errorMessage = ref('');
const preview = ref<HighRiskPreview | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
let previewAttempt: { key: string; signature: string } | null = null;
let confirmAttempt: { key: string; signature: string } | null = null;
let directAttempt: { key: string; signature: string } | null = null;

const title = computed(() => ({
  APPROVE: '通过售后初审',
  CONTINUE_REFUND: '继续退货退款',
  CREATE_REFUND: '创建普通退款',
  RECORD_INSPECTION: '记录退货验收',
  REJECT: '拒绝售后申请',
  REJECT_AFTER_RETURN: '验货后拒绝退款',
})[props.mode ?? 'APPROVE']);
const needsPreview = computed(() => ['CREATE_REFUND', 'REJECT', 'REJECT_AFTER_RETURN'].includes(props.mode ?? ''));
const needsReason = computed(() => ['CONTINUE_REFUND', 'CREATE_REFUND', 'REJECT', 'REJECT_AFTER_RETURN'].includes(props.mode ?? ''));
const refundLines = computed(() => props.detail.items
  .map((item) => ({
    aftersale_item_id: item.aftersale_item_id,
    quantity: Math.max(0, (item.approved_refund_quantity ?? item.requested_quantity) - item.refunded_quantity),
  }))
  .filter(({ quantity }) => quantity > 0));

function textLength(value: string): number {
  return Array.from(value.trim()).length;
}

function reset(): void {
  reason.value = '';
  note.value = '';
  inspectionResult.value = 'PASS';
  abnormalReason.value = '';
  evidence.value = [];
  uploading.value = false;
  pending.value = false;
  uncertain.value = false;
  errorMessage.value = '';
  preview.value = null;
  previewAttempt = null;
  confirmAttempt = null;
  directAttempt = null;
  inspectionLines.value = props.detail.items.map((item) => ({
    approved: item.requested_quantity,
    damaged: 0,
    note: '',
    orderItemId: item.order_item_id,
    received: item.requested_quantity,
    restock: item.requested_quantity,
    returnToCustomer: 0,
    scrap: 0,
  }));
}

function inspectionValid(line: InspectionLineForm): boolean {
  const values = [line.received, line.approved, line.restock, line.damaged, line.scrap, line.returnToCustomer];
  return values.every((value) => Number.isInteger(value) && value >= 0 && value <= 99) &&
    line.approved + line.returnToCustomer === line.received &&
    line.restock + line.damaged + line.scrap === line.approved;
}

const valid = computed(() => {
  if (pending.value || uploading.value) return false;
  if (props.mode === 'APPROVE') return textLength(note.value) <= 500;
  if (props.mode === 'RECORD_INSPECTION') {
    if (!inspectionLines.value.length || !inspectionLines.value.every(inspectionValid) || evidence.value.length > 9) return false;
    if (inspectionResult.value === 'PASS') {
      return !abnormalReason.value.trim() && inspectionLines.value.every((line, index) => {
        const requested = props.detail.items[index]?.requested_quantity;
        return requested !== undefined && line.received === requested && line.approved === requested &&
          line.restock === requested && line.damaged === 0 && line.scrap === 0 && line.returnToCustomer === 0;
      });
    }
    return textLength(abnormalReason.value) >= 2 && textLength(abnormalReason.value) <= 500 && evidence.value.length >= 1;
  }
  if (needsReason.value && (textLength(reason.value) < 2 || textLength(reason.value) > 500)) return false;
  if (props.mode === 'CREATE_REFUND') return refundLines.value.length > 0;
  return true;
});

function actionBody(): object {
  if (props.mode === 'APPROVE') return { note: note.value.trim() || null };
  if (props.mode === 'CONTINUE_REFUND') return { reason: reason.value.trim(), resolution: 'CONTINUE_REFUND' as const };
  if (props.mode === 'CREATE_REFUND') return { items: refundLines.value, reason: reason.value.trim() };
  if (props.mode === 'REJECT_AFTER_RETURN') return { reason: reason.value.trim(), resolution: 'REJECT_AFTER_RETURN' as const };
  if (props.mode === 'RECORD_INSPECTION') return inspectionBody();
  return { reason: reason.value.trim() };
}

function inspectionBody(): ReturnInspectionInput {
  const items = inspectionLines.value.map((line) => ({
    approved_refund_qty: line.approved,
    damaged_qty: line.damaged,
    note: line.note.trim() || null,
    order_item_id: line.orderItemId,
    received_qty: line.received,
    restock_qty: line.restock,
    return_to_customer_qty: line.returnToCustomer,
    scrap_qty: line.scrap,
  }));
  const evidenceIds = evidence.value.map(({ fileId }) => fileId);
  return inspectionResult.value === 'PASS'
    ? { evidence_file_ids: evidenceIds, items, result: 'PASS' }
    : { abnormal_reason: abnormalReason.value.trim(), evidence_file_ids: evidenceIds, items, result: 'ABNORMAL' };
}

function signature(stage: 'CONFIRM' | 'DIRECT' | 'PREVIEW'): string {
  return JSON.stringify({ body: actionBody(), mode: props.mode, resource: props.detail.aftersale_id, stage, version: props.detail.version });
}

function stableKey(stage: 'CONFIRM' | 'DIRECT' | 'PREVIEW'): string {
  const value = signature(stage);
  if (stage === 'PREVIEW') {
    if (previewAttempt?.signature !== value) previewAttempt = { key: newIdempotencyKey(), signature: value };
    return previewAttempt.key;
  }
  if (stage === 'CONFIRM') {
    if (confirmAttempt?.signature !== value) confirmAttempt = { key: newIdempotencyKey(), signature: value };
    return confirmAttempt.key;
  }
  if (directAttempt?.signature !== value) directAttempt = { key: newIdempotencyKey(), signature: value };
  return directAttempt.key;
}

function clearForEdit(): void {
  preview.value = null;
  previewAttempt = null;
  confirmAttempt = null;
  uncertain.value = false;
  errorMessage.value = '';
}

function chooseEvidence(): void {
  if (!uploading.value && !pending.value && evidence.value.length < 9) fileInput.value?.click();
}

async function selectEvidence(event: Event): Promise<void> {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  target.value = '';
  if (!file || uploading.value || evidence.value.length >= 9) return;
  uploading.value = true;
  errorMessage.value = '';
  try {
    const uploaded = await uploadAdminImage('AFTERSALE_EVIDENCE', file);
    evidence.value = [...evidence.value, { fileId: uploaded.file_id, name: file.name }];
  } catch (error) {
    if (error instanceof AdminApiError && error.status === 401) emit('auth-expired', error);
    else errorMessage.value = '验货证据上传失败，请重新选择 JPEG/PNG 图片。';
  } finally {
    uploading.value = false;
  }
}

function removeEvidence(fileId: string): void {
  if (!pending.value) evidence.value = evidence.value.filter((item) => item.fileId !== fileId);
}

function isUncertain(error: unknown): boolean {
  return !(error instanceof AdminApiError) || error.status === 0 || error.status >= 500;
}

function readableError(error: unknown): string {
  if (!(error instanceof AdminApiError)) return '服务响应无法安全确认，请保持内容不变后重试';
  if (error.status === 0) return '网络连接中断，结果尚未确认；请保持内容不变后重试';
  if (error.status === 403) return '当前账号无权执行该售后操作';
  if (error.status === 404) return '售后或退款记录已不存在';
  if (error.status === 422) return error.code === 'AFTERSALE_QUOTA_EXCEEDED'
    ? '可退款数量或金额已变化，请刷新详情'
    : '当前业务条件不满足该操作';
  if (error.status === 429) return error.retryAfterSeconds
    ? `操作过于频繁，请在 ${error.retryAfterSeconds} 秒后重试`
    : '操作过于频繁，请稍后重试';
  return '操作未完成，请刷新详情后重试';
}

async function requestPreview(): Promise<void> {
  const mode = props.mode;
  if (!valid.value || !mode) return;
  pending.value = true;
  errorMessage.value = '';
  try {
    const key = stableKey('PREVIEW');
    if (mode === 'REJECT') preview.value = await previewAdminAftersaleRejection(props.detail.aftersale_id, actionBody() as { reason: string }, key);
    else if (mode === 'REJECT_AFTER_RETURN') preview.value = await previewAdminRejectionAfterReturn(props.detail.aftersale_id, actionBody() as { reason: string; resolution: 'REJECT_AFTER_RETURN' }, key);
    else if (mode === 'CREATE_REFUND') preview.value = await previewAdminAftersaleRefund(props.detail.aftersale_id, actionBody() as { items: typeof refundLines.value; reason: string }, key);
    previewAttempt = null;
    confirmAttempt = null;
    uncertain.value = false;
  } catch (error) {
    if (error instanceof AdminApiError && error.status === 401) emit('auth-expired', error);
    else if (error instanceof AdminApiError && error.status === 409) emit('conflict');
    else {
      const responseCannotBeReplayed = isUncertain(error);
      previewAttempt = null;
      uncertain.value = false;
      errorMessage.value = responseCannotBeReplayed
        ? '预览结果无法安全重放，请重新生成预览'
        : readableError(error);
    }
  } finally {
    pending.value = false;
  }
}

async function confirmPreview(): Promise<void> {
  const mode = props.mode;
  const currentPreview = preview.value;
  if (!valid.value || !mode || !currentPreview) return;
  pending.value = true;
  errorMessage.value = '';
  try {
    const key = stableKey('CONFIRM');
    if (mode === 'REJECT') await confirmAdminAftersaleRejection(props.detail.aftersale_id, actionBody() as { reason: string }, currentPreview, key);
    else if (mode === 'REJECT_AFTER_RETURN') await confirmAdminRejectionAfterReturn(props.detail.aftersale_id, actionBody() as { reason: string; resolution: 'REJECT_AFTER_RETURN' }, currentPreview, key);
    else if (mode === 'CREATE_REFUND') await confirmAdminAftersaleRefund(props.detail.aftersale_id, actionBody() as { items: typeof refundLines.value; reason: string }, currentPreview, key);
    confirmAttempt = null;
    emit('update:open', false);
    emit('completed', mode === 'CREATE_REFUND' ? '退款已创建并进入处理' : '售后处置已完成');
    reset();
  } catch (error) {
    if (error instanceof AdminApiError && error.status === 401) emit('auth-expired', error);
    else if (error instanceof AdminApiError && error.status === 409) emit('conflict');
    else {
      uncertain.value = isUncertain(error);
      if (!uncertain.value) confirmAttempt = null;
      errorMessage.value = readableError(error);
    }
  } finally {
    pending.value = false;
  }
}

async function submitDirect(): Promise<void> {
  const mode = props.mode;
  if (!valid.value || !mode) return;
  pending.value = true;
  errorMessage.value = '';
  try {
    const key = stableKey('DIRECT');
    if (mode === 'APPROVE') await approveAdminAftersale(props.detail.aftersale_id, actionBody() as { note?: string | null }, props.detail.version, key);
    else if (mode === 'CONTINUE_REFUND') await continueAdminRefundAfterReturn(props.detail.aftersale_id, actionBody() as { reason: string; resolution: 'CONTINUE_REFUND' }, props.detail.version, key);
    else if (mode === 'RECORD_INSPECTION') await recordAdminReturnInspection(props.detail.aftersale_id, inspectionBody(), props.detail.version, key);
    directAttempt = null;
    emit('update:open', false);
    emit('completed', mode === 'APPROVE' ? '售后初审已通过' : mode === 'RECORD_INSPECTION' ? '退货验收已封存' : '已继续退款流程');
    reset();
  } catch (error) {
    if (error instanceof AdminApiError && error.status === 401) emit('auth-expired', error);
    else if (error instanceof AdminApiError && error.status === 409) emit('conflict');
    else {
      uncertain.value = isUncertain(error);
      if (!uncertain.value) directAttempt = null;
      errorMessage.value = readableError(error);
    }
  } finally {
    pending.value = false;
  }
}

function submit(): void {
  if (preview.value) void confirmPreview();
  else if (needsPreview.value) void requestPreview();
  else void submitDirect();
}

watch([() => props.open, () => props.mode, () => props.detail.version], () => reset());
watch(inspectionResult, (result) => {
  if (result === 'PASS') {
    abnormalReason.value = '';
    inspectionLines.value = props.detail.items.map((item) => ({ approved: item.requested_quantity, damaged: 0, note: '', orderItemId: item.order_item_id, received: item.requested_quantity, restock: item.requested_quantity, returnToCustomer: 0, scrap: 0 }));
  }
  clearForEdit();
});
</script>

<template>
  <el-dialog
    v-model="dialogOpen"
    :data-testid="`aftersale-command-${mode?.toLowerCase()}`"
    width="min(760px, calc(100vw - 24px))"
    :close-on-click-modal="false"
    :close-on-press-escape="!pending && !uncertain"
    :show-close="!pending && !uncertain"
    destroy-on-close
    @closed="reset"
  >
    <template #header>
      <div class="command-heading">
        <el-icon><Warning /></el-icon><div><strong>{{ title }}</strong><p>{{ detail.aftersale_no }} · v{{ detail.version }}</p></div>
      </div>
    </template>
    <div class="command-body">
      <el-alert
        v-if="uncertain"
        title="上次请求结果尚未确认"
        description="保持内容不变重试会复用同一幂等键；也可放弃并刷新详情。"
        type="warning"
        :closable="false"
        show-icon
      />

      <fieldset :disabled="pending || uncertain || preview !== null">
        <el-form label-position="top">
          <el-form-item
            v-if="mode === 'APPROVE'"
            label="审核备注（选填）"
          >
            <el-input
              v-model="note"
              type="textarea"
              :rows="3"
              maxlength="500"
              show-word-limit
            />
          </el-form-item>
          <el-form-item
            v-if="needsReason"
            label="操作原因"
            required
          >
            <el-input
              v-model="reason"
              type="textarea"
              :rows="3"
              maxlength="500"
              show-word-limit
              placeholder="请输入 2–500 个字符"
            />
          </el-form-item>

          <template v-if="mode === 'RECORD_INSPECTION'">
            <el-form-item
              label="验货结论"
              required
            >
              <el-segmented
                v-model="inspectionResult"
                :options="[{ label: 'PASS 全量通过', value: 'PASS' }, { label: 'ABNORMAL 异常', value: 'ABNORMAL' }]"
              />
            </el-form-item>
            <el-form-item
              v-if="inspectionResult === 'ABNORMAL'"
              label="异常原因"
              required
            >
              <el-input
                v-model="abnormalReason"
                type="textarea"
                :rows="2"
                maxlength="500"
                show-word-limit
              />
            </el-form-item>
            <div class="inspection-lines">
              <article
                v-for="(line, index) in inspectionLines"
                :key="line.orderItemId"
              >
                <header><strong>{{ detail.items[index]?.product_name }} · {{ detail.items[index]?.sku_name }}</strong><span>申请 {{ detail.items[index]?.requested_quantity }} 件</span></header>
                <div class="quantity-grid">
                  <el-form-item label="实收">
                    <el-input-number
                      v-model="line.received"
                      :min="0"
                      :max="99"
                      controls-position="right"
                    />
                  </el-form-item>
                  <el-form-item label="批准退款">
                    <el-input-number
                      v-model="line.approved"
                      :min="0"
                      :max="99"
                      controls-position="right"
                    />
                  </el-form-item>
                  <el-form-item label="回库">
                    <el-input-number
                      v-model="line.restock"
                      :min="0"
                      :max="99"
                      controls-position="right"
                    />
                  </el-form-item>
                  <el-form-item label="损坏">
                    <el-input-number
                      v-model="line.damaged"
                      :min="0"
                      :max="99"
                      controls-position="right"
                    />
                  </el-form-item>
                  <el-form-item label="报废">
                    <el-input-number
                      v-model="line.scrap"
                      :min="0"
                      :max="99"
                      controls-position="right"
                    />
                  </el-form-item>
                  <el-form-item label="退回客户">
                    <el-input-number
                      v-model="line.returnToCustomer"
                      :min="0"
                      :max="99"
                      controls-position="right"
                    />
                  </el-form-item>
                </div>
                <el-alert
                  :title="inspectionValid(line) ? '数量等式校验通过' : '必须满足：批准退款 + 退回客户 = 实收；回库 + 损坏 + 报废 = 批准退款'"
                  :type="inspectionValid(line) ? 'success' : 'error'"
                  :closable="false"
                />
                <el-input
                  v-model="line.note"
                  class="line-note"
                  maxlength="500"
                  placeholder="逐项备注（选填）"
                />
              </article>
            </div>
            <div class="evidence-box">
              <div><strong>验货证据</strong><span>PASS 可为空；ABNORMAL 至少 1 张，最多 9 张</span></div>
              <div
                v-for="item in evidence"
                :key="item.fileId"
                class="evidence-row"
              >
                <span>{{ item.name }}</span><el-button
                  text
                  :icon="Delete"
                  :disabled="pending"
                  @click="removeEvidence(item.fileId)"
                >
                  移除
                </el-button>
              </div>
              <el-button
                :icon="Upload"
                :loading="uploading"
                :disabled="evidence.length >= 9"
                @click="chooseEvidence"
              >
                上传 JPEG / PNG
              </el-button>
              <input
                ref="fileInput"
                class="hidden-file"
                type="file"
                accept="image/jpeg,image/png"
                @change="selectEvidence"
              >
            </div>
          </template>

          <div
            v-if="mode === 'CREATE_REFUND'"
            class="refund-lines"
          >
            <div
              v-for="line in refundLines"
              :key="line.aftersale_item_id"
            >
              <span>{{ detail.items.find((item) => item.aftersale_item_id === line.aftersale_item_id)?.product_name }}</span><strong>退款 {{ line.quantity }} 件</strong>
            </div>
          </div>
        </el-form>
      </fieldset>

      <section
        v-if="preview"
        class="preview-impact"
        data-testid="aftersale-command-preview"
      >
        <header><strong>服务端影响预览</strong><span>有效至 {{ new Date(preview.expires_at).toLocaleTimeString() }}</span></header>
        <div
          v-for="metric in preview.impact.metrics"
          :key="metric.key"
        >
          <span>{{ metric.label }}</span><strong>{{ metric.before ?? '—' }} → {{ metric.after ?? '—' }}</strong>
        </div>
        <p
          v-for="warning in preview.impact.warnings"
          :key="warning"
        >
          {{ warning }}
        </p>
        <el-button
          text
          @click="clearForEdit"
        >
          返回修改
        </el-button>
      </section>

      <p
        v-if="errorMessage"
        class="form-error"
        role="alert"
      >
        {{ errorMessage }}
      </p>
    </div>
    <template #footer>
      <el-button
        :disabled="pending || uncertain"
        @click="dialogOpen = false"
      >
        取消
      </el-button><el-button
        v-if="uncertain"
        @click="emit('conflict')"
      >
        放弃并刷新
      </el-button><el-button
        type="primary"
        :loading="pending"
        :disabled="!valid"
        data-testid="aftersale-command-submit"
        @click="submit"
      >
        {{ preview ? '确认执行' : needsPreview ? '预览影响' : '确认提交' }}
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.command-heading { display: flex; align-items: center; gap: 12px; }
.command-heading > .el-icon { width: 34px; height: 34px; border-radius: 6px; color: var(--admin-danger); background: #fff0ef; font-size: 19px; }
.command-heading div { display: grid; gap: 3px; }
.command-heading strong { font-size: 16px; }
.command-heading p { margin: 0; color: var(--admin-muted); font-size: 11px; }
.command-body { display: grid; gap: 16px; }
fieldset { min-width: 0; margin: 0; padding: 0; border: 0; }
.inspection-lines { display: grid; gap: 14px; }
.inspection-lines article { padding: 14px; border: 1px solid var(--admin-border); border-radius: 7px; background: #f8faf9; }
.inspection-lines header { display: flex; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
.inspection-lines header span, .evidence-box > div:first-child span { color: var(--admin-muted); font-size: 11px; }
.quantity-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.quantity-grid :deep(.el-input-number) { width: 100%; }
.line-note { margin-top: 10px; }
.evidence-box { display: grid; gap: 10px; margin-top: 16px; padding: 14px; border: 1px dashed var(--admin-border); border-radius: 7px; }
.evidence-box > div:first-child { display: flex; justify-content: space-between; gap: 12px; }
.evidence-row, .refund-lines > div, .preview-impact > div { display: flex; min-width: 0; align-items: center; justify-content: space-between; gap: 12px; }
.evidence-row span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hidden-file { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
.refund-lines { display: grid; gap: 8px; padding: 12px; border-radius: 7px; background: #f5f8f6; font-size: 12px; }
.preview-impact { display: grid; gap: 10px; padding: 15px; border: 1px solid #b9d2c6; border-radius: 7px; background: #f2f8f5; }
.preview-impact header { display: flex; justify-content: space-between; gap: 12px; }
.preview-impact header span, .preview-impact > div { color: var(--admin-text-soft); font-size: 12px; }
.preview-impact p { margin: 0; color: var(--admin-danger); font-size: 12px; }
.form-error { margin: 0; color: var(--admin-danger); font-size: 12px; }
@media (max-width: 680px) { .quantity-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } .inspection-lines header, .evidence-box > div:first-child, .preview-impact header { align-items: flex-start; flex-direction: column; } }
</style>
