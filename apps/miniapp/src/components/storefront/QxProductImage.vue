<script setup lang="ts">
import { computed, ref, watch } from 'vue';

const props = withDefaults(
  defineProps<{
    src?: string | null;
    alt?: string;
    shape?: 'square' | 'landscape' | 'hero' | 'fill';
    lazy?: boolean;
  }>(),
  {
    src: null,
    alt: '商品图片',
    shape: 'square',
    lazy: true,
  },
);

const emit = defineEmits<{
  load: [];
  error: [];
}>();

const loaded = ref(false);
const failed = ref(false);
const normalizedSource = computed(() => props.src?.trim() || '');

watch(normalizedSource, () => {
  loaded.value = false;
  failed.value = false;
});

function handleLoad() {
  loaded.value = true;
  failed.value = false;
  emit('load');
}

function handleError() {
  loaded.value = false;
  failed.value = true;
  emit('error');
}
</script>

<template>
  <view
    class="qx-product-image"
    :class="`qx-product-image--${shape}`"
  >
    <view
      class="qx-product-image__fallback"
      :class="{ 'qx-product-image__fallback--visible': !loaded || failed }"
      aria-hidden="true"
    >
      <view class="qx-product-image__pack">
        <text>
          青序
        </text>
      </view>
    </view>
    <image
      v-if="normalizedSource && !failed"
      class="qx-product-image__asset"
      :class="{ 'qx-product-image__asset--loaded': loaded }"
      :src="normalizedSource"
      :alt="alt"
      mode="aspectFill"
      :lazy-load="lazy"
      @load="handleLoad"
      @error="handleError"
    />
  </view>
</template>

<style scoped>
.qx-product-image {
  position: relative;
  width: 100%;
  overflow: hidden;
  background: var(--qx-store-surface-soft, #edf3ef);
}

.qx-product-image--square {
  aspect-ratio: 1 / 1;
}

.qx-product-image--landscape {
  aspect-ratio: 16 / 9;
}

.qx-product-image--hero {
  aspect-ratio: 1 / 1.05;
}

.qx-product-image--fill {
  height: 100%;
}

.qx-product-image__asset,
.qx-product-image__fallback {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.qx-product-image__asset {
  z-index: 2;
  opacity: 0;
  transition: opacity 160ms ease;
}

.qx-product-image__asset--loaded {
  opacity: 1;
}

.qx-product-image__fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
}

.qx-product-image__fallback--visible {
  opacity: 1;
}

.qx-product-image__pack {
  position: relative;
  display: flex;
  width: 40%;
  height: 62%;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(32, 37, 34, 0.13);
  border-radius: 14rpx 14rpx 8rpx 8rpx;
  color: var(--qx-store-brand, #496859);
  background: #faf8f1;
  box-shadow: 0 20rpx 36rpx rgba(59, 73, 64, 0.12);
}

.qx-product-image__pack::before {
  position: absolute;
  top: -9%;
  left: 30%;
  width: 40%;
  height: 11%;
  border-radius: 6rpx 6rpx 0 0;
  background: var(--qx-store-text, #202522);
  content: '';
}

.qx-product-image__pack text {
  width: 80%;
  padding: 14rpx 0;
  border-top: 1px solid #ccd8d0;
  border-bottom: 1px solid #ccd8d0;
  font-size: 20rpx;
  line-height: 1;
  text-align: center;
}
</style>

