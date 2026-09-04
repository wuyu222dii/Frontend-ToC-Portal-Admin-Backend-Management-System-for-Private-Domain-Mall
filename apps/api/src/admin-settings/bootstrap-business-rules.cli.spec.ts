import { generateUlid } from '@qingxu/platform-core';
import { describe, expect, it } from 'vitest';

import { parseInitialBusinessRuleBootstrapInput } from './bootstrap-business-rules.cli';

const ADMIN_ID = generateUlid(new Date('2026-09-04T08:00:00.000Z').getTime());

describe('initial business-rule bootstrap input', () => {
  it('requires an explicit administrator and approved legal retention period', () => {
    expect(parseInitialBusinessRuleBootstrapInput(['node', 'bootstrap-business-rules.cli.ts'], {
      BUSINESS_RULE_BOOTSTRAP_ADMIN_ID: ADMIN_ID,
      BUSINESS_RULE_LEGAL_RECORD_RETENTION_YEARS: '10',
    })).toEqual({ actorAccountId: ADMIN_ID, legalRecordRetentionYears: 10 });
  });

  it.each(['0', '01', '101', '1.5', ''])('rejects invalid legal retention %j', (retention) => {
    expect(() => parseInitialBusinessRuleBootstrapInput(['node', 'bootstrap-business-rules.cli.ts'], {
      BUSINESS_RULE_BOOTSTRAP_ADMIN_ID: ADMIN_ID,
      BUSINESS_RULE_LEGAL_RECORD_RETENTION_YEARS: retention,
    })).toThrow('BUSINESS_RULE_LEGAL_RECORD_RETENTION_YEARS');
  });

  it('rejects missing administrator identity and command-line arguments', () => {
    expect(() => parseInitialBusinessRuleBootstrapInput(['node', 'bootstrap-business-rules.cli.ts'], {
      BUSINESS_RULE_LEGAL_RECORD_RETENTION_YEARS: '10',
    })).toThrow('BUSINESS_RULE_BOOTSTRAP_ADMIN_ID');
    expect(() => parseInitialBusinessRuleBootstrapInput(['node', 'bootstrap-business-rules.cli.ts', '10'], {
      BUSINESS_RULE_BOOTSTRAP_ADMIN_ID: ADMIN_ID,
      BUSINESS_RULE_LEGAL_RECORD_RETENTION_YEARS: '10',
    })).toThrow('does not accept command-line arguments');
  });
});
