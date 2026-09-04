<script setup lang="ts">
import { Lock, Refresh, Search } from '@element-plus/icons-vue';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import AdminShell from '../../layouts/AdminShell.vue';
import { listAdminAuditLogs } from '../../services/admin-audit';
import { AdminApiError } from '../../services/admin-api';
import { authSession } from '../../stores/auth-session';
import type { AuditLog, AuditLogListQuery } from '../../types/admin-b13';
import { formatChinaDateTime } from '../../utils/time';

const route = useRoute();
const router = useRouter();
const items = ref<AuditLog[]>([]);
const loading = ref(false);
const errorMessage = ref('');
const page = ref(1);
const pageSize = 20;
const total = ref(0);
const actorId = ref('');
const moduleName = ref('');
const action = ref('');
const resultCode = ref('');
const dateRange = ref<[string, string] | null>(null);
let sequence = 0;
let controller: AbortController | null = null;
let mounted = false;

function routeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

const lockedTarget = computed(() => {
  const type = routeText(route.query.target_type);
  const id = routeText(route.query.target_id);
  return type && id ? { id, type } : null;
});
const lockedTargetKey = computed(() => `${routeText(route.query.target_type)}\u0000${routeText(route.query.target_id)}`);
const targetType = ref(lockedTarget.value?.type ?? '');
const targetId = ref(lockedTarget.value?.id ?? '');
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)));

function query(): AuditLogListQuery {
  const value: AuditLogListQuery = { page: page.value, pageSize };
  if (actorId.value.trim()) value.actorId = actorId.value.trim();
  if (moduleName.value.trim()) value.module = moduleName.value.trim();
  if (action.value.trim()) value.action = action.value.trim();
  if (resultCode.value.trim()) value.resultCode = resultCode.value.trim();
  if (lockedTarget.value) {
    value.targetType = lockedTarget.value.type;
    value.targetId = lockedTarget.value.id;
  } else {
    if (targetType.value.trim()) value.targetType = targetType.value.trim();
    if (targetId.value.trim()) value.targetId = targetId.value.trim();
  }
  if (dateRange.value) [value.dateFrom, value.dateTo] = dateRange.value;
  return value;
}

function readableError(error: unknown): string {
  if (!(error instanceof AdminApiError)) return '审计日志加载失败，请稍后重试';
  if (error.status === 0) return '网络连接失败，请检查网络后重试';
  if (error.status === 400) return '筛选条件无效，请检查目标类型、目标 ID 或日期范围';
  if (error.status === 403) return '当前账号无权访问审计日志';
  if (error.status === 429) {
    return error.retryAfterSeconds
      ? `查询过于频繁，请在 ${error.retryAfterSeconds} 秒后重试`
      : '查询过于频繁，请稍后重试';
  }
  if (error.status >= 500) return '审计服务暂时不可用，请稍后重试';
  return '审计日志加载失败，请稍后重试';
}

async function redirectIfExpired(error: unknown): Promise<boolean> {
  if (!(error instanceof AdminApiError) || error.status !== 401) return false;
  ++sequence;
  controller?.abort();
  authSession.clearSession();
  await router.replace('/login');
  return true;
}

async function load(): Promise<void> {
  const currentSequence = ++sequence;
  controller?.abort();
  const current = new AbortController();
  controller = current;
  loading.value = true;
  errorMessage.value = '';
  try {
    const result = await listAdminAuditLogs(query(), current.signal);
    if (currentSequence !== sequence) return;
    items.value = result.items;
    page.value = result.pagination.page;
    total.value = result.pagination.total;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    if (currentSequence !== sequence || await redirectIfExpired(error)) return;
    items.value = [];
    total.value = 0;
    errorMessage.value = readableError(error);
  } finally {
    if (currentSequence === sequence) {
      loading.value = false;
      controller = null;
    }
  }
}

function search(): void {
  page.value = 1;
  void load();
}

function reset(): void {
  actorId.value = '';
  moduleName.value = '';
  action.value = '';
  resultCode.value = '';
  targetType.value = lockedTarget.value?.type ?? '';
  targetId.value = lockedTarget.value?.id ?? '';
  dateRange.value = null;
  page.value = 1;
  void load();
}

function changePage(next: number): void {
  page.value = next;
  void load();
}

watch(lockedTargetKey, () => {
  targetType.value = lockedTarget.value?.type ?? '';
  targetId.value = lockedTarget.value?.id ?? '';
  page.value = 1;
  if (mounted) void load();
});
onMounted(() => {
  mounted = true;
  void load();
});
onBeforeUnmount(() => {
  ++sequence;
  controller?.abort();
});
</script>

<template>
  <AdminShell>
    <div class="audit-page" data-testid="admin-audit-page">
      <section class="page-heading">
        <div>
          <p>风险控制 · ADM-17</p>
          <h1>审计日志</h1>
          <span>查询关键业务与安全操作；变更内容仅展示服务端生成的字段级脱敏摘要。</span>
        </div>
      </section>

      <el-alert
        v-if="lockedTarget"
        data-testid="audit-target-lock"
        type="info"
        :closable="false"
        show-icon
      >
        <template #title>
          <span class="locked-target"><el-icon><Lock /></el-icon>已锁定对象 {{ lockedTarget.type }} · {{ lockedTarget.id }}</span>
        </template>
      </el-alert>

      <section class="audit-filters" aria-label="审计日志筛选">
        <el-input v-model="actorId" clearable placeholder="操作者账户 ULID" @keyup.enter="search" />
        <el-input v-model="moduleName" clearable placeholder="业务模块" @keyup.enter="search" />
        <el-input v-model="action" clearable placeholder="动作" @keyup.enter="search" />
        <el-input v-model="resultCode" clearable placeholder="结果码" @keyup.enter="search" />
        <el-input v-model="targetType" :clearable="!lockedTarget" data-testid="audit-target-type-filter" placeholder="目标类型" :disabled="Boolean(lockedTarget)" @keyup.enter="search" />
        <el-input v-model="targetId" :clearable="!lockedTarget" data-testid="audit-target-id-filter" placeholder="目标 ID" :disabled="Boolean(lockedTarget)" @keyup.enter="search" />
        <el-date-picker
          v-model="dateRange"
          type="daterange"
          value-format="YYYY-MM-DD"
          start-placeholder="开始日期"
          end-placeholder="结束日期"
        />
        <div class="filter-actions">
          <el-button type="primary" data-testid="audit-search" @click="search"><el-icon><Search /></el-icon>查询</el-button>
          <el-button data-testid="audit-reset" @click="reset"><el-icon><Refresh /></el-icon>重置</el-button>
        </div>
      </section>

      <section class="audit-results" data-testid="audit-results">
        <header>
          <div><strong>{{ total }} 条审计记录</strong><span>按发生时间倒序</span></div>
          <el-button text :loading="loading" aria-label="刷新审计日志" @click="load"><el-icon><Refresh /></el-icon>刷新</el-button>
        </header>

        <el-alert v-if="errorMessage" :title="errorMessage" type="error" :closable="false" show-icon>
          <template #default><el-button link type="primary" @click="load">重新加载</el-button></template>
        </el-alert>
        <el-table
          v-else
          v-loading="loading"
          :data="items"
          row-key="audit_id"
          empty-text="当前筛选下暂无审计记录"
          element-loading-text="正在读取审计日志"
        >
          <el-table-column type="expand" width="48">
            <template #default="{ row }">
              <div class="audit-detail" data-testid="audit-summary">
                <dl class="audit-metadata">
                  <div><dt>请求 ID</dt><dd>{{ row.request_id }}</dd></div>
                  <div><dt>幂等标识</dt><dd>{{ row.idempotency_key ?? '无' }}</dd></div>
                  <div><dt>IP 哈希</dt><dd>{{ row.ip_hash ?? '无' }}</dd></div>
                  <div><dt>操作原因</dt><dd>{{ row.reason ?? '未记录' }}</dd></div>
                </dl>
                <div class="summary-grid">
                  <section>
                    <h3>变更前 <small>{{ row.before_version === null ? '无版本' : `v${row.before_version}` }}</small></h3>
                    <p v-if="row.before_summary.length === 0">无字段摘要</p>
                    <ul v-else>
                      <li v-for="summary in row.before_summary" :key="`${summary.field}-${summary.display_value}`">
                        <code>{{ summary.field }}</code><span>{{ summary.display_value }}</span><el-tag v-if="summary.sensitive" size="small" type="warning">敏感字段</el-tag>
                      </li>
                    </ul>
                  </section>
                  <section>
                    <h3>变更后 <small>{{ row.after_version === null ? '无版本' : `v${row.after_version}` }}</small></h3>
                    <p v-if="row.after_summary.length === 0">无字段摘要</p>
                    <ul v-else>
                      <li v-for="summary in row.after_summary" :key="`${summary.field}-${summary.display_value}`">
                        <code>{{ summary.field }}</code><span>{{ summary.display_value }}</span><el-tag v-if="summary.sensitive" size="small" type="warning">敏感字段</el-tag>
                      </li>
                    </ul>
                  </section>
                </div>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="操作者" min-width="210">
            <template #default="{ row }"><div class="primary-cell"><strong>{{ row.actor_role }}</strong><span>{{ row.actor_account_id }}</span></div></template>
          </el-table-column>
          <el-table-column label="模块 / 动作" min-width="190">
            <template #default="{ row }"><div class="primary-cell"><strong>{{ row.module }}</strong><span>{{ row.action }}</span></div></template>
          </el-table-column>
          <el-table-column label="目标对象" min-width="210">
            <template #default="{ row }"><div class="primary-cell"><strong>{{ row.target_type }}</strong><span>{{ row.target_id ?? '无目标 ID' }}</span></div></template>
          </el-table-column>
          <el-table-column label="结果" min-width="140">
            <template #default="{ row }"><div class="primary-cell"><el-tag :type="row.result === 'SUCCESS' ? 'success' : 'danger'" effect="plain">{{ row.result === 'SUCCESS' ? '成功' : '失败' }}</el-tag><span>{{ row.result_code }}</span></div></template>
          </el-table-column>
          <el-table-column label="发生时间" min-width="175">
            <template #default="{ row }">{{ formatChinaDateTime(row.created_at) }}</template>
          </el-table-column>
        </el-table>

        <footer v-if="total > pageSize">
          <span>第 {{ page }} / {{ totalPages }} 页</span>
          <el-pagination layout="prev, pager, next" :current-page="page" :page-size="pageSize" :total="total" @current-change="changePage" />
        </footer>
      </section>
    </div>
  </AdminShell>
</template>

<style scoped>
.audit-page { display: grid; min-width: 0; gap: 16px; }
.audit-page .page-heading { margin-bottom: 0; }
.locked-target { display: inline-flex; align-items: center; gap: 6px; overflow-wrap: anywhere; }
.audit-filters { display: grid; grid-template-columns: repeat(4, minmax(150px, 1fr)); gap: 12px; padding: 16px; border: 1px solid var(--admin-border); border-radius: 7px; background: #fff; }
.audit-filters :deep(.el-date-editor) { width: 100%; min-width: 0; }
.filter-actions { display: flex; justify-content: flex-end; gap: 8px; }
.audit-results { min-width: 0; overflow: hidden; border: 1px solid var(--admin-border); border-radius: 7px; background: #fff; }
.audit-results > header, .audit-results > footer { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 14px 16px; }
.audit-results > header { border-bottom: 1px solid var(--admin-border); }
.audit-results > footer { border-top: 1px solid var(--admin-border); color: var(--admin-muted); font-size: 12px; }
.audit-results > header > div { display: flex; align-items: baseline; gap: 10px; }
.audit-results > header span, .primary-cell span { color: var(--admin-muted); font-size: 11px; }
.audit-results :deep(.el-alert) { margin: 14px; }
.primary-cell { display: grid; gap: 4px; overflow-wrap: anywhere; }
.audit-detail { display: grid; gap: 18px; padding: 18px 24px; background: #f8faf9; }
.audit-metadata { display: grid; gap: 12px; margin: 0; grid-template-columns: repeat(2, minmax(0, 1fr)); }
.audit-metadata div { min-width: 0; }
.audit-metadata dt { color: var(--admin-muted); font-size: 11px; }
.audit-metadata dd { margin: 4px 0 0; overflow-wrap: anywhere; font-size: 12px; }
.summary-grid { display: grid; gap: 14px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
.summary-grid section { min-width: 0; padding: 14px; border: 1px solid var(--admin-border); background: #fff; }
.summary-grid h3 { margin: 0 0 10px; font-size: 13px; }
.summary-grid h3 small, .summary-grid p { color: var(--admin-muted); font-size: 11px; }
.summary-grid ul { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
.summary-grid li { display: grid; align-items: center; gap: 8px; grid-template-columns: minmax(90px, 0.8fr) minmax(0, 1fr) auto; font-size: 12px; }
.summary-grid code, .summary-grid span { min-width: 0; overflow-wrap: anywhere; }
@media (max-width: 1024px) { .audit-filters { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 680px) { .audit-filters { grid-template-columns: minmax(0, 1fr); padding: 12px; } .filter-actions .el-button { flex: 1; } .audit-results > header > div, .audit-results > footer { align-items: flex-start; flex-direction: column; } .audit-metadata, .summary-grid { grid-template-columns: 1fr; } .audit-detail { padding: 14px; } .summary-grid li { grid-template-columns: minmax(80px, 0.8fr) minmax(0, 1fr); } .summary-grid li .el-tag { grid-column: 2; justify-self: flex-start; } }
</style>
