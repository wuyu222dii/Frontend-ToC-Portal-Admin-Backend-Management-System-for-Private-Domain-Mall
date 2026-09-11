<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import { qxIconDataUri, qxIconImageSrc, type QxIconName } from './qx-icons';

const props = withDefaults(
  defineProps<{
    name: QxIconName;
    size?: number;
    color?: string;
  }>(),
  {
    size: 40,
    color: '#6B6458',
  },
);

const useFileFallback = ref(false);

watch(
  () => [props.name, props.color] as const,
  () => {
    useFileFallback.value = false;
  },
);

const sizeStyle = computed(() => ({
  width: `${props.size}rpx`,
  height: `${props.size}rpx`,
}));

const iconStyle = computed(() => ({
  ...sizeStyle.value,
  maskImage: qxIconDataUri(props.name),
  webkitMaskImage: qxIconDataUri(props.name),
}));

const imageSrc = computed(() => (
  useFileFallback.value
    ? `/static/icons/${props.name}.svg`
    : qxIconImageSrc(props.name, props.color)
));

function handleImageError() {
  if (useFileFallback.value) return;
  useFileFallback.value = true;
}
</script>

<template>
  <!-- #ifdef MP-WEIXIN -->
  <image
    class="qx-icon qx-icon--image"
    :src="imageSrc"
    :style="sizeStyle"
    mode="aspectFit"
    @error="handleImageError"
  />
  <!-- #endif -->
  <!-- #ifndef MP-WEIXIN -->
  <view
    class="qx-icon"
    :style="iconStyle"
    aria-hidden="true"
  />
  <!-- #endif -->
</template>

<style scoped>
.qx-icon {
  display: inline-flex;
  flex: 0 0 auto;
  background-color: currentColor;
  mask-repeat: no-repeat;
  mask-position: center;
  mask-size: contain;
  -webkit-mask-repeat: no-repeat;
  -webkit-mask-position: center;
  -webkit-mask-size: contain;
}

.qx-icon--image {
  display: block;
  background-color: transparent;
}
</style>
