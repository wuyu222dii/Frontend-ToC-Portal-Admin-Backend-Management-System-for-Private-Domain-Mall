<script setup lang="ts">
import { Close, Delete, Picture, Upload } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { computed, onBeforeUnmount, ref, watch } from 'vue';

import { AdminApiError } from '../../services/admin-api';
import { uploadBannerAsset } from '../../services/admin-banners';
import { safePublicAssetUrl } from '../../services/admin-files';
import type { UploadedBannerAsset } from '../../types/banners';

const props = defineProps<{
  fileId: string | null;
  imageUrl: string | null;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  authExpired: [error: AdminApiError];
  change: [asset: UploadedBannerAsset];
  remove: [];
  uploading: [value: boolean];
}>();

const input = ref<HTMLInputElement | null>(null);
const uploading = ref(false);
const localObjectUrl = ref<string | null>(null);
const uploadController = ref<AbortController | null>(null);
const remoteUrl = computed(() => safePublicAssetUrl(props.imageUrl));
const previewUrl = computed(() => localObjectUrl.value ?? remoteUrl.value);

function revokeLocalUrl(): void {
  if (localObjectUrl.value) URL.revokeObjectURL(localObjectUrl.value);
  localObjectUrl.value = null;
}

function chooseFile(): void {
  if (!uploading.value && !props.disabled) input.value?.click();
}

async function selectFile(event: Event): Promise<void> {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  target.value = '';
  if (!file || uploading.value || props.disabled) return;

  revokeLocalUrl();
  localObjectUrl.value = URL.createObjectURL(file);
  uploadController.value = new AbortController();
  uploading.value = true;
  emit('uploading', true);
  try {
    const asset = await uploadBannerAsset(file, uploadController.value.signal);
    emit('change', asset);
    if (asset.publicUrl) revokeLocalUrl();
    ElMessage.success('Banner 图片已上传');
  } catch (error) {
    if (error instanceof AdminApiError && error.status === 401) emit('authExpired', error);
    if (!(error instanceof DOMException && error.name === 'AbortError')) {
      const message = error instanceof AdminApiError && error.status === 0
        ? '网络连接失败，请检查网络后重试'
        : error instanceof AdminApiError && error.status === 422
          ? '图片校验未通过，请确认格式和大小后重试'
          : 'Banner 图片上传失败，请重新选择后再试';
      ElMessage.error(message);
    }
    revokeLocalUrl();
  } finally {
    uploadController.value = null;
    uploading.value = false;
    emit('uploading', false);
  }
}

function removeAsset(): void {
  if (uploading.value || props.disabled) return;
  revokeLocalUrl();
  emit('remove');
}

function cancelUpload(): void {
  uploadController.value?.abort();
}

watch(() => props.imageUrl, () => {
  if (safePublicAssetUrl(props.imageUrl)) revokeLocalUrl();
});

onBeforeUnmount(() => {
  uploadController.value?.abort();
  uploadController.value = null;
  revokeLocalUrl();
});
</script>

<template>
  <div
    class="banner-asset-upload"
    data-testid="banner-asset-upload"
  >
    <div
      class="asset-preview"
      :class="{ empty: !previewUrl }"
    >
      <img
        v-if="previewUrl"
        :src="previewUrl"
        alt="Banner 图片预览"
        referrerpolicy="no-referrer"
      >
      <el-icon v-else>
        <Picture />
      </el-icon>
    </div>
    <div class="asset-actions">
      <strong>Banner 图片</strong>
      <span>JPEG / PNG，最大 5 MiB</span>
      <div>
        <el-button
          :loading="uploading"
          :disabled="disabled"
          @click="chooseFile"
        >
          <el-icon><Upload /></el-icon>
          {{ props.fileId ? '替换图片' : '选择图片' }}
        </el-button>
        <el-button
          v-if="uploading"
          text
          @click="cancelUpload"
        >
          <el-icon><Close /></el-icon>
          取消上传
        </el-button>
        <el-button
          v-if="props.fileId || previewUrl"
          :disabled="uploading || disabled"
          text
          @click="removeAsset"
        >
          <el-icon><Delete /></el-icon>
          移除
        </el-button>
      </div>
    </div>
    <input
      ref="input"
      class="visually-hidden-file"
      type="file"
      accept="image/jpeg,image/png"
      aria-label="选择 Banner 图片"
      @change="selectFile"
    >
  </div>
</template>

<style scoped>
.banner-asset-upload {
  display: grid;
  align-items: center;
  gap: 14px;
  grid-template-columns: 156px minmax(0, 1fr);
}

.asset-preview {
  display: grid;
  width: 156px;
  aspect-ratio: 16 / 7;
  overflow: hidden;
  border: 1px solid var(--admin-border);
  border-radius: 7px;
  background: #fff;
  color: var(--admin-muted);
  font-size: 24px;
  place-items: center;
}

.asset-preview img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.asset-preview.empty {
  border-style: dashed;
  background: #f7faf8;
}

.asset-actions {
  display: grid;
  min-width: 0;
  gap: 5px;
}

.asset-actions strong {
  font-size: 13px;
}

.asset-actions > span {
  color: var(--admin-muted);
  font-size: 11px;
}

.asset-actions > div {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 4px;
}

.visually-hidden-file {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  clip-path: inset(50%);
  white-space: nowrap;
}

@media (max-width: 520px) {
  .banner-asset-upload {
    align-items: stretch;
    grid-template-columns: minmax(0, 1fr);
  }

  .asset-preview {
    width: 100%;
  }
}
</style>
