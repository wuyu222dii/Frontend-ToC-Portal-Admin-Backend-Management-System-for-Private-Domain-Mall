import type { Router } from 'vue-router';

import { AgentApiError, agentAuthSession } from '../services/agent';

export function formatMoney(value: string): string {
  const match = /^(-?)(\d+)(?:\.(\d{2}))?$/.exec(value);
  if (!match) return `¥ ${value}`;
  const sign = match[1] ?? '';
  const integer = match[2] ?? value;
  const fraction = match[3] ?? '00';
  return `${sign ? '- ' : ''}¥ ${integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${fraction}`;
}

export function formatRate(value: string): string {
  return `${value.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1')}%`;
}

export function moneyMinor(value: string): bigint | null {
  const match = /^(-?)(\d+)\.(\d{2})$/.exec(value);
  if (!match) return null;
  const amount = BigInt(`${match[2] ?? '0'}${match[3] ?? '00'}`);
  return match[1] === '-' ? -amount : amount;
}

export function sumNonNegativeMoney(values: readonly string[]): string {
  const total = values.reduce((sum, value) => {
    const minor = moneyMinor(value);
    if (minor === null || minor < 0n) throw new TypeError('money amount is invalid');
    return sum + minor;
  }, 0n);
  return `${total / 100n}.${String(total % 100n).padStart(2, '0')}`;
}

export function formatChinaDateTime(value: string | null | undefined): string {
  if (!value) return '暂无';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '暂无'
    : new Intl.DateTimeFormat('zh-CN', {
      day: '2-digit', hour: '2-digit', minute: '2-digit', month: '2-digit',
      timeZone: 'Asia/Shanghai', year: 'numeric',
    }).format(date);
}

export function loadErrorMessage(error: unknown, subject: string): string {
  if (!(error instanceof AgentApiError)) return `${subject}加载失败，请检查网络后重试`;
  if (error.status === 0) return '网络连接失败，请检查网络后重试';
  if (error.status === 403) return `当前账号无权访问${subject}`;
  if (error.status === 404) return `${subject}不存在或已不可访问`;
  if (error.status === 409) return `${subject}状态已变化，请刷新后重试`;
  if (error.status === 422) return `${subject}暂不可用，请检查当前业务状态`;
  if (error.status === 429) return error.retryAfterSeconds
    ? `查询过于频繁，请在 ${error.retryAfterSeconds} 秒后重试`
    : '查询过于频繁，请稍后重试';
  return `${subject}暂不可用，请稍后重试`;
}

export async function handleAuthError(error: unknown, router: Router): Promise<boolean> {
  if (!(error instanceof AgentApiError) || error.status !== 401) return false;
  agentAuthSession.clear();
  await router.replace('/login');
  return true;
}

export function ruleSourceLabel(value: 'CATEGORY' | 'PLATFORM' | 'SKU'): string {
  return ({ CATEGORY: '分类规则', PLATFORM: '平台规则', SKU: 'SKU 规则' })[value];
}
