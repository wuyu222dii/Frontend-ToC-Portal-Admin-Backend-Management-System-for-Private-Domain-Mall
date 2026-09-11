<script setup lang="ts">
withDefaults(
  defineProps<{
    title?: string;
    footer?: string;
  }>(),
  {
    title: '',
    footer: '',
  },
);
</script>

<template>
  <view class="qx-cells">
    <text
      v-if="title"
      class="qx-cells__title"
    >
      {{ title }}
    </text>
    <view class="qx-cells__body">
      <slot />
    </view>
    <text
      v-if="footer"
      class="qx-cells__footer"
    >
      {{ footer }}
    </text>
  </view>
</template>

<style scoped>
.qx-cells {
  width: 100%;
}

.qx-cells__title,
.qx-cells__footer {
  display: block;
  padding: 16rpx 32rpx 12rpx;
  color: var(--qx-store-muted, #9A9286);
  font-size: 26rpx;
  line-height: 1.4;
}

.qx-cells__footer {
  padding-top: 12rpx;
  padding-bottom: 16rpx;
}

.qx-cells__body {
  overflow: hidden;
  background: var(--qx-store-surface, #ffffff);
}

.qx-cells__body :deep(.qx-cell:last-child)::after {
  display: none;
}
</style>
