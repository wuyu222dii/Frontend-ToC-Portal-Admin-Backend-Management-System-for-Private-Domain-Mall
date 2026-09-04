<script setup lang="ts">
import { Delete, Edit, Plus, Refresh, Search, View } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import HighRiskCommandDialog from '../../components/b13/HighRiskCommandDialog.vue';
import AdminShell from '../../layouts/AdminShell.vue';
import { AdminApiError } from '../../services/admin-api';
import {
  confirmAdminCommissionRules,
  getAdminCommissionRules,
  getAdminCommissionRuleVersion,
  getAdminOrderCommissionExplanation,
  listAdminCommissionRuleSkus,
  listAdminCommissionRuleVersions,
  previewAdminCommissionRules,
} from '../../services/admin-commissions';
import { authSession } from '../../stores/auth-session';
import type {
  CommissionRuleInput,
  CommissionRules,
  CommissionRuleSkuResult,
  CommissionRuleVersion,
  CommissionRuleVersionResult,
  HighRiskPreview,
  OrderCommissionExplanation,
} from '../../types/admin-b13';
import { formatChinaDateTime } from '../../utils/time';

type RuleChange = CommissionRuleInput['changes'][number];

const route = useRoute();
const router = useRouter();
const current = ref<CommissionRules | null>(null);
const skuResult = ref<CommissionRuleSkuResult | null>(null);
const versions = ref<CommissionRuleVersionResult | null>(null);
const versionDetail = ref<CommissionRuleVersion | null>(null);
const versionDetailOpen = ref(false);
const versionDetailLoading = ref(false);
const versionDetailError = ref('');
const versionsLoading = ref(false);
const versionsError = ref('');
const explanation = ref<OrderCommissionExplanation | null>(null);
const explanationLoading = ref(false);
const explanationError = ref('');
const loading = ref(false);
const errorMessage = ref('');
const keyword = ref('');
const categoryId = ref('');
const skuPage = ref(1);
const skuPageSize = 20;
const versionPage = ref(1);
const versionPageSize = 20;
const orderId = ref(typeof route.query.order_id === 'string' ? route.query.order_id : '');
const publishOpen = ref(false);
const changes = ref<RuleChange[]>([]);
const editor = reactive({ configuredRate: '', inherit: false, targetId: '', targetType: 'PLATFORM' as RuleChange['target_type'] });
let sequence = 0;
let versionsSequence = 0;
let controller: AbortController | null = null;
let versionsController: AbortController | null = null;
let versionController: AbortController | null = null;
let explanationController: AbortController | null = null;

const editorValid = computed(() => {
  if (editor.targetType !== 'PLATFORM' && !/^[0-9A-HJKMNP-TV-Z]{26}$/.test(editor.targetId.trim())) return false;
  if (editor.inherit) return editor.targetType !== 'PLATFORM';
  if (!/^(?:0|[1-9][0-9]?|100)(?:\.\d{1,4})?$/.test(editor.configuredRate.trim())) return false;
  return Number(editor.configuredRate) <= 100;
});
const orderIdValid = computed(() => /^[0-9A-HJKMNP-TV-Z]{26}$/.test(orderId.value.trim()));

function sourceLabel(source: string): string {
  return ({ CATEGORY: '分类覆盖', PLATFORM: '平台默认', SKU: 'SKU 覆盖' } as Record<string, string>)[source] ?? source;
}

function categoryLabel(categoryIdValue: string): string {
  return current.value?.categories.find((item) => item.category_id === categoryIdValue)?.category_name ?? categoryIdValue;
}

async function handleExpired(error: unknown): Promise<boolean> {
  if (!(error instanceof AdminApiError) || error.status !== 401) return false;
  ++sequence;
  ++versionsSequence;
  controller?.abort();
  versionsController?.abort();
  versionController?.abort();
  explanationController?.abort();
  publishOpen.value = false;
  versionDetailOpen.value = false;
  authSession.clearSession();
  await router.replace('/login');
  return true;
}

async function fetchRuleSnapshot(signal: AbortSignal): Promise<{
  rule: CommissionRules | null;
  skuList: CommissionRuleSkuResult | null;
}> {
  const rule = await getAdminCommissionRules(signal).catch((error: unknown) => {
    if (error instanceof AdminApiError && error.status === 404) return null;
    throw error;
  });
  const skuList = rule
    ? await listAdminCommissionRuleSkus({
        page: skuPage.value,
        pageSize: skuPageSize,
        ...(categoryId.value ? { categoryId: categoryId.value } : {}),
        ...(keyword.value.trim() ? { keyword: keyword.value.trim() } : {}),
      }, signal)
    : null;
  return { rule, skuList };
}

function snapshotMatches(snapshot: { rule: CommissionRules | null; skuList: CommissionRuleSkuResult | null }): boolean {
  if (snapshot.rule === null) return snapshot.skuList === null;
  return snapshot.skuList !== null &&
    snapshot.rule.version_id === snapshot.skuList.version_id &&
    snapshot.rule.version_no === snapshot.skuList.version_no;
}

async function load(): Promise<void> {
  const currentSequence = ++sequence;
  controller?.abort();
  const active = new AbortController();
  controller = active;
  loading.value = true;
  errorMessage.value = '';
  try {
    let snapshot = await fetchRuleSnapshot(active.signal);
    if (!snapshotMatches(snapshot)) snapshot = await fetchRuleSnapshot(active.signal);
    if (currentSequence !== sequence) return;
    if (!snapshotMatches(snapshot)) {
      current.value = null;
      skuResult.value = null;
      errorMessage.value = '佣金规则版本正在变化，无法安全展示，请稍后重试';
      return;
    }
    current.value = snapshot.rule;
    skuResult.value = snapshot.skuList;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    if (currentSequence !== sequence || await handleExpired(error)) return;
    current.value = null;
    skuResult.value = null;
    errorMessage.value = error instanceof AdminApiError && error.status === 403
      ? '当前账号无权访问佣金规则'
      : error instanceof AdminApiError && error.status === 0
        ? '网络连接失败，请检查网络后重试'
        : '佣金规则加载失败，请稍后重试';
  } finally {
    if (currentSequence === sequence) {
      loading.value = false;
      controller = null;
    }
  }
}

async function loadVersions(): Promise<void> {
  const currentSequence = ++versionsSequence;
  versionsController?.abort();
  const active = new AbortController();
  versionsController = active;
  versionsLoading.value = true;
  versionsError.value = '';
  try {
    const result = await listAdminCommissionRuleVersions({
      page: versionPage.value,
      pageSize: versionPageSize,
    }, active.signal);
    if (currentSequence !== versionsSequence) return;
    versions.value = result;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    if (currentSequence !== versionsSequence || await handleExpired(error)) return;
    versions.value = null;
    versionsError.value = error instanceof AdminApiError && error.status === 403
      ? '当前账号无权查看佣金规则历史'
      : '佣金规则历史加载失败，请稍后重试';
  } finally {
    if (currentSequence === versionsSequence) {
      versionsLoading.value = false;
      versionsController = null;
    }
  }
}

function refresh(): Promise<void> {
  return Promise.all([load(), loadVersions()]).then(() => undefined);
}

function searchSkus(): void {
  skuPage.value = 1;
  void load();
}

function changeSkuPage(page: number): void {
  skuPage.value = page;
  void load();
}

function changeVersionPage(page: number): void {
  versionPage.value = page;
  void loadVersions();
}

function editTarget(targetType: RuleChange['target_type'], targetId: string | null, configuredRate: string | null): void {
  editor.targetType = targetType;
  editor.targetId = targetId ?? '';
  editor.configuredRate = configuredRate ?? '';
  editor.inherit = false;
  requestAnimationFrame(() => document.querySelector('.rule-editor')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
}

function targetLabel(change: RuleChange): string {
  if (change.target_type === 'PLATFORM') return '全平台';
  if (change.target_type === 'CATEGORY') {
    return current.value?.categories.find((item) => item.category_id === change.target_id)?.category_name
      ?? change.target_id
      ?? '未知分类';
  }
  const sku = skuResult.value?.items.find((item) => item.sku_id === change.target_id);
  return sku ? `${sku.sku_code} · ${sku.product_name}` : change.target_id ?? '未知 SKU';
}

function addChange(): void {
  if (!editorValid.value) return;
  const change: RuleChange = {
    configured_rate: editor.inherit ? null : Number(editor.configuredRate).toFixed(4),
    target_id: editor.targetType === 'PLATFORM' ? null : editor.targetId.trim(),
    target_type: editor.targetType,
  };
  const index = changes.value.findIndex((item) => item.target_type === change.target_type && item.target_id === change.target_id);
  if (index >= 0) changes.value.splice(index, 1, change);
  else changes.value.push(change);
  editor.configuredRate = '';
  editor.inherit = false;
  editor.targetId = '';
}

function changeTargetType(): void {
  editor.inherit = false;
  editor.targetId = '';
  editor.configuredRate = editor.targetType === 'PLATFORM' ? current.value?.platform_rate ?? '' : '';
}

function input(reason: string): CommissionRuleInput {
  return { base_version_id: current.value?.version_id ?? null, changes: changes.value.map((change) => ({ ...change })), reason };
}

function previewPublish(reason: string, key: string, signal: AbortSignal): Promise<HighRiskPreview> {
  return previewAdminCommissionRules(input(reason), key, signal);
}

function confirmPublish(reason: string, preview: HighRiskPreview, key: string, signal: AbortSignal): Promise<unknown> {
  return confirmAdminCommissionRules(input(reason), preview, key, signal);
}

async function published(): Promise<void> {
  changes.value = [];
  versionPage.value = 1;
  ElMessage.success('新佣金规则版本已发布');
  await refresh();
}

async function conflict(): Promise<void> {
  publishOpen.value = false;
  await load();
  ElMessage.warning('规则基线已变化，已刷新当前有效版本；请重新核对待发布变更');
}

async function authExpired(error: AdminApiError): Promise<void> { await handleExpired(error); }

async function openVersionDetail(versionId: string): Promise<void> {
  versionController?.abort();
  const active = new AbortController();
  versionController = active;
  versionDetail.value = null;
  versionDetailError.value = '';
  versionDetailLoading.value = true;
  versionDetailOpen.value = true;
  try {
    versionDetail.value = await getAdminCommissionRuleVersion(versionId, active.signal);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    if (await handleExpired(error)) return;
    versionDetailError.value = error instanceof AdminApiError && error.status === 404
      ? '规则版本不存在或已不可访问'
      : '规则版本详情加载失败，请稍后重试';
  } finally {
    if (versionController === active) {
      versionDetailLoading.value = false;
      versionController = null;
    }
  }
}

function closeVersionDetail(): void {
  versionController?.abort();
  versionController = null;
  versionDetail.value = null;
  versionDetailError.value = '';
}

function clearExplanation(): void {
  explanationController?.abort();
  explanationController = null;
  explanation.value = null;
  explanationError.value = '';
  explanationLoading.value = false;
}

async function loadExplanation(): Promise<void> {
  if (!orderIdValid.value) return;
  explanationController?.abort();
  const active = new AbortController();
  explanationController = active;
  const id = orderId.value.trim();
  explanation.value = null;
  explanationError.value = '';
  explanationLoading.value = true;
  void router.replace({ query: { ...route.query, order_id: id } });
  try {
    explanation.value = await getAdminOrderCommissionExplanation(id, active.signal);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    if (await handleExpired(error)) return;
    if (error instanceof AdminApiError && error.status === 403) explanationError.value = '当前账号无权查看该订单佣金解释';
    else if (error instanceof AdminApiError && error.status === 404) explanationError.value = '订单不存在，或尚未生成代理佣金快照';
    else if (error instanceof AdminApiError && error.status === 429) explanationError.value = '查询过于频繁，请稍后重试';
    else explanationError.value = '订单佣金解释加载失败，请稍后重试';
  } finally {
    if (explanationController === active) {
      explanationLoading.value = false;
      explanationController = null;
    }
  }
}

async function initialize(): Promise<void> {
  await refresh();
  if (authSession.state.session && orderIdValid.value) await loadExplanation();
}

onMounted(() => void initialize());
onBeforeUnmount(() => {
  ++sequence;
  ++versionsSequence;
  controller?.abort();
  versionsController?.abort();
  versionController?.abort();
  explanationController?.abort();
  publishOpen.value = false;
  versionDetailOpen.value = false;
  changes.value = [];
});
</script>

<template>
  <AdminShell>
    <div class="commission-page" data-testid="admin-commission-rules-page">
      <section class="page-heading"><div><p>代理资金 · ADM-22</p><h1>佣金规则</h1><span>共享平台、分类和 SKU 规则；发布后只影响未来支付快照。</span></div><el-button :loading="loading || versionsLoading" data-testid="commission-refresh" @click="refresh"><el-icon><Refresh /></el-icon>刷新</el-button></section>

      <el-alert v-if="errorMessage" :title="errorMessage" type="error" :closable="false" show-icon><template #default><el-button link type="primary" @click="refresh">重新加载</el-button></template></el-alert>
      <div v-else-if="loading" class="commission-state"><el-skeleton :rows="10" animated /></div>
      <template v-else>
        <section class="rule-baseline">
          <div><small>当前规则版本</small><strong>{{ current ? `V${current.version_no}` : '尚未发布' }}</strong><span>{{ current ? `平台默认 ${current.platform_rate}%` : '首次发布需设置平台默认比例' }}</span><el-button text type="primary" :icon="Edit" data-testid="commission-platform-edit" @click="editTarget('PLATFORM', null, current?.platform_rate ?? null)">编辑平台默认</el-button></div>
          <div><small>分类覆盖</small><strong>{{ current?.categories.filter((item) => item.configured_rate !== null).length ?? 0 }}</strong><span>未覆盖时继承平台默认</span></div>
          <div><small>SKU 投影</small><strong>{{ skuResult?.pagination.total ?? 0 }}</strong><span>0% 是有效覆盖，不等于继承</span></div>
        </section>

        <section class="rule-editor">
          <header><div><p>待发布版本</p><h2>添加规则变更</h2></div><el-button type="primary" :disabled="changes.length === 0" data-testid="commission-publish-open" @click="publishOpen = true">预览并发布</el-button></header>
          <div class="rule-editor-grid">
            <el-select v-model="editor.targetType" aria-label="规则层级" @change="changeTargetType"><el-option label="平台默认" value="PLATFORM" /><el-option label="分类覆盖" value="CATEGORY" /><el-option label="SKU 覆盖" value="SKU" /></el-select>
            <el-select v-if="editor.targetType === 'CATEGORY'" v-model="editor.targetId" filterable aria-label="规则目标" placeholder="选择一级分类"><el-option v-for="item in current?.categories ?? []" :key="item.category_id" :label="item.category_name" :value="item.category_id" /></el-select>
            <el-select v-if="editor.targetType === 'SKU'" v-model="editor.targetId" filterable aria-label="规则目标" placeholder="选择当前列表 SKU"><el-option v-for="item in skuResult?.items ?? []" :key="item.sku_id" :label="`${item.sku_code} · ${item.product_name}`" :value="item.sku_id" /></el-select>
            <el-input v-model="editor.configuredRate" :disabled="editor.inherit" inputmode="decimal" placeholder="比例 0-100"><template #append>%</template></el-input>
            <el-checkbox v-if="editor.targetType !== 'PLATFORM'" v-model="editor.inherit">清除覆盖并恢复继承</el-checkbox>
            <el-button :icon="Plus" :disabled="!editorValid" @click="addChange">加入变更</el-button>
          </div>
          <el-empty v-if="changes.length === 0" description="暂无待发布变更" :image-size="50" />
          <div v-else class="change-list"><article v-for="(change, index) in changes" :key="`${change.target_type}:${change.target_id}`"><div><strong>{{ sourceLabel(change.target_type) }}</strong><span>{{ targetLabel(change) }}</span></div><b>{{ change.configured_rate === null ? '恢复继承' : `${change.configured_rate}%` }}</b><el-button circle text :icon="Delete" aria-label="删除变更" @click="changes.splice(index, 1)" /></article></div>
        </section>

        <section class="rules-table">
          <header><div><p>一级分类规则</p><h2>分类默认比例</h2></div></header>
          <el-empty v-if="!current?.categories.length" description="当前没有可配置的一级分类" />
          <div v-else class="table-scroll"><el-table :data="current.categories"><el-table-column prop="category_name" label="一级分类" min-width="180" /><el-table-column label="配置比例" width="120"><template #default="scope">{{ scope.row.configured_rate === null ? '继承' : `${scope.row.configured_rate}%` }}</template></el-table-column><el-table-column label="有效比例" width="120"><template #default="scope"><strong>{{ scope.row.effective_rate }}%</strong></template></el-table-column><el-table-column label="命中来源" min-width="130"><template #default="scope"><el-tag effect="plain">{{ sourceLabel(scope.row.source) }}</el-tag></template></el-table-column><el-table-column label="操作" width="100" fixed="right"><template #default="scope"><el-button link type="primary" :icon="Edit" :data-testid="`commission-category-edit-${scope.row.category_id}`" @click="editTarget('CATEGORY', scope.row.category_id, scope.row.configured_rate)">设置</el-button></template></el-table-column></el-table></div>
        </section>

        <section class="rules-table">
          <header><div><p>当前命中结果</p><h2>SKU 有效比例</h2></div><div class="sku-filters"><el-select v-model="categoryId" clearable aria-label="筛选一级分类" placeholder="全部一级分类" @change="searchSkus"><el-option v-for="item in current?.categories ?? []" :key="item.category_id" :label="item.category_name" :value="item.category_id" /></el-select><el-input v-model="keyword" clearable placeholder="搜索 SKU / 商品" @clear="searchSkus" @keyup.enter="searchSkus"><template #prefix><el-icon><Search /></el-icon></template></el-input></div></header>
          <el-empty v-if="!skuResult?.items.length" description="当前没有可展示的 SKU 规则" />
          <div v-else class="table-scroll"><el-table :data="skuResult.items"><el-table-column prop="sku_code" label="SKU" min-width="160" /><el-table-column prop="product_name" label="商品" min-width="180" /><el-table-column label="一级分类" min-width="150"><template #default="scope">{{ categoryLabel(scope.row.category_id) }}</template></el-table-column><el-table-column label="配置比例" width="120"><template #default="scope">{{ scope.row.configured_rate === null ? '继承' : `${scope.row.configured_rate}%` }}</template></el-table-column><el-table-column label="有效比例" width="120"><template #default="scope"><strong>{{ scope.row.effective_rate }}%</strong></template></el-table-column><el-table-column label="命中来源" min-width="130"><template #default="scope"><el-tag effect="plain">{{ sourceLabel(scope.row.source) }}</el-tag></template></el-table-column><el-table-column label="操作" width="100" fixed="right"><template #default="scope"><el-button link type="primary" :icon="Edit" :data-testid="`commission-sku-edit-${scope.row.sku_id}`" @click="editTarget('SKU', scope.row.sku_id, scope.row.configured_rate)">设置</el-button></template></el-table-column></el-table></div>
          <el-pagination v-if="skuResult && skuResult.pagination.total > skuPageSize" class="rule-pagination" background layout="prev, pager, next" :current-page="skuPage" :page-size="skuPageSize" :total="skuResult.pagination.total" @current-change="changeSkuPage" />
        </section>

        <section class="rules-table explanation-section">
          <header><div><p>支付快照复现</p><h2>订单佣金解释</h2></div><div class="explanation-toolbar"><el-input v-model="orderId" clearable aria-label="订单 ID" placeholder="订单 ID" @input="clearExplanation" @keyup.enter="loadExplanation"><template #prefix><el-icon><Search /></el-icon></template></el-input><el-button type="primary" :icon="View" :loading="explanationLoading" :disabled="!orderIdValid" data-testid="commission-explanation-load" @click="loadExplanation">查询解释</el-button></div></header>
          <el-alert v-if="explanationError" :title="explanationError" type="error" :closable="false" show-icon />
          <el-skeleton v-else-if="explanationLoading" :rows="5" animated />
          <el-empty v-else-if="!explanation" description="尚未选择待解释订单" :image-size="54" />
          <template v-else>
            <div class="explanation-summary"><strong>{{ explanation.order_no }}</strong><span>{{ explanation.items.length }} 个订单项快照</span></div>
            <el-empty v-if="explanation.items.length === 0" description="该订单没有代理佣金快照" :image-size="54" />
            <div v-else class="table-scroll"><el-table :data="explanation.items" data-testid="commission-explanation-result"><el-table-column type="expand"><template #default="scope"><div class="explanation-expand"><dl><div><dt>一级分类</dt><dd>{{ scope.row.category_name }}</dd></div><div><dt>命中路径</dt><dd>{{ scope.row.hit_path.join(' → ') }}</dd></div><div class="wide"><dt>服务端计佣事实</dt><dd>基数 ¥{{ scope.row.commission_base }} × 比例 {{ scope.row.effective_rate }}% / 100 = 原始佣金 ¥{{ scope.row.original_commission }}</dd></div><div><dt>舍入</dt><dd>{{ scope.row.rounding_mode }} · {{ scope.row.rounding_scale }} 位</dd></div><div><dt>预计剩余</dt><dd>¥{{ scope.row.expected_remaining }}</dd></div><div><dt>累计冲正</dt><dd>¥{{ scope.row.reversal_total }}</dd></div></dl><h3>佣金流水</h3><el-empty v-if="scope.row.ledger.length === 0" description="暂无佣金流水" :image-size="42" /><el-table v-else :data="scope.row.ledger" size="small"><el-table-column prop="ledger_type" label="类型" min-width="150" /><el-table-column prop="reason" label="原因" min-width="180" /><el-table-column label="预计变化" width="110"><template #default="ledger">¥{{ ledger.row.expected_change }}</template></el-table-column><el-table-column label="可用变化" width="110"><template #default="ledger">¥{{ ledger.row.available_change }}</template></el-table-column><el-table-column label="冻结变化" width="110"><template #default="ledger">¥{{ ledger.row.frozen_change }}</template></el-table-column><el-table-column label="发生时间" min-width="170"><template #default="ledger">{{ formatChinaDateTime(ledger.row.occurred_at) }}</template></el-table-column></el-table></div></template></el-table-column><el-table-column label="商品 / SKU" min-width="220"><template #default="scope"><div class="cell-stack"><strong>{{ scope.row.product_name }}</strong><span>{{ scope.row.sku_name }}</span></div></template></el-table-column><el-table-column label="规则版本" width="110"><template #default="scope">V{{ scope.row.rule_version_no }}</template></el-table-column><el-table-column label="命中来源" width="120"><template #default="scope"><el-tag effect="plain">{{ sourceLabel(scope.row.rule_source) }}</el-tag></template></el-table-column><el-table-column label="有效比例" width="105"><template #default="scope">{{ scope.row.effective_rate }}%</template></el-table-column><el-table-column label="佣金基数" width="110"><template #default="scope">¥{{ scope.row.commission_base }}</template></el-table-column><el-table-column label="原始佣金" width="110"><template #default="scope"><strong>¥{{ scope.row.original_commission }}</strong></template></el-table-column><el-table-column prop="position_state" label="当前状态" width="110" /></el-table></div>
          </template>
        </section>

        <section class="rules-table" data-testid="commission-version-history"><header><div><p>不可变发布记录</p><h2>版本历史</h2></div></header><el-alert v-if="versionsError" :title="versionsError" type="error" :closable="false" show-icon><template #default><el-button link type="primary" @click="loadVersions">重新加载历史</el-button></template></el-alert><el-skeleton v-else-if="versionsLoading" :rows="5" animated /><el-empty v-else-if="!versions?.items.length" description="尚无规则版本" /><template v-else><div class="table-scroll"><el-table :data="versions.items"><el-table-column label="版本" width="90"><template #default="scope">V{{ scope.row.version_no }}</template></el-table-column><el-table-column prop="status" label="状态" width="110" /><el-table-column prop="reason" label="发布原因" min-width="220" /><el-table-column prop="created_by_account_id" label="发布账号" min-width="190" /><el-table-column label="生效时间" min-width="170"><template #default="scope">{{ scope.row.effective_at ? formatChinaDateTime(scope.row.effective_at) : '未生效' }}</template></el-table-column><el-table-column label="操作" width="100" fixed="right"><template #default="scope"><el-button link type="primary" :icon="View" :data-testid="`commission-version-view-${scope.row.version_id}`" @click="openVersionDetail(scope.row.version_id)">详情</el-button></template></el-table-column></el-table></div><el-pagination v-if="versions.pagination.total > versionPageSize" class="rule-pagination" background layout="prev, pager, next" :current-page="versionPage" :page-size="versionPageSize" :total="versions.pagination.total" data-testid="commission-version-pagination" @current-change="changeVersionPage" /></template></section>
      </template>
    </div>

    <HighRiskCommandDialog v-model:open="publishOpen" title="发布佣金规则版本" description="服务端会在同一版本内原子发布全部变更；支付并发只能命中完整旧版或完整新版。" confirm-label="确认发布新版本" :preview-command="previewPublish" :confirm-command="confirmPublish" @completed="published" @conflict="conflict" @auth-expired="authExpired" />
    <el-dialog v-model="versionDetailOpen" title="佣金规则版本详情" width="min(720px, calc(100vw - 28px))" destroy-on-close @closed="closeVersionDetail">
      <el-skeleton v-if="versionDetailLoading" :rows="6" animated />
      <el-alert v-else-if="versionDetailError" :title="versionDetailError" type="error" :closable="false" show-icon />
      <template v-else-if="versionDetail">
        <dl class="version-meta" data-testid="commission-version-detail"><div><dt>版本</dt><dd>V{{ versionDetail.version_no }}</dd></div><div><dt>状态</dt><dd>{{ versionDetail.status }}</dd></div><div><dt>发布账号</dt><dd>{{ versionDetail.created_by_account_id }}</dd></div><div><dt>生效时间</dt><dd>{{ versionDetail.effective_at ? formatChinaDateTime(versionDetail.effective_at) : '未生效' }}</dd></div><div class="wide"><dt>发布原因</dt><dd>{{ versionDetail.reason }}</dd></div></dl>
        <h3 class="version-changes-title">本版本变更</h3>
        <el-empty v-if="!versionDetail.changes?.length" description="本版本没有可展示的变更" :image-size="50" />
        <div v-else class="table-scroll"><el-table :data="versionDetail.changes"><el-table-column label="层级" width="120"><template #default="scope">{{ sourceLabel(scope.row.target_type) }}</template></el-table-column><el-table-column label="目标" min-width="240"><template #default="scope">{{ targetLabel(scope.row) }}</template></el-table-column><el-table-column label="配置比例" width="130"><template #default="scope">{{ scope.row.configured_rate === null ? '恢复继承' : `${scope.row.configured_rate}%` }}</template></el-table-column></el-table></div>
      </template>
    </el-dialog>
  </AdminShell>
</template>

<style scoped>
.commission-page { display: grid; gap: 18px; }
.commission-state { padding: 24px; background: #fff; }
.rule-baseline { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); border: 1px solid var(--admin-border); background: #fff; }
.rule-baseline > div { display: grid; gap: 5px; padding: 18px; border-right: 1px solid var(--admin-border); }
.rule-baseline > div:last-child { border-right: 0; }
.rule-baseline small, .rule-baseline span, .change-list span { color: var(--admin-muted); font-size: 11px; }
.rule-baseline strong { font-size: 20px; }
.rule-baseline .el-button { width: fit-content; margin: 2px 0 0; padding: 0; }
.rule-editor, .rules-table { min-width: 0; padding: 18px; border-top: 1px solid var(--admin-border); background: #fff; }
.rule-editor > header, .rules-table > header { display: flex; align-items: center; justify-content: space-between; gap: 14px; margin-bottom: 16px; }
.rule-editor header p, .rules-table header p { margin: 0; color: var(--admin-brand); font-size: 11px; font-weight: 700; }
.rule-editor h2, .rules-table h2 { margin: 4px 0 0; font-size: 17px; }
.rules-table header .el-input { width: min(100%, 320px); }
.rule-editor-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px; align-items: center; }
.change-list { display: grid; gap: 6px; margin-top: 14px; }
.change-list article { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; align-items: center; gap: 12px; padding: 10px 12px; background: #f6f9f7; }
.change-list article div { display: grid; gap: 2px; }
.table-scroll { overflow-x: auto; }
.sku-filters, .explanation-toolbar { display: flex; width: min(100%, 560px); gap: 8px; }
.sku-filters .el-select { width: min(100%, 210px); }
.rule-pagination { justify-content: flex-end; margin-top: 14px; }
.explanation-summary { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
.explanation-summary span, .cell-stack span { color: var(--admin-muted); font-size: 11px; }
.cell-stack { display: grid; gap: 3px; }
.explanation-expand { padding: 8px 18px 16px; }
.explanation-expand dl, .version-meta { display: grid; margin: 0 0 16px; gap: 10px 18px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
.explanation-expand dl div, .version-meta div { display: grid; gap: 4px; }
.explanation-expand dt, .version-meta dt { color: var(--admin-muted); font-size: 11px; }
.explanation-expand dd, .version-meta dd { margin: 0; overflow-wrap: anywhere; font-size: 13px; }
.explanation-expand h3, .version-changes-title { margin: 0 0 10px; font-size: 14px; }
.explanation-expand .wide { grid-column: 1 / -1; }
.version-meta .wide { grid-column: 1 / -1; }
@media (max-width: 900px) { .rule-editor-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 600px) { .rule-baseline, .rule-editor-grid, .explanation-expand dl, .version-meta { grid-template-columns: 1fr; } .rule-baseline > div { border-right: 0; border-bottom: 1px solid var(--admin-border); } .rule-editor > header, .rules-table > header { align-items: stretch; flex-direction: column; } .rules-table header .el-input { width: 100%; } .sku-filters, .explanation-toolbar { display: grid; width: 100%; grid-template-columns: 1fr; } .sku-filters .el-select { width: 100%; } .explanation-expand .wide, .version-meta .wide { grid-column: auto; } }
</style>
