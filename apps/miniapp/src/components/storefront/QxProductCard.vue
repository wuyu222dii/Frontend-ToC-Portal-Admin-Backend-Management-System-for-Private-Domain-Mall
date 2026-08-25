<script setup lang="ts">
import { computed } from 'vue';

import type { StoreProductCardData } from './storefront.types';
import QxPrice from './QxPrice.vue';
import QxProductImage from './QxProductImage.vue';

const props = withDefaults(
  defineProps<{
    product: StoreProductCardData;
    variant?: 'grid' | 'list';
  }>(),
  {
    variant: 'grid',
  },
);

const emit = defineEmits<{
  select: [productId: string];
}>();

const badge = computed(() => {
  if (!props.product.is_salable) {
    return '暂时售罄';
  }
  if (props.product.is_hot) {
    return '热销';
  }
  if (props.product.is_new) {
    return '新品';
  }
  return '';
});

const salesCopy = computed(() => {
  if (!props.product.is_salable) {
    return '到货后可购买';
  }
  return `已售${Math.max(0, props.product.net_sales_count)}`;
});
</script>

<template>
  <button
    class="qx-product-card"
    :class="[
      `qx-product-card--${variant}`,
      { 'qx-product-card--sold-out': !product.is_salable },
    ]"
    :aria-label="`${product.name}，${salesCopy}`"
    hover-class="qx-product-card--pressed"
    @click="emit('select', product.product_id)"
  >
    <view class="qx-product-card__media">
      <QxProductImage
        :src="product.primary_image?.url ?? null"
        :alt="product.name"
        :shape="variant === 'list' ? 'fill' : 'square'"
      />
      <text
        v-if="badge"
        class="qx-product-card__badge"
      >
        {{ badge }}
      </text>
    </view>
    <view class="qx-product-card__body">
      <text
        v-if="product.brand?.name"
        class="qx-product-card__brand"
      >
        {{ product.brand.name }}
      </text>
      <text class="qx-product-card__name">
        {{ product.name }}
      </text>
      <text
        v-if="variant === 'list' && product.subtitle"
        class="qx-product-card__subtitle"
      >
        {{ product.subtitle }}
      </text>
      <view class="qx-product-card__footer">
        <QxPrice
          :amount="product.minimum_active_price"
          :is-salable="product.is_salable"
          :show-availability="false"
          :size="variant === 'list' ? 'medium' : 'small'"
        />
        <text class="qx-product-card__sales">
          {{ salesCopy }}
        </text>
      </view>
    </view>
  </button>
</template>

<style scoped>
.qx-product-card {
  display: block;
  width: 100%;
  min-width: 0;
  margin: 0;
  overflow: hidden;
  border: 1px solid var(--qx-store-line, #e4e8e5);
  border-radius: 16rpx;
  color: var(--qx-store-text, #202522);
  background: var(--qx-store-surface, #ffffff);
  text-align: left;
}

.qx-product-card--pressed {
  border-color: var(--qx-store-line-strong, #cfd6d1);
  opacity: 0.88;
}

.qx-product-card--list {
  display: grid;
  min-height: 224rpx;
  grid-template-columns: 208rpx minmax(0, 1fr);
  border-right: 0;
  border-left: 0;
  border-radius: 0;
}

.qx-product-card__media {
  position: relative;
  width: 100%;
  min-width: 0;
  overflow: hidden;
}

.qx-product-card--list .qx-product-card__media {
  width: 184rpx;
  height: 184rpx;
  align-self: center;
  margin-left: 24rpx;
  border-radius: 12rpx;
}

.qx-product-card--sold-out .qx-product-card__media {
  filter: saturate(0.45);
  opacity: 0.72;
}

.qx-product-card__badge {
  position: absolute;
  z-index: 3;
  top: 16rpx;
  left: 16rpx;
  padding: 8rpx 12rpx;
  border-radius: 8rpx;
  color: #ffffff;
  background: var(--qx-store-accent, #e27766);
  font-size: 18rpx;
  font-weight: 700;
  line-height: 1.2;
}

.qx-product-card--sold-out .qx-product-card__badge {
  background: var(--qx-store-text-soft, #5f6762);
}

.qx-product-card__body {
  display: flex;
  min-width: 0;
  min-height: 194rpx;
  flex-direction: column;
  padding: 20rpx;
}

.qx-product-card--list .qx-product-card__body {
  min-height: 224rpx;
  padding: 28rpx 24rpx 26rpx;
}

.qx-product-card__brand,
.qx-product-card__name,
.qx-product-card__subtitle {
  display: block;
  max-width: 100%;
  overflow: hidden;
}

.qx-product-card__brand {
  color: var(--qx-store-brand, #496859);
  font-size: 18rpx;
  font-weight: 800;
  line-height: 1.3;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.qx-product-card__name {
  min-height: 72rpx;
  margin-top: 10rpx;
  color: var(--qx-store-text, #202522);
  font-size: 24rpx;
  font-weight: 600;
  line-height: 1.5;
}

.qx-product-card--list .qx-product-card__name {
  min-height: auto;
  font-size: 26rpx;
}

.qx-product-card__subtitle {
  margin-top: 8rpx;
  color: var(--qx-store-muted, #8d9690);
  font-size: 20rpx;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.qx-product-card__footer {
  display: flex;
  min-width: 0;
  align-items: flex-end;
  gap: 12rpx;
  margin-top: auto;
  padding-top: 16rpx;
}

.qx-product-card__sales {
  min-width: 0;
  margin-left: auto;
  overflow: hidden;
  color: var(--qx-store-muted, #8d9690);
  font-size: 17rpx;
  line-height: 1.35;
  text-align: right;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (min-width: 768px) {
  .qx-product-card__body {
    min-height: 156px;
    padding: 16px;
  }

  .qx-product-card__name {
    min-height: 48px;
    font-size: 16px;
  }

  .qx-product-card__brand,
  .qx-product-card__sales {
    font-size: 12px;
  }
}
</style>
