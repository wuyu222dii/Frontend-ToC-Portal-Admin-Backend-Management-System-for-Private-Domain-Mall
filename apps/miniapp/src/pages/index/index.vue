<script setup lang="ts">
import { onLoad, onUnload } from '@dcloudio/uni-app';
import { computed, ref } from 'vue';

import { getStoreHome } from '../../api';
import { StoreApiError, type StoreCancelableRequest } from '../../api/store-client';
import QxBottomNav from '../../components/storefront/QxBottomNav.vue';
import QxCatalogState from '../../components/storefront/QxCatalogState.vue';
import QxProductCard from '../../components/storefront/QxProductCard.vue';
import QxProductImage from '../../components/storefront/QxProductImage.vue';
import QxSearchTrigger from '../../components/storefront/QxSearchTrigger.vue';
import QxSectionHeading from '../../components/storefront/QxSectionHeading.vue';
import QxStoreShell from '../../components/storefront/QxStoreShell.vue';
import type { StoreHomeData } from '../../types/store-catalog';
import {
  handleBottomNavigation,
  openBannerTarget,
  openCategory,
  openProduct,
  openSearch,
} from '../../utils/store-navigation';

type HomeState = 'loading' | 'ready' | 'error' | 'rate-limited';
type HomeSection = keyof StoreHomeData['section_status'];

const state = ref<HomeState>('loading');
const home = ref<StoreHomeData | null>(null);
const retryAfterSeconds = ref(0);
const slowRequest = ref(false);
const failedCategoryImages = ref<Record<string, boolean>>({});

let currentRequest: StoreCancelableRequest<StoreHomeData> | undefined;
let requestGeneration = 0;
let slowTimer: ReturnType<typeof setTimeout> | undefined;

const pageErrorKind = computed(() => state.value === 'rate-limited' ? 'rate-limited' : 'error');
const pageErrorTitle = computed(() => state.value === 'rate-limited'
  ? '浏览得有些快'
  : '商城首页加载失败');
const loadingDescription = computed(() => slowRequest.value
  ? '网络响应较慢，正在继续加载。'
  : '正在准备今日好物。');

function clearSlowTimer() {
  if (slowTimer !== undefined) {
    clearTimeout(slowTimer);
    slowTimer = undefined;
  }
}

function sectionReady(section: HomeSection): boolean {
  return home.value?.section_status[section] === 'READY';
}

async function loadHome() {
  const generation = ++requestGeneration;
  currentRequest?.abort();
  clearSlowTimer();
  state.value = 'loading';
  slowRequest.value = false;
  retryAfterSeconds.value = 0;
  slowTimer = setTimeout(() => {
    if (generation === requestGeneration && state.value === 'loading') slowRequest.value = true;
  }, 800);

  const request = getStoreHome();
  currentRequest = request;
  try {
    const result = await request.promise;
    if (generation !== requestGeneration) return;
    home.value = result;
    state.value = 'ready';
  } catch (error) {
    if (generation !== requestGeneration || (error instanceof StoreApiError && error.aborted)) return;
    home.value = null;
    if (error instanceof StoreApiError && error.status === 429) {
      retryAfterSeconds.value = error.retryAfterSeconds ?? 1;
      state.value = 'rate-limited';
    } else {
      state.value = 'error';
    }
  } finally {
    if (generation === requestGeneration) {
      currentRequest = undefined;
      clearSlowTimer();
    }
  }
}

function markCategoryImageFailed(categoryId: string) {
  failedCategoryImages.value = { ...failedCategoryImages.value, [categoryId]: true };
}

onLoad(() => {
  void loadHome();
});

onUnload(() => {
  requestGeneration += 1;
  currentRequest?.abort();
  clearSlowTimer();
});
</script>

<template>
  <QxStoreShell with-bottom-nav>
    <view class="home-page">
      <header class="home-header">
        <view class="home-brand">
          <view
            class="home-brand__mark"
            aria-hidden="true"
          >
            青
          </view>
          <view class="home-brand__copy">
            <text class="home-brand__name">
              青序生活
            </text>
            <text class="home-brand__tagline">
              日常洗护，安心选购
            </text>
          </view>
        </view>
        <QxSearchTrigger @activate="openSearch()" />
      </header>

      <QxCatalogState
        v-if="state === 'loading'"
        class="home-page__state"
        kind="loading"
        :description="loadingDescription"
      />
      <QxCatalogState
        v-else-if="state !== 'ready'"
        class="home-page__state"
        :kind="pageErrorKind"
        :title="pageErrorTitle"
        description="暂时无法读取公开目录，请稍后重试。"
        action-label="重新加载"
        :retry-after-seconds="retryAfterSeconds"
        @action="loadHome"
      />

      <template v-else-if="home">
        <section
          class="home-section home-section--banner"
          aria-label="推荐活动"
        >
          <QxCatalogState
            v-if="!sectionReady('banners')"
            compact
            kind="error"
            title="推荐活动暂不可用"
            description="其他内容仍可继续浏览。"
            action-label="重新加载"
            @action="loadHome"
          />
          <QxCatalogState
            v-else-if="home.banners.length === 0"
            compact
            kind="empty"
            title="暂无推荐活动"
            description="先看看分类和商品。"
          />
          <swiper
            v-else
            class="home-banners"
            circular
            indicator-active-color="#315f50"
            indicator-color="rgba(255,255,255,0.74)"
            indicator-dots
            :autoplay="home.banners.length > 1"
            :interval="5000"
          >
            <swiper-item
              v-for="banner in home.banners"
              :key="banner.banner_id"
            >
              <button
                class="home-banner"
                :aria-label="banner.title"
                :disabled="banner.target_type === 'NONE'"
                @click="openBannerTarget(banner)"
              >
                <QxProductImage
                  :src="banner.image_url"
                  :alt="banner.title"
                  shape="landscape"
                />
                <view class="home-banner__caption">
                  <text>{{ banner.title }}</text>
                  <text
                    v-if="banner.target_type !== 'NONE'"
                    aria-hidden="true"
                  >
                    ›
                  </text>
                </view>
              </button>
            </swiper-item>
          </swiper>
        </section>

        <section
          class="home-section"
          aria-labelledby="home-categories-title"
        >
          <QxSectionHeading
            id="home-categories-title"
            title="按分类选购"
            action-label="全部分类"
            @action="openCategory()"
          />
          <QxCatalogState
            v-if="!sectionReady('categories')"
            compact
            kind="error"
            title="分类暂不可用"
            description="商品内容仍可继续浏览。"
            action-label="重新加载"
            @action="loadHome"
          />
          <QxCatalogState
            v-else-if="home.categories.length === 0"
            compact
            kind="empty"
            title="暂无可用分类"
          />
          <view
            v-else
            class="home-categories"
          >
            <button
              v-for="category in home.categories"
              :key="category.category_id"
              class="home-category"
              @click="openCategory(category.category_id)"
            >
              <view class="home-category__icon">
                <image
                  v-if="category.icon_url && !failedCategoryImages[category.category_id]"
                  :src="category.icon_url"
                  :alt="category.name"
                  mode="aspectFill"
                  @error="markCategoryImageFailed(category.category_id)"
                />
                <text
                  v-else
                  aria-hidden="true"
                >
                  {{ category.name.slice(0, 1) }}
                </text>
              </view>
              <text class="home-category__name">
                {{ category.name }}
              </text>
            </button>
          </view>
        </section>

        <section
          class="home-section"
          aria-labelledby="home-hot-title"
        >
          <QxSectionHeading
            id="home-hot-title"
            title="正在热卖"
            subtitle="按真实净销量排序"
            action-label="查看更多"
            @action="openCategory()"
          />
          <QxCatalogState
            v-if="!sectionReady('hot_products')"
            compact
            kind="error"
            title="热销商品暂不可用"
            description="不影响浏览其他分区。"
            action-label="重新加载"
            @action="loadHome"
          />
          <QxCatalogState
            v-else-if="home.hot_products.length === 0"
            compact
            kind="empty"
            title="暂无热销商品"
          />
          <view
            v-else
            class="home-products"
          >
            <QxProductCard
              v-for="product in home.hot_products"
              :key="product.product_id"
              :product="product"
              @select="openProduct"
            />
          </view>
        </section>

        <section
          class="home-section"
          aria-labelledby="home-new-title"
        >
          <QxSectionHeading
            id="home-new-title"
            title="本期新品"
            subtitle="按首次发布时间排序"
            action-label="查看更多"
            @action="openCategory()"
          />
          <QxCatalogState
            v-if="!sectionReady('new_products')"
            compact
            kind="error"
            title="新品暂不可用"
            description="不影响浏览其他分区。"
            action-label="重新加载"
            @action="loadHome"
          />
          <QxCatalogState
            v-else-if="home.new_products.length === 0"
            compact
            kind="empty"
            title="暂无新品"
          />
          <view
            v-else
            class="home-products"
          >
            <QxProductCard
              v-for="product in home.new_products"
              :key="product.product_id"
              :product="product"
              @select="openProduct"
            />
          </view>
        </section>
      </template>
    </view>

    <template #bottom>
      <QxBottomNav
        active="home"
        @select="handleBottomNavigation"
      />
    </template>
  </QxStoreShell>
</template>

<style scoped>
.home-page { min-height: 100vh; padding-bottom: 36rpx; }
.home-header {
  padding: calc(26rpx + env(safe-area-inset-top)) 28rpx 24rpx;
  border-bottom: 1px solid var(--qx-store-line);
  background: var(--qx-store-surface);
}
.home-brand { display: flex; align-items: center; gap: 18rpx; margin-bottom: 24rpx; }
.home-brand__mark {
  display: flex; width: 70rpx; height: 70rpx; flex: 0 0 auto; align-items: center;
  justify-content: center; border-radius: 12rpx; color: #ffffff;
  background: var(--qx-store-brand-strong); font-size: 34rpx; font-weight: 700;
}
.home-brand__copy, .home-brand__name, .home-brand__tagline { display: block; min-width: 0; }
.home-brand__name { font-size: 34rpx; font-weight: 750; line-height: 1.25; }
.home-brand__tagline {
  margin-top: 4rpx; color: var(--qx-store-muted); font-size: 20rpx; line-height: 1.35;
}
.home-page__state { min-height: 620rpx; }
.home-section { padding: 34rpx 28rpx 0; }
.home-section--banner { padding-top: 24rpx; }
.home-section :deep(.qx-catalog-state--compact) { margin-top: 22rpx; }
.home-banners {
  width: 100%; height: 326rpx; overflow: hidden; border-radius: 16rpx;
  background: var(--qx-store-surface-soft);
}
.home-banner {
  position: relative; width: 100%; height: 100%; overflow: hidden;
  border-radius: 16rpx; background: transparent;
}
.home-banner[disabled] { opacity: 1; }
.home-banner__caption {
  position: absolute; z-index: 4; right: 18rpx; bottom: 18rpx; left: 18rpx;
  display: flex; min-width: 0; align-items: center; justify-content: space-between;
  gap: 14rpx; padding: 14rpx 18rpx; border-radius: 10rpx; color: #ffffff;
  background: rgba(23, 35, 31, 0.78); font-size: 24rpx; font-weight: 650;
}
.home-banner__caption text:first-child {
  min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.home-categories {
  display: grid; grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 22rpx 12rpx; margin-top: 24rpx;
}
.home-category {
  display: flex; min-width: 0; min-height: 128rpx; flex-direction: column;
  align-items: center; gap: 12rpx; color: var(--qx-store-text); background: transparent;
}
.home-category__icon {
  display: flex; width: 76rpx; height: 76rpx; align-items: center; justify-content: center;
  overflow: hidden; border: 1px solid var(--qx-store-line); border-radius: 14rpx;
  color: var(--qx-store-brand); background: var(--qx-store-surface); font-size: 28rpx; font-weight: 700;
}
.home-category__icon image { width: 100%; height: 100%; }
.home-category__name {
  display: block; width: 100%; overflow: hidden; font-size: 21rpx; line-height: 1.35;
  text-align: center; text-overflow: ellipsis; white-space: nowrap;
}
.home-products {
  display: grid; grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18rpx; margin-top: 24rpx;
}
</style>
