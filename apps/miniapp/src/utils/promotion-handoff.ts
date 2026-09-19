/* global uni */
import { createAttributionCandidate } from '../api';
import { hasRefreshableCustomerSession } from './customer-session';
import { takePromotionLaunchQuery } from './promotion-launch';

export async function consumePromotionLaunch(query: unknown): Promise<void> {
  const parsed = takePromotionLaunchQuery(query);
  if (parsed.kind === 'invalid') {
    void uni.showToast({ icon: 'none', title: '推广链接格式无效。' });
    return;
  }
  if (parsed.kind !== 'ready') return;
  try {
    const created = await createAttributionCandidate({
      invite_code: parsed.input.invite_code,
      promotion_asset_id: parsed.input.promotion_asset_id,
    });
    if (hasRefreshableCustomerSession() && created.candidate !== null && created.service_agent === null) {
      void uni.navigateTo({ url: '/pages/profile/agent' });
    }
  } catch {
    return;
  }
}
