<script setup lang="ts">
import { onLoad, onUnload } from '@dcloudio/uni-app';
import { computed, ref } from 'vue';

import { getStoreHome } from '../../api';
import { StoreApiError, type StoreCancelableRequest } from '../../api/store-client';
import QxBottomNav from '../../components/storefront/QxBottomNav.vue';
import QxCatalogState from '../../components/storefront/QxCatalogState.vue';
import QxIcon from '../../components/storefront/QxIcon.vue';
import QxPrice from '../../components/storefront/QxPrice.vue';
import QxProductImage from '../../components/storefront/QxProductImage.vue';
import QxSearchTrigger from '../../components/storefront/QxSearchTrigger.vue';
import QxSectionHeading from '../../components/storefront/QxSectionHeading.vue';
import QxStoreShell from '../../components/storefront/QxStoreShell.vue';
import type { StoreHomeData, StoreProductListItem } from '../../types/store-catalog';
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
const featuredCategories = computed(() => home.value?.categories.slice(0, 5) ?? []);
const brandEnglish = 'Z\u00A0E\u00A0F\u00A0E\u00A0N\u00A0G\u00A0\u00A0C\u00A0A\u00A0R\u00A0E';

function clearSlowTimer() {
  if (slowTimer !== undefined) {
    clearTimeout(slowTimer);
    slowTimer = undefined;
  }
}

function sectionReady(section: HomeSection): boolean {
  return home.value?.section_status[section] === 'READY';
}

function productTags(product: StoreProductListItem): string[] {
  const tags: string[] = [];
  if (product.category.name) tags.push(product.category.name);
  if (product.subtitle?.trim()) tags.push(product.subtitle.trim());
  return tags.slice(0, 2);
}

function hotRankLabel(product: StoreProductListItem, index: number): string {
  const sold = Math.max(0, product.net_sales_count);
  const rank = `TOP ${index + 1}`;
  return sold > 0 ? `${rank} · 已售${sold}` : rank;
}

function newKicker(product: StoreProductListItem): string {
  return product.subtitle?.trim() || product.brand.name;
}

function newCorner(product: StoreProductListItem): string {
  if (product.is_new) return '新品';
  if (product.is_hot) return '热销';
  return '';
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
      <view
        class="home-header-slot"
        aria-hidden="true"
      />
      <view
        class="home-header"
        aria-label="泽枫洗护"
      >
        <view class="home-header__brand">
          <view class="home-brand">
            <view
              class="home-brand__mark"
              aria-hidden="true"
            >
              <image
                class="home-brand__logo"
                src="/static/brand/zefeng-care.jpg"
                mode="aspectFill"
              />
            </view>
            <view class="home-brand__copy">
              <view class="home-brand__title-row">
                <text class="home-brand__name">
                  泽枫洗护
                </text>
                <text class="home-brand__salon">
                  SALON
                </text>
              </view>
              <text class="home-brand__en">
                {{ brandEnglish }}
              </text>
            </view>
          </view>
        </view>
        <view class="home-header__search">
          <QxSearchTrigger
            variant="pill"
            label="搜索沙龙发膜、生姜控油、鱼子酱精油..."
            hint="专研推荐"
            @activate="openSearch()"
          />
        </view>
      </view>

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

      <view
        v-else-if="home"
        class="home-main"
      >
        <section
          class="home-section"
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
          <view
            v-else-if="home.banners.length === 0"
            class="home-hero home-hero--empty"
          >
            <text class="home-hero__chip">
              SALON CARE
            </text>
            <text class="home-hero__title">
              暂无推荐活动
            </text>
            <text class="home-hero__desc">
              先看看分类和商品
            </text>
          </view>
          <swiper
            v-else
            class="home-banners"
            circular
            indicator-active-color="#C5A059"
            indicator-color="rgba(255,255,255,0.42)"
            indicator-dots
            :autoplay="home.banners.length > 1"
            :interval="5000"
          >
            <swiper-item
              v-for="banner in home.banners"
              :key="banner.banner_id"
            >
              <button
                class="home-hero"
                :class="{ 'home-hero--static': banner.target_type === 'NONE' }"
                :aria-label="banner.title"
                :disabled="banner.target_type === 'NONE'"
                @click="openBannerTarget(banner)"
              >
                <QxProductImage
                  class="home-hero__photo"
                  :src="banner.image_url"
                  :alt="banner.title"
                  shape="fill"
                />
                <view class="home-hero__veil" />
                <view class="home-hero__body">
                  <text class="home-hero__chip">
                    SALON CARE
                  </text>
                  <text class="home-hero__title">
                    {{ banner.title }}
                  </text>
                  <view
                    v-if="banner.target_type !== 'NONE'"
                    class="home-hero__cta"
                  >
                    <text>立即查看</text>
                    <QxIcon
                      name="chevron"
                      :size="28"
                      color="#2B231B"
                    />
                  </view>
                </view>
              </button>
            </swiper-item>
          </swiper>
        </section>

        <section
          class="home-panel"
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
            description="分类上架后会显示在这里。"
          />
          <view
            v-else
            class="home-categories"
          >
            <button
              v-for="category in featuredCategories"
              :key="category.category_id"
              class="home-category"
              hover-class="home-category--pressed"
              @click="openCategory(category.category_id)"
            >
              <view class="home-category__icon">
                <image
                  v-if="category.icon_url && !failedCategoryImages[category.category_id]"
                  class="home-category__icon-img"
                  :src="category.icon_url"
                  :alt="category.name"
                  mode="aspectFill"
                  @error="markCategoryImageFailed(category.category_id)"
                />
                <text
                  v-else
                  class="home-category__glyph"
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
            badge="TOP 榜"
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
            description="热销商品上架后会显示在这里。"
          />
          <view
            v-else
            class="home-hot-list"
          >
            <view
              v-for="(product, index) in home.hot_products"
              :key="product.product_id"
              class="home-hot-card"
              :class="{ 'home-hot-card--sold-out': !product.is_salable }"
              hover-class="home-card--pressed"
              :aria-label="product.name"
              @click="openProduct(product.product_id)"
            >
              <text
                class="home-hot-card__rank"
                :class="index === 0 ? 'home-hot-card__rank--gold' : 'home-hot-card__rank--quiet'"
              >
                {{ hotRankLabel(product, index) }}
              </text>
              <view class="home-hot-card__media">
                <QxProductImage
                  :src="product.primary_image?.url ?? null"
                  :alt="product.name"
                  shape="fill"
                />
              </view>
              <view class="home-hot-card__body">
                <view class="home-hot-card__copy">
                  <text class="home-hot-card__name">
                    {{ product.name }}
                  </text>
                  <view
                    v-if="productTags(product).length > 0"
                    class="home-hot-card__tags"
                  >
                    <text
                      v-for="tag in productTags(product)"
                      :key="tag"
                      class="home-hot-card__tag"
                    >
                      {{ tag }}
                    </text>
                  </view>
                </view>
                <view class="home-hot-card__footer">
                  <QxPrice
                    class="home-hot-card__price"
                    :amount="product.minimum_active_price"
                    :is-salable="product.is_salable"
                    :show-availability="false"
                    size="medium"
                  />
                  <view
                    class="home-hot-card__add"
                    aria-hidden="true"
                  >
                    <QxIcon
                      name="plus"
                      :size="32"
                      color="#28221D"
                    />
                  </view>
                </view>
              </view>
            </view>
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
            badge="NEW"
            badge-tone="quiet"
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
            description="新品上架后会显示在这里。"
          />
          <view
            v-else
            class="home-new-grid"
          >
            <view
              v-for="product in home.new_products"
              :key="product.product_id"
              class="home-new-card"
              :class="{ 'home-new-card--sold-out': !product.is_salable }"
              hover-class="home-card--pressed"
              :aria-label="product.name"
              @click="openProduct(product.product_id)"
            >
              <view class="home-new-card__media">
                <text
                  v-if="newCorner(product)"
                  class="home-new-card__corner"
                >
                  {{ newCorner(product) }}
                </text>
                <QxProductImage
                  :src="product.primary_image?.url ?? null"
                  :alt="product.name"
                  shape="square"
                />
              </view>
              <text
                v-if="newKicker(product)"
                class="home-new-card__kicker"
              >
                {{ newKicker(product) }}
              </text>
              <text class="home-new-card__name">
                {{ product.name }}
              </text>
              <view class="home-new-card__footer">
                <QxPrice
                  class="home-new-card__price"
                  :amount="product.minimum_active_price"
                  :is-salable="product.is_salable"
                  :show-availability="false"
                  size="small"
                />
                <view
                  class="home-new-card__add"
                  aria-hidden="true"
                >
                  <QxIcon
                    name="plus"
                    :size="28"
                    color="#8A6A24"
                  />
                </view>
              </view>
            </view>
          </view>
        </section>

        <view class="home-footnote">
          <view class="home-footnote__promises">
            <text>沙龙级专研配方</text>
            <text class="home-footnote__dot">
              •
            </text>
            <text>无硅油低敏呵护</text>
            <text class="home-footnote__dot">
              •
            </text>
            <text>官方正品保障</text>
          </view>
          <text class="home-footnote__en">
            ZEFENG CARE LUXURY SALON SYSTEM
          </text>
        </view>
      </view>
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
.home-page {
  min-height: 100%;
  background: #fbf9f5;
}

.home-header-slot {
  height: calc(var(--qx-nav-bar, 96rpx) + 108rpx);
}

.home-header {
  position: fixed;
  z-index: 20;
  top: 0;
  right: 0;
  left: 0;
  width: 100%;
  border-bottom: 1px solid rgba(239, 234, 225, 0.6);
  background: #fbf9f5;
  box-shadow: 0 8rpx 40rpx -4rpx rgba(197, 160, 89, 0.12);
}

/* #ifndef MP-WEIXIN */
.home-header {
  max-width: 414px;
  margin: 0 auto;
}
/* #endif */

.home-header__brand {
  box-sizing: border-box;
  display: flex;
  min-height: var(--qx-nav-bar, 96rpx);
  align-items: center;
  padding-top: var(--qx-status-bar, 8rpx);
  padding-right: var(--qx-capsule-right, 48rpx);
  padding-left: var(--qx-capsule-gap, 48rpx);
}

.home-brand {
  display: flex;
  min-width: 0;
  flex: 1;
  align-items: center;
  gap: 16rpx;
}

.home-brand__mark {
  width: 72rpx;
  height: 72rpx;
  flex: 0 0 auto;
  overflow: hidden;
  border: 1px solid #e7d6be;
  border-radius: 50%;
  background: linear-gradient(135deg, #fff8ed 0%, #fdf3e3 48%, #faf0dc 100%);
  box-shadow: 0 4rpx 10rpx rgba(197, 160, 89, 0.12);
}

.home-brand__logo {
  width: 128rpx;
  height: 128rpx;
  margin-top: -12rpx;
  margin-left: -28rpx;
}

.home-brand__copy {
  min-width: 0;
}

.home-brand__title-row {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8rpx;
}

.home-brand__name {
  overflow: hidden;
  color: #2b2520;
  font-size: 34rpx;
  font-weight: 700;
  line-height: 1.15;
  letter-spacing: 2rpx;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.home-brand__salon {
  flex: 0 0 auto;
  padding: 2rpx 8rpx;
  border: 1px solid rgba(197, 160, 89, 0.28);
  border-radius: 6rpx;
  color: #9f7c38;
  background: rgba(197, 160, 89, 0.14);
  font-size: 16rpx;
  font-weight: 600;
  line-height: 1.3;
}

.home-brand__en {
  display: block;
  margin-top: 4rpx;
  overflow: hidden;
  color: #8e857e;
  font-size: 16rpx;
  font-weight: 500;
  line-height: 1.2;
  letter-spacing: 0.08em;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.home-header__search {
  padding: 16rpx 32rpx 20rpx;
}

.home-page__state {
  min-height: 620rpx;
}

.home-main {
  display: flex;
  flex-direction: column;
  gap: 40rpx;
  padding: 24rpx 32rpx 48rpx;
}

.home-section,
.home-panel {
  min-width: 0;
}

.home-panel {
  padding: 32rpx 24rpx 28rpx;
  border: 1px solid #efeae1;
  border-radius: 32rpx;
  background: #ffffff;
  box-shadow: 0 16rpx 48rpx -8rpx rgba(197, 160, 89, 0.08), 0 4rpx 12rpx -2rpx rgba(43, 37, 32, 0.04);
}

.home-section :deep(.qx-catalog-state--compact),
.home-panel :deep(.qx-catalog-state--compact) {
  margin-top: 20rpx;
  background: #f7f2e9;
  box-shadow: none;
}

.home-panel :deep(.qx-catalog-state--compact) {
  padding-right: 8rpx;
  padding-left: 8rpx;
}

.home-banners {
  width: 100%;
  height: 352rpx;
  overflow: hidden;
  border-radius: 32rpx;
}

.home-hero {
  position: relative;
  display: flex;
  width: 100%;
  height: 352rpx;
  overflow: hidden;
  border: 1px solid rgba(197, 160, 89, 0.32);
  border-radius: 32rpx;
  color: #fdf9f3;
  background:
    radial-gradient(circle at 92% 88%, rgba(197, 160, 89, 0.28), transparent 42%),
    radial-gradient(circle at 8% 0%, rgba(250, 240, 220, 0.14), transparent 36%),
    linear-gradient(135deg, #2d2621 0%, #3c332b 48%, #1e1916 100%);
  text-align: left;
  box-shadow: 0 16rpx 48rpx -8rpx rgba(197, 160, 89, 0.08), 0 4rpx 12rpx -2rpx rgba(43, 37, 32, 0.04);
}

.home-hero--empty {
  flex-direction: column;
  align-items: flex-start;
  justify-content: flex-end;
  padding: 40rpx 36rpx;
}

.home-hero--static {
  opacity: 1;
}

.home-hero__photo {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 1;
  width: 100%;
  height: 100%;
  opacity: 0.42;
}

.home-hero__veil {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 2;
  background: linear-gradient(180deg, rgba(30, 25, 22, 0.12) 0%, rgba(30, 25, 22, 0.72) 100%);
}

.home-hero__body {
  position: relative;
  z-index: 3;
  display: flex;
  width: 100%;
  height: 100%;
  flex-direction: column;
  align-items: flex-start;
  justify-content: flex-end;
  padding: 36rpx 32rpx 40rpx;
}

.home-hero__chip {
  display: inline-flex;
  padding: 4rpx 16rpx;
  border-radius: 999rpx;
  color: #ffffff;
  background: linear-gradient(90deg, #d7b675 0%, #b08940 100%);
  font-size: 20rpx;
  font-weight: 600;
  line-height: 1.4;
  letter-spacing: 0.04em;
}

.home-hero__title {
  display: -webkit-box;
  max-width: 100%;
  margin-top: 16rpx;
  overflow: hidden;
  color: #fdf9f3;
  font-size: 40rpx;
  font-weight: 700;
  line-height: 1.25;
  letter-spacing: 1rpx;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.home-hero__desc {
  display: block;
  max-width: 420rpx;
  margin-top: 10rpx;
  color: #dfd7ce;
  font-size: 24rpx;
  font-weight: 400;
  line-height: 1.45;
}

.home-hero__cta {
  display: flex;
  align-items: center;
  gap: 6rpx;
  margin-top: 24rpx;
  padding: 12rpx 28rpx;
  border-radius: 999rpx;
  color: #2b231b;
  background: linear-gradient(135deg, #dfca9e 0%, #c5a059 50%, #9f7c38 100%);
  font-size: 24rpx;
  font-weight: 700;
  line-height: 1.2;
  box-shadow: 0 10rpx 24rpx rgba(159, 124, 56, 0.28);
}

.home-categories {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 16rpx 8rpx;
  margin-top: 24rpx;
}

.home-category {
  display: flex;
  min-width: 0;
  flex-direction: column;
  align-items: center;
  gap: 12rpx;
  color: #2b2520;
  background: transparent;
}

.home-category--pressed {
  opacity: 0.72;
}

.home-category__icon {
  display: flex;
  width: 96rpx;
  height: 96rpx;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border: 1px solid #e9dcc8;
  border-radius: 32rpx;
  background: linear-gradient(135deg, #fff9f0 0%, #f3e7d3 100%);
}

.home-category__icon-img {
  width: 100%;
  height: 100%;
}

.home-category__glyph {
  color: #9f7c38;
  font-size: 32rpx;
  font-weight: 600;
  line-height: 1;
}

.home-category__name {
  display: block;
  width: 100%;
  overflow: hidden;
  font-size: 22rpx;
  font-weight: 500;
  line-height: 1.35;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.home-hot-list {
  display: flex;
  flex-direction: column;
  gap: 20rpx;
  margin-top: 24rpx;
}

.home-hot-card,
.home-new-card {
  overflow: hidden;
  border: 1px solid #efeae1;
  border-radius: 32rpx;
  background: #ffffff;
  box-shadow: 0 16rpx 48rpx -8rpx rgba(197, 160, 89, 0.08), 0 4rpx 12rpx -2rpx rgba(43, 37, 32, 0.04);
}

.home-card--pressed {
  opacity: 0.88;
}

.home-hot-card {
  position: relative;
  display: flex;
  min-width: 0;
  gap: 20rpx;
  padding: 24rpx;
}

.home-hot-card--sold-out,
.home-new-card--sold-out {
  opacity: 0.72;
}

.home-hot-card__rank {
  position: absolute;
  z-index: 3;
  top: 0;
  left: 0;
  padding: 4rpx 16rpx 6rpx;
  border-radius: 0 0 16rpx 0;
  color: #ffffff;
  font-size: 18rpx;
  font-weight: 700;
  line-height: 1.3;
}

.home-hot-card__rank--gold {
  background: #c5a059;
}

.home-hot-card__rank--quiet {
  background: #a68a56;
}

.home-hot-card__media {
  position: relative;
  width: 192rpx;
  height: 192rpx;
  flex: 0 0 auto;
  overflow: hidden;
  border: 1px solid rgba(239, 234, 225, 0.8);
  border-radius: 24rpx;
  background: linear-gradient(180deg, #f7f4ef 0%, #ede7dc 100%);
}

.home-hot-card__body {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  justify-content: space-between;
}

.home-hot-card__name,
.home-new-card__name,
.home-new-card__kicker {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
}

.home-hot-card__name {
  color: #2b2520;
  font-size: 24rpx;
  font-weight: 700;
  line-height: 1.4;
  -webkit-line-clamp: 2;
}

.home-hot-card__tags {
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  gap: 8rpx;
  margin-top: 10rpx;
}

.home-hot-card__tag {
  max-width: 100%;
  overflow: hidden;
  padding: 2rpx 10rpx;
  border-radius: 8rpx;
  color: #9f7c38;
  background: rgba(197, 160, 89, 0.12);
  font-size: 20rpx;
  font-weight: 500;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.home-hot-card__tag:nth-child(2) {
  color: #8e857e;
  background: #f3f0ea;
}

.home-hot-card__footer,
.home-new-card__footer {
  display: flex;
  min-width: 0;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12rpx;
}

.home-hot-card__footer {
  margin-top: 16rpx;
}

.home-hot-card__price :deep(.qx-price),
.home-hot-card__price :deep(.qx-price__amount) {
  color: #a53424;
}

.home-hot-card__add,
.home-new-card__add {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
}

.home-hot-card__add {
  width: 64rpx;
  height: 64rpx;
  border-radius: 50%;
  background: linear-gradient(135deg, #dfca9e 0%, #c5a059 50%, #9f7c38 100%);
  box-shadow: 0 8rpx 16rpx rgba(159, 124, 56, 0.24);
}

.home-new-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 24rpx;
  margin-top: 24rpx;
}

.home-new-card {
  display: flex;
  min-width: 0;
  flex-direction: column;
  padding: 24rpx;
}

.home-new-card__media {
  position: relative;
  width: 100%;
  margin-bottom: 16rpx;
  overflow: hidden;
  border-radius: 24rpx;
  background: #f6f2ea;
}

.home-new-card__corner {
  position: absolute;
  z-index: 3;
  top: 12rpx;
  left: 12rpx;
  padding: 4rpx 12rpx;
  border-radius: 8rpx;
  color: #f7eacd;
  background: #2b2520;
  font-size: 16rpx;
  font-weight: 600;
  letter-spacing: 0.08em;
}

.home-new-card__kicker {
  color: #9f7c38;
  font-size: 18rpx;
  font-weight: 600;
  line-height: 1.35;
  -webkit-line-clamp: 1;
}

.home-new-card__name {
  margin-top: 6rpx;
  color: #2b2520;
  font-size: 24rpx;
  font-weight: 700;
  line-height: 1.35;
  -webkit-line-clamp: 2;
}

.home-new-card__footer {
  margin-top: 20rpx;
  padding-top: 16rpx;
  border-top: 1px solid rgba(239, 234, 225, 0.8);
}

.home-new-card__price :deep(.qx-price),
.home-new-card__price :deep(.qx-price__amount) {
  color: #2b2520;
}

.home-new-card__add {
  width: 48rpx;
  height: 48rpx;
  border: 1px solid rgba(197, 160, 89, 0.4);
  border-radius: 50%;
  background: #fbf9f5;
}

.home-footnote {
  padding: 16rpx 8rpx 8rpx;
  border-top: 1px solid rgba(239, 234, 225, 0.9);
  text-align: center;
}

.home-footnote__promises {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 10rpx;
  color: #8e857e;
  font-size: 20rpx;
  line-height: 1.4;
}

.home-footnote__dot {
  color: #c5a059;
}

.home-footnote__en {
  display: block;
  margin-top: 12rpx;
  color: rgba(142, 133, 126, 0.72);
  font-size: 18rpx;
  font-weight: 500;
  letter-spacing: 0.18em;
}
</style>
