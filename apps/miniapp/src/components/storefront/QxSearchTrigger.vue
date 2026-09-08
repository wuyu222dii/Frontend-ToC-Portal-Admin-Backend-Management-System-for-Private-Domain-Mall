<script setup lang="ts">
import QxIcon from './QxIcon.vue';

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
    <QxIcon
      name="search"
      :size="32"
    />
    <text class="qx-search-trigger__label">
      {{ label }}
    </text>
  </button>
</template>

<style scoped>
.qx-search-trigger {
  display: flex;
  width: 100%;
  min-height: 80rpx;
  align-items: center;
  gap: 16rpx;
  padding: 0 24rpx;
  border-radius: 40rpx;
  color: var(--qx-store-muted, #8d9690);
  background: var(--qx-store-surface-soft, #eef3ef);
  text-align: left;
}

.qx-search-trigger--pressed {
  background: var(--qx-store-brand-soft, #e7efe9);
}

.qx-search-trigger[disabled] {
  opacity: 0.55;
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
