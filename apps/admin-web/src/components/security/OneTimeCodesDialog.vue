<script setup lang="ts">
import { DocumentCopy, Warning } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';

const props = defineProps<{
  codes: readonly string[];
}>();

const emit = defineEmits<{
  acknowledged: [];
}>();

async function copyCodes(): Promise<void> {
  try {
    await navigator.clipboard.writeText(props.codes.join('\n'));
    ElMessage.success('恢复码已复制，请保存到安全位置');
  } catch {
    ElMessage.error('复制失败，请逐项安全记录');
  }
}
</script>

<template>
  <el-dialog
    :model-value="codes.length > 0"
    width="min(560px, calc(100vw - 32px))"
    :close-on-click-modal="false"
    :close-on-press-escape="false"
    :show-close="false"
    class="one-time-dialog"
  >
    <template #header>
      <div class="dialog-title">
        <span class="dialog-icon warning"><el-icon><Warning /></el-icon></span>
        <div>
          <h3>请立即保存恢复码</h3>
          <p>每个恢复码只能使用一次，关闭后无法再次查看。</p>
        </div>
      </div>
    </template>
    <div class="recovery-code-grid" data-testid="one-time-recovery-codes">
      <code v-for="(code, index) in codes" :key="index">{{ code }}</code>
    </div>
    <template #footer>
      <el-button :icon="DocumentCopy" @click="copyCodes">复制全部</el-button>
      <el-button type="primary" @click="emit('acknowledged')">我已安全保存</el-button>
    </template>
  </el-dialog>
</template>

