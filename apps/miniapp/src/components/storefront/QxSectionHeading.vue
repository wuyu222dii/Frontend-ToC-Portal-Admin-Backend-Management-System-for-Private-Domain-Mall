<script setup lang="ts">
withDefaults(
  defineProps<{
    title: string;
    subtitle?: string;
    actionLabel?: string;
  }>(),
  {
    subtitle: '',
    actionLabel: '',
  },
);

const emit = defineEmits<{
  action: [];
}>();
</script>

<template>
  <view class="qx-section-heading">
    <view class="qx-section-heading__copy">
      <text class="qx-section-heading__title">
        {{ title }}
      </text>
      <text
        v-if="subtitle"
        class="qx-section-heading__subtitle"
      >
        {{ subtitle }}
      </text>
    </view>
    <slot name="action">
      <button
        v-if="actionLabel"
        class="qx-section-heading__action"
        hover-class="qx-section-heading__action--pressed"
        @click="emit('action')"
      >
        <text>{{ actionLabel }}</text>
        <text aria-hidden="true">
          ›
        </text>
      </button>
    </slot>
  </view>
</template>

<style scoped>
.qx-section-heading {
  display: flex;
  width: 100%;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20rpx;
}

.qx-section-heading__copy {
  min-width: 0;
}

.qx-section-heading__title,
.qx-section-heading__subtitle {
  display: block;
}

.qx-section-heading__title {
  color: var(--qx-store-text, #202522);
  font-size: 32rpx;
  font-weight: 700;
  line-height: 1.3;
}

.qx-section-heading__subtitle {
  margin-top: 6rpx;
  color: var(--qx-store-muted, #8d9690);
  font-size: 20rpx;
  line-height: 1.45;
}

.qx-section-heading__action {
  display: flex;
  min-height: 56rpx;
  flex: 0 0 auto;
  align-items: center;
  gap: 6rpx;
  padding: 0 4rpx;
  color: var(--qx-store-brand, #496859);
  background: transparent;
  font-size: 22rpx;
  line-height: 1.4;
}

.qx-section-heading__action--pressed {
  opacity: 0.65;
}
</style>
