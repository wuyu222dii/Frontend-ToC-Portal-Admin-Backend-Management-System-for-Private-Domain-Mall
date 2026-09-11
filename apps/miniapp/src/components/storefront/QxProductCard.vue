<script setup lang="ts">
import { computed } from 'vue';

import type { StoreProductCardData } from './storefront.types';
import QxIcon from './QxIcon.vue';
import QxPrice from './QxPrice.vue';
import QxProductImage from './QxProductImage.vue';
import QxTag from './QxTag.vue';

const props = withDefaults(
  defineProps<{
    product: StoreProductCardData;
    variant?: 'grid' | 'list';
    rank?: number;
  }>(),
  {
    variant: 'grid',
    rank: 0,
  },
);

const emit = defineEmits<{
  select: [productId: string];
}>();

const badge = computed(() => {
  if (!props.product.is_salable) {
    return { tone: 'sold-out' as const, label: '暂时售罄' };
  }
  if (props.rank > 0) {
    return { tone: 'hot' as const, label: `TOP ${props.rank}` };
  }
  if (props.product.is_hot) {
    return { tone: 'hot' as const, label: '热销' };
  }
  if (props.product.is_new) {
    return { tone: 'new' as const, label: '新品' };
  }
  return null;
});

const tags = computed(() => {
  const values: string[] = [];
  const categoryName = props.product.category?.name?.trim();
  const subtitle = props.product.subtitle?.trim();
  if (categoryName) values.push(categoryName);
  if (subtitle && subtitle !== categoryName) values.push(subtitle);
  return values.slice(0, 2);
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
      <QxTag
        v-if="badge"
        class="qx-product-card__badge"
        :tone="badge.tone"
      >
        {{ badge.label }}
      </QxTag>
    </view>
    <view class="qx-product-card__body">
      <text
        v-if="variant === 'grid' && product.brand?.name"
        class="qx-product-card__brand"
      >
        {{ product.brand.name }}
      </text>
      <text class="qx-product-card__name">
        {{ product.name }}
      </text>
      <view
        v-if="variant === 'list' && tags.length > 0"
        class="qx-product-card__tags"
      >
        <text
          v-for="tag in tags"
          :key="tag"
          class="qx-product-card__tag"
        >
          {{ tag }}
        </text>
      </view>
      <text
        v-else-if="variant === 'list' && product.subtitle"
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
        <view
          v-if="variant === 'list'"
          class="qx-product-card__add"
          aria-hidden="true"
        >
          <QxIcon
            name="plus"
            :size="28"
            color="#ffffff"
          />
        </view>
        <text
          v-else
          class="qx-product-card__sales"
        >
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
  border-radius: var(--qx-store-radius, 16rpx);
  color: var(--qx-store-text, #2A2418);
  background: var(--qx-store-surface, #ffffff);
  text-align: left;
}

.qx-product-card--pressed {
  opacity: 0.88;
}

.qx-product-card--list {
  display: flex;
  min-height: 192rpx;
  align-items: stretch;
  gap: 20rpx;
  padding: 20rpx;
  border: 1px solid #ede8e0;
  border-radius: 24rpx;
  box-shadow: 0 4rpx 16rpx rgba(43, 37, 32, 0.03);
}

.qx-product-card__media {
  position: relative;
  width: 100%;
  min-width: 0;
  overflow: hidden;
  background: var(--qx-store-surface-soft, #F3EBDA);
}

.qx-product-card--grid .qx-product-card__media {
  border-radius: var(--qx-store-radius, 16rpx) var(--qx-store-radius, 16rpx) 0 0;
}

.qx-product-card--list .qx-product-card__media {
  width: 168rpx;
  height: 192rpx;
  flex: 0 0 auto;
  border: 1px solid #f2ece1;
  border-radius: 16rpx;
  background: #f9f7f2;
}

.qx-product-card--sold-out .qx-product-card__media {
  filter: saturate(0.45);
  opacity: 0.72;
}

.qx-product-card__badge {
  position: absolute;
  z-index: 3;
  top: 8rpx;
  left: 8rpx;
}

.qx-product-card--list :deep(.qx-tag--hot) {
  color: #ffffff;
  background: #b58a46;
}

.qx-product-card--list :deep(.qx-tag--new) {
  color: #e5c9a2;
  background: #2d2823;
}

.qx-product-card--list :deep(.qx-tag--sold-out) {
  color: #ffffff;
  background: rgba(45, 40, 35, 0.72);
}

.qx-product-card__body {
  display: flex;
  min-width: 0;
  flex-direction: column;
  padding: 18rpx 16rpx 20rpx;
}

.qx-product-card--list .qx-product-card__body {
  flex: 1;
  min-height: 0;
  padding: 4rpx 0 0;
}

.qx-product-card__brand,
.qx-product-card__name,
.qx-product-card__subtitle {
  display: block;
  max-width: 100%;
  overflow: hidden;
}

.qx-product-card__brand {
  color: var(--qx-store-brand, #C4A35A);
  font-size: 18rpx;
  font-weight: 600;
  line-height: 1.3;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.qx-product-card__name {
  display: -webkit-box;
  margin-top: 8rpx;
  overflow: hidden;
  color: var(--qx-store-text, #2A2418);
  font-size: 24rpx;
  font-weight: 700;
  line-height: 1.4;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.qx-product-card--grid .qx-product-card__name {
  font-weight: 600;
  line-height: 1.45;
}

.qx-product-card--list .qx-product-card__name {
  margin-top: 0;
  font-size: 24rpx;
}

.qx-product-card__subtitle {
  margin-top: 8rpx;
  color: var(--qx-store-muted, #9A9286);
  font-size: 20rpx;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.qx-product-card__tags {
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  gap: 8rpx;
  margin-top: 12rpx;
}

.qx-product-card__tag {
  max-width: 100%;
  overflow: hidden;
  padding: 4rpx 12rpx;
  border-radius: 6rpx;
  color: #916e37;
  background: #f8f2e8;
  font-size: 18rpx;
  font-weight: 500;
  line-height: 1.3;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.qx-product-card__tag:nth-child(2) {
  color: #696156;
  background: #f5f2ec;
}

.qx-product-card__footer {
  display: flex;
  min-width: 0;
  align-items: flex-end;
  gap: 12rpx;
  margin-top: 14rpx;
}

.qx-product-card--list .qx-product-card__footer {
  margin-top: auto;
  padding-top: 12rpx;
  border-top: 1px solid #faf7f2;
}

.qx-product-card--list :deep(.qx-price),
.qx-product-card--list :deep(.qx-price__amount) {
  color: #a52a18;
}

.qx-product-card--list :deep(.qx-price--sold-out),
.qx-product-card--list :deep(.qx-price--sold-out .qx-price__amount) {
  color: var(--qx-store-text-soft, #6B6458);
}

.qx-product-card__add {
  display: flex;
  width: 48rpx;
  height: 48rpx;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  margin-left: auto;
  border-radius: 50%;
  background: linear-gradient(135deg, #b58a46 0%, #d4af37 100%);
  box-shadow: 0 6rpx 16rpx rgba(200, 160, 100, 0.28);
}

.qx-product-card__sales {
  min-width: 0;
  margin-left: auto;
  overflow: hidden;
  color: var(--qx-store-muted, #9A9286);
  font-size: 18rpx;
  line-height: 1.35;
  text-align: right;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (min-width: 768px) {
  .qx-product-card__body {
    padding: 14px;
  }

  .qx-product-card--list .qx-product-card__body {
    padding: 2px 0 0;
  }

  .qx-product-card__name {
    font-size: 16px;
  }

  .qx-product-card__brand,
  .qx-product-card__sales {
    font-size: 12px;
  }
}
</style>
