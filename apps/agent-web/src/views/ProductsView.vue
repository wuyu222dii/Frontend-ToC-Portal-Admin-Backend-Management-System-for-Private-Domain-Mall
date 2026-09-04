<script setup lang="ts">
import { Link, Refresh, Search } from '@element-plus/icons-vue';
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';

import PageState from '../components/PageState.vue';
import PromotionDialog from '../components/PromotionDialog.vue';
import AgentShell from '../layouts/AgentShell.vue';
import type { AgentProduct, AgentProductList } from '../services/agent';
import { getAgentProduct, getAgentProductFilterOptions, listAgentProducts } from '../services/agent';
import { formatMoney, formatRate, handleAuthError, loadErrorMessage, ruleSourceLabel } from '../utils/presentation';

const router = useRouter();
const keyword = ref('');
const recommended = ref<'all' | 'yes'>('all');
const brandId = ref('');
const categoryId = ref('');
const brandOptions = ref<Array<{ id: string; name: string }>>([]);
const categoryOptions = ref<Array<{ id: string; name: string }>>([]);
const filtersLoaded = ref(false);
const page = ref(1);
const data = ref<AgentProductList>();
const detail = ref<AgentProduct>();
const selected = ref<AgentProduct>();
const drawerOpen = ref(false);
const promotionOpen = ref(false);
const loading = ref(true);
const detailLoading = ref(false);
const errorMessage = ref('');
const detailError = ref('');
let listSeq = 0;
let detailSeq = 0;
let listController: AbortController | undefined;
let detailController: AbortController | undefined;

async function load(): Promise<void> {
  const sequence = ++listSeq;
  listController?.abort();
  listController = new AbortController();
  loading.value = true;
  errorMessage.value = '';
  try {
    const [response, filters] = await Promise.all([
      listAgentProducts({ page: page.value, pageSize: 20, keyword: keyword.value.trim() || undefined, brandId: brandId.value || undefined, categoryId: categoryId.value || undefined, recommended: recommended.value === 'yes' ? true : undefined }, listController.signal),
      filtersLoaded.value ? undefined : getAgentProductFilterOptions(listController.signal),
    ]);
    if (sequence === listSeq) {
      data.value = response;
      if (filters) {
        brandOptions.value = filters.brands.map((item) => ({ id: item.brand_id, name: item.name }));
        categoryOptions.value = filters.categories.map((item) => ({ id: item.category_id, name: item.name }));
        filtersLoaded.value = true;
      }
    }
  } catch (error) {
    if (sequence !== listSeq || (error instanceof DOMException && error.name === 'AbortError')) return;
    if (await handleAuthError(error, router)) return;
    errorMessage.value = loadErrorMessage(error, '授权商品');
  } finally { if (sequence === listSeq) loading.value = false; }
}

async function openDetail(product: AgentProduct): Promise<void> {
  selected.value = product;
  drawerOpen.value = true;
  detail.value = undefined;
  detailError.value = '';
  detailLoading.value = true;
  const sequence = ++detailSeq;
  detailController?.abort();
  detailController = new AbortController();
  try {
    const response = await getAgentProduct(product.product_id, detailController.signal);
    if (sequence === detailSeq) detail.value = response;
  } catch (error) {
    if (sequence !== detailSeq || (error instanceof DOMException && error.name === 'AbortError')) return;
    if (await handleAuthError(error, router)) return;
    detailError.value = loadErrorMessage(error, '商品详情');
  } finally { if (sequence === detailSeq) detailLoading.value = false; }
}

function promote(product: AgentProduct): void { selected.value = product; promotionOpen.value = true; }
function search(): void { page.value = 1; void load(); }
onMounted(load);
onBeforeUnmount(() => { listSeq += 1; detailSeq += 1; listController?.abort(); detailController?.abort(); });
</script>

<template>
  <AgentShell>
    <header class="page-heading">
      <div><h1>推广中心</h1><p>这里只展示当前已上架且已授权给您的商品。</p></div>
      <div class="page-actions"><el-button data-testid="products-refresh" :icon="Refresh" :loading="loading" @click="load" /><el-button data-testid="agent-primary-action" :icon="Link" type="primary" @click="selected = undefined; promotionOpen = true">推广商城</el-button></div>
    </header>
    <div class="notice" style="margin-bottom: 18px">白名单只限制可推广商品；已绑定客户购买全店商品仍按统一规则计佣。</div>
    <section class="panel">
      <div class="filter-bar">
        <el-input v-model="keyword" data-testid="products-keyword" clearable placeholder="商品名称或编码" @keyup.enter="search" />
        <el-select v-model="brandId" data-testid="products-brand" clearable placeholder="品牌"><el-option v-for="option in brandOptions" :key="option.id" :label="option.name" :value="option.id" /></el-select>
        <el-select v-model="categoryId" data-testid="products-category" clearable placeholder="分类"><el-option v-for="option in categoryOptions" :key="option.id" :label="option.name" :value="option.id" /></el-select>
        <el-select v-model="recommended" data-testid="products-recommended"><el-option label="全部商品" value="all" /><el-option label="推荐商品" value="yes" /></el-select>
        <div class="filter-actions"><el-button :icon="Search" type="primary" @click="search">查询</el-button></div>
      </div>
      <PageState testid="products-state" :empty="!data?.items.length" empty-message="暂无可推广的授权商品" :error="errorMessage" :loading="loading" @retry="load">
        <div class="product-grid">
          <article v-for="product in data?.items" :key="product.product_id" class="product-card">
            <img v-if="product.primary_image" :src="product.primary_image.url" :alt="product.name">
            <div v-else class="empty-inline">暂无商品图</div>
            <div class="product-card-body">
              <h2>{{ product.name }}</h2><p>{{ product.brand.name }} · {{ product.category.name }}</p><p>{{ product.subtitle || product.spu_code }}</p>
              <div class="product-card-footer"><strong>{{ product.skus.length }} 个可推广规格</strong><span>逐规格查看价格与佣金</span></div>
              <div class="dialog-actions" style="margin-top: 12px"><el-button :data-testid="`product-detail-${product.product_id}`" @click="openDetail(product)">查看详情</el-button><el-button :data-testid="`product-promote-${product.product_id}`" type="primary" @click="promote(product)">推广</el-button></div>
            </div>
          </article>
        </div>
        <div class="pagination-row"><el-pagination v-if="(data?.pagination.total ?? 0) > 20" v-model:current-page="page" :page-size="20" :total="data?.pagination.total" layout="prev, pager, next" @current-change="load" /></div>
      </PageState>
    </section>
    <el-drawer v-model="drawerOpen" data-testid="product-detail" destroy-on-close size="520px" title="商品推广详情">
      <PageState testid="product-detail-state" :error="detailError" :loading="detailLoading" @retry="selected && openDetail(selected)">
        <template v-if="detail">
          <dl class="detail-list"><dt>商品</dt><dd>{{ detail.name }}</dd><dt>品牌 / 分类</dt><dd>{{ detail.brand.name }} / {{ detail.category.name }}</dd><dt>商品编码</dt><dd>{{ detail.spu_code }}</dd></dl>
              <section class="detail-section"><h3>可推广规格</h3><div v-for="sku in detail.skus" :key="sku.sku_id" class="panel" style="margin-top: 10px"><div class="record-head"><strong>{{ sku.name }}</strong><span class="status-pill" :class="{ success: sku.current_estimated_rate !== '0.0000' }">{{ sku.current_estimated_rate === '0.0000' ? '无佣金' : formatRate(sku.current_estimated_rate) }}</span></div><p>{{ formatMoney(sku.retail_price) }} · 单件预计 {{ formatMoney(sku.estimated_commission_per_unit) }}</p><small>{{ sku.commission_label || '预计佣金，以支付时规则为准' }} · {{ ruleSourceLabel(sku.rule_source) }}</small></div></section>
          <el-button style="width: 100%; margin-top: 20px" type="primary" @click="promote(detail)">生成此商品推广素材</el-button>
        </template>
      </PageState>
    </el-drawer>
    <PromotionDialog v-model="promotionOpen" :target-id="selected?.product_id" :target-name="selected?.name || '青序生活商城'" :target-type="selected ? 'PRODUCT' : 'STOREFRONT'" />
  </AgentShell>
</template>
