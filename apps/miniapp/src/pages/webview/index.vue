<script setup lang="ts">
import { onLoad } from '@dcloudio/uni-app';
import { ref } from 'vue';

import { goBackOrHome, isSafeHttpsUrl } from '../../utils/store-navigation';

const targetUrl = ref('');

onLoad((query) => {
  const candidate = typeof query?.url === 'string' ? query.url : '';
  if (isSafeHttpsUrl(candidate)) targetUrl.value = candidate;
});

function goBack() {
  goBackOrHome();
}
</script>

<template>
  <web-view
    v-if="targetUrl"
    :src="targetUrl"
  />
  <view
    v-else
    class="webview-error"
  >
    <text class="webview-error__title">
      链接不可用
    </text>
    <text class="webview-error__copy">
      仅支持安全的 HTTPS 页面。
    </text>
    <button @click="goBack">
      返回商城
    </button>
  </view>
</template>

<style scoped>
.webview-error {
  display: flex;
  min-height: 100vh;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48rpx;
  background: #f4f7f5;
  text-align: center;
}

.webview-error__title,
.webview-error__copy { display: block; }
.webview-error__title { color: #17231f; font-size: 34rpx; font-weight: 700; }
.webview-error__copy { margin-top: 16rpx; color: #77837e; font-size: 24rpx; }
.webview-error button {
  min-width: 220rpx;
  min-height: 80rpx;
  margin-top: 34rpx;
  border-radius: 10rpx;
  color: #ffffff;
  background: #315f50;
  font-size: 24rpx;
}
</style>
