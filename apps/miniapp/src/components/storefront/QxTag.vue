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
  color: var(--qx-store-accent, #e27766);
  background: var(--qx-store-accent-soft, #f7e7e2);
}

.qx-tag--new {
  color: var(--qx-store-info, #2f6578);
  background: var(--qx-store-info-soft, #e0edf1);
}

.qx-tag--sold-out {
  color: var(--qx-store-text-soft, #5f6762);
  background: var(--qx-store-surface-soft, #eef3ef);
}

.qx-tag--info {
  color: var(--qx-store-brand, #496859);
  background: var(--qx-store-brand-soft, #e7efe9);
}

.qx-tag--warning {
  color: var(--qx-store-warning, #a56d27);
  background: var(--qx-store-warning-soft, #f6ecdd);
}
</style>
