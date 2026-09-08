<script setup lang="ts">
import AdminImageUpload from '../common/AdminImageUpload.vue';
import { AdminApiError } from '../../services/admin-api';
import { uploadBannerAsset } from '../../services/admin-banners';
import type { UploadedBannerAsset } from '../../types/banners';

defineProps<{
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
</script>

<template>
  <AdminImageUpload
    :file-id="fileId"
    :image-url="imageUrl"
    :disabled="disabled"
    label="Banner 图片"
    test-id="banner-asset-upload"
    variant="banner"
    show-cancel
    :upload="uploadBannerAsset"
    @auth-expired="emit('authExpired', $event)"
    @change="emit('change', $event)"
    @remove="emit('remove')"
    @uploading="emit('uploading', $event)"
  />
</template>
