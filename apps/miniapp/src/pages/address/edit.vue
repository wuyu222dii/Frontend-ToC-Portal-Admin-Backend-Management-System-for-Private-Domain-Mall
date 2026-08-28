<script setup lang="ts">
/* global uni */
import { onLoad, onShow, onUnload } from '@dcloudio/uni-app';
import { computed, ref } from 'vue';

import {
  createIdempotencyKey,
  createStoreAddress,
  getStoreAddress,
  updateStoreAddress,
} from '../../api';
import { StoreApiError } from '../../api/store-client';
import QxAccountHeader from '../../components/storefront/QxAccountHeader.vue';
import QxCatalogState from '../../components/storefront/QxCatalogState.vue';
import QxStoreShell from '../../components/storefront/QxStoreShell.vue';
import type { AddressWriteInput, StoreAddressDetail } from '../../types/store-shopping';
import {
  clearCustomerSession,
  hasRefreshableCustomerSession,
} from '../../utils/customer-session';
import { openLoginForAction } from '../../utils/protected-action';

type PageState = 'loading' | 'ready' | 'auth-required' | 'not-found' | 'error' | 'rate-limited';
type FieldName = 'recipient_name' | 'phone' | 'province' | 'city' | 'district' | 'detail';

interface VolatileCommand {
  fingerprint: string;
  idempotencyKey: string;
}

const state = ref<PageState>('loading');
const addressId = ref<string | null>(null);
const version = ref<number | null>(null);
const recipientName = ref('');
const phone = ref('');
const province = ref('');
const city = ref('');
const district = ref('');
const detail = ref('');
const isDefault = ref(false);
const pending = ref(false);
const dirty = ref(false);
const message = ref('');
const conflict = ref(false);
const retryAfterSeconds = ref(0);
const slowRequest = ref(false);
const fieldErrors = ref<Partial<Record<FieldName, string>>>({});

let loadGeneration = 0;
let slowTimer: ReturnType<typeof setTimeout> | undefined;
let volatileCommand: VolatileCommand | null = null;
let reloadAfterAuthentication = false;
let preserveSensitiveOnLoadFailure = false;

const editing = computed(() => addressId.value !== null);
const pageTitle = computed(() => editing.value ? '编辑地址' : '新增地址');
const loadingDescription = computed(() => slowRequest.value
  ? '网络响应较慢，正在继续读取本人地址。'
  : '正在读取本人地址详情。');

function clearSlowTimer() {
  if (slowTimer !== undefined) {
    clearTimeout(slowTimer);
    slowTimer = undefined;
  }
}

function clearSensitiveFields() {
  recipientName.value = '';
  phone.value = '';
  province.value = '';
  city.value = '';
  district.value = '';
  detail.value = '';
  volatileCommand = null;
}

function requireLogin(reloadAddress = false) {
  reloadAfterAuthentication = reloadAddress;
  clearCustomerSession();
  openLoginForAction({
    type: 'ADDRESS_EDIT',
    ...(addressId.value === null ? {} : { address_id: addressId.value }),
  });
}

function retryLogin() {
  requireLogin(true);
}

function isUlid(value: string): boolean {
  return /^[0-9A-HJKMNP-TV-Z]{26}$/i.test(value);
}

function markDirty() {
  dirty.value = true;
  if (!conflict.value) message.value = '';
  volatileCommand = null;
}

function applyAddress(next: StoreAddressDetail) {
  recipientName.value = next.recipient_name;
  phone.value = next.phone;
  province.value = next.province;
  city.value = next.city;
  district.value = next.district;
  detail.value = next.detail;
  isDefault.value = next.is_default;
  version.value = next.version;
  fieldErrors.value = {};
  dirty.value = false;
  conflict.value = false;
  volatileCommand = null;
  preserveSensitiveOnLoadFailure = false;
}

function returnToList() {
  void uni.navigateBack({
    fail: () => {
      void uni.redirectTo({ url: '/pages/address/index' });
    },
  });
}

async function loadAddress(afterConflict = false) {
  const currentId = addressId.value;
  if (currentId === null) {
    state.value = 'ready';
    return;
  }
  const generation = ++loadGeneration;
  if (afterConflict) preserveSensitiveOnLoadFailure = true;
  clearSlowTimer();
  state.value = 'loading';
  retryAfterSeconds.value = 0;
  slowRequest.value = false;
  message.value = '';
  slowTimer = setTimeout(() => {
    if (generation === loadGeneration && state.value === 'loading') slowRequest.value = true;
  }, 800);
  try {
    const next = await getStoreAddress(currentId);
    if (generation !== loadGeneration) return;
    applyAddress(next);
    state.value = 'ready';
    if (afterConflict) message.value = '已加载服务端最新地址，请重新修改并确认保存。';
  } catch (error) {
    if (generation !== loadGeneration) return;
    const clearsSensitiveFields = !preserveSensitiveOnLoadFailure ||
      (error instanceof StoreApiError && (error.status === 401 || error.status === 404));
    if (clearsSensitiveFields) {
      clearSensitiveFields();
      version.value = null;
      preserveSensitiveOnLoadFailure = false;
    }
    if (error instanceof StoreApiError && error.status === 401) {
      requireLogin(true);
      return;
    }
    if (error instanceof StoreApiError && error.status === 404) {
      state.value = 'not-found';
    } else if (error instanceof StoreApiError && error.status === 429) {
      retryAfterSeconds.value = error.retryAfterSeconds ?? 1;
      state.value = 'rate-limited';
    } else {
      state.value = 'error';
    }
  } finally {
    if (generation === loadGeneration) {
      clearSlowTimer();
      slowRequest.value = false;
    }
  }
}

function normalizedText(
  field: FieldName,
  value: string,
  label: string,
  maximum: number,
): string | null {
  const normalized = value.trim();
  if (normalized.length === 0) {
    fieldErrors.value[field] = `请填写${label}。`;
    return null;
  }
  if (/\p{Cc}/u.test(value)) {
    fieldErrors.value[field] = `${label}不能包含控制字符。`;
    return null;
  }
  if (Array.from(normalized).length > maximum) {
    fieldErrors.value[field] = `${label}不能超过 ${maximum} 个字符。`;
    return null;
  }
  return normalized;
}

function validatedInput(): AddressWriteInput | null {
  fieldErrors.value = {};
  const nextRecipient = normalizedText('recipient_name', recipientName.value, '收货人', 80);
  const nextProvince = normalizedText('province', province.value, '省', 80);
  const nextCity = normalizedText('city', city.value, '市', 80);
  const nextDistrict = normalizedText('district', district.value, '区', 80);
  const nextDetail = normalizedText('detail', detail.value, '详细地址', 300);
  if (!/^[0-9]{11}$/.test(phone.value)) {
    fieldErrors.value.phone = '请输入 11 位 ASCII 数字手机号。';
  }
  if (nextRecipient === null || nextProvince === null || nextCity === null ||
    nextDistrict === null || nextDetail === null || fieldErrors.value.phone) {
    message.value = '请检查标记的地址字段。';
    return null;
  }
  return {
    recipient_name: nextRecipient,
    phone: phone.value,
    province: nextProvince,
    city: nextCity,
    district: nextDistrict,
    detail: nextDetail,
    is_default: isDefault.value,
  };
}

function commandKey(input: AddressWriteInput, currentVersion: number | null): string {
  const fingerprint = JSON.stringify({
    address_id: addressId.value,
    input,
    version: currentVersion,
  });
  if (volatileCommand?.fingerprint === fingerprint) return volatileCommand.idempotencyKey;
  volatileCommand = { fingerprint, idempotencyKey: createIdempotencyKey() };
  return volatileCommand.idempotencyKey;
}

function mapMutationError(error: unknown) {
  if (error instanceof StoreApiError && error.status === 401) {
    requireLogin();
    return;
  }
  if (error instanceof StoreApiError && error.status === 404) {
    clearSensitiveFields();
    version.value = null;
    state.value = 'not-found';
    return;
  }
  if (error instanceof StoreApiError && error.status === 409) {
    conflict.value = true;
    message.value = addressId.value === null
      ? '创建结果发生冲突。当前输入已保留，请返回地址列表确认是否已经创建，避免重复提交。'
      : '地址已在其他操作中变化。当前输入已保留，不会自动覆盖；请显式加载最新内容后重新确认。';
    return;
  }
  if (error instanceof StoreApiError && error.status === 422 &&
    error.code === 'DEFAULT_ADDRESS_REQUIRED') {
    message.value = '必须保留一个默认地址。请先在地址列表将其他地址设为默认。';
    return;
  }
  if (error instanceof StoreApiError && error.status === 429) {
    message.value = `请求较频繁，请在 ${error.retryAfterSeconds ?? 1} 秒后使用当前内容重试。`;
    return;
  }
  if (error instanceof StoreApiError && error.status === 400) {
    message.value = '地址内容未通过服务端校验，请检查后重试。';
    return;
  }
  message.value = '地址保存失败。当前输入已保留，可检查网络后重试。';
}

async function saveAddress() {
  if (pending.value || state.value !== 'ready') return;
  const input = validatedInput();
  if (input === null) return;
  const currentId = addressId.value;
  const currentVersion = version.value;
  if (currentId !== null && currentVersion === null) return;

  pending.value = true;
  conflict.value = false;
  message.value = '';
  try {
    const idempotencyKey = commandKey(input, currentVersion);
    if (currentId === null) {
      await createStoreAddress(input, idempotencyKey);
    } else {
      await updateStoreAddress(currentId, input, currentVersion as number, idempotencyKey);
    }
    volatileCommand = null;
    dirty.value = false;
    void uni.showToast({ icon: 'success', title: '地址已保存' });
    returnToList();
  } catch (error) {
    mapMutationError(error);
  } finally {
    pending.value = false;
  }
}

function handleDefaultChange(event: Event) {
  const value = (event as Event & { detail?: { value?: boolean } }).detail?.value;
  isDefault.value = value === true;
  markDirty();
}

function resolveConflict() {
  if (addressId.value === null) {
    void uni.redirectTo({ url: '/pages/address/index' });
    return;
  }
  void loadAddress(true);
}

onLoad((query) => {
  const queryAddressId = query?.address_id;
  if (queryAddressId === undefined) {
    state.value = 'ready';
    return;
  }
  if (typeof queryAddressId !== 'string' || !isUlid(queryAddressId)) {
    state.value = 'not-found';
    return;
  }
  addressId.value = queryAddressId;
  void loadAddress();
});

onShow(() => {
  if (!reloadAfterAuthentication) return;
  if (!hasRefreshableCustomerSession()) {
    reloadAfterAuthentication = false;
    state.value = 'auth-required';
    return;
  }
  reloadAfterAuthentication = false;
  void loadAddress();
});

onUnload(() => {
  loadGeneration += 1;
  clearSlowTimer();
  clearSensitiveFields();
});
</script>

<template>
  <QxStoreShell>
    <view class="qx-account-page address-edit-page">
      <QxAccountHeader :title="pageTitle" />

      <QxCatalogState
        v-if="state === 'loading'"
        kind="loading"
        :description="loadingDescription"
      />
      <QxCatalogState
        v-else-if="state === 'auth-required'"
        kind="empty"
        title="登录后编辑地址"
        description="你已取消登录，地址明文仍保持清空。"
        action-label="去登录"
        @action="retryLogin"
      />
      <QxCatalogState
        v-else-if="state === 'not-found'"
        kind="empty"
        title="地址不存在"
        description="该地址可能已被删除，或不属于当前账户。"
        action-label="返回地址列表"
        @action="returnToList"
      />
      <QxCatalogState
        v-else-if="state !== 'ready'"
        :kind="state === 'rate-limited' ? 'rate-limited' : 'error'"
        :retry-after-seconds="retryAfterSeconds"
        title="地址详情加载失败"
        description="当前未显示地址明文，请重新加载。"
        action-label="重新加载"
        @action="loadAddress()"
      />

      <view
        v-else
        class="address-edit-page__body"
      >
        <text
          v-if="message"
          class="qx-account-notice"
          :class="{ 'qx-account-notice--error': conflict }"
          role="status"
        >
          {{ message }}
        </text>
        <button
          v-if="conflict"
          class="qx-account-button qx-account-button--secondary"
          :disabled="pending"
          @click="resolveConflict"
        >
          {{ editing ? '加载最新地址' : '返回地址列表确认' }}
        </button>

        <view
          class="address-form"
          :aria-busy="pending"
        >
          <label class="qx-account-field">
            <text class="qx-account-field__label">收货人</text>
            <input
              v-model="recipientName"
              aria-label="收货人"
              :aria-invalid="Boolean(fieldErrors.recipient_name)"
              class="qx-account-field__input"
              :disabled="pending"
              maxlength="80"
              placeholder="请输入收货人"
              @input="markDirty"
            >
            <text
              v-if="fieldErrors.recipient_name"
              class="address-field-error"
            >
              {{ fieldErrors.recipient_name }}
            </text>
          </label>

          <label class="qx-account-field">
            <text class="qx-account-field__label">手机号</text>
            <input
              v-model="phone"
              aria-label="收货手机号"
              :aria-invalid="Boolean(fieldErrors.phone)"
              class="qx-account-field__input"
              :disabled="pending"
              inputmode="numeric"
              maxlength="11"
              placeholder="11 位数字手机号"
              @input="markDirty"
            >
            <text
              v-if="fieldErrors.phone"
              class="address-field-error"
            >
              {{ fieldErrors.phone }}
            </text>
          </label>

          <label class="qx-account-field">
            <text class="qx-account-field__label">省</text>
            <input
              v-model="province"
              aria-label="省"
              :aria-invalid="Boolean(fieldErrors.province)"
              class="qx-account-field__input"
              :disabled="pending"
              maxlength="80"
              placeholder="请输入省"
              @input="markDirty"
            >
            <text
              v-if="fieldErrors.province"
              class="address-field-error"
            >
              {{ fieldErrors.province }}
            </text>
          </label>

          <label class="qx-account-field">
            <text class="qx-account-field__label">市</text>
            <input
              v-model="city"
              aria-label="市"
              :aria-invalid="Boolean(fieldErrors.city)"
              class="qx-account-field__input"
              :disabled="pending"
              maxlength="80"
              placeholder="请输入市"
              @input="markDirty"
            >
            <text
              v-if="fieldErrors.city"
              class="address-field-error"
            >
              {{ fieldErrors.city }}
            </text>
          </label>

          <label class="qx-account-field">
            <text class="qx-account-field__label">区</text>
            <input
              v-model="district"
              aria-label="区"
              :aria-invalid="Boolean(fieldErrors.district)"
              class="qx-account-field__input"
              :disabled="pending"
              maxlength="80"
              placeholder="请输入区"
              @input="markDirty"
            >
            <text
              v-if="fieldErrors.district"
              class="address-field-error"
            >
              {{ fieldErrors.district }}
            </text>
          </label>

          <label class="qx-account-field">
            <text class="qx-account-field__label">详细地址</text>
            <textarea
              v-model="detail"
              aria-label="详细地址"
              :aria-invalid="Boolean(fieldErrors.detail)"
              class="address-detail-input"
              :disabled="pending"
              maxlength="300"
              placeholder="街道、楼栋和门牌号"
              @input="markDirty"
            />
            <text
              v-if="fieldErrors.detail"
              class="address-field-error"
            >
              {{ fieldErrors.detail }}
            </text>
          </label>

          <label class="address-default-row">
            <view class="address-default-row__copy">
              <text class="address-default-row__title">设为默认地址</text>
              <text class="qx-account-muted">
                {{ editing ? '保存后其他地址将取消默认。' : '第一条地址由服务端自动设为默认。' }}
              </text>
            </view>
            <switch
              aria-label="设为默认地址"
              :checked="isDefault"
              color="#496859"
              :disabled="pending"
              @change="handleDefaultChange"
            />
          </label>
        </view>

        <view class="address-edit-page__actions">
          <button
            class="qx-account-button qx-account-button--secondary"
            :disabled="pending"
            @click="returnToList"
          >
            取消
          </button>
          <button
            class="qx-account-button"
            :disabled="pending || conflict"
            @click="saveAddress"
          >
            {{ pending ? '正在保存…' : '保存地址' }}
          </button>
        </view>
        <text
          v-if="dirty"
          class="qx-account-muted"
          role="status"
        >
          当前修改尚未保存。
        </text>
      </view>
    </view>
  </QxStoreShell>
</template>

<style src="../../styles/account.css"></style>

<style scoped>
.address-edit-page__body {
  display: flex;
  width: 100%;
  flex-direction: column;
  gap: 20rpx;
  padding: 24rpx 24rpx calc(40rpx + env(safe-area-inset-bottom));
}

.address-form {
  display: flex;
  width: 100%;
  flex-direction: column;
  gap: 22rpx;
}

.address-detail-input {
  width: 100%;
  min-height: 180rpx;
  padding: 22rpx 24rpx;
  border: 1px solid var(--qx-store-line-strong);
  border-radius: 10rpx;
  color: var(--qx-store-text);
  background: var(--qx-store-surface);
  font-size: 26rpx;
  line-height: 1.55;
  overflow-wrap: anywhere;
}

.address-field-error {
  display: block;
  color: var(--qx-store-danger);
  font-size: 21rpx;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.address-default-row {
  display: flex;
  width: 100%;
  min-height: 104rpx;
  align-items: center;
  justify-content: space-between;
  gap: 20rpx;
  padding: 20rpx 24rpx;
  border: 1px solid var(--qx-store-line);
  border-radius: 10rpx;
  background: var(--qx-store-surface);
}

.address-default-row__copy {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 6rpx;
}

.address-default-row__title {
  font-size: 25rpx;
  font-weight: 800;
}

.address-edit-page__actions {
  display: grid;
  width: 100%;
  gap: 16rpx;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

@media (max-width: 359px) {
  .address-edit-page__actions {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
