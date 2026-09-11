<script lang="ts">
export default {
  name: 'QingxuMiniapp',
};
</script>

<style>
page {
  --qx-store-background: #f7f4ee;
  --qx-store-surface: #ffffff;
  --qx-store-surface-soft: #f3ebda;
  --qx-store-text: #2a2418;
  --qx-store-text-soft: #6b6458;
  --qx-store-muted: #9a9286;
  --qx-store-line: #e8e2d6;
  --qx-store-line-strong: #d8d0c2;
  --qx-store-brand: #c4a35a;
  --qx-store-brand-strong: #8a6a24;
  --qx-store-brand-soft: #f6efd9;
  --qx-store-accent: #8a6a24;
  --qx-store-accent-soft: #f6efd9;
  --qx-store-warning: #b45309;
  --qx-store-warning-soft: #f6e8d0;
  --qx-store-danger: #b84848;
  --qx-store-danger-soft: #f7e7e2;
  --qx-store-info: #5c6b73;
  --qx-store-info-soft: #ede8dc;
  --qx-store-radius: 16rpx;
  --qx-store-radius-sm: 12rpx;
  --qx-store-tap: 88rpx;
  --qx-store-shadow: 0 8rpx 28rpx rgba(138, 106, 36, 0.08);
  --qx-ink: var(--qx-store-text);
  --qx-ink-soft: var(--qx-store-text-soft);
  --qx-muted: var(--qx-store-muted);
  --qx-sage: var(--qx-store-brand);
  --qx-sage-deep: var(--qx-store-brand-strong);
  --qx-sage-pale: var(--qx-store-brand-soft);
  --qx-blue: var(--qx-store-info);
  --qx-blue-pale: var(--qx-store-info-soft);
  --qx-coral: var(--qx-store-accent);
  --qx-coral-pale: var(--qx-store-accent-soft);
  --qx-gold: var(--qx-store-warning);
  --qx-gold-pale: var(--qx-store-warning-soft);
  --qx-line: var(--qx-store-line);
  --qx-surface: var(--qx-store-background);
  --qx-white: var(--qx-store-surface);
  min-height: 100%;
  overflow-x: hidden;
  color: var(--qx-store-text);
  background: var(--qx-store-background);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  font-size: 28rpx;
  letter-spacing: 0;
}

view,
text,
button,
input,
image,
scroll-view,
swiper,
swiper-item {
  box-sizing: border-box;
  letter-spacing: 0;
}

button,
uni-button {
  margin: 0;
  padding: 0;
  overflow: visible;
  border: 0;
  border-radius: 0;
  background-color: transparent;
  line-height: inherit;
  font-size: inherit;
  -webkit-appearance: none;
  appearance: none;
}

button::after,
uni-button::after,
html body button::after,
html body uni-button::after {
  display: none;
  border: 0;
}

html body button,
html body uni-button {
  margin: 0;
  padding: 0;
  overflow: visible;
  border: 0;
  border-radius: 0;
  background-color: transparent;
  line-height: inherit;
  font-size: inherit;
  -webkit-appearance: none;
  appearance: none;
}

image {
  display: block;
}

.qx-visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
</style>
