<script setup lang="ts">
import { Lock, Setting } from '@element-plus/icons-vue';

import AdminShell from '../../layouts/AdminShell.vue';
</script>

<template>
  <AdminShell>
    <section class="page-heading">
      <div>
        <p>总部安全入口 · B2</p>
        <h1>工作台</h1>
        <span>管理员安全登录已就绪，业务模块将在对应批次完成后开放。</span>
      </div>
    </section>
    <section class="workspace-empty" aria-labelledby="workspace-title">
      <span class="workspace-empty-icon"><el-icon><Lock /></el-icon></span>
      <p>SECURE WORKSPACE</p>
      <h2 id="workspace-title">当前没有可用的业务模块</h2>
      <span>本批次仅开放账户安全能力，未完成的业务导航不会显示。</span>
      <el-button type="primary" :icon="Setting" @click="$router.push('/settings/account/security')">管理账户安全</el-button>
    </section>
  </AdminShell>
</template>
