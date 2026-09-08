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
  <header class="qx-account-header">
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
      />
    </button>
    <view v-else class="qx-account-header__space" />
    <text class="qx-account-header__title" role="heading" aria-level="1">
      {{ title }}
    </text>
    <view class="qx-account-header__space" />
  </header>
</template>

<style scoped>
.qx-account-header {
  display: grid;
  min-height: 104rpx;
  align-items: center;
  padding: env(safe-area-inset-top) 16rpx 0;
  box-shadow: 0 1rpx 0 var(--qx-store-line, #e8ece9);
  background: rgba(255, 255, 255, 0.96);
  grid-template-columns: 72rpx minmax(0, 1fr) 72rpx;
}

.qx-account-header__back,
.qx-account-header__space {
  width: 72rpx;
  min-height: 72rpx;
}

.qx-account-header__back {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--qx-store-text);
  background: transparent;
}

.qx-account-header__back--pressed {
  opacity: 0.65;
}

.qx-account-header__title {
  overflow: hidden;
  font-size: 30rpx;
  font-weight: 600;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
