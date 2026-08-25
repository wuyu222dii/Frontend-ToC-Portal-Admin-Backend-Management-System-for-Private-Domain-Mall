<script setup lang="ts">
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
</script>

<template>
  <view
    class="qx-store-theme qx-store-shell"
    :class="{
      'qx-store-shell--white': surface === 'white',
      'qx-store-shell--with-nav': withBottomNav,
    }"
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
  min-height: 100vh;
  overflow-x: hidden;
  background: #eef1ef;
}

.qx-store-shell--white {
  background: #eef1ef;
}

.qx-store-shell__viewport {
  position: relative;
  width: 100%;
  max-width: 414px;
  min-height: 100vh;
  margin: 0 auto;
  background: var(--qx-store-background);
}

.qx-store-shell--white .qx-store-shell__viewport {
  background: var(--qx-store-surface);
}

.qx-store-shell__content {
  width: 100%;
  min-height: 100vh;
}

.qx-store-shell--with-nav .qx-store-shell__content {
  padding-bottom: calc(124rpx + env(safe-area-inset-bottom));
}

@media (min-width: 768px) {
  .qx-store-shell__viewport {
    border-right: 1px solid var(--qx-store-line);
    border-left: 1px solid var(--qx-store-line);
  }
}
</style>
