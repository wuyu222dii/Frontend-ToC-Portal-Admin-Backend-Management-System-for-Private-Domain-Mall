<template>
  <view class="page">
    <view class="status-panel">
      <view
        class="brand-mark"
        aria-hidden="true"
      >
        青
      </view>
      <text class="eyebrow">
        QINGXU LIFE
      </text>
      <text class="title">
        青序生活商城
      </text>
      <text class="status">
        工程环境已就绪
      </text>
      <text class="description">
        商城功能将在对应开发批次验收后开放。
      </text>
    </view>
  </view>
</template>

<style scoped>
.page {
  display: flex;
  min-height: 100vh;
  align-items: center;
  justify-content: center;
  padding: 32rpx;
  background: #f6f8f6;
}

.status-panel {
  display: flex;
  width: 100%;
  max-width: 680rpx;
  flex-direction: column;
  align-items: center;
  padding: 72rpx 40rpx;
  border: 1px solid #dce3df;
  border-radius: 16rpx;
  background: #ffffff;
  box-shadow: 0 24rpx 64rpx rgba(23, 59, 49, 0.08);
}

.brand-mark {
  display: flex;
  width: 104rpx;
  height: 104rpx;
  align-items: center;
  justify-content: center;
  margin-bottom: 40rpx;
  border-radius: 16rpx;
  color: #ffffff;
  background: #173b31;
  font-size: 48rpx;
}

.eyebrow {
  margin-bottom: 12rpx;
  color: #c96855;
  font-size: 22rpx;
  font-weight: 700;
}

.title {
  margin-bottom: 32rpx;
  color: #1f2925;
  font-size: 48rpx;
  font-weight: 700;
}

.status {
  padding: 10rpx 20rpx;
  border: 1px solid #88a89a;
  border-radius: 8rpx;
  color: #315e50;
  font-size: 24rpx;
}

.description {
  margin-top: 32rpx;
  color: #66736d;
  font-size: 26rpx;
  line-height: 1.7;
  text-align: center;
}
</style>
