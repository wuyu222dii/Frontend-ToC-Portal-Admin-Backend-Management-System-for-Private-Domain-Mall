<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useRouter } from 'vue-router';

import type { AgentBankAccount, AgentWithdrawalInput } from '../services/agent';
import { AgentApiError, createAgentWithdrawal, newIdempotencyKey } from '../services/agent';
import { formatMoney, handleAuthError, moneyMinor } from '../utils/presentation';

const props = defineProps<{
  accounts: AgentBankAccount[];
  availableBalance: string;
  modelValue: boolean;
}>();
const emit = defineEmits<{ created: []; 'update:modelValue': [value: boolean] }>();
const router = useRouter();
const open = computed({ get: () => props.modelValue, set: (value) => emit('update:modelValue', value) });
const amount = ref('');
const bankAccountId = ref('');
const confirming = ref(false);
const pending = ref(false);
const uncertain = ref(false);
const errorMessage = ref('');
let intent: { body: AgentWithdrawalInput; key: string } | undefined;

const selectedAccount = computed(() => props.accounts.find((item) => item.bank_account_id === bankAccountId.value));

function clear(): void {
  amount.value = '';
  bankAccountId.value = '';
  confirming.value = false;
  pending.value = false;
  uncertain.value = false;
  errorMessage.value = '';
  intent = undefined;
}

watch(() => props.modelValue, (value) => {
  if (value && !bankAccountId.value) bankAccountId.value = props.accounts.find((item) => item.is_active)?.bank_account_id ?? '';
  if (!value && !uncertain.value) clear();
});
onBeforeUnmount(clear);

function validate(): boolean {
  const requestedMinor = moneyMinor(amount.value);
  if (!/^(?:0|[1-9]\d*)\.\d{2}$/.test(amount.value) || requestedMinor === null || requestedMinor <= 0n) {
    errorMessage.value = '请输入大于 0 且保留两位小数的提现金额';
    return false;
  }
  const availableMinor = moneyMinor(props.availableBalance);
  if (requestedMinor === null || availableMinor === null || requestedMinor > availableMinor) {
    errorMessage.value = '提现金额不能超过当前可用余额';
    return false;
  }
  if (!selectedAccount.value) {
    errorMessage.value = '请选择当前有效的收款银行卡';
    return false;
  }
  return true;
}

function continueToConfirm(): void {
  errorMessage.value = '';
  if (!validate()) return;
  intent = { body: { amount: amount.value, bank_account_id: bankAccountId.value }, key: newIdempotencyKey() };
  confirming.value = true;
}

function readable(error: AgentApiError): string {
  if (error.status === 409) return '余额或提现状态已变化，请关闭后刷新再提交';
  if (error.status === 422) return '当前金额不符合提现规则，请调整后重试';
  if (error.status === 429) return '提交过于频繁，请稍后使用同一请求重试';
  if (error.status === 403) return '当前钱包状态不允许提现';
  return '提现暂时无法提交，请稍后重试';
}

async function confirm(): Promise<void> {
  if (pending.value || !intent) return;
  pending.value = true;
  errorMessage.value = '';
  try {
    await createAgentWithdrawal(intent.body, intent.key);
    uncertain.value = false;
    clear();
    emit('created');
    open.value = false;
  } catch (error) {
    if (await handleAuthError(error, router)) return;
    if (!(error instanceof AgentApiError) || error.status === 0 || error.status >= 500) {
      uncertain.value = true;
      errorMessage.value = '响应未确认。请保留此页面，并使用原请求重试以查询同一提交结果。';
    } else {
      uncertain.value = false;
      errorMessage.value = readable(error);
      if (error.status !== 429) {
        intent = undefined;
        confirming.value = false;
      }
    }
  } finally {
    pending.value = false;
  }
}
</script>

<template>
  <el-dialog v-model="open" data-testid="withdrawal-dialog" :close-on-click-modal="!pending && !uncertain" :close-on-press-escape="!pending && !uncertain" :show-close="!pending && !uncertain" destroy-on-close title="申请提现" width="520px">
    <el-form v-if="!confirming" data-testid="withdrawal-form" label-position="top" @submit.prevent="continueToConfirm">
      <el-form-item label="提现金额">
        <el-input v-model="amount" data-testid="withdrawal-amount" inputmode="decimal" placeholder="0.00">
          <template #prepend>¥</template>
        </el-input>
        <small class="dialog-note">可用余额 {{ formatMoney(availableBalance) }}</small>
      </el-form-item>
      <el-form-item label="收款银行卡">
        <el-select v-model="bankAccountId" data-testid="withdrawal-bank" style="width: 100%">
          <el-option v-for="account in accounts.filter((item) => item.is_active)" :key="account.bank_account_id" :label="`${account.bank_name} ${account.account_number_masked}`" :value="account.bank_account_id" />
        </el-select>
      </el-form-item>
    </el-form>
    <div v-else class="amount-preview" data-testid="withdrawal-confirmation">
      <small>确认冻结金额</small>
      <strong>{{ formatMoney(intent?.body.amount ?? amount) }}</strong>
      <p>{{ selectedAccount?.bank_name }} {{ selectedAccount?.account_number_masked }}</p>
      <span class="dialog-note">提交后不可撤回；金额将从可用余额转入冻结余额，审核期间不可再次使用。</span>
    </div>
    <p v-if="errorMessage" class="inline-error" data-testid="withdrawal-error" role="alert" style="margin-top: 14px">{{ errorMessage }}</p>
    <template #footer>
      <div class="dialog-actions">
        <el-button v-if="!uncertain" :disabled="pending" @click="confirming ? (confirming = false, intent = undefined) : (open = false)">{{ confirming ? '返回修改' : '取消' }}</el-button>
        <el-button v-if="!confirming" data-testid="withdrawal-continue" type="primary" @click="continueToConfirm">核对申请</el-button>
        <el-button v-else :data-testid="uncertain ? 'withdrawal-retry' : 'withdrawal-confirm'" :loading="pending" type="primary" @click="confirm">{{ uncertain ? '使用原请求重试' : '确认提交' }}</el-button>
      </div>
    </template>
  </el-dialog>
</template>
