<script setup lang="ts">
import QxIcon from './QxIcon.vue';

withDefaults(
  defineProps<{
    checked?: boolean;
    disabled?: boolean;
  }>(),
  {
    checked: false,
    disabled: false,
  },
);
</script>

<template>
  <view
    class="qx-check"
    :class="{
      'qx-check--checked': checked,
      'qx-check--disabled': disabled,
    }"
    aria-hidden="true"
  >
    <QxIcon
      v-if="checked"
      name="check"
      :size="22"
    />
  </view>
</template>

<style scoped>
.qx-check {
  display: flex;
  width: 36rpx;
  height: 36rpx;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--qx-store-line-strong, #d5dcd6);
  border-radius: 50%;
  color: #ffffff;
  background: var(--qx-store-surface, #ffffff);
}

.qx-check--checked {
  border-color: var(--qx-store-brand, #496859);
  background: var(--qx-store-brand, #496859);
}

.qx-check--disabled {
  background: var(--qx-store-line, #e8ece9);
  opacity: 0.72;
}
</style>
