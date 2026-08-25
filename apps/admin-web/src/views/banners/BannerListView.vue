<script setup lang="ts">
import {
  ArrowLeft,
  ArrowRight,
  CirclePlus,
  Edit,
  Picture,
  Refresh,
  RefreshLeft,
  Search,
} from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';

import BannerCommandDialog from '../../components/banners/BannerCommandDialog.vue';
import BannerEditorDialog from '../../components/banners/BannerEditorDialog.vue';
import AdminShell from '../../layouts/AdminShell.vue';
import { AdminApiError } from '../../services/admin-api';
import { listAdminBanners } from '../../services/admin-banners';
import { safePublicAssetUrl } from '../../services/admin-files';
import { authSession } from '../../stores/auth-session';
import type { BannerItem, BannerStatus } from '../../types/banners';
import { formatChinaDateTime } from '../../utils/time';

type StatusFilter = '' | BannerStatus;
type BannerCommand = 'ACTIVATE' | 'ARCHIVE' | 'DEACTIVATE' | 'RESTORE';

const router = useRouter();
const items = ref<BannerItem[]>([]);
const loading = ref(false);
const listError = ref('');
const keyword = ref('');
const status = ref<StatusFilter>('');
const page = ref(1);
const pageSize = 20;
const total = ref(0);
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)));
const editorOpen = ref(false);
const editorItem = ref<BannerItem | null>(null);
const commandOpen = ref(false);
const commandTarget = ref<BannerItem | null>(null);
const command = ref<BannerCommand | null>(null);
let listSequence = 0;
let listController: AbortController | null = null;

const statusOptions: Array<{ label: string; value: StatusFilter }> = [
  { label: '默认（不含已归档）', value: '' },
  { label: '草稿', value: 'DRAFT' },
  { label: '已启用', value: 'ACTIVE' },
  { label: '已停用', value: 'INACTIVE' },
  { label: '已归档', value: 'ARCHIVED' },
];

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function statusLabel(value: BannerStatus): string {
  return ({ ACTIVE: '已启用', ARCHIVED: '已归档', DRAFT: '草稿', INACTIVE: '已停用' })[value];
}

function readableError(error: unknown): string {
  if (!(error instanceof AdminApiError)) return 'Banner 列表加载失败，请稍后重试';
  if (error.status === 0) return '网络连接失败，请检查网络后重试';
  if (error.status === 403) return '当前账号无权访问 Banner 管理';
  if (error.status === 429) return '操作过于频繁，请稍后重试';
  return 'Banner 列表加载失败，请稍后重试';
}

async function handleSessionError(error: unknown): Promise<boolean> {
  if (authSession.state.session && (!(error instanceof AdminApiError) || error.status !== 401)) return false;
  items.value = [];
  total.value = 0;
  closeEditor();
  closeCommand();
  authSession.clearSession();
  await router.replace('/login');
  return true;
}

async function loadBanners(): Promise<void> {
  const sequence = ++listSequence;
  listController?.abort();
  const controller = new AbortController();
  listController = controller;
  loading.value = true;
  listError.value = '';
  try {
    const query: { keyword?: string; page: number; pageSize: number; status?: BannerStatus } = {
      page: page.value,
      pageSize,
    };
    const trimmedKeyword = keyword.value.trim();
    if (trimmedKeyword) query.keyword = trimmedKeyword;
    if (status.value) query.status = status.value;
    const result = await listAdminBanners(query, controller.signal);
    if (sequence !== listSequence) return;
    items.value = result.items;
    total.value = result.pagination.total;
    page.value = result.pagination.page;
  } catch (error) {
    if (isAbort(error) || sequence !== listSequence) return;
    if (await handleSessionError(error)) return;
    items.value = [];
    total.value = 0;
    listError.value = readableError(error);
  } finally {
    if (sequence === listSequence) {
      loading.value = false;
      listController = null;
    }
  }
}

function applyFilters(): void {
  page.value = 1;
  void loadBanners();
}

function resetFilters(): void {
  keyword.value = '';
  status.value = '';
  page.value = 1;
  void loadBanners();
}

function changePage(value: number): void {
  page.value = value;
  void loadBanners();
}

function openCreate(): void {
  editorItem.value = null;
  editorOpen.value = true;
}

function openEditor(item: BannerItem): void {
  if (item.status === 'ARCHIVED') return;
  editorItem.value = item;
  editorOpen.value = true;
}

function closeEditor(): void {
  editorOpen.value = false;
  editorItem.value = null;
}

function openCommand(item: BannerItem, nextCommand: BannerCommand): void {
  commandTarget.value = item;
  command.value = nextCommand;
  commandOpen.value = true;
}

function closeCommand(): void {
  commandOpen.value = false;
  commandTarget.value = null;
  command.value = null;
}

async function saved(): Promise<void> {
  const created = editorItem.value === null;
  closeEditor();
  ElMessage.success(created ? 'Banner 已创建为草稿' : 'Banner 资料已保存');
  await loadBanners();
}

async function commandCompleted(): Promise<void> {
  const completedCommand = command.value;
  closeCommand();
  ElMessage.success(({
    ACTIVATE: 'Banner 已启用',
    ARCHIVE: 'Banner 已归档',
    DEACTIVATE: 'Banner 已停用',
    RESTORE: 'Banner 已恢复为草稿',
  } as const)[completedCommand ?? 'ACTIVATE']);
  await loadBanners();
}

async function conflict(): Promise<void> {
  closeEditor();
  closeCommand();
  await loadBanners();
  ElMessage.warning('Banner 状态或版本已变化，已刷新最新数据，请重新检查后确认');
}

async function authExpired(error: AdminApiError): Promise<void> {
  await handleSessionError(error);
}

function targetLabel(item: BannerItem): string {
  if (item.target_type === 'NONE') return '不跳转';
  if (item.target_type === 'PRODUCT') return `商品 · ${item.target_id}`;
  if (item.target_type === 'CATEGORY') return `一级分类 · ${item.target_id}`;
  return `HTTPS 地址 · ${item.target_url}`;
}

function scheduleLabel(item: BannerItem): string {
  if (!item.starts_at && !item.ends_at) return '长期有效';
  const start = item.starts_at ? formatChinaDateTime(item.starts_at) : '不限';
  const end = item.ends_at ? formatChinaDateTime(item.ends_at) : '不限';
  return `${start} 至 ${end}`;
}

onMounted(() => void loadBanners());

onBeforeUnmount(() => {
  ++listSequence;
  listController?.abort();
  closeEditor();
  closeCommand();
});
</script>

<template>
  <AdminShell>
    <div
      class="banner-list-page"
      data-testid="banner-list-page"
    >
      <section class="page-heading">
        <div>
          <p>内容运营 · ADM-07</p>
          <h1>Banner 管理</h1>
          <span>维护首页广告图片、跳转目标、投放时间与独立生命周期。</span>
        </div>
        <el-button
          type="primary"
          @click="openCreate"
        >
          <el-icon><CirclePlus /></el-icon>
          新建 Banner
        </el-button>
      </section>

      <section
        class="banner-toolbar"
        aria-label="Banner 筛选"
      >
        <el-input
          v-model="keyword"
          clearable
          data-testid="banner-keyword"
          aria-label="Banner 关键词"
          placeholder="Banner 标题"
          @keyup.enter="applyFilters"
          @clear="applyFilters"
        >
          <template #prefix>
            <el-icon><Search /></el-icon>
          </template>
        </el-input>
        <el-select
          v-model="status"
          data-testid="banner-status-filter"
          aria-label="Banner 状态筛选"
          placeholder="默认（不含已归档）"
        >
          <el-option
            v-for="option in statusOptions"
            :key="option.value || 'DEFAULT'"
            v-bind="option"
          />
        </el-select>
        <div class="toolbar-actions">
          <el-button
            type="primary"
            @click="applyFilters"
          >
            <el-icon><Search /></el-icon>
            查询 Banner
          </el-button>
          <el-button @click="resetFilters">
            <el-icon><Refresh /></el-icon>
            重置筛选
          </el-button>
        </div>
      </section>

      <section
        class="banner-list"
        :class="{ refreshing: loading && items.length }"
      >
        <header class="banner-list-heading">
          <div>
            <strong>共 {{ total }} 个 Banner</strong>
            <span>默认不显示归档记录</span>
          </div>
          <el-button
            :icon="Refresh"
            :loading="loading"
            @click="loadBanners"
          >
            重新加载
          </el-button>
        </header>

        <div
          v-if="loading && !items.length"
          class="banner-state"
          data-testid="banner-list-loading"
        >
          <el-skeleton
            :rows="7"
            animated
          />
        </div>
        <div
          v-else-if="listError"
          class="banner-state"
          data-testid="banner-list-error"
        >
          <el-alert
            :title="listError"
            type="error"
            :closable="false"
            show-icon
          />
          <el-button @click="loadBanners">
            重试
          </el-button>
        </div>
        <div
          v-else-if="!items.length"
          class="banner-state empty"
          data-testid="banner-list-empty"
        >
          <el-icon><Picture /></el-icon>
          <strong>没有符合条件的 Banner</strong>
          <span>调整筛选条件后再试，或新建一个草稿 Banner。</span>
          <el-button @click="resetFilters">
            清除筛选
          </el-button>
        </div>
        <div
          v-else
          v-loading="loading"
          class="banner-grid"
          data-testid="banner-list"
          aria-label="Banner 列表"
        >
          <article
            v-for="item in items"
            :key="item.banner_id"
            class="banner-card"
            :data-testid="`banner-card-${item.banner_id}`"
          >
            <div class="banner-preview">
              <img
                v-if="safePublicAssetUrl(item.image_url)"
                :src="safePublicAssetUrl(item.image_url) ?? undefined"
                :alt="`${item.title} Banner 图片`"
                referrerpolicy="no-referrer"
              >
              <span v-else>
                <el-icon><Picture /></el-icon>
              </span>
              <small>排序 {{ item.sort_order }}</small>
            </div>

            <div class="banner-card-body">
              <header>
                <div>
                  <strong :title="item.title">{{ item.title }}</strong>
                  <small>{{ item.banner_id }}</small>
                </div>
                <span
                  class="banner-status"
                  :class="`is-${item.status.toLowerCase()}`"
                >{{ statusLabel(item.status) }}</span>
              </header>

              <dl>
                <div>
                  <dt>投放时间（北京时间）</dt>
                  <dd>{{ scheduleLabel(item) }}</dd>
                </div>
                <div>
                  <dt>跳转目标</dt>
                  <dd>{{ targetLabel(item) }}</dd>
                </div>
                <div>
                  <dt>图片文件</dt>
                  <dd>{{ item.file_id }}</dd>
                </div>
                <div>
                  <dt>版本</dt>
                  <dd>v{{ item.version }}</dd>
                </div>
              </dl>

              <footer class="banner-actions">
                <el-button
                  v-if="item.status !== 'ARCHIVED'"
                  link
                  type="primary"
                  @click="openEditor(item)"
                >
                  <el-icon><Edit /></el-icon>
                  编辑资料
                </el-button>
                <el-button
                  v-if="item.status === 'DRAFT' || item.status === 'INACTIVE'"
                  link
                  type="primary"
                  @click="openCommand(item, 'ACTIVATE')"
                >
                  启用
                </el-button>
                <el-button
                  v-if="item.status === 'ACTIVE'"
                  link
                  type="primary"
                  @click="openCommand(item, 'DEACTIVATE')"
                >
                  停用
                </el-button>
                <el-button
                  v-if="item.status === 'DRAFT' || item.status === 'INACTIVE'"
                  link
                  type="danger"
                  @click="openCommand(item, 'ARCHIVE')"
                >
                  归档
                </el-button>
                <el-button
                  v-if="item.status === 'ARCHIVED'"
                  link
                  type="primary"
                  @click="openCommand(item, 'RESTORE')"
                >
                  <el-icon><RefreshLeft /></el-icon>
                  恢复为草稿
                </el-button>
              </footer>
            </div>
          </article>
        </div>

        <footer
          v-if="total > pageSize && !listError"
          class="banner-pagination"
        >
          <span>第 {{ page }} / {{ totalPages }} 页</span>
          <div>
            <el-button
              circle
              :icon="ArrowLeft"
              :disabled="page <= 1 || loading"
              aria-label="上一页"
              title="上一页"
              @click="changePage(page - 1)"
            />
            <el-button
              circle
              :icon="ArrowRight"
              :disabled="page >= totalPages || loading"
              aria-label="下一页"
              title="下一页"
              @click="changePage(page + 1)"
            />
          </div>
        </footer>
      </section>
    </div>

    <BannerEditorDialog
      v-model:open="editorOpen"
      :item="editorItem"
      @saved="saved"
      @conflict="conflict"
      @auth-expired="authExpired"
    />
    <BannerCommandDialog
      v-model:open="commandOpen"
      :command="command"
      :target="commandTarget"
      @completed="commandCompleted"
      @conflict="conflict"
      @auth-expired="authExpired"
    />
  </AdminShell>
</template>

<style scoped>
.banner-list-page,
.banner-list,
.banner-grid,
.banner-card,
.banner-card-body {
  min-width: 0;
}

.banner-toolbar {
  display: grid;
  align-items: center;
  gap: 10px;
  margin-bottom: 18px;
  padding: 14px;
  border: 1px solid var(--admin-border);
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 1px 2px rgb(20 45 34 / 4%);
  grid-template-columns: minmax(220px, 1fr) minmax(180px, 0.45fr) auto;
}

.banner-toolbar :deep(.el-select),
.banner-toolbar :deep(.el-input) {
  width: 100%;
}

.toolbar-actions,
.banner-actions,
.banner-pagination > div {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.toolbar-actions .el-button + .el-button,
.banner-actions .el-button + .el-button,
.banner-pagination :deep(.el-button + .el-button) {
  margin-left: 0;
}

.banner-list.refreshing {
  opacity: 0.82;
}

.banner-list-heading {
  display: flex;
  min-height: 48px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}

.banner-list-heading > div {
  display: flex;
  align-items: baseline;
  gap: 12px;
}

.banner-list-heading strong {
  font-size: 13px;
}

.banner-list-heading span {
  color: var(--admin-muted);
  font-size: 11px;
}

.banner-state {
  display: grid;
  min-height: 320px;
  align-content: center;
  justify-items: center;
  gap: 14px;
  padding: 28px;
  border: 1px solid var(--admin-border);
  border-radius: 8px;
  background: #fff;
  text-align: center;
}

.banner-state > .el-alert,
.banner-state > .el-skeleton {
  width: min(100%, 700px);
}

.banner-state.empty > .el-icon {
  color: #9aac9f;
  font-size: 34px;
}

.banner-state.empty > span {
  color: var(--admin-muted);
  font-size: 12px;
}

.banner-grid {
  display: grid;
  gap: 14px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.banner-card {
  overflow: hidden;
  border: 1px solid var(--admin-border);
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 1px 2px rgb(20 45 34 / 4%);
}

.banner-preview {
  position: relative;
  width: 100%;
  aspect-ratio: 16 / 7;
  overflow: hidden;
  background: #e9f0ec;
}

.banner-preview > img,
.banner-preview > span {
  width: 100%;
  height: 100%;
}

.banner-preview > img {
  display: block;
  object-fit: cover;
}

.banner-preview > span {
  display: grid;
  color: #81958b;
  font-size: 32px;
  place-items: center;
}

.banner-preview > small {
  position: absolute;
  right: 10px;
  bottom: 10px;
  padding: 4px 7px;
  border-radius: 5px;
  color: #fff;
  background: rgb(23 42 35 / 78%);
  font-size: 10px;
}

.banner-card-body {
  display: grid;
  gap: 14px;
  padding: 15px;
}

.banner-card-body > header {
  display: flex;
  min-width: 0;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.banner-card-body > header > div {
  display: grid;
  min-width: 0;
  gap: 4px;
}

.banner-card-body > header strong,
.banner-card-body > header small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.banner-card-body > header strong {
  font-size: 15px;
}

.banner-card-body > header small {
  color: var(--admin-muted);
  font-size: 10px;
}

.banner-status {
  display: inline-flex;
  min-height: 24px;
  flex: 0 0 auto;
  align-items: center;
  padding: 0 8px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 650;
}

.banner-status.is-active { color: #27624f; background: #e5f1eb; }
.banner-status.is-inactive { color: #655f53; background: #f0eee9; }
.banner-status.is-draft { color: #806227; background: #f7efd9; }
.banner-status.is-archived { color: #777; background: #ededed; }

.banner-card dl {
  display: grid;
  min-width: 0;
  gap: 10px 14px;
  margin: 0;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.banner-card dl > div {
  display: grid;
  min-width: 0;
  gap: 3px;
}

.banner-card dt {
  color: var(--admin-muted);
  font-size: 10px;
}

.banner-card dd {
  min-width: 0;
  margin: 0;
  overflow-wrap: anywhere;
  color: var(--admin-text-soft);
  font-size: 11px;
  line-height: 1.5;
}

.banner-actions {
  padding-top: 10px;
  border-top: 1px solid var(--admin-border);
}

.banner-pagination {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  padding: 16px 0 0;
}

.banner-pagination > span {
  color: var(--admin-muted);
  font-size: 11px;
}

@media (max-width: 920px) {
  .banner-toolbar {
    grid-template-columns: minmax(0, 1fr) minmax(160px, 0.55fr);
  }

  .toolbar-actions {
    grid-column: 1 / -1;
  }

  .banner-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 620px) {
  .banner-toolbar {
    grid-template-columns: minmax(0, 1fr);
  }

  .toolbar-actions {
    display: grid;
    grid-column: auto;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .banner-list-heading > div {
    display: grid;
    gap: 3px;
  }

  .banner-card dl {
    grid-template-columns: minmax(0, 1fr);
  }

  .banner-pagination {
    justify-content: center;
  }
}

@media (max-width: 420px) {
  .toolbar-actions {
    grid-template-columns: minmax(0, 1fr);
  }

  .toolbar-actions .el-button {
    width: 100%;
  }
}
</style>
