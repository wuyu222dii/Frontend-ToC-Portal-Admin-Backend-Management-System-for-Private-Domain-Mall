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
      color="#ffffff"
    />
  </view>
</template>

<style scoped>
.qx-check {
  display: flex;
  width: 40rpx;
  height: 40rpx;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--qx-store-line-strong, #D8D0C2);
  border-radius: 50%;
  color: #ffffff;
  background: var(--qx-store-surface, #ffffff);
}

.qx-check--checked {
  border-color: var(--qx-store-brand, #C4A35A);
  background: var(--qx-store-brand, #C4A35A);
}

.qx-check--disabled {
  background: var(--qx-store-line, #E8E2D6);
  opacity: 0.72;
}
</style>
