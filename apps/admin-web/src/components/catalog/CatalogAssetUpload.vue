<script setup lang="ts">
import { computed } from 'vue';

import AdminImageUpload from '../common/AdminImageUpload.vue';
import { AdminApiError } from '../../services/admin-api';
import { uploadCatalogAsset } from '../../services/admin-catalog';
import type { CatalogKind, UploadedCatalogAsset } from '../../types/catalog';

const props = defineProps<{
  kind: CatalogKind;
  fileId: string | null;
  imageUrl: string | null;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  authExpired: [error: AdminApiError];
  change: [asset: UploadedCatalogAsset];
  remove: [];
  uploading: [value: boolean];
}>();

const label = computed(() => props.kind === 'brand' ? '品牌 Logo' : '分类 Icon');

function upload(file: File, signal: AbortSignal): Promise<UploadedCatalogAsset> {
  return uploadCatalogAsset(props.kind, file, signal);
}
</script>

<template>
  <AdminImageUpload
    :file-id="fileId"
    :image-url="imageUrl"
    :disabled="disabled"
    :label="label"
    test-id="asset-upload"
    variant="catalog"
    :upload="upload"
    @auth-expired="emit('authExpired', $event)"
    @change="emit('change', $event)"
    @remove="emit('remove')"
    @uploading="emit('uploading', $event)"
  />
</template>
