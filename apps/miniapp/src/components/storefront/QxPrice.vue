<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    amount: string | number | null | undefined;
    isSalable?: boolean;
    size?: 'small' | 'medium' | 'large';
    showAvailability?: boolean;
    soldOutText?: string;
  }>(),
  {
    isSalable: true,
    size: 'medium',
    showAvailability: true,
    soldOutText: '暂时售罄',
  },
);

const formattedAmount = computed(() => {
  const raw = typeof props.amount === 'number' ? String(props.amount) : props.amount?.trim();
  if (!raw || !/^\d+(?:\.\d+)?$/.test(raw)) {
    return '--';
  }

  const [integer, fraction = ''] = raw.split('.');
  const normalizedFraction = fraction.padEnd(2, '0').slice(0, 2);
  return normalizedFraction === '00' ? integer : `${integer}.${normalizedFraction}`;
});
</script>

<template>
  <view
    class="qx-price"
    :class="[`qx-price--${size}`, { 'qx-price--sold-out': !isSalable }]"
  >
    <view class="qx-price__amount">
      <text class="qx-price__currency">
        ¥
      </text>
      <text class="qx-price__value">
        {{ formattedAmount }}
      </text>
    </view>
    <text
      v-if="showAvailability && !isSalable"
      class="qx-price__availability"
    >
      {{ soldOutText }}
    </text>
  </view>
</template>

<style scoped>
.qx-price {
  display: flex;
  min-width: 0;
  align-items: baseline;
  gap: 10rpx;
  color: var(--qx-store-accent, #8A6A24);
}

.qx-price__amount {
  display: flex;
  min-width: 0;
  align-items: baseline;
  font-weight: 700;
  line-height: 1;
}

.qx-price__currency {
  flex: 0 0 auto;
  margin-right: 2rpx;
  font-size: 20rpx;
  font-weight: 600;
}

.qx-price__value {
  overflow: hidden;
  font-size: 34rpx;
  letter-spacing: -0.4rpx;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.qx-price--small .qx-price__currency {
  font-size: 18rpx;
}

.qx-price--small .qx-price__value {
  font-size: 30rpx;
}

.qx-price--large .qx-price__currency {
  font-size: 24rpx;
}

.qx-price--large .qx-price__value {
  font-size: 44rpx;
}

.qx-price--sold-out .qx-price__amount {
  color: var(--qx-store-text-soft, #6B6458);
}

.qx-price__availability {
  flex: 0 0 auto;
  padding: 4rpx 10rpx;
  border-radius: 8rpx;
  color: var(--qx-store-text-soft, #6B6458);
  background: var(--qx-store-surface-soft, #F3EBDA);
  font-size: 18rpx;
  font-weight: 600;
  line-height: 1.3;
}
</style>
