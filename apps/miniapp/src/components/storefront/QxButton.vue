<script setup lang="ts">
withDefaults(
  defineProps<{
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
    block?: boolean;
    disabled?: boolean;
  }>(),
  {
    variant: 'primary',
    block: true,
    disabled: false,
  },
);
</script>

<template>
  <button
    class="qx-button"
    :class="[
      `qx-button--${variant}`,
      { 'qx-button--block': block, 'qx-button--disabled': disabled },
    ]"
    :disabled="disabled"
    hover-class="qx-button--pressed"
  >
    <slot />
  </button>
</template>

<style scoped>
.qx-button {
  display: inline-flex;
  min-height: var(--qx-store-tap, 88rpx);
  align-items: center;
  justify-content: center;
  padding: 0 28rpx;
  border-radius: var(--qx-store-radius, 16rpx);
  font-size: 28rpx;
  font-weight: 600;
  line-height: 1.2;
}

.qx-button--block {
  width: 100%;
}

.qx-button--primary {
  color: #ffffff;
  background: var(--qx-store-brand, #C4A35A);
}

.qx-button--secondary {
  border: 1px solid var(--qx-store-brand, #C4A35A);
  color: var(--qx-store-brand, #C4A35A);
  background: var(--qx-store-surface, #ffffff);
}

.qx-button--ghost {
  color: var(--qx-store-brand, #C4A35A);
  background: transparent;
}

.qx-button--danger {
  color: #ffffff;
  background: var(--qx-store-danger, #b84848);
}

.qx-button--pressed {
  opacity: 0.86;
}

.qx-button--disabled {
  color: #ffffff;
  background: var(--qx-store-muted, #9A9286);
  opacity: 0.72;
  border-color: transparent;
}

.qx-button::after {
  display: none;
}
</style>
