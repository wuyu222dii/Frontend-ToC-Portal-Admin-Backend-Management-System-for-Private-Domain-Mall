<script setup lang="ts">
import { ArrowLeft, ArrowRight, Delete, Picture, Upload } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { computed, onBeforeUnmount, ref } from 'vue';

import { AdminApiError } from '../../services/admin-api';
import { safePublicAssetUrl, uploadAdminImage } from '../../services/admin-files';
import type { ProductImage } from '../../types/products';

const props = defineProps<{
  disabled?: boolean;
  modelValue: ProductImage[];
}>();

const emit = defineEmits<{
  authExpired: [error: AdminApiError];
  uploading: [value: boolean];
  'update:modelValue': [images: ProductImage[]];
}>();

const MAX_IMAGES = 8;
const input = ref<HTMLInputElement | null>(null);
const uploading = ref(false);
let uploadController: AbortController | null = null;
let uploadFeedback: ReturnType<typeof ElMessage.success> | null = null;

const orderedImages = computed(() => [...props.modelValue].sort((left, right) =>
  left.sort_order - right.sort_order || left.file_id.localeCompare(right.file_id)));
const remaining = computed(() => Math.max(0, MAX_IMAGES - orderedImages.value.length));

function normalized(images: readonly ProductImage[]): ProductImage[] {
  return images.map((image, index) => ({
    ...image,
    is_primary: index === 0,
    sort_order: index,
  }));
}

function chooseFiles(): void {
  if (!props.disabled && !uploading.value && remaining.value > 0) input.value?.click();
}

function updateImages(images: readonly ProductImage[]): void {
  emit('update:modelValue', normalized(images));
}

function move(index: number, offset: -1 | 1): void {
  const destination = index + offset;
  if (props.disabled || uploading.value || destination < 0 || destination >= orderedImages.value.length) return;
  const images = [...orderedImages.value];
  const current = images[index];
  const adjacent = images[destination];
  if (!current || !adjacent) return;
  images[index] = adjacent;
  images[destination] = current;
  updateImages(images);
}

function remove(index: number): void {
  if (props.disabled || uploading.value) return;
  const images = [...orderedImages.value];
  images.splice(index, 1);
  updateImages(images);
}

function uploadError(error: unknown): string {
  if (!(error instanceof AdminApiError)) return '商品图片上传失败，请重新选择后再试';
  if (error.status === 0) return '网络连接失败，请检查网络后重试';
  if (error.status === 422) return '图片校验未通过，仅支持 5 MiB 内的 JPEG 或 PNG';
  if (error.status >= 500) return '商品图片上传失败，请稍后重试';
  return '商品图片未能上传，请重新选择后再试';
}

async function selectFiles(event: Event): Promise<void> {
  const target = event.target as HTMLInputElement;
  const files = Array.from(target.files ?? []);
  target.value = '';
  if (!files.length || props.disabled || uploading.value) return;
  if (files.length > remaining.value) {
    ElMessage.warning(`商品图集最多 ${MAX_IMAGES} 张，当前还可上传 ${remaining.value} 张`);
    return;
  }

  const controller = new AbortController();
  uploadController = controller;
  uploading.value = true;
  emit('uploading', true);
  const next = [...orderedImages.value];
  try {
    for (const file of files) {
      const uploaded = await uploadAdminImage('PRODUCT_IMAGE', file, controller.signal);
      if (!uploaded.public_url) {
        throw new AdminApiError('服务端未返回商品图片地址', { status: 502, code: 'INVALID_UPLOAD_URL' });
      }
      if (next.some((image) => image.file_id === uploaded.file_id)) continue;
      next.push({
        file_id: uploaded.file_id,
        is_primary: false,
        sort_order: next.length,
        url: uploaded.public_url,
      });
      updateImages(next);
    }
    uploadFeedback?.close();
    uploadFeedback = ElMessage.success({
      duration: 1500,
      message: files.length === 1 ? '商品图片已上传' : `${files.length} 张商品图片已上传`,
    });
  } catch (error) {
    if (error instanceof AdminApiError && error.status === 401) emit('authExpired', error);
    if (!(error instanceof DOMException && error.name === 'AbortError')) ElMessage.error(uploadError(error));
  } finally {
    if (uploadController === controller) uploadController = null;
    uploading.value = false;
    emit('uploading', false);
  }
}

onBeforeUnmount(() => {
  uploadController?.abort();
  uploadController = null;
  uploadFeedback?.close();
  uploadFeedback = null;
  if (uploading.value) emit('uploading', false);
});
</script>

<template>
  <section
    class="product-images-editor"
    data-testid="product-images-editor"
    aria-label="商品图集"
  >
    <header>
      <div>
        <strong>商品图集</strong>
        <span>JPEG / PNG，单张最大 5 MiB</span>
      </div>
      <span>{{ orderedImages.length }} / {{ MAX_IMAGES }}</span>
    </header>

    <div class="image-grid">
      <article
        v-for="(image, index) in orderedImages"
        :key="image.file_id"
        class="image-item"
        :data-file-id="image.file_id"
      >
        <div class="image-preview">
          <img
            v-if="safePublicAssetUrl(image.url)"
            :src="safePublicAssetUrl(image.url) ?? undefined"
            :alt="`商品图片 ${index + 1}`"
            referrerpolicy="no-referrer"
          >
          <el-icon v-else>
            <Picture />
          </el-icon>
          <span v-if="index === 0">首图</span>
        </div>
        <div class="image-actions">
          <el-button
            circle
            :icon="ArrowLeft"
            :disabled="disabled || uploading || index === 0"
            :aria-label="`商品图片 ${index + 1} 上移`"
            title="上移"
            @click="move(index, -1)"
          />
          <el-button
            circle
            :icon="ArrowRight"
            :disabled="disabled || uploading || index === orderedImages.length - 1"
            :aria-label="`商品图片 ${index + 1} 下移`"
            title="下移"
            @click="move(index, 1)"
          />
          <el-button
            circle
            type="danger"
            plain
            :icon="Delete"
            :disabled="disabled || uploading"
            :aria-label="`删除商品图片 ${index + 1}`"
            title="删除"
            @click="remove(index)"
          />
        </div>
      </article>

      <button
        class="upload-tile"
        type="button"
        :disabled="disabled || uploading || remaining === 0"
        aria-label="上传商品图片"
        @click="chooseFiles"
      >
        <el-icon><Upload /></el-icon>
        <strong>{{ uploading ? '正在上传' : remaining === 0 ? '已达上限' : '上传图片' }}</strong>
        <span>{{ remaining === 0 ? '最多 8 张' : `还可上传 ${remaining} 张` }}</span>
      </button>
    </div>

    <input
      v-if="!disabled"
      ref="input"
      class="visually-hidden-file"
      type="file"
      multiple
      accept="image/jpeg,image/png"
      aria-label="商品图片文件"
      @change="selectFiles"
    >
  </section>
</template>

<style scoped>
.product-images-editor {
  display: grid;
  min-width: 0;
  gap: 12px;
}

.product-images-editor > header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.product-images-editor > header > div {
  display: grid;
  min-width: 0;
  gap: 3px;
}

.product-images-editor > header strong {
  font-size: 13px;
}

.product-images-editor > header span {
  color: var(--admin-muted);
  font-size: 11px;
}

.image-grid {
  display: grid;
  min-width: 0;
  gap: 12px;
  grid-template-columns: repeat(auto-fill, minmax(132px, 1fr));
}

.image-item,
.upload-tile {
  min-width: 0;
  border: 1px solid var(--admin-border);
  border-radius: 7px;
  background: #fff;
}

.image-item {
  overflow: hidden;
}

.image-preview {
  position: relative;
  display: grid;
  overflow: hidden;
  aspect-ratio: 1;
  background: #f5f8f6;
  color: var(--admin-muted);
  font-size: 26px;
  place-items: center;
}

.image-preview img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.image-preview > span {
  position: absolute;
  top: 7px;
  left: 7px;
  padding: 2px 6px;
  border-radius: 4px;
  color: #fff;
  background: var(--admin-brand);
  font-size: 10px;
  font-weight: 650;
}

.image-actions {
  display: flex;
  min-height: 44px;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 5px;
  border-top: 1px solid var(--admin-border);
}

.image-actions :deep(.el-button + .el-button) {
  margin-left: 0;
}

.upload-tile {
  display: grid;
  min-height: 174px;
  align-content: center;
  justify-items: center;
  gap: 5px;
  border-style: dashed;
  color: var(--admin-text-soft);
  cursor: pointer;
}

.upload-tile:hover:not(:disabled) {
  border-color: var(--admin-brand);
  color: var(--admin-brand);
  background: #f7faf8;
}

.upload-tile:disabled {
  cursor: wait;
  opacity: 0.6;
}

.upload-tile .el-icon {
  font-size: 24px;
}

.upload-tile strong {
  font-size: 12px;
}

.upload-tile span {
  color: var(--admin-muted);
  font-size: 10px;
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
  .image-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .image-actions :deep(.el-button) {
    width: 30px;
    height: 30px;
  }
}
</style>
