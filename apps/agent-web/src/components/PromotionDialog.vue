<script setup lang="ts">
import { CopyDocument, Download, Link } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useRouter } from 'vue-router';

import type { AgentPromotion } from '../services/agent';
import { AgentApiError, createAgentPromotion, getAgentQrDownloadUrl, newIdempotencyKey } from '../services/agent';
import { formatChinaDateTime, handleAuthError, loadErrorMessage } from '../utils/presentation';

const props = defineProps<{
  modelValue: boolean;
  targetId?: string | undefined;
  targetName: string;
  targetType: 'PRODUCT' | 'STOREFRONT';
}>();
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>();
const router = useRouter();
const open = computed({ get: () => props.modelValue, set: (value) => emit('update:modelValue', value) });
const pending = ref(false);
const uncertain = ref(false);
const result = ref<AgentPromotion>();
const qrUrl = ref('');
const errorMessage = ref('');
let key = newIdempotencyKey();
let sequence = 0;
let controller: AbortController | undefined;

function reset(): void {
  sequence += 1;
  controller?.abort();
  controller = undefined;
  result.value = undefined;
  qrUrl.value = '';
  errorMessage.value = '';
  pending.value = false;
  uncertain.value = false;
  key = newIdempotencyKey();
}

watch(() => props.modelValue, (value) => { if (!value) reset(); });
onBeforeUnmount(reset);

async function create(): Promise<void> {
  if (pending.value) return;
  if (props.targetType === 'PRODUCT' && !props.targetId) {
    errorMessage.value = '推广目标不可用，请刷新页面后重试';
    return;
  }
  const current = ++sequence;
  controller?.abort();
  const activeController = new AbortController();
  controller = activeController;
  pending.value = true;
  errorMessage.value = '';
  let promotionCreated = false;
  try {
    const promotion = await createAgentPromotion(props.targetType === 'PRODUCT'
      ? { target_type: 'PRODUCT', target_id: props.targetId as string }
      : { target_type: 'STOREFRONT', target_id: null }, key, activeController.signal);
    promotionCreated = true;
    const download = await getAgentQrDownloadUrl(promotion.qr_file.file_id, activeController.signal);
    if (current !== sequence) return;
    result.value = promotion;
    qrUrl.value = download.download_url;
    uncertain.value = false;
  } catch (error) {
    if (current !== sequence || (error instanceof DOMException && error.name === 'AbortError')) return;
    if (await handleAuthError(error, router)) return;
    uncertain.value = promotionCreated || !(error instanceof AgentApiError) || error.status === 0 || error.status >= 500;
    errorMessage.value = uncertain.value
      ? '生成结果未确认，请保留此页面并使用原请求重试'
      : loadErrorMessage(error, '推广素材');
  } finally {
    if (current === sequence) {
      pending.value = false;
      controller = undefined;
    }
  }
}

async function copyLink(): Promise<void> {
  if (!result.value) return;
  try {
    await navigator.clipboard.writeText(result.value.public_url);
    ElMessage.success('推广链接已复制');
  } catch {
    ElMessage.error('复制失败，请手动选择链接');
  }
}

async function downloadQr(): Promise<void> {
  if (!result.value || pending.value) return;
  const current = ++sequence;
  controller?.abort();
  const activeController = new AbortController();
  controller = activeController;
  pending.value = true;
  errorMessage.value = '';
  try {
    const download = await getAgentQrDownloadUrl(result.value.qr_file.file_id, activeController.signal);
    if (current !== sequence) return;
    const anchor = document.createElement('a');
    anchor.href = download.download_url;
    anchor.download = `${props.targetName}-推广二维码.png`;
    anchor.rel = 'noopener';
    anchor.click();
  } catch (error) {
    if (current !== sequence || (error instanceof DOMException && error.name === 'AbortError')) return;
    if (await handleAuthError(error, router)) return;
    errorMessage.value = loadErrorMessage(error, '二维码下载');
  } finally {
    if (current === sequence) {
      pending.value = false;
      controller = undefined;
    }
  }
}
</script>

<template>
  <el-dialog v-model="open" data-testid="promotion-dialog" :close-on-click-modal="!pending && !uncertain" :close-on-press-escape="!pending && !uncertain" :show-close="!pending && !uncertain" destroy-on-close :title="`推广 · ${targetName}`" width="560px">
    <p class="dialog-note">推广归属由服务端写入链接。旧链接失效或商品不可售时，商城会安全降级。</p>
    <p v-if="errorMessage" class="inline-error" data-testid="promotion-error" role="alert">{{ errorMessage }}</p>
    <div v-if="result" class="promotion-result" data-testid="promotion-result">
      <img v-if="qrUrl" :src="qrUrl" alt="推广二维码" data-testid="promotion-qr">
      <el-skeleton v-else style="width: 152px" :rows="4" animated />
      <div>
        <strong>{{ result.attribution_eligible ? '当前可用于归属绑定' : '当前仅可访问，不产生新归属' }}</strong>
        <p class="dialog-note">{{ result.expires_at ? `有效至 ${formatChinaDateTime(result.expires_at)}` : '链接有效期由当前邀请码状态控制' }}</p>
        <div class="copy-row">
          <el-input :model-value="result.public_url" readonly aria-label="推广链接" />
          <el-button data-testid="promotion-copy" :icon="CopyDocument" title="复制推广链接" @click="copyLink" />
        </div>
        <el-button data-testid="promotion-download" :icon="Download" :loading="pending" style="margin-top: 12px" @click="downloadQr">下载二维码</el-button>
      </div>
    </div>
    <template #footer>
      <div class="dialog-actions">
        <el-button v-if="!uncertain" :disabled="pending" @click="open = false">关闭</el-button>
        <el-button v-if="!result" data-testid="promotion-create" :icon="Link" :loading="pending" type="primary" @click="create">{{ uncertain ? '使用原请求重试' : '生成推广素材' }}</el-button>
      </div>
    </template>
  </el-dialog>
</template>
