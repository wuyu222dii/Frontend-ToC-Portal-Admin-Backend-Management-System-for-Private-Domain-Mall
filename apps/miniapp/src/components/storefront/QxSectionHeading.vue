<script setup lang="ts">
import QxIcon from './QxIcon.vue';

withDefaults(
  defineProps<{
    title: string;
    subtitle?: string;
    actionLabel?: string;
    badge?: string;
    badgeTone?: 'gold' | 'quiet';
  }>(),
  {
    subtitle: '',
    actionLabel: '',
    badge: '',
    badgeTone: 'gold',
  },
);

const emit = defineEmits<{
  action: [];
}>();
</script>

<template>
  <view class="qx-section-heading">
    <view class="qx-section-heading__copy">
      <view class="qx-section-heading__title-row">
        <view
          class="qx-section-heading__mark"
          aria-hidden="true"
        />
        <text class="qx-section-heading__title">
          {{ title }}
        </text>
        <text
          v-if="badge"
          class="qx-section-heading__badge"
          :class="`qx-section-heading__badge--${badgeTone}`"
        >
          {{ badge }}
        </text>
      </view>
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
        <QxIcon
          name="chevron"
          :size="24"
          color="#9A9286"
        />
      </button>
    </slot>
  </view>
</template>

<style scoped>
.qx-section-heading {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  gap: 20rpx;
}

.qx-section-heading__copy {
  min-width: 0;
  flex: 1;
}

.qx-section-heading__title-row {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 12rpx;
}

.qx-section-heading__mark {
  width: 8rpx;
  height: 28rpx;
  flex: 0 0 auto;
  border-radius: 999rpx;
  background: var(--qx-store-brand, #C4A35A);
}

.qx-section-heading__title,
.qx-section-heading__subtitle {
  display: block;
}

.qx-section-heading__title {
  min-width: 0;
  overflow: hidden;
  color: var(--qx-store-text, #2A2418);
  font-size: 32rpx;
  font-weight: 700;
  line-height: 1.3;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.qx-section-heading__badge {
  flex: 0 0 auto;
  padding: 4rpx 12rpx;
  border-radius: 8rpx;
  color: #9f6b1e;
  background: #fbeed7;
  font-size: 20rpx;
  font-weight: 600;
  line-height: 1.3;
}

.qx-section-heading__badge--quiet {
  color: var(--qx-store-text, #2A2418);
  background: #ede5d8;
}

.qx-section-heading__subtitle {
  margin-top: 6rpx;
  padding-left: 20rpx;
  color: var(--qx-store-muted, #9A9286);
  font-size: 22rpx;
  font-weight: 400;
  line-height: 1.45;
}

.qx-section-heading__action {
  display: flex;
  min-height: 56rpx;
  flex: 0 0 auto;
  align-items: center;
  gap: 2rpx;
  padding: 0 4rpx;
  color: var(--qx-store-muted, #9A9286);
  background: transparent;
  font-size: 22rpx;
  font-weight: 400;
  line-height: 1.4;
}

.qx-section-heading__action--pressed {
  opacity: 0.65;
}
</style>
