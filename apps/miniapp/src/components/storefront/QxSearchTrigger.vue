<script setup lang="ts">
withDefaults(
  defineProps<{
    label?: string;
    disabled?: boolean;
  }>(),
  {
    label: '搜索商品名称',
    disabled: false,
  },
);

const emit = defineEmits<{
  activate: [];
}>();
</script>

<template>
  <button
    class="qx-search-trigger"
    :disabled="disabled"
    :aria-label="label"
    hover-class="qx-search-trigger--pressed"
    @click="emit('activate')"
  >
    <text
      class="qx-search-trigger__icon"
      aria-hidden="true"
    >
      ⌕
    </text>
    <text class="qx-search-trigger__label">
      {{ label }}
    </text>
  </button>
</template>

<style scoped>
.qx-search-trigger {
  display: flex;
  width: 100%;
  min-height: 84rpx;
  align-items: center;
  gap: 18rpx;
  padding: 0 24rpx;
  border: 1px solid var(--qx-store-line, #e4e8e5);
  border-radius: 12rpx;
  color: var(--qx-store-muted, #8d9690);
  background: var(--qx-store-surface, #ffffff);
  text-align: left;
}

.qx-search-trigger--pressed {
  border-color: var(--qx-store-line-strong, #cfd6d1);
  background: var(--qx-store-surface-soft, #edf3ef);
}

.qx-search-trigger[disabled] {
  opacity: 0.55;
}

.qx-search-trigger__icon {
  flex: 0 0 auto;
  color: var(--qx-store-text-soft, #5f6762);
  font-size: 34rpx;
  line-height: 1;
}

.qx-search-trigger__label {
  min-width: 0;
  overflow: hidden;
  font-size: 26rpx;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
