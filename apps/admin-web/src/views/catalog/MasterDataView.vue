<script setup lang="ts">
import {
  CirclePlus,
  Edit,
  Refresh,
  RefreshLeft,
  Search,
  View,
} from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';

import CatalogAssetUpload from '../../components/catalog/CatalogAssetUpload.vue';
import AdminShell from '../../layouts/AdminShell.vue';
import { AdminApiError, newIdempotencyKey } from '../../services/admin-api';
import {
  confirmMasterDataLifecycle,
  createMasterData,
  getMasterData,
  listMasterData,
  previewMasterDataLifecycle,
  restoreMasterData,
  updateMasterData,
} from '../../services/admin-catalog';
import { authSession } from '../../stores/auth-session';
import type {
  CatalogKind,
  HighRiskPreview,
  MasterDataAction,
  MasterDataItem,
  MasterDataStatus,
  UploadedCatalogAsset,
} from '../../types/catalog';

const props = defineProps<{ kind: CatalogKind }>();
const router = useRouter();

const labels = computed(() => props.kind === 'brand'
  ? {
      asset: 'Logo',
      create: '新增品牌',
      description: '维护品牌名称、描述、Logo、展示顺序与生命周期。',
      entity: '品牌',
      eyebrow: '商品中心 · ADM-05',
      name: '品牌名称',
      title: '品牌管理',
    }
  : {
      asset: 'Icon',
      create: '新增分类',
      description: '维护一级分类名称、Icon、展示顺序与生命周期。',
      entity: '分类',
      eyebrow: '商品中心 · ADM-06',
      name: '分类名称',
      title: '分类管理',
    });

const items = ref<MasterDataItem[]>([]);
const loading = ref(true);
const listError = ref('');
const page = ref(1);
const pageSize = 20;
const total = ref(0);
const keyword = ref('');
const status = ref<MasterDataStatus | ''>('');
let listSequence = 0;
let listController: AbortController | null = null;
let detailSequence = 0;
let detailController: AbortController | null = null;
let editorOpenSequence = 0;
const detailLoadingId = ref<string | null>(null);

interface CommandAttempt {
  key: string;
  signature: string;
}

let editorAttempt: CommandAttempt | null = null;

const editorOpen = ref(false);
const editorLoading = ref(false);
const editorSaving = ref(false);
const assetUploading = ref(false);
const editorError = ref('');
const editorItem = ref<MasterDataItem | null>(null);
const editorForm = reactive({
  assetFileId: null as string | null,
  assetUrl: null as string | null,
  description: '',
  name: '',
  sortOrder: 0,
});

const lifecycleOpen = ref(false);
const lifecycleItem = ref<MasterDataItem | null>(null);
const lifecycleAction = ref<MasterDataAction>('ACTIVATE');
const lifecycleReason = ref('');
const lifecyclePreview = ref<HighRiskPreview | null>(null);
const previewPending = ref(false);
const confirmPending = ref(false);
const lifecycleError = ref('');
let previewSequence = 0;
let previewController: AbortController | null = null;
let lifecycleAttempt: CommandAttempt | null = null;

const restoreOpen = ref(false);
const restoreItem = ref<MasterDataItem | null>(null);
const restoreReason = ref('');
const restorePending = ref(false);
const restoreError = ref('');
let restoreAttempt: CommandAttempt | null = null;

const statusOptions: Array<{ label: string; value: MasterDataStatus | '' }> = [
  { label: '默认（不含已归档）', value: '' },
  { label: '草稿', value: 'DRAFT' },
  { label: '已启用', value: 'ACTIVE' },
  { label: '已停用', value: 'INACTIVE' },
  { label: '已归档', value: 'ARCHIVED' },
];

const actionOptions = computed<Array<{ label: string; value: MasterDataAction }>>(() => {
  if (lifecycleItem.value?.status === 'ACTIVE') return [{ label: '停用', value: 'DEACTIVATE' }];
  if (lifecycleItem.value?.status === 'DRAFT' || lifecycleItem.value?.status === 'INACTIVE') {
    return [
      { label: '启用', value: 'ACTIVATE' },
      { label: '归档', value: 'SOFT_DELETE' },
    ];
  }
  return [];
});

const actionLabel = computed(() => ({
  ACTIVATE: '启用',
  DEACTIVATE: '停用',
  SOFT_DELETE: '归档',
})[lifecycleAction.value]);

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function statusLabel(value: MasterDataStatus): string {
  return ({ ACTIVE: '已启用', ARCHIVED: '已归档', DRAFT: '草稿', INACTIVE: '已停用' })[value];
}

async function handleSessionError(error: unknown): Promise<boolean> {
  if (authSession.state.session && (!(error instanceof AdminApiError) || error.status !== 401)) return false;
  clearSensitiveState();
  items.value = [];
  total.value = 0;
  authSession.clearSession();
  await router.replace('/login');
  return true;
}

function readableError(error: unknown, fallback: string): string {
  if (!(error instanceof AdminApiError)) return fallback;
  if (error.status === 0) return '网络连接失败，请检查网络后重试';
  if (error.status === 403) return '当前账号无权访问此功能';
  if (error.status === 404) return '记录不存在或已不可用，请刷新列表';
  if (error.status === 429) return '操作过于频繁，请稍后重试';
  if (error.code === 'SOFT_DELETED_KEY_RESERVED') return '该名称由已归档记录保留，请先恢复原记录';
  if (error.code === 'FILE_CONTENT_MISMATCH') return '图片内容校验不一致，请重新选择后再试';
  if (error.status === 400 || error.status === 409 || error.status === 422) {
    return '请求内容或当前状态不符合要求，请检查后重试';
  }
  if (error.status >= 500) return fallback;
  return fallback;
}

function isUnknownOutcome(error: unknown): boolean {
  return error instanceof AdminApiError && (error.status === 0 || error.status >= 500);
}

function commandAttempt(current: CommandAttempt | null, signature: string): CommandAttempt {
  return current?.signature === signature ? current : { key: newIdempotencyKey(), signature };
}

async function loadList(): Promise<void> {
  const sequence = ++listSequence;
  listController?.abort();
  const controller = new AbortController();
  listController = controller;
  loading.value = true;
  listError.value = '';
  try {
    const result = await listMasterData(props.kind, {
      keyword: keyword.value.trim(),
      page: page.value,
      pageSize,
      signal: controller.signal,
      status: status.value,
    });
    if (sequence !== listSequence) return;
    items.value = result.items;
    total.value = result.pagination.total;
    if (result.pagination.page !== page.value) page.value = result.pagination.page;
  } catch (error) {
    if (isAbort(error) || sequence !== listSequence) return;
    if (await handleSessionError(error)) return;
    listError.value = readableError(error, `${labels.value.entity}列表加载失败`);
    items.value = [];
    total.value = 0;
  } finally {
    if (sequence === listSequence) loading.value = false;
  }
}

function applyFilters(): void {
  page.value = 1;
  void loadList();
}

function resetFilters(): void {
  keyword.value = '';
  status.value = '';
  page.value = 1;
  void loadList();
}

function changePage(nextPage: number): void {
  page.value = nextPage;
  void loadList();
}

function resetEditor(): void {
  editorAttempt = null;
  editorItem.value = null;
  editorForm.assetFileId = null;
  editorForm.assetUrl = null;
  editorForm.description = '';
  editorForm.name = '';
  editorForm.sortOrder = 0;
  editorError.value = '';
  editorLoading.value = false;
  editorSaving.value = false;
  assetUploading.value = false;
}

function fillEditor(item: MasterDataItem): void {
  editorItem.value = item;
  editorForm.assetFileId = item.assetFileId;
  editorForm.assetUrl = item.assetUrl;
  editorForm.description = item.description ?? '';
  editorForm.name = item.name;
  editorForm.sortOrder = item.sortOrder;
}

function openCreateEditor(): void {
  ++editorOpenSequence;
  detailController?.abort();
  resetEditor();
  editorOpen.value = true;
}

async function fetchLatest(item: MasterDataItem): Promise<MasterDataItem | null> {
  const sequence = ++detailSequence;
  detailController?.abort();
  const controller = new AbortController();
  detailController = controller;
  detailLoadingId.value = item.id;
  try {
    const latest = await getMasterData(item.kind, item.id, controller.signal);
    return sequence === detailSequence ? latest : null;
  } catch (error) {
    if (isAbort(error) || sequence !== detailSequence) return null;
    if (await handleSessionError(error)) return null;
    ElMessage.error(readableError(error, `${labels.value.entity}详情加载失败`));
    return null;
  } finally {
    if (sequence === detailSequence) detailLoadingId.value = null;
  }
}

async function openEditEditor(item: MasterDataItem): Promise<void> {
  const opening = ++editorOpenSequence;
  resetEditor();
  editorOpen.value = true;
  editorLoading.value = true;
  const latest = await fetchLatest(item);
  if (!editorOpen.value || opening !== editorOpenSequence) return;
  if (!latest) {
    editorOpen.value = false;
    return;
  }
  fillEditor(latest);
  editorLoading.value = false;
}

function requestEditorClose(done: () => void): void {
  if (editorSaving.value || assetUploading.value) return;
  done();
}

function acceptAsset(asset: UploadedCatalogAsset): void {
  editorForm.assetFileId = asset.fileId;
  editorForm.assetUrl = asset.publicUrl;
}

async function submitEditor(): Promise<void> {
  if (editorSaving.value || assetUploading.value || editorLoading.value) return;
  editorError.value = '';
  const name = editorForm.name.trim();
  if (name.length < 1 || name.length > 120) editorError.value = `${labels.value.name}须为 1–120 个字符`;
  else if (!Number.isInteger(editorForm.sortOrder) || editorForm.sortOrder < 0) editorError.value = '排序值须为非负整数';
  else if (props.kind === 'brand' && editorForm.description.length > 500) editorError.value = '品牌描述不能超过 500 个字符';
  if (editorError.value) return;

  editorSaving.value = true;
  const current = editorItem.value;
  try {
    const input = {
      assetFileId: editorForm.assetFileId,
      description: props.kind === 'brand' ? editorForm.description.trim() || null : null,
      name,
      sortOrder: editorForm.sortOrder,
    };
    const signature = JSON.stringify({ id: current?.id ?? null, input, version: current?.version ?? null });
    editorAttempt = commandAttempt(editorAttempt, signature);
    if (current) await updateMasterData(current, input, editorAttempt.key);
    else await createMasterData(props.kind, input, editorAttempt.key);
    editorAttempt = null;
    editorOpen.value = false;
    ElMessage.success(`${labels.value.entity}${current ? '修改已保存' : '已创建为草稿'}`);
    await loadList();
  } catch (error) {
    if (await handleSessionError(error)) return;
    if (!isUnknownOutcome(error)) editorAttempt = null;
    if (error instanceof AdminApiError && error.status === 409 && current) {
      editorOpen.value = false;
      await loadList();
      ElMessage.warning('记录已被其他操作更新，已刷新最新数据，请重新编辑');
      return;
    }
    editorError.value = readableError(error, `${labels.value.entity}保存失败`);
  } finally {
    editorSaving.value = false;
  }
}

function clearPreview(): void {
  ++previewSequence;
  previewController?.abort();
  previewController = null;
  lifecyclePreview.value = null;
  lifecycleAttempt = null;
  previewPending.value = false;
}

function clearLifecycle(): void {
  clearPreview();
  lifecycleItem.value = null;
  lifecycleAction.value = 'ACTIVATE';
  lifecycleReason.value = '';
  lifecycleError.value = '';
  confirmPending.value = false;
}

async function openLifecycle(item: MasterDataItem): Promise<void> {
  const latest = await fetchLatest(item);
  if (!latest || latest.status === 'ARCHIVED') return;
  clearLifecycle();
  lifecycleItem.value = latest;
  lifecycleAction.value = latest.status === 'ACTIVE' ? 'DEACTIVATE' : 'ACTIVATE';
  lifecycleOpen.value = true;
}

async function closeAndRefreshConflict(message: string): Promise<void> {
  lifecycleOpen.value = false;
  restoreOpen.value = false;
  clearLifecycle();
  clearRestore();
  await loadList();
  ElMessage.warning(message);
}

async function generatePreview(): Promise<void> {
  const item = lifecycleItem.value;
  if (!item || previewPending.value || confirmPending.value) return;
  lifecycleError.value = '';
  const reason = lifecycleReason.value.trim();
  if (reason.length < 2 || reason.length > 500) {
    lifecycleError.value = '操作原因须为 2–500 个字符';
    return;
  }
  clearPreview();
  const sequence = ++previewSequence;
  const controller = new AbortController();
  previewController = controller;
  previewPending.value = true;
  try {
    const preview = await previewMasterDataLifecycle(item, lifecycleAction.value, reason, controller.signal);
    if (sequence === previewSequence) lifecyclePreview.value = preview;
  } catch (error) {
    if (isAbort(error) || sequence !== previewSequence) return;
    if (await handleSessionError(error)) return;
    if (error instanceof AdminApiError && error.status === 409) {
      await closeAndRefreshConflict('记录状态或版本已变化，已刷新最新数据，请重新生成影响预览');
      return;
    }
    if (error instanceof AdminApiError && error.status === 403) {
      lifecycleOpen.value = false;
      clearLifecycle();
      ElMessage.error('当前账号无权执行生命周期操作');
      return;
    }
    lifecycleError.value = readableError(error, '影响预览生成失败');
  } finally {
    if (sequence === previewSequence) {
      previewPending.value = false;
      previewController = null;
    }
  }
}

async function confirmLifecycle(): Promise<void> {
  const item = lifecycleItem.value;
  const preview = lifecyclePreview.value;
  if (!item || !preview || confirmPending.value) return;
  confirmPending.value = true;
  lifecycleError.value = '';
  const signature = JSON.stringify({
    action: lifecycleAction.value,
    confirmationHash: preview.confirmation_hash,
    id: item.id,
    previewToken: preview.preview_token,
    reason: lifecycleReason.value.trim(),
  });
  lifecycleAttempt = commandAttempt(lifecycleAttempt, signature);
  try {
    await confirmMasterDataLifecycle(
      item,
      lifecycleAction.value,
      lifecycleReason.value.trim(),
      preview,
      lifecycleAttempt.key,
    );
    lifecycleAttempt = null;
    const completedAction = actionLabel.value;
    lifecycleOpen.value = false;
    clearLifecycle();
    ElMessage.success(`${item.name} 已${completedAction}`);
    await loadList();
  } catch (error) {
    if (await handleSessionError(error)) return;
    if (!isUnknownOutcome(error)) lifecycleAttempt = null;
    if (error instanceof AdminApiError && error.status === 409) {
      await closeAndRefreshConflict('记录已被其他操作更新，已刷新最新数据，请重新预览并确认');
      return;
    }
    if (error instanceof AdminApiError && error.code === 'ACTIVE_PRODUCT_DEPENDENCY') {
      clearPreview();
      lifecycleError.value = '存在活动商品依赖，记录未变更。请先迁移或下架关联商品，再重新预览。';
      await loadList();
      return;
    }
    if (error instanceof AdminApiError && error.status === 403) {
      lifecycleOpen.value = false;
      clearLifecycle();
      ElMessage.error('当前账号无权执行生命周期操作');
      return;
    }
    lifecycleError.value = readableError(error, `确认${actionLabel.value}失败`);
  } finally {
    confirmPending.value = false;
  }
}

function clearRestore(): void {
  restoreAttempt = null;
  restoreItem.value = null;
  restoreReason.value = '';
  restoreError.value = '';
  restorePending.value = false;
}

async function openRestore(item: MasterDataItem): Promise<void> {
  const latest = await fetchLatest(item);
  if (!latest || latest.status !== 'ARCHIVED') return;
  clearRestore();
  restoreItem.value = latest;
  restoreOpen.value = true;
}

async function submitRestore(): Promise<void> {
  const item = restoreItem.value;
  if (!item || restorePending.value) return;
  restoreError.value = '';
  const reason = restoreReason.value.trim();
  if (reason.length < 2 || reason.length > 500) {
    restoreError.value = '恢复原因须为 2–500 个字符';
    return;
  }
  restorePending.value = true;
  const signature = JSON.stringify({ id: item.id, reason, version: item.version });
  restoreAttempt = commandAttempt(restoreAttempt, signature);
  try {
    await restoreMasterData(item, reason, restoreAttempt.key);
    restoreAttempt = null;
    restoreOpen.value = false;
    clearRestore();
    ElMessage.success(`${item.name} 已恢复为草稿`);
    await loadList();
  } catch (error) {
    if (await handleSessionError(error)) return;
    if (!isUnknownOutcome(error)) restoreAttempt = null;
    if (error instanceof AdminApiError && error.status === 409) {
      await closeAndRefreshConflict('记录已被其他操作更新，已刷新最新数据，请重新确认恢复');
      return;
    }
    if (error instanceof AdminApiError && error.status === 403) {
      restoreOpen.value = false;
      clearRestore();
    }
    restoreError.value = readableError(error, '恢复失败');
  } finally {
    restorePending.value = false;
  }
}

function clearSensitiveState(): void {
  editorOpen.value = false;
  lifecycleOpen.value = false;
  restoreOpen.value = false;
  resetEditor();
  clearLifecycle();
  clearRestore();
}

watch([lifecycleAction, lifecycleReason], () => {
  if (lifecyclePreview.value) clearPreview();
  lifecycleError.value = '';
});

onMounted(loadList);
onBeforeUnmount(() => {
  ++listSequence;
  ++detailSequence;
  listController?.abort();
  detailController?.abort();
  listController = null;
  detailController = null;
  clearSensitiveState();
});
</script>

<template>
  <AdminShell>
    <div class="catalog-page" data-testid="catalog-page">
      <section class="page-heading">
        <div>
          <p>{{ labels.eyebrow }}</p>
          <h1>{{ labels.title }}</h1>
          <span>{{ labels.description }}</span>
        </div>
        <el-button type="primary" @click="openCreateEditor">
          <el-icon><CirclePlus /></el-icon>
          {{ labels.create }}
        </el-button>
      </section>

      <el-alert
        v-if="kind === 'category'"
        class="dependency-note"
        title="活动商品依赖会阻断停用或归档"
        description="影响预览会展示依赖范围；确认被阻断时记录保持不变。"
        type="warning"
        :closable="false"
        show-icon
      />

      <section class="catalog-toolbar" aria-label="列表筛选">
        <el-input
          v-model="keyword"
          class="catalog-search"
          clearable
          data-testid="search-input"
          :placeholder="`搜索${labels.name}`"
          :aria-label="`搜索${labels.name}`"
          @keyup.enter="applyFilters"
          @clear="applyFilters"
        >
          <template #prefix><el-icon><Search /></el-icon></template>
        </el-input>
        <el-select
          v-model="status"
          class="catalog-status"
          data-testid="status-filter"
          aria-label="状态筛选"
          placeholder="默认（不含已归档）"
          @change="applyFilters"
        >
          <el-option v-for="option in statusOptions" :key="option.value || 'DEFAULT'" v-bind="option" />
        </el-select>
        <el-button @click="applyFilters">
          <el-icon><Search /></el-icon>
          查询
        </el-button>
        <el-button @click="resetFilters">
          <el-icon><Refresh /></el-icon>
          重置
        </el-button>
      </section>

      <section class="catalog-list" :class="{ refreshing: loading && items.length }">
        <header class="catalog-list-heading">
          <div>
            <strong>共 {{ total }} 个{{ labels.entity }}</strong>
            <span>默认不显示归档记录</span>
          </div>
        </header>

        <div v-if="loading && !items.length" class="catalog-state" data-testid="catalog-loading">
          <el-skeleton :rows="5" animated />
        </div>
        <div v-else-if="listError" class="catalog-state" data-testid="catalog-error">
          <el-alert :title="listError" type="error" :closable="false" show-icon />
          <el-button @click="loadList">重新加载</el-button>
        </div>
        <div v-else-if="!items.length" class="catalog-state empty" data-testid="catalog-empty">
          <el-icon><Search /></el-icon>
          <strong>没有符合条件的{{ labels.entity }}</strong>
          <span>调整关键词或状态筛选后再试。</span>
          <el-button @click="resetFilters">清除筛选</el-button>
        </div>
        <div
          v-else
          v-loading="loading"
          class="catalog-grid"
          :class="{ 'is-category': kind === 'category' }"
          role="table"
          :aria-label="`${labels.title}列表`"
        >
          <div class="catalog-grid-header" role="row">
            <span role="columnheader">{{ labels.asset }}</span>
            <span role="columnheader">{{ labels.name }}</span>
            <span v-if="kind === 'brand'" class="catalog-description-column" role="columnheader">品牌描述</span>
            <span role="columnheader">排序</span>
            <span role="columnheader">状态</span>
            <span role="columnheader">版本</span>
            <span role="columnheader">操作</span>
          </div>
          <div
            v-for="item in items"
            :key="item.id"
            class="catalog-grid-row"
            role="row"
            :data-testid="`catalog-row-${item.id}`"
          >
            <div class="catalog-asset" role="cell">
              <img
                v-if="item.assetUrl"
                :src="item.assetUrl"
                :alt="`${item.name}${labels.asset}`"
                referrerpolicy="no-referrer"
              >
              <span v-else aria-hidden="true">{{ item.name.slice(0, 1) }}</span>
            </div>
            <div class="catalog-name" role="cell">
              <strong>{{ item.name }}</strong>
              <small>{{ item.id }}</small>
            </div>
            <p v-if="kind === 'brand'" class="catalog-description-column catalog-description" role="cell">
              {{ item.description || '—' }}
            </p>
            <div class="catalog-meta" role="cell" data-label="排序"><span>{{ item.sortOrder }}</span></div>
            <div class="catalog-meta" role="cell" data-label="状态">
              <span class="catalog-status-badge" :class="`is-${item.status.toLowerCase()}`">
                {{ statusLabel(item.status) }}
              </span>
            </div>
            <div class="catalog-meta" role="cell" data-label="版本"><span>v{{ item.version }}</span></div>
            <div class="catalog-row-actions" role="cell">
              <el-button
                v-if="item.status !== 'ARCHIVED'"
                link
                type="primary"
                :loading="detailLoadingId === item.id"
                @click="openEditEditor(item)"
              >
                <el-icon><Edit /></el-icon>
                编辑
              </el-button>
              <el-button
                v-if="item.status !== 'ARCHIVED'"
                link
                type="primary"
                :disabled="detailLoadingId === item.id"
                @click="openLifecycle(item)"
              >
                <el-icon><View /></el-icon>
                影响预览
              </el-button>
              <el-button
                v-else
                link
                type="primary"
                :loading="detailLoadingId === item.id"
                @click="openRestore(item)"
              >
                <el-icon><RefreshLeft /></el-icon>
                恢复为草稿
              </el-button>
            </div>
          </div>
        </div>

        <footer v-if="total > pageSize && !listError" class="catalog-pagination">
          <el-pagination
            background
            layout="prev, pager, next"
            :current-page="page"
            :page-size="pageSize"
            :total="total"
            @current-change="changePage"
          />
        </footer>
      </section>
    </div>

    <el-drawer
      v-model="editorOpen"
      :title="editorItem ? `编辑${labels.entity}` : labels.create"
      size="min(520px, 100%)"
      destroy-on-close
      :before-close="requestEditorClose"
      @closed="resetEditor"
    >
      <div data-testid="catalog-editor">
        <div v-if="editorLoading" class="drawer-loading"><el-skeleton :rows="7" animated /></div>
        <form v-else class="catalog-editor-form" @submit.prevent="submitEditor">
          <el-alert
            v-if="!editorItem"
            title="新建记录固定保存为草稿"
            type="info"
            :closable="false"
            show-icon
          />
          <el-alert
            v-else
            :title="`当前 ${statusLabel(editorItem.status)} · v${editorItem.version}`"
            description="普通编辑不会改变生命周期状态。"
            type="info"
            :closable="false"
          />
          <el-form label-position="top">
            <el-form-item :label="labels.name" required>
              <el-input
                v-model="editorForm.name"
                maxlength="120"
                show-word-limit
                :aria-label="labels.name"
              />
            </el-form-item>
            <el-form-item :label="`${labels.asset} 图片`">
              <CatalogAssetUpload
                v-if="editorOpen"
                :kind="kind"
                :file-id="editorForm.assetFileId"
                :image-url="editorForm.assetUrl"
                :disabled="editorSaving"
                @change="acceptAsset"
                @remove="editorForm.assetFileId = null; editorForm.assetUrl = null"
                @uploading="assetUploading = $event"
                @auth-expired="handleSessionError"
              />
            </el-form-item>
            <el-form-item v-if="kind === 'brand'" label="品牌描述">
              <el-input
                v-model="editorForm.description"
                type="textarea"
                :rows="4"
                maxlength="500"
                show-word-limit
                aria-label="品牌描述"
              />
            </el-form-item>
            <el-form-item label="排序值" required>
              <el-input-number
                v-model="editorForm.sortOrder"
                :min="0"
                :step="1"
                step-strictly
                controls-position="right"
                aria-label="排序值"
              />
            </el-form-item>
          </el-form>
          <p v-if="editorError" class="catalog-form-error" role="alert">{{ editorError }}</p>
          <div class="drawer-actions">
            <el-button :disabled="editorSaving || assetUploading" @click="editorOpen = false">取消</el-button>
            <el-button
              native-type="submit"
              type="primary"
              :loading="editorSaving"
              :disabled="assetUploading"
            >
              {{ editorItem ? '保存修改' : '保存为草稿' }}
            </el-button>
          </div>
        </form>
      </div>
    </el-drawer>

    <el-dialog
      v-model="lifecycleOpen"
      width="min(580px, calc(100vw - 28px))"
      :close-on-click-modal="false"
      :close-on-press-escape="!confirmPending"
      :show-close="!confirmPending"
      @closed="clearLifecycle"
    >
      <template #header>
        <div>
          <strong>生命周期影响预览</strong>
          <p v-if="lifecycleItem">{{ lifecycleItem.name }} · {{ statusLabel(lifecycleItem.status) }} · v{{ lifecycleItem.version }}</p>
        </div>
      </template>
      <div class="lifecycle-dialog" data-testid="lifecycle-dialog">
        <el-form label-position="top">
          <el-form-item label="生命周期动作" required>
            <el-select
              v-model="lifecycleAction"
              aria-label="生命周期动作"
              :disabled="previewPending || confirmPending"
            >
              <el-option v-for="option in actionOptions" :key="option.value" v-bind="option" />
            </el-select>
          </el-form-item>
          <el-form-item label="操作原因" required>
            <el-input
              v-model="lifecycleReason"
              type="textarea"
              :rows="3"
              maxlength="500"
              show-word-limit
              aria-label="操作原因"
              :disabled="confirmPending"
            />
          </el-form-item>
        </el-form>

        <section v-if="lifecyclePreview" class="impact-preview" aria-label="影响预览结果">
          <div class="impact-summary">
            <span>受影响记录</span>
            <strong>{{ lifecyclePreview.impact.affected_count }}</strong>
          </div>
          <dl v-if="lifecyclePreview.impact.metrics.length" class="impact-metrics">
            <template v-for="metric in lifecyclePreview.impact.metrics" :key="metric.key">
              <dt>{{ metric.label }}</dt>
              <dd>{{ metric.before ?? '—' }} → {{ metric.after ?? '—' }}</dd>
            </template>
          </dl>
          <el-alert
            v-for="warning in lifecyclePreview.impact.warnings"
            :key="warning"
            :title="warning"
            type="warning"
            :closable="false"
            show-icon
          />
          <small>预览有效期至 {{ new Date(lifecyclePreview.expires_at).toLocaleString('zh-CN') }}</small>
        </section>
        <p v-if="lifecycleError" class="catalog-form-error" role="alert">{{ lifecycleError }}</p>
      </div>
      <template #footer>
        <el-button :disabled="confirmPending" @click="lifecycleOpen = false">取消</el-button>
        <el-button
          v-if="!lifecyclePreview"
          type="primary"
          :loading="previewPending"
          :disabled="confirmPending"
          @click="generatePreview"
        >
          生成影响预览
        </el-button>
        <el-button
          v-else
          type="primary"
          :loading="confirmPending"
          @click="confirmLifecycle"
        >
          确认{{ actionLabel }}
        </el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="restoreOpen"
      width="min(500px, calc(100vw - 28px))"
      :close-on-click-modal="false"
      :close-on-press-escape="!restorePending"
      :show-close="!restorePending"
      @closed="clearRestore"
    >
      <template #header>
        <div>
          <strong>恢复为草稿</strong>
          <p v-if="restoreItem">{{ restoreItem.name }} · 已归档 · v{{ restoreItem.version }}</p>
        </div>
      </template>
      <div data-testid="restore-dialog">
        <el-alert
          title="恢复后不会自动启用"
          description="记录将回到草稿，重新启用前仍须生成影响预览并确认。"
          type="info"
          :closable="false"
          show-icon
        />
        <el-form class="restore-form" label-position="top">
          <el-form-item label="恢复原因" required>
            <el-input
              v-model="restoreReason"
              type="textarea"
              :rows="3"
              maxlength="500"
              show-word-limit
              aria-label="恢复原因"
              :disabled="restorePending"
            />
          </el-form-item>
        </el-form>
        <p v-if="restoreError" class="catalog-form-error" role="alert">{{ restoreError }}</p>
      </div>
      <template #footer>
        <el-button :disabled="restorePending" @click="restoreOpen = false">取消</el-button>
        <el-button type="primary" :loading="restorePending" @click="submitRestore">确认恢复为草稿</el-button>
      </template>
    </el-dialog>
  </AdminShell>
</template>

<style scoped>
.catalog-page {
  min-width: 0;
}

.dependency-note {
  margin-bottom: 16px;
}

.catalog-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 0;
  border-top: 1px solid var(--admin-border);
}

.catalog-search {
  width: min(360px, 100%);
}

.catalog-status {
  width: 220px;
}

.catalog-list {
  overflow: hidden;
  border: 1px solid var(--admin-border);
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 1px 2px rgb(20 45 34 / 5%);
}

.catalog-list.refreshing {
  opacity: 0.85;
}

.catalog-list-heading {
  display: flex;
  min-height: 58px;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  border-bottom: 1px solid var(--admin-border);
}

.catalog-list-heading > div {
  display: grid;
  gap: 3px;
}

.catalog-list-heading strong {
  font-size: 14px;
}

.catalog-list-heading span {
  color: var(--admin-muted);
  font-size: 11px;
}

.catalog-grid-header,
.catalog-grid-row {
  display: grid;
  align-items: center;
  grid-template-columns: var(--catalog-grid-columns);
}

.catalog-grid {
  --catalog-grid-columns: 64px minmax(150px, 1.2fr) minmax(180px, 1.5fr) 70px 88px 66px minmax(196px, auto);
}

.catalog-grid.is-category {
  --catalog-grid-columns: 64px minmax(150px, 1fr) 70px 88px 66px minmax(196px, auto);
}

.catalog-grid-header {
  min-height: 42px;
  border-bottom: 1px solid var(--admin-border);
  background: #f7faf8;
  color: var(--admin-text-soft);
  font-size: 12px;
  font-weight: 650;
}

.catalog-grid-header > span,
.catalog-grid-row > * {
  min-width: 0;
  padding: 10px 12px;
}

.catalog-grid-row {
  min-height: 72px;
  border-bottom: 1px solid #edf1ef;
}

.catalog-grid-row:last-child {
  border-bottom: 0;
}

.catalog-grid-row:hover {
  background: #fbfdfc;
}

.catalog-asset {
  display: grid;
  width: 42px;
  height: 42px;
  margin-left: 11px;
  overflow: hidden;
  padding: 0 !important;
  border: 1px solid var(--admin-border);
  border-radius: 6px;
  background: #edf4f0;
  color: var(--admin-brand);
  font-size: 15px;
  font-weight: 700;
  place-items: center;
}

.catalog-asset img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.catalog-name {
  display: grid;
  gap: 4px;
}

.catalog-name strong {
  overflow-wrap: anywhere;
  font-size: 13px;
}

.catalog-name small {
  overflow: hidden;
  color: var(--admin-muted);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.catalog-description {
  display: -webkit-box;
  overflow: hidden;
  margin: 0;
  color: var(--admin-text-soft);
  font-size: 12px;
  line-height: 1.5;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.catalog-meta {
  color: var(--admin-text-soft);
  font-size: 12px;
}

.catalog-status-badge {
  display: inline-flex;
  min-height: 22px;
  align-items: center;
  padding: 1px 7px;
  border: 1px solid #cbd5d0;
  border-radius: 4px;
  background: #f4f7f5;
  color: #52615a;
  font-size: 11px;
  font-weight: 650;
  line-height: 18px;
}

.catalog-status-badge.is-active {
  border-color: #9fc9b9;
  background: #eaf5f0;
  color: #176247;
}

.catalog-status-badge.is-inactive {
  border-color: #dfc58b;
  background: #fff8e8;
  color: #825b05;
}

.catalog-status-badge.is-archived {
  border-color: #ddaaa8;
  background: #fff0ef;
  color: #9b302d;
}

.catalog-row-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 3px;
}

.catalog-row-actions :deep(.el-button + .el-button) {
  margin-left: 0;
}

.catalog-state {
  display: grid;
  min-height: 330px;
  align-content: center;
  gap: 16px;
  padding: 28px;
}

.catalog-state.empty {
  justify-items: center;
  color: var(--admin-muted);
  text-align: center;
}

.catalog-state.empty > .el-icon {
  font-size: 30px;
}

.catalog-state.empty strong {
  color: var(--admin-text);
  font-size: 15px;
}

.catalog-state.empty span {
  font-size: 12px;
}

.catalog-pagination {
  display: flex;
  min-height: 62px;
  align-items: center;
  justify-content: flex-end;
  padding: 10px 16px;
  border-top: 1px solid var(--admin-border);
}

.drawer-loading {
  padding: 12px 0;
}

.catalog-editor-form {
  display: grid;
  gap: 16px;
}

.catalog-editor-form :deep(.el-input-number) {
  width: 180px;
}

.catalog-form-error {
  margin: 0;
  padding: 10px 12px;
  border-left: 3px solid var(--admin-danger);
  background: #fff3f1;
  color: #9f3030;
  font-size: 12px;
  line-height: 1.55;
}

.drawer-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 14px;
  border-top: 1px solid var(--admin-border);
}

.lifecycle-dialog :deep(.el-select) {
  width: 100%;
}

.impact-preview {
  display: grid;
  gap: 12px;
  padding: 14px;
  border: 1px solid var(--admin-border);
  border-radius: 7px;
  background: #f8faf9;
}

.impact-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: var(--admin-text-soft);
  font-size: 12px;
}

.impact-summary strong {
  color: var(--admin-text);
  font-size: 20px;
}

.impact-metrics {
  display: grid;
  margin: 0;
  grid-template-columns: minmax(0, 1fr) auto;
}

.impact-metrics dt,
.impact-metrics dd {
  margin: 0;
  padding: 7px 0;
  border-top: 1px solid var(--admin-border);
  font-size: 12px;
}

.impact-metrics dd {
  padding-left: 12px;
  color: var(--admin-text-soft);
  text-align: right;
}

.impact-preview > small {
  color: var(--admin-muted);
  font-size: 10px;
}

.restore-form {
  margin-top: 18px;
}

:deep(.el-dialog__header p) {
  margin: 4px 0 0;
  color: var(--admin-muted);
  font-size: 11px;
}

@media (max-width: 1180px) {
  .catalog-grid {
    --catalog-grid-columns: 64px minmax(150px, 1fr) 70px 88px 66px minmax(196px, auto);
  }

  .catalog-description-column {
    display: none;
  }
}

@media (max-width: 760px) {
  .catalog-toolbar {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
  }

  .catalog-search,
  .catalog-status {
    width: 100%;
  }

  .catalog-search {
    grid-column: 1 / -1;
  }

  .catalog-grid-header {
    display: none;
  }

  .catalog-grid-row {
    display: grid;
    min-height: 0;
    align-items: start;
    padding: 14px;
    grid-template-columns: 52px minmax(0, 1fr);
  }

  .catalog-grid-row > * {
    padding: 0;
  }

  .catalog-asset {
    width: 42px;
    height: 42px;
    margin: 0;
    grid-column: 1;
    grid-row: 1 / span 2;
  }

  .catalog-name {
    grid-column: 2;
  }

  .catalog-meta {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    margin-top: 8px;
    grid-column: 2;
  }

  .catalog-meta::before {
    content: attr(data-label) '：';
    color: var(--admin-muted);
  }

  .catalog-row-actions {
    justify-content: flex-start;
    margin-top: 12px;
    padding-top: 9px;
    border-top: 1px solid #edf1ef;
    grid-column: 1 / -1;
  }
}

@media (max-width: 520px) {
  .catalog-toolbar {
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .catalog-status {
    grid-column: 1 / -1;
  }

  .catalog-list-heading,
  .catalog-pagination {
    padding-right: 12px;
    padding-left: 12px;
  }

  .drawer-actions {
    position: sticky;
    bottom: 0;
    padding: 12px 0 max(2px, env(safe-area-inset-bottom));
    background: #fff;
  }
}
</style>
