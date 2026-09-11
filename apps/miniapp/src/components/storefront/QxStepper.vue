<script setup lang="ts">
import QxIcon from './QxIcon.vue';

const props = withDefaults(
  defineProps<{
    value: number;
    min?: number;
    max?: number;
    disabled?: boolean;
    size?: 'default' | 'compact';
  }>(),
  {
    min: 1,
    max: 99,
    disabled: false,
    size: 'default',
  },
);

const emit = defineEmits<{
  change: [value: number];
}>();

function step(delta: number) {
  if (props.disabled) return;
  const next = Math.min(props.max, Math.max(props.min, props.value + delta));
  if (next !== props.value) emit('change', next);
}
</script>

<template>
  <view
    class="qx-stepper"
    :class="`qx-stepper--${size}`"
    aria-label="商品数量"
  >
    <button
      class="qx-stepper__button"
      :class="{ 'qx-stepper__button--disabled': disabled || value <= min }"
      aria-label="减少数量"
      :disabled="disabled || value <= min"
      hover-class="qx-stepper__button--pressed"
      @click="step(-1)"
    >
      <QxIcon
        name="minus"
        :size="size === 'compact' ? 22 : 28"
      />
    </button>
    <text class="qx-stepper__value">
      {{ value }}
    </text>
    <button
      class="qx-stepper__button"
      :class="{ 'qx-stepper__button--disabled': disabled || value >= max }"
      aria-label="增加数量"
      :disabled="disabled || value >= max"
      hover-class="qx-stepper__button--pressed"
      @click="step(1)"
    >
      <QxIcon
        name="plus"
        :size="size === 'compact' ? 22 : 28"
      />
    </button>
  </view>
</template>

<style scoped>
.qx-stepper {
  display: grid;
  width: 176rpx;
  height: 56rpx;
  grid-template-columns: 56rpx minmax(0, 1fr) 56rpx;
  align-items: center;
  overflow: hidden;
  border: 1px solid var(--qx-store-line, #E8E2D6);
  border-radius: var(--qx-store-radius-sm, 12rpx);
  background: var(--qx-store-surface, #ffffff);
}

.qx-stepper__button {
  display: flex;
  height: 54rpx;
  align-items: center;
  justify-content: center;
  color: var(--qx-store-text, #2A2418);
  background: var(--qx-store-surface-soft, #F3EBDA);
}

.qx-stepper__button--pressed {
  opacity: 0.7;
}

.qx-stepper__button--disabled {
  color: var(--qx-store-muted, #9A9286);
  opacity: 0.5;
}

.qx-stepper__value {
  color: var(--qx-store-text, #2A2418);
  font-size: 22rpx;
  font-weight: 600;
  text-align: center;
}

.qx-stepper--compact {
  width: 144rpx;
  height: 48rpx;
  grid-template-columns: 48rpx minmax(0, 1fr) 48rpx;
  background: rgba(251, 249, 245, 0.8);
}

.qx-stepper--compact .qx-stepper__button {
  height: 46rpx;
  background: transparent;
}

.qx-stepper--compact .qx-stepper__value {
  font-size: 22rpx;
  font-weight: 500;
}
</style>
