<script setup lang="ts">
import { Plus, Refresh, Search, View } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';

import AdminShell from '../../layouts/AdminShell.vue';
import { createAdminAgent, listAdminAgents } from '../../services/admin-agents';
import { AdminApiError, newIdempotencyKey } from '../../services/admin-api';
import { authSession } from '../../stores/auth-session';
import type { AgentCreateInput, AgentCreateResult, AdminAgentListItem, AdminAgentListQuery } from '../../types/admin-b13';
import { formatChinaDateTime } from '../../utils/time';

const router = useRouter();
const items = ref<AdminAgentListItem[]>([]);
const loading = ref(false);
const errorMessage = ref('');
const page = ref(1);
const pageSize = 20;
const total = ref(0);
const keyword = ref('');
const status = ref<AdminAgentListQuery['status'] | ''>('');
const authorizationMode = ref<AdminAgentListQuery['authorizationMode'] | ''>('');
const createOpen = ref(false);
const creating = ref(false);
const createUncertain = ref(false);
const createError = ref('');
const disclosure = ref<AgentCreateResult | null>(null);
const form = reactive<AgentCreateInput>({
  contact_name: '',
  contact_phone: null,
  login_name: '',
  name: '',
  product_authorization_mode: 'ALL_ACTIVE_PRODUCTS',
});
let sequence = 0;
let controller: AbortController | null = null;
let createController: AbortController | null = null;
let disclosureTimer: ReturnType<typeof setTimeout> | null = null;
let createAttempt: { input: AgentCreateInput; key: string } | null = null;

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)));
const formValid = computed(() => /^[a-z0-9][a-z0-9._-]{2,79}$/i.test(form.login_name.trim()) &&
  Array.from(form.name.trim()).length >= 2 && Array.from(form.name.trim()).length <= 120 &&
  Array.from(form.contact_name.trim()).length >= 1 && Array.from(form.contact_name.trim()).length <= 80 &&
  (!form.contact_phone || /^[0-9]{11}$/.test(form.contact_phone.trim())));

function query(): AdminAgentListQuery {
  const value: AdminAgentListQuery = { page: page.value, pageSize };
  if (keyword.value.trim()) value.keyword = keyword.value.trim();
  if (status.value) value.status = status.value;
  if (authorizationMode.value) value.authorizationMode = authorizationMode.value;
  return value;
}

function readableError(error: unknown): string {
  if (!(error instanceof AdminApiError)) return '代理列表加载失败，请稍后重试';
  if (error.status === 0) return '网络连接失败，请检查网络后重试';
  if (error.status === 403) return '当前账号无权访问代理管理';
  if (error.status === 429) return '查询过于频繁，请稍后重试';
  return '代理列表加载失败，请稍后重试';
}

async function handleExpired(error: unknown): Promise<boolean> {
  if (!(error instanceof AdminApiError) || error.status !== 401) return false;
  ++sequence;
  controller?.abort();
  createController?.abort();
  clearDisclosure();
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
    const result = await listAdminAgents(query(), current.signal);
    if (currentSequence !== sequence) return;
    items.value = result.items;
    page.value = result.pagination.page;
    total.value = result.pagination.total;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    if (currentSequence !== sequence || await handleExpired(error)) return;
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

function clearForm(): void {
  form.contact_name = '';
  form.contact_phone = null;
  form.login_name = '';
  form.name = '';
  form.product_authorization_mode = 'ALL_ACTIVE_PRODUCTS';
  createAttempt = null;
  createUncertain.value = false;
  createError.value = '';
}

function clearDisclosure(): void {
  if (disclosureTimer !== null) clearTimeout(disclosureTimer);
  disclosureTimer = null;
  disclosure.value = null;
}

async function create(): Promise<void> {
  if (creating.value || !formValid.value) return;
  creating.value = true;
  createError.value = '';
  createController?.abort();
  const current = new AbortController();
  createController = current;
  try {
    if (createAttempt === null) {
      createAttempt = {
        input: {
          contact_name: form.contact_name.trim(),
          contact_phone: form.contact_phone?.trim() || null,
          login_name: form.login_name.trim().toLowerCase(),
          name: form.name.trim(),
          product_authorization_mode: form.product_authorization_mode,
        },
        key: newIdempotencyKey(),
      };
    }
    const result = await createAdminAgent(createAttempt.input, createAttempt.key, current.signal);
    createAttempt = null;
    createUncertain.value = false;
    disclosure.value = result;
    createOpen.value = false;
    clearForm();
    if (result.disclosure_state === 'FIRST_ISSUE') {
      const remaining = Math.max(0, Math.min(10 * 60_000, Date.parse(result.expires_at) - Date.now()));
      disclosureTimer = setTimeout(clearDisclosure, remaining);
    }
    await load();
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    if (await handleExpired(error)) return;
    createUncertain.value = !(error instanceof AdminApiError) || error.status === 0 || error.status >= 500;
    if (!createUncertain.value) createAttempt = null;
    if (createUncertain.value) createError.value = '创建结果尚未确认，请保持当前表单并使用原请求重试';
    else if (error instanceof AdminApiError && error.status === 409) createError.value = '登录名已存在，请更换后重试';
    else if (error instanceof AdminApiError && error.status === 422) createError.value = '代理资料未通过业务校验';
    else createError.value = '代理创建未完成，请稍后重试';
  } finally {
    if (createController === current) createController = null;
    creating.value = false;
  }
}

function abandonCreate(): void {
  createOpen.value = false;
  clearForm();
  void load();
}

async function copySecret(value: string): Promise<void> {
  await navigator.clipboard.writeText(value);
  ElMessage.success('已复制，请通过受控渠道交接');
}

function search(): void { page.value = 1; void load(); }
function reset(): void { keyword.value = ''; status.value = ''; authorizationMode.value = ''; page.value = 1; void load(); }
function changePage(next: number): void { page.value = next; void load(); }

onMounted(() => void load());
onBeforeUnmount(() => {
  ++sequence;
  controller?.abort();
  createController?.abort();
  clearDisclosure();
  clearForm();
});
</script>

<template>
  <AdminShell>
    <div class="agents-page" data-testid="admin-agent-list-page">
      <section class="page-heading">
        <div><p>代理经营 · ADM-18</p><h1>一级代理</h1><span>创建、检索并进入代理经营下钻；密码和邀请码只在首次签发时展示。</span></div>
        <el-button type="primary" data-testid="agent-create-open" @click="createOpen = true"><el-icon><Plus /></el-icon>创建代理</el-button>
      </section>

      <section class="agent-filters">
        <el-input v-model="keyword" clearable placeholder="代理编号 / 名称 / 登录名" @keyup.enter="search"><template #prefix><el-icon><Search /></el-icon></template></el-input>
        <el-select v-model="status" clearable placeholder="全部状态"><el-option label="正常经营" value="ACTIVE" /><el-option label="已停用" value="DISABLED" /></el-select>
        <el-select v-model="authorizationMode" clearable placeholder="全部授权模式"><el-option label="全部在售商品" value="ALL_ACTIVE_PRODUCTS" /><el-option label="指定商品白名单" value="CUSTOM_WHITELIST" /></el-select>
        <div class="agent-filter-actions"><el-button type="primary" @click="search"><el-icon><Search /></el-icon>查询</el-button><el-button @click="reset"><el-icon><Refresh /></el-icon>重置</el-button></div>
      </section>

      <section class="agent-results">
        <header><div><strong>{{ total }} 个一级代理</strong><span>经营摘要与钱包余额均来自服务端投影</span></div><el-button text :loading="loading" @click="load"><el-icon><Refresh /></el-icon>刷新</el-button></header>
        <el-alert v-if="errorMessage" :title="errorMessage" type="error" :closable="false" show-icon><template #default><el-button link type="primary" @click="load">重新加载</el-button></template></el-alert>
        <div v-else-if="loading" class="agent-state"><el-skeleton :rows="7" animated /></div>
        <el-empty v-else-if="items.length === 0" description="没有符合条件的代理" />
        <template v-else>
          <div class="agent-table-wrap"><el-table :data="items">
            <el-table-column label="代理" min-width="180"><template #default="scope"><strong>{{ scope.row.name }}</strong><small>{{ scope.row.agent_no }} · {{ scope.row.login_name }}</small></template></el-table-column>
            <el-table-column label="状态" width="110"><template #default="scope"><el-tag :type="scope.row.status === 'ACTIVE' ? 'success' : 'info'">{{ scope.row.status === 'ACTIVE' ? '正常' : '停用' }}</el-tag></template></el-table-column>
            <el-table-column label="授权" min-width="145"><template #default="scope">{{ scope.row.product_authorization_mode === 'ALL_ACTIVE_PRODUCTS' ? '全部在售商品' : '指定白名单' }}</template></el-table-column>
            <el-table-column prop="active_customer_count" label="活跃客户" width="100" />
            <el-table-column label="净销售额" min-width="120"><template #default="scope">¥{{ scope.row.net_sales_amount }}</template></el-table-column>
            <el-table-column label="可用余额" min-width="120"><template #default="scope">¥{{ scope.row.available_balance }}</template></el-table-column>
            <el-table-column label="创建时间" min-width="170"><template #default="scope">{{ formatChinaDateTime(scope.row.created_at) }}</template></el-table-column>
            <el-table-column label="操作" width="92" fixed="right"><template #default="scope"><el-button link type="primary" @click="router.push(`/agents/${scope.row.agent_id}`)"><el-icon><View /></el-icon>详情</el-button></template></el-table-column>
          </el-table></div>
          <div class="agent-pagination"><span>第 {{ page }} / {{ totalPages }} 页</span><el-pagination small layout="prev, pager, next" :page-size="pageSize" :total="total" :current-page="page" @current-change="changePage" /></div>
        </template>
      </section>
    </div>

    <el-dialog
      v-model="createOpen"
      title="创建一级代理"
      width="min(560px, calc(100vw - 28px))"
      :close-on-click-modal="false"
      :close-on-press-escape="!creating && !createUncertain"
      :show-close="!creating && !createUncertain"
      destroy-on-close
      @closed="clearForm"
    >
      <el-form label-position="top" @submit.prevent="create">
        <el-alert v-if="createUncertain" title="请使用原请求重试；修改字段、关闭页面或换键会失去本次结果查询能力。" type="warning" :closable="false" show-icon />
        <div class="agent-form-grid"><el-form-item label="代理名称"><el-input v-model="form.name" maxlength="120" :disabled="creating || createUncertain" /></el-form-item><el-form-item label="登录账号"><el-input v-model="form.login_name" maxlength="80" autocomplete="off" :disabled="creating || createUncertain" /></el-form-item></div>
        <div class="agent-form-grid"><el-form-item label="联系人"><el-input v-model="form.contact_name" maxlength="80" :disabled="creating || createUncertain" /></el-form-item><el-form-item label="联系电话（可选）"><el-input v-model="form.contact_phone" maxlength="11" inputmode="numeric" autocomplete="off" :disabled="creating || createUncertain" /></el-form-item></div>
        <el-form-item label="商品授权"><el-segmented v-model="form.product_authorization_mode" :disabled="creating || createUncertain" :options="[{ label: '全部在售商品', value: 'ALL_ACTIVE_PRODUCTS' }, { label: '指定白名单', value: 'CUSTOM_WHITELIST' }]" /></el-form-item>
        <p v-if="createError" class="inline-error" role="alert">{{ createError }}</p>
      </el-form>
      <template #footer><el-button :disabled="creating" @click="createUncertain ? abandonCreate() : (createOpen = false)">{{ createUncertain ? '放弃并刷新' : '取消' }}</el-button><el-button type="primary" :loading="creating" :disabled="!formValid" @click="create">{{ createUncertain ? '使用原请求重试' : '创建并签发凭据' }}</el-button></template>
    </el-dialog>

    <el-dialog :model-value="disclosure !== null" title="一次性凭据交接" width="min(560px, calc(100vw - 28px))" :close-on-click-modal="false" destroy-on-close @close="clearDisclosure">
      <template v-if="disclosure?.disclosure_state === 'FIRST_ISSUE'">
        <el-alert title="以下内容只展示一次，关闭或到期后会从页面清除。" type="warning" :closable="false" show-icon />
        <div class="disclosure-list">
          <div><span>临时密码</span><code data-testid="agent-temporary-password">{{ disclosure.temporary_password }}</code><el-button text @click="copySecret(disclosure.temporary_password)">复制</el-button></div>
          <div><span>初始邀请码</span><code data-testid="agent-initial-invite-code">{{ disclosure.initial_invite_code.code }}</code><el-button text @click="copySecret(disclosure.initial_invite_code.code)">复制</el-button></div>
          <small>安全交接截止：{{ formatChinaDateTime(disclosure.expires_at) }}</small>
        </div>
      </template>
      <el-alert v-else-if="disclosure" title="该创建请求已被幂等重放，秘密不会再次披露；请从代理详情重新签发。" type="info" :closable="false" show-icon />
      <template #footer><el-button type="primary" @click="clearDisclosure">我已完成交接并清除</el-button></template>
    </el-dialog>
  </AdminShell>
</template>

<style scoped>
.agents-page { display: grid; gap: 18px; }
.agent-filters { display: grid; grid-template-columns: minmax(220px, 1.4fr) minmax(130px, .7fr) minmax(170px, 1fr) auto; gap: 10px; }
.agent-filter-actions { display: flex; gap: 8px; }
.agent-results { min-width: 0; border-top: 1px solid var(--admin-border); background: #fff; }
.agent-results > header { display: flex; min-height: 64px; align-items: center; justify-content: space-between; padding: 0 18px; border-bottom: 1px solid var(--admin-border); }
.agent-results > header div { display: grid; gap: 3px; }
.agent-results > header span, :deep(.el-table small) { display: block; color: var(--admin-muted); font-size: 11px; }
.agent-state { padding: 24px; }
.agent-table-wrap { overflow-x: auto; }
.agent-pagination { display: flex; align-items: center; justify-content: space-between; padding: 14px 18px; color: var(--admin-muted); font-size: 12px; }
.agent-form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.disclosure-list { display: grid; gap: 12px; margin-top: 18px; }
.disclosure-list > div { display: grid; grid-template-columns: 90px minmax(0, 1fr) auto; align-items: center; gap: 10px; padding: 12px; border: 1px solid var(--admin-border); }
.disclosure-list code { min-width: 0; overflow-wrap: anywhere; color: var(--admin-brand-dark); font-size: 14px; }
.disclosure-list small { color: var(--admin-muted); }
@media (max-width: 900px) { .agent-filters { grid-template-columns: repeat(2, minmax(0, 1fr)); } .agent-filter-actions { grid-column: 1 / -1; } }
@media (max-width: 600px) { .agent-filters, .agent-form-grid { grid-template-columns: 1fr; } .agent-filter-actions { grid-column: auto; } .agent-filter-actions .el-button { flex: 1; } .agent-pagination { align-items: flex-start; flex-direction: column; } .disclosure-list > div { grid-template-columns: 1fr auto; } .disclosure-list > div span { grid-column: 1 / -1; } }
</style>
