<script setup lang="ts">
import { computed } from 'vue';

import { wechatChromeCssVars } from '../../utils/wechat-chrome';

withDefaults(
  defineProps<{
    surface?: 'default' | 'white';
    withBottomNav?: boolean;
  }>(),
  {
    surface: 'default',
    withBottomNav: false,
  },
);

const chromeStyle = computed(() => wechatChromeCssVars());
</script>

<template>
  <view
    class="qx-store-theme qx-store-shell"
    :class="{
      'qx-store-shell--white': surface === 'white',
      'qx-store-shell--with-nav': withBottomNav,
    }"
    :style="chromeStyle"
  >
    <view class="qx-store-shell__viewport">
      <view class="qx-store-shell__content">
        <slot />
      </view>
      <slot name="bottom" />
    </view>
  </view>
</template>

<style src="../../styles/storefront.css"></style>

<style scoped>
.qx-store-shell {
  width: 100%;
  min-width: 320px;
  min-height: 100%;
  overflow-x: hidden;
  overflow-x: clip;
  background: var(--qx-store-background, #F7F4EE);
}

.qx-store-shell--white {
  background: var(--qx-store-background, #F7F4EE);
}

.qx-store-shell__viewport {
  position: relative;
  width: 100%;
  max-width: 414px;
  min-height: 100%;
  margin: 0 auto;
  background: var(--qx-store-background);
}

.qx-store-shell--white .qx-store-shell__viewport {
  background: var(--qx-store-surface);
}

.qx-store-shell__content {
  width: 100%;
  min-height: 100%;
}

.qx-store-shell--with-nav .qx-store-shell__content {
  padding-bottom: calc(124rpx + constant(safe-area-inset-bottom));
  padding-bottom: calc(124rpx + env(safe-area-inset-bottom));
  padding-bottom: calc(124rpx + var(--qx-safe-bottom-pad, env(safe-area-inset-bottom, 0px)));
}

/* #ifndef MP-WEIXIN */
.qx-store-shell,
.qx-store-shell__viewport,
.qx-store-shell__content {
  min-height: 100vh;
}
/* #endif */

@media (min-width: 768px) {
  .qx-store-shell__viewport {
    border-right: 1px solid var(--qx-store-line);
    border-left: 1px solid var(--qx-store-line);
  }
}
</style>
