<script setup lang="ts">
import { computed } from 'vue';

import { qxIconDataUri, type QxIconName } from './qx-icons';

const props = withDefaults(
  defineProps<{
    name: QxIconName;
    size?: number;
  }>(),
  {
    size: 40,
  },
);

const iconStyle = computed(() => ({
  width: `${props.size}rpx`,
  height: `${props.size}rpx`,
  maskImage: qxIconDataUri(props.name),
  webkitMaskImage: qxIconDataUri(props.name),
}));
</script>

<template>
  <view
    class="qx-icon"
    :style="iconStyle"
    aria-hidden="true"
  />
</template>

<style scoped>
.qx-icon {
  display: inline-flex;
  flex: 0 0 auto;
  background-color: currentColor;
  mask-repeat: no-repeat;
  mask-position: center;
  mask-size: contain;
  -webkit-mask-repeat: no-repeat;
  -webkit-mask-position: center;
  -webkit-mask-size: contain;
}
</style>
