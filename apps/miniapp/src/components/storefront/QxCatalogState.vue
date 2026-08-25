<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';

type CatalogStateKind = 'loading' | 'empty' | 'error' | 'rate-limited';

const props = withDefaults(
  defineProps<{
    kind: CatalogStateKind;
    title?: string;
    description?: string;
    actionLabel?: string;
    retryAfterSeconds?: number;
    compact?: boolean;
  }>(),
  {
    title: '',
    description: '',
    actionLabel: '',
    retryAfterSeconds: 0,
    compact: false,
  },
);

const emit = defineEmits<{
  action: [];
}>();

const defaults: Record<
  CatalogStateKind,
  { title: string; description: string; actionLabel: string; icon: string }
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
    icon: '□',
  },
  error: {
    title: '内容加载失败',
    description: '网络可能开了小差，请重新加载。',
    actionLabel: '重新加载',
    icon: '!',
  },
  'rate-limited': {
    title: '请求过于频繁',
    description: '请稍等片刻后再试。',
    actionLabel: '重新加载',
    icon: '429',
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
      v-if="kind === 'loading'"
      class="qx-catalog-state__spinner"
      aria-hidden="true"
    />
    <view
      v-else
      class="qx-catalog-state__icon"
      aria-hidden="true"
    >
      {{ defaults[kind].icon }}
    </view>
    <view class="qx-catalog-state__copy">
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
  padding: 64rpx 40rpx;
  color: var(--qx-store-muted, #8d9690);
  text-align: center;
}

.qx-catalog-state--compact {
  min-height: 156rpx;
  flex-direction: row;
  justify-content: flex-start;
  gap: 24rpx;
  padding: 28rpx;
  border: 1px solid var(--qx-store-line, #e4e8e5);
  border-radius: 14rpx;
  background: var(--qx-store-surface, #ffffff);
  text-align: left;
}

.qx-catalog-state__spinner,
.qx-catalog-state__icon {
  display: flex;
  width: 80rpx;
  height: 80rpx;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  border-radius: 14rpx;
}

.qx-catalog-state__spinner {
  width: 58rpx;
  height: 58rpx;
  border: 6rpx solid var(--qx-store-info-soft, #e0edf1);
  border-top-color: var(--qx-store-info, #2f6578);
  border-radius: 50%;
  animation: qx-catalog-spin 900ms linear infinite;
}

.qx-catalog-state__icon {
  color: var(--qx-store-text-soft, #5f6762);
  background: var(--qx-store-surface-soft, #edf3ef);
  font-size: 28rpx;
  font-weight: 800;
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
  font-weight: 700;
  line-height: 1.4;
}

.qx-catalog-state__description {
  margin-top: 12rpx;
  font-size: 22rpx;
  line-height: 1.6;
}

.qx-catalog-state__action {
  min-width: 192rpx;
  min-height: 72rpx;
  margin-top: 28rpx;
  padding: 0 24rpx;
  border: 1px solid var(--qx-store-brand, #496859);
  border-radius: 10rpx;
  color: var(--qx-store-brand, #496859);
  background: var(--qx-store-surface, #ffffff);
  font-size: 24rpx;
  font-weight: 700;
}

.qx-catalog-state__action--pressed {
  background: var(--qx-store-surface-soft, #edf3ef);
}

.qx-catalog-state__action[disabled] {
  border-color: var(--qx-store-line-strong, #cfd6d1);
  color: var(--qx-store-muted, #8d9690);
  background: var(--qx-store-background, #f6f8f6);
}

.qx-catalog-state--compact .qx-catalog-state__action {
  min-height: 64rpx;
  margin-top: 20rpx;
}

@keyframes qx-catalog-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
