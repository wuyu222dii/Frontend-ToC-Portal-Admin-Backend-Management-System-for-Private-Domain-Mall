<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';

import QxIcon from './QxIcon.vue';
import type { QxIconName } from './qx-icons';

type CatalogStateKind = 'loading' | 'empty' | 'error' | 'rate-limited';

const props = withDefaults(
  defineProps<{
    kind: CatalogStateKind;
    title?: string;
    description?: string;
    actionLabel?: string;
    actionTestid?: string;
    retryAfterSeconds?: number;
    compact?: boolean;
  }>(),
  {
    title: '',
    description: '',
    actionLabel: '',
    actionTestid: '',
    retryAfterSeconds: 0,
    compact: false,
  },
);

const emit = defineEmits<{
  action: [];
}>();

const defaults: Record<
  CatalogStateKind,
  { title: string; description: string; actionLabel: string; icon: QxIconName | '' }
> = {
  loading: {
    title: '正在加载',
    description: '好物正在向你走来',
    actionLabel: '',
    icon: '',
  },
  empty: {
    title: '暂无内容',
    description: '换个条件试试，或稍后再来看看。',
    actionLabel: '',
    icon: 'empty',
  },
  error: {
    title: '内容加载失败',
    description: '网络可能开了小差，请重新加载。',
    actionLabel: '重新加载',
    icon: 'warning',
  },
  'rate-limited': {
    title: '请求过于频繁',
    description: '请稍等片刻后再试。',
    actionLabel: '重新加载',
    icon: 'clock',
  },
};

const remainingSeconds = ref(0);
let timer: ReturnType<typeof setInterval> | undefined;

function clearTimer() {
  if (timer !== undefined) {
    clearInterval(timer);
    timer = undefined;
  }
}

function resetCountdown(value: number) {
  clearTimer();
  remainingSeconds.value = Number.isFinite(value) ? Math.max(0, Math.ceil(value)) : 0;

  if (props.kind !== 'rate-limited' || remainingSeconds.value === 0) {
    return;
  }

  timer = setInterval(() => {
    remainingSeconds.value = Math.max(0, remainingSeconds.value - 1);
    if (remainingSeconds.value === 0) {
      clearTimer();
    }
  }, 1000);
}

watch(
  () => [props.kind, props.retryAfterSeconds] as const,
  ([, retryAfterSeconds]) => resetCountdown(retryAfterSeconds),
  { immediate: true },
);

onBeforeUnmount(clearTimer);

const resolvedTitle = computed(() => props.title || defaults[props.kind].title);
const resolvedDescription = computed(() => props.description || defaults[props.kind].description);
const resolvedActionLabel = computed(() => props.actionLabel || defaults[props.kind].actionLabel);
const actionDisabled = computed(
  () => props.kind === 'rate-limited' && remainingSeconds.value > 0,
);
const actionCopy = computed(() => {
  if (actionDisabled.value) {
    return `${remainingSeconds.value}秒后可重试`;
  }
  return resolvedActionLabel.value;
});
const showAction = computed(
  () => props.kind !== 'loading' && Boolean(resolvedActionLabel.value),
);
const stateIcon = computed(() => defaults[props.kind].icon);
</script>

<template>
  <view
    class="qx-catalog-state"
    :class="[
      `qx-catalog-state--${kind}`,
      { 'qx-catalog-state--compact': compact },
    ]"
    role="status"
    aria-live="polite"
  >
    <view
      v-if="kind === 'loading' && compact"
      class="qx-catalog-state__compact-bones"
      aria-hidden="true"
    >
      <view class="qx-skeleton qx-catalog-state__bar qx-catalog-state__bar--wide" />
      <view class="qx-skeleton qx-catalog-state__bar" />
    </view>
    <view
      v-else-if="kind === 'loading'"
      class="qx-catalog-state__skeleton"
      aria-hidden="true"
    >
      <view class="qx-skeleton qx-catalog-state__banner" />
      <view class="qx-catalog-state__grid">
        <view
          v-for="index in 4"
          :key="index"
          class="qx-catalog-state__card"
        >
          <view class="qx-skeleton qx-catalog-state__thumb" />
          <view class="qx-skeleton qx-catalog-state__bar qx-catalog-state__bar--wide" />
          <view class="qx-skeleton qx-catalog-state__bar qx-catalog-state__bar--price" />
        </view>
      </view>
    </view>
    <view
      v-else
      class="qx-catalog-state__icon"
      aria-hidden="true"
    >
      <QxIcon
        v-if="stateIcon"
        :name="stateIcon"
        :size="compact ? 36 : 48"
      />
    </view>
    <view
      v-if="kind !== 'loading'"
      class="qx-catalog-state__copy"
    >
      <text class="qx-catalog-state__title">
        {{ resolvedTitle }}
      </text>
      <text class="qx-catalog-state__description">
        {{ resolvedDescription }}
      </text>
      <slot />
      <button
        v-if="showAction"
        class="qx-catalog-state__action"
        :data-testid="actionTestid || undefined"
        :disabled="actionDisabled"
        hover-class="qx-catalog-state__action--pressed"
        @click="emit('action')"
      >
        {{ actionCopy }}
      </button>
    </view>
  </view>
</template>

<style scoped>
.qx-catalog-state {
  display: flex;
  width: 100%;
  min-height: 560rpx;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 24rpx;
  padding: 48rpx 32rpx;
  color: var(--qx-store-muted, #8d9690);
  text-align: center;
}

.qx-catalog-state--loading {
  align-items: stretch;
  justify-content: flex-start;
  min-height: 480rpx;
  padding: 24rpx;
}

.qx-catalog-state--compact {
  min-height: 132rpx;
  flex-direction: row;
  justify-content: flex-start;
  gap: 20rpx;
  padding: 24rpx;
  border-radius: var(--qx-store-radius, 16rpx);
  background: var(--qx-store-surface, #ffffff);
  text-align: left;
}

.qx-catalog-state--compact.qx-catalog-state--loading {
  min-height: 120rpx;
}

.qx-catalog-state__skeleton,
.qx-catalog-state__compact-bones {
  width: 100%;
}

.qx-catalog-state__compact-bones {
  display: flex;
  flex-direction: column;
  gap: 14rpx;
}

.qx-catalog-state__banner {
  width: 100%;
  height: 220rpx;
  border-radius: var(--qx-store-radius, 16rpx);
}

.qx-catalog-state__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18rpx;
  margin-top: 24rpx;
}

.qx-catalog-state__card {
  display: flex;
  flex-direction: column;
  gap: 12rpx;
}

.qx-catalog-state__thumb {
  width: 100%;
  aspect-ratio: 1 / 1;
  border-radius: var(--qx-store-radius, 16rpx);
}

.qx-catalog-state__bar {
  width: 64%;
  height: 22rpx;
  border-radius: 8rpx;
}

.qx-catalog-state__bar--wide {
  width: 88%;
}

.qx-catalog-state__bar--price {
  width: 40%;
  height: 28rpx;
}

.qx-skeleton {
  background-image: linear-gradient(
    90deg,
    var(--qx-store-surface-soft, #eef3ef) 20%,
    #f7faf8 50%,
    var(--qx-store-surface-soft, #eef3ef) 80%
  );
  background-size: 200% 100%;
  animation: qx-catalog-shimmer 1.2s ease-in-out infinite;
}

@keyframes qx-catalog-shimmer {
  0% { background-position: 100% 0; }
  100% { background-position: -100% 0; }
}

.qx-catalog-state__icon {
  display: flex;
  width: 88rpx;
  height: 88rpx;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  border-radius: var(--qx-store-radius, 16rpx);
  color: var(--qx-store-text-soft, #5f6762);
  background: var(--qx-store-surface-soft, #eef3ef);
}

.qx-catalog-state--compact .qx-catalog-state__icon {
  width: 64rpx;
  height: 64rpx;
}

.qx-catalog-state--error .qx-catalog-state__icon {
  color: var(--qx-store-danger, #b84848);
  background: var(--qx-store-accent-soft, #f7e7e2);
}

.qx-catalog-state--rate-limited .qx-catalog-state__icon {
  color: var(--qx-store-warning, #a56d27);
  background: var(--qx-store-warning-soft, #f6ecdd);
}

.qx-catalog-state__copy {
  display: flex;
  max-width: 560rpx;
  min-width: 0;
  flex-direction: column;
  align-items: center;
}

.qx-catalog-state--compact .qx-catalog-state__copy {
  flex: 1;
  align-items: flex-start;
}

.qx-catalog-state__title,
.qx-catalog-state__description {
  display: block;
  width: 100%;
}

.qx-catalog-state__title {
  color: var(--qx-store-text-soft, #5f6762);
  font-size: 28rpx;
  font-weight: 600;
  line-height: 1.4;
}

.qx-catalog-state__description {
  margin-top: 10rpx;
  font-size: 22rpx;
  line-height: 1.6;
}

.qx-catalog-state__action {
  min-width: 192rpx;
  min-height: 72rpx;
  margin-top: 24rpx;
  padding: 0 24rpx;
  border: 1px solid var(--qx-store-brand, #496859);
  border-radius: var(--qx-store-radius, 16rpx);
  color: var(--qx-store-brand, #496859);
  background: var(--qx-store-surface, #ffffff);
  font-size: 24rpx;
  font-weight: 600;
}

.qx-catalog-state__action--pressed {
  background: var(--qx-store-surface-soft, #eef3ef);
}

.qx-catalog-state__action[disabled] {
  border-color: var(--qx-store-line-strong, #d5dcd6);
  color: var(--qx-store-muted, #8d9690);
  background: var(--qx-store-background, #f6f8f6);
}

.qx-catalog-state--compact .qx-catalog-state__action {
  min-height: 64rpx;
  margin-top: 16rpx;
}
</style>
