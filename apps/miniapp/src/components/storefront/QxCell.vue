<script setup lang="ts">
import QxIcon from './QxIcon.vue';
import type { QxIconName } from './qx-icons';

withDefaults(
  defineProps<{
    title: string;
    value?: string;
    icon?: QxIconName | '';
    chevron?: boolean;
    danger?: boolean;
    center?: boolean;
  }>(),
  {
    value: '',
    icon: '',
    chevron: false,
    danger: false,
    center: false,
  },
);

const emit = defineEmits<{
  select: [];
}>();
</script>

<template>
  <button
    class="qx-cell qx-hairline--bottom"
    :class="{
      'qx-cell--danger': danger,
      'qx-cell--center': center,
    }"
    hover-class="qx-cell--pressed"
    @click="emit('select')"
  >
    <view
      v-if="icon"
      class="qx-cell__icon"
    >
      <QxIcon
        :name="icon"
        :size="32"
        :color="danger ? '#B84848' : '#C4A35A'"
      />
    </view>
    <text class="qx-cell__title">
      {{ title }}
    </text>
    <text
      v-if="value"
      class="qx-cell__value"
    >
      {{ value }}
    </text>
    <QxIcon
      v-if="chevron"
      name="chevron"
      :size="28"
      color="#9A9286"
    />
  </button>
</template>

<style scoped>
.qx-cell {
  display: flex;
  width: 100%;
  min-height: 112rpx;
  align-items: center;
  gap: 16rpx;
  padding: 0 32rpx;
  color: var(--qx-store-text, #2A2418);
  background: var(--qx-store-surface, #ffffff);
  text-align: left;
}

.qx-cell--pressed {
  background: var(--qx-store-background, #F7F4EE);
}

.qx-cell--center {
  justify-content: center;
}

.qx-cell--danger {
  color: var(--qx-store-danger, #b84848);
}

.qx-cell__icon {
  display: flex;
  width: 40rpx;
  height: 40rpx;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
}

.qx-cell__title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  font-size: 34rpx;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.qx-cell--center .qx-cell__title {
  flex: 0 1 auto;
}

.qx-cell__value {
  flex: 0 1 auto;
  max-width: 46%;
  overflow: hidden;
  color: var(--qx-store-muted, #9A9286);
  font-size: 28rpx;
  text-align: right;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
