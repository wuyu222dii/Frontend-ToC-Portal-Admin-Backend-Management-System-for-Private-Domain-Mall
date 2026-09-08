<script setup lang="ts">
import QxIcon from './QxIcon.vue';
import type { QxIconName } from './qx-icons';
import type { StoreNavTarget } from './storefront.types';

withDefaults(
  defineProps<{
    active?: StoreNavTarget;
  }>(),
  {
    active: 'home',
  },
);

const emit = defineEmits<{
  select: [target: StoreNavTarget];
}>();

const items: ReadonlyArray<{
  target: StoreNavTarget;
  label: string;
  icon: QxIconName;
  activeIcon: QxIconName;
}> = [
  { target: 'home', label: '首页', icon: 'home', activeIcon: 'home-fill' },
  { target: 'category', label: '分类', icon: 'category', activeIcon: 'category-fill' },
  { target: 'cart', label: '购物车', icon: 'cart', activeIcon: 'cart-fill' },
  { target: 'profile', label: '我的', icon: 'profile', activeIcon: 'profile-fill' },
];
</script>

<template>
  <view
    class="qx-bottom-nav"
    role="navigation"
    aria-label="商城主导航"
  >
    <button
      v-for="item in items"
      :key="item.target"
      class="qx-bottom-nav__item"
      :class="{ 'qx-bottom-nav__item--active': active === item.target }"
      :aria-current="active === item.target ? 'page' : 'false'"
      :aria-label="item.label"
      hover-class="qx-bottom-nav__item--pressed"
      @click="emit('select', item.target)"
    >
      <QxIcon
        :name="active === item.target ? item.activeIcon : item.icon"
        :size="44"
      />
      <text class="qx-bottom-nav__label">
        {{ item.label }}
      </text>
    </button>
  </view>
</template>

<style scoped>
.qx-bottom-nav {
  position: fixed;
  z-index: 30;
  right: 0;
  bottom: 0;
  left: 0;
  display: grid;
  width: 100%;
  max-width: 414px;
  min-height: calc(108rpx + env(safe-area-inset-bottom));
  grid-template-columns: repeat(4, minmax(0, 1fr));
  margin: 0 auto;
  padding: 8rpx 8rpx env(safe-area-inset-bottom);
  box-shadow: 0 -2rpx 0 var(--qx-store-line, #e8ece9);
  background: rgba(255, 255, 255, 0.98);
}

.qx-bottom-nav__item {
  display: flex;
  min-width: 0;
  min-height: 88rpx;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4rpx;
  color: var(--qx-store-muted, #8d9690);
  background: transparent;
}

.qx-bottom-nav__item--pressed {
  background: var(--qx-store-surface-soft, #eef3ef);
}

.qx-bottom-nav__item--active {
  color: var(--qx-store-brand, #496859);
}

.qx-bottom-nav__label {
  max-width: 100%;
  overflow: hidden;
  font-size: 20rpx;
  font-weight: 400;
  line-height: 1.25;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.qx-bottom-nav__item--active .qx-bottom-nav__label {
  font-weight: 600;
}

@media (min-width: 768px) {
  .qx-bottom-nav {
    box-shadow: -1px 0 0 var(--qx-store-line, #e8ece9), 1px 0 0 var(--qx-store-line, #e8ece9),
      0 -2rpx 0 var(--qx-store-line, #e8ece9);
  }
}
</style>
