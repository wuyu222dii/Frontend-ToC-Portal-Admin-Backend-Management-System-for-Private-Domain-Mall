<script setup lang="ts">
import { Document, Refresh } from '@element-plus/icons-vue';

defineProps<{
  empty?: boolean;
  emptyMessage?: string;
  error?: string;
  loading?: boolean;
  testid: string;
}>();

defineEmits<{ retry: [] }>();
</script>

<template>
  <div v-if="loading" class="page-state" :data-testid="`${testid}-loading`">
    <el-skeleton :rows="7" animated />
  </div>
  <div v-else-if="error" class="page-state centered" :data-testid="`${testid}-error`" role="alert">
    <el-icon><Document /></el-icon>
    <strong>{{ error }}</strong>
    <el-button type="primary" @click="$emit('retry')">
      <el-icon><Refresh /></el-icon>重新加载
    </el-button>
  </div>
  <div v-else-if="empty" class="page-state centered" :data-testid="`${testid}-empty`">
    <el-icon><Document /></el-icon>
    <strong>{{ emptyMessage || '暂无数据' }}</strong>
  </div>
  <slot v-else />
</template>
