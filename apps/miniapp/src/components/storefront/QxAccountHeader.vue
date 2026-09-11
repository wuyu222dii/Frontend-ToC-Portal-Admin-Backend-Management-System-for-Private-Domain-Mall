<script setup lang="ts">
import QxIcon from './QxIcon.vue';
import { goBackOrHome } from '../../utils/store-navigation';

withDefaults(defineProps<{
  back?: boolean;
  title: string;
}>(), { back: true });

function goBack() {
  goBackOrHome();
}
</script>

<template>
  <header class="qx-account-header qx-hairline--bottom">
    <button
      v-if="back"
      class="qx-account-header__back"
      aria-label="返回"
      hover-class="qx-account-header__back--pressed"
      @click="goBack"
    >
      <QxIcon
        name="back"
        :size="40"
        color="#2A2418"
      />
    </button>
    <view
      v-else
      class="qx-account-header__space"
    />
    <text
      class="qx-account-header__title"
      role="heading"
      aria-level="1"
    >
      {{ title }}
    </text>
    <view class="qx-account-header__space" />
  </header>
</template>

<style scoped>
.qx-account-header {
  box-sizing: border-box;
  display: grid;
  min-height: var(--qx-nav-bar, calc(88rpx + env(safe-area-inset-top)));
  align-items: stretch;
  padding-top: var(--qx-status-bar, env(safe-area-inset-top));
  padding-right: var(--qx-capsule-right, 16rpx);
  padding-left: var(--qx-capsule-gap, 16rpx);
  background: var(--qx-store-surface, #ffffff);
  grid-template-columns: 88rpx minmax(0, 1fr) 88rpx;
}

.qx-account-header__back,
.qx-account-header__space {
  width: 88rpx;
  min-height: 88rpx;
}

.qx-account-header__back {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  overflow: visible;
  border: 0;
  color: var(--qx-store-text, #2A2418);
  background: transparent;
}

.qx-account-header__back--pressed {
  opacity: 0.65;
}

.qx-account-header__back::after {
  display: none;
}

.qx-account-header__title {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  font-size: 34rpx;
  font-weight: 600;
  line-height: 1.2;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
