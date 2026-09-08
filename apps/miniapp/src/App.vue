<script lang="ts">
export default {
  name: 'QingxuMiniapp',
};
</script>

<style>
page {
  --qx-store-background: #f6f8f6;
  --qx-store-surface: #ffffff;
  --qx-store-surface-soft: #eef3ef;
  --qx-store-text: #202522;
  --qx-store-text-soft: #5f6762;
  --qx-store-muted: #8d9690;
  --qx-store-line: #e8ece9;
  --qx-store-line-strong: #d5dcd6;
  --qx-store-brand: #496859;
  --qx-store-brand-strong: #173b31;
  --qx-store-brand-soft: #e7efe9;
  --qx-store-accent: #e27766;
  --qx-store-accent-soft: #f7e7e2;
  --qx-store-warning: #a56d27;
  --qx-store-warning-soft: #f6ecdd;
  --qx-store-danger: #b84848;
  --qx-store-info: #2f6578;
  --qx-store-info-soft: #e0edf1;
  --qx-store-radius: 16rpx;
  --qx-store-radius-sm: 12rpx;
  --qx-store-tap: 88rpx;
  --qx-store-shadow: 0 8rpx 28rpx rgba(23, 59, 49, 0.05);
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

button {
  margin: 0;
  padding: 0;
  border-radius: 0;
  line-height: inherit;
}

button::after {
  border: 0;
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
