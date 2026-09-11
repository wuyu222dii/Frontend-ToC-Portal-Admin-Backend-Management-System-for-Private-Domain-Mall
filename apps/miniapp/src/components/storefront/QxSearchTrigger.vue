<script setup lang="ts">
import { computed } from 'vue';

import QxIcon from './QxIcon.vue';

const props = withDefaults(
  defineProps<{
    label?: string;
    hint?: string;
    variant?: 'default' | 'pill';
    surface?: 'white' | 'cream';
    disabled?: boolean;
  }>(),
  {
    label: '搜索商品名称',
    hint: '',
    variant: 'default',
    surface: 'white',
    disabled: false,
  },
);

const emit = defineEmits<{
  activate: [];
}>();

const iconColor = computed(() => {
  if (props.variant === 'pill' && props.surface === 'cream') return '#A3998C';
  if (props.variant === 'pill') return '#C4A35A';
  return '#9A9286';
});
</script>

<template>
  <button
    class="qx-search-trigger"
    :class="{
      'qx-search-trigger--pill': variant === 'pill',
      'qx-search-trigger--cream': variant === 'pill' && surface === 'cream',
      'qx-search-trigger--disabled': disabled,
    }"
    :disabled="disabled"
    :aria-label="label"
    hover-class="qx-search-trigger--pressed"
    @click="emit('activate')"
  >
    <QxIcon
      name="search"
      :size="32"
      :color="iconColor"
    />
    <text class="qx-search-trigger__label">
      {{ label }}
    </text>
    <text
      v-if="hint"
      class="qx-search-trigger__hint"
    >
      {{ hint }}
    </text>
  </button>
</template>

<style scoped>
.qx-search-trigger {
  display: flex;
  width: 100%;
  min-height: 72rpx;
  align-items: center;
  gap: 12rpx;
  padding: 0 24rpx;
  border-radius: 8rpx;
  color: var(--qx-store-muted, #9A9286);
  background: var(--qx-store-surface-soft, #F3EBDA);
  text-align: left;
}

.qx-search-trigger--pill {
  min-height: 72rpx;
  padding: 0 16rpx 0 28rpx;
  border: 1px solid var(--qx-store-line, #EFEAE1);
  border-radius: 999rpx;
  background: #ffffff;
  box-shadow: 0 8rpx 24rpx -4rpx rgba(197, 160, 89, 0.08), 0 2rpx 8rpx -2rpx rgba(43, 37, 32, 0.04);
}

.qx-search-trigger--pressed {
  background: var(--qx-store-brand-soft, #F6EFD9);
}

.qx-search-trigger--cream {
  border-color: rgba(233, 227, 216, 0.8);
  background: #f3efe8;
  box-shadow: none;
}

.qx-search-trigger--pill.qx-search-trigger--pressed {
  border-color: var(--qx-store-brand, #C4A35A);
  background: #ffffff;
}

.qx-search-trigger--cream.qx-search-trigger--pressed {
  background: #ffffff;
}

.qx-search-trigger--cream .qx-search-trigger__hint {
  color: #785926;
  background: #eadcc8;
}

.qx-search-trigger--disabled {
  opacity: 0.55;
}

.qx-search-trigger::after {
  display: none;
}

.qx-search-trigger__label {
  min-width: 0;
  overflow: hidden;
  font-size: 30rpx;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.qx-search-trigger--pill .qx-search-trigger__label {
  flex: 1;
  font-size: 24rpx;
}

.qx-search-trigger__hint {
  flex: 0 0 auto;
  padding: 4rpx 16rpx;
  border-radius: 999rpx;
  color: var(--qx-store-brand, #C4A35A);
  background: #f7f2e9;
  font-size: 20rpx;
  font-weight: 500;
  line-height: 1.3;
}
</style>
