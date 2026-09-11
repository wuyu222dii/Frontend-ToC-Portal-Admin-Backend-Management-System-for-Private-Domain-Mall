<script setup lang="ts">
withDefaults(
  defineProps<{
    tone?: 'hot' | 'new' | 'sold-out' | 'info' | 'warning';
  }>(),
  {
    tone: 'info',
  },
);
</script>

<template>
  <text
    class="qx-tag"
    :class="`qx-tag--${tone}`"
  >
    <slot />
  </text>
</template>

<style scoped>
.qx-tag {
  display: inline-flex;
  max-width: 100%;
  align-items: center;
  padding: 4rpx 10rpx;
  border-radius: 8rpx;
  font-size: 18rpx;
  font-weight: 600;
  line-height: 1.3;
}

.qx-tag--hot {
  color: var(--qx-store-accent, #8A6A24);
  background: var(--qx-store-accent-soft, #f7e7e2);
}

.qx-tag--new {
  color: var(--qx-store-info, #5C6B73);
  background: var(--qx-store-info-soft, #EDE8DC);
}

.qx-tag--sold-out {
  color: var(--qx-store-text-soft, #6B6458);
  background: var(--qx-store-surface-soft, #F3EBDA);
}

.qx-tag--info {
  color: var(--qx-store-brand, #C4A35A);
  background: var(--qx-store-brand-soft, #F6EFD9);
}

.qx-tag--warning {
  color: var(--qx-store-warning, #b45309);
  background: var(--qx-store-warning-soft, #f6ecdd);
}
</style>
