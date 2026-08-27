<script setup lang="ts">
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
      @click="goBack"
    >
      ‹
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
  padding: env(safe-area-inset-top) 24rpx 0;
  border-bottom: 1px solid var(--qx-store-line);
  background: rgba(255, 255, 255, 0.96);
  grid-template-columns: 72rpx minmax(0, 1fr) 72rpx;
}

.qx-account-header__back,
.qx-account-header__space {
  width: 72rpx;
  min-height: 72rpx;
}

.qx-account-header__back {
  color: var(--qx-store-text);
  background: transparent;
  font-size: 42rpx;
}

.qx-account-header__title {
  overflow: hidden;
  font-size: 30rpx;
  font-weight: 800;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
