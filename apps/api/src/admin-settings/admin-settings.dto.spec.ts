import { describe, expect, it } from 'vitest';

import {
  parseAdminBusinessRuleAction,
  parseAdminBusinessRuleConfirmation,
  parseAdminSettingsEmptyQuery,
} from './admin-settings.dto';

describe('admin settings DTO', () => {
  it('parses closed preview and confirmation bodies without writable fixed rules', () => {
    expect(parseAdminBusinessRuleAction({
      changes: { aftersale_window_days: 14, minimum_withdrawal_amount: '200.00' },
      reason: ' Update rules ',
    })).toEqual({
      changes: { aftersaleWindowDays: 14, minimumWithdrawalAmount: '200.00' },
      reason: 'Update rules',
    });
    expect(parseAdminBusinessRuleConfirmation({
      changes: { minimum_withdrawal_amount: '0.01' },
      confirmation_hash: 'a'.repeat(64),
      preview_token: 'pvw_0123456789abcdef',
      reason: 'Lower minimum',
    })).toMatchObject({ confirmationHash: 'a'.repeat(64), previewToken: 'pvw_0123456789abcdef' });
    expect(() => parseAdminSettingsEmptyQuery({ extra: '1' }))
      .toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
  });

  it.each([
    { changes: {}, reason: 'No changes' },
    { changes: { legal_record_retention_years: 1 }, reason: 'Readonly' },
    { changes: { order_payment_timeout_minutes: 60 }, reason: 'Readonly' },
    { changes: { minimum_withdrawal_amount: '0.00' }, reason: 'Invalid amount' },
  ])('rejects an invalid action: %j', (body) => {
    expect(() => parseAdminBusinessRuleAction(body)).toThrow();
  });
});
