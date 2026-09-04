<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useRouter } from 'vue-router';

import type { AgentBankAccountInput } from '../services/agent';
import { AgentApiError, newIdempotencyKey, replaceAgentBankAccount } from '../services/agent';
import { handleAuthError } from '../utils/presentation';

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ saved: []; 'update:modelValue': [value: boolean] }>();
const router = useRouter();
const open = computed({ get: () => props.modelValue, set: (value) => emit('update:modelValue', value) });
const holder = ref('');
const bank = ref('');
const number = ref('');
const pending = ref(false);
const uncertain = ref(false);
const errorMessage = ref('');
let intent: { body: AgentBankAccountInput; key: string } | undefined;

function clear(): void {
  holder.value = '';
  bank.value = '';
  number.value = '';
  errorMessage.value = '';
  pending.value = false;
  uncertain.value = false;
  intent = undefined;
}

watch(() => props.modelValue, (value) => { if (!value) clear(); });
onBeforeUnmount(clear);

function readable(error: unknown): string {
  if (!(error instanceof AgentApiError)) return '保存结果未知，请检查网络后重试';
  if (error.status === 409) return '银行卡状态已变化，请刷新后重新填写';
  if (error.status === 422 || error.status === 400) return '请检查持卡人、银行名称和卡号格式';
  if (error.status === 429) return '操作过于频繁，请稍后再试';
  if (error.status === 403) return '当前账号不可维护银行卡';
  return '银行卡暂时无法保存，请稍后重试';
}

async function submit(): Promise<void> {
  if (pending.value) return;
  errorMessage.value = '';
  if (!intent) {
    const normalized = number.value.replace(/[ -]/g, '');
    if (!holder.value.trim() || !bank.value.trim() || !/^\d{6,32}$/.test(normalized)) {
      errorMessage.value = '请填写持卡人、银行名称和 6 至 32 位数字卡号';
      return;
    }
    intent = {
      body: {
        account_holder: holder.value.trim(),
        bank_name: bank.value.trim(),
        account_number: number.value,
      },
      key: newIdempotencyKey(),
    };
  }
  pending.value = true;
  try {
    await replaceAgentBankAccount(intent.body, intent.key);
    uncertain.value = false;
    clear();
    emit('saved');
    open.value = false;
  } catch (error) {
    if (await handleAuthError(error, router)) return;
    uncertain.value = !(error instanceof AgentApiError) || error.status === 0 || error.status >= 500;
    errorMessage.value = uncertain.value
      ? '保存结果未确认。请保留此页面，并使用原请求重试。'
      : readable(error);
    if (!uncertain.value) intent = undefined;
  } finally {
    pending.value = false;
  }
}
</script>

<template>
  <el-dialog v-model="open" data-testid="bank-account-dialog" :close-on-click-modal="!pending && !uncertain" :close-on-press-escape="!pending && !uncertain" :show-close="!pending && !uncertain" destroy-on-close title="更换收款银行卡" width="500px">
    <div class="notice">完整卡号仅用于本次加密写入。保存后工作台只显示掩码，旧卡不会用于新的提现申请。</div>
    <el-form class="auth-form" label-position="top" data-testid="bank-account-form" style="margin-top: 18px" @submit.prevent="submit">
      <el-form-item label="持卡人">
        <el-input v-model="holder" autocomplete="off" data-testid="bank-account-holder" :disabled="pending || uncertain" />
      </el-form-item>
      <el-form-item label="开户银行">
        <el-input v-model="bank" autocomplete="off" data-testid="bank-account-bank" :disabled="pending || uncertain" />
      </el-form-item>
      <el-form-item label="银行卡号">
        <el-input v-model="number" autocomplete="off" data-testid="bank-account-number" :disabled="pending || uncertain" inputmode="numeric" placeholder="可使用空格或连字符分隔" />
      </el-form-item>
      <p v-if="errorMessage" class="inline-error" data-testid="bank-account-error" role="alert">{{ errorMessage }}</p>
    </el-form>
    <template #footer>
      <div class="dialog-actions">
        <el-button v-if="!uncertain" :disabled="pending" @click="open = false">取消</el-button>
        <el-button data-testid="bank-account-submit" :loading="pending" type="primary" @click="submit">{{ uncertain ? '使用原请求重试' : '加密保存' }}</el-button>
      </div>
    </template>
  </el-dialog>
</template>
