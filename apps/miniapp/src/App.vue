<script lang="ts">
export default {
  name: 'QingxuMiniapp',
};
</script>

<style>
page {
  --qx-ink: #17231f;
  --qx-ink-soft: #3f5049;
  --qx-muted: #77837e;
  --qx-sage: #315f50;
  --qx-sage-deep: #1f463a;
  --qx-sage-pale: #e8f0eb;
  --qx-blue: #2f6d81;
  --qx-blue-pale: #e8f2f5;
  --qx-coral: #d86555;
  --qx-coral-pale: #f8e9e6;
  --qx-gold: #9a742e;
  --qx-gold-pale: #f7f0df;
  --qx-line: #dce4e0;
  --qx-surface: #f4f7f5;
  --qx-white: #ffffff;
  min-height: 100%;
  overflow-x: hidden;
  color: var(--qx-ink);
  background: var(--qx-surface);
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
