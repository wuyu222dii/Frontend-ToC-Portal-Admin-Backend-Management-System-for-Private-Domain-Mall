import { ApplicationError } from '@qingxu/platform-core';
import { describe, expect, it } from 'vitest';

import {
  parseAdminCustomerEmptyQuery,
  parseAdminCustomerId,
  parseAdminCustomerListQuery,
  parseCustomerTransferBody,
  parseCustomerTransferConfirmationBody,
} from './admin-customers.dto';

const CUSTOMER_ID = '01J00000000000000000000001';
const AGENT_ID = '01J00000000000000000000002';
const HASH = 'a'.repeat(64);
const TOKEN = `pvw_${'b'.repeat(43)}`;

describe('B13.3 Admin customer DTO', () => {
  it('applies list defaults and maps the closed filters', () => {
    expect(parseAdminCustomerListQuery({})).toEqual({ page: 1, pageSize: 20 });
    expect(parseAdminCustomerListQuery({
      agent_id: AGENT_ID,
      binding_status: 'BOUND',
      date_from: '2026-09-02',
      date_to: '2026-09-03',
      keyword: '  customer_abc  ',
      max_consumption: '9999999999999999.99',
      min_consumption: '0.00',
      page: '2',
      page_size: '100',
    })).toEqual({
      agentId: AGENT_ID,
      bindingStatus: 'BOUND',
      createdAtFrom: new Date('2026-09-01T16:00:00.000Z'),
      createdAtToExclusive: new Date('2026-09-03T16:00:00.000Z'),
      keyword: 'customer_abc',
      maxConsumption: '9999999999999999.99',
      minConsumption: '0.00',
      page: 2,
      pageSize: 100,
    });
  });

  it('accepts every binding state and a real leap day', () => {
    for (const bindingStatus of ['BOUND', 'UNBOUND', 'ENDED'] as const) {
      expect(parseAdminCustomerListQuery({ binding_status: bindingStatus }).bindingStatus).toBe(bindingStatus);
    }
    expect(parseAdminCustomerListQuery({ date_from: '2024-02-29', date_to: '2024-02-29' }))
      .toMatchObject({
        createdAtFrom: new Date('2024-02-28T16:00:00.000Z'),
        createdAtToExclusive: new Date('2024-02-29T16:00:00.000Z'),
      });
  });

  it.each([
    ['non-object query', null],
    ['unknown field', { status: 'ACTIVE' }],
    ['zero page', { page: '0' }],
    ['non-canonical page', { page: '01' }],
    ['oversized page size', { page_size: '101' }],
    ['offset overflow', { page: '2147483647', page_size: '2' }],
    ['duplicate query value', { binding_status: ['BOUND', 'ENDED'] }],
    ['unknown binding state', { binding_status: 'ALL' }],
    ['invalid Agent ID', { agent_id: 'agent' }],
    ['blank keyword', { keyword: '  ' }],
    ['control keyword', { keyword: 'bad\nvalue' }],
    ['invalid leap date', { date_from: '2026-02-29' }],
    ['reversed dates', { date_from: '2026-09-04', date_to: '2026-09-03' }],
    ['integer money', { min_consumption: '1' }],
    ['leading-zero money', { max_consumption: '01.00' }],
    ['money overflow', { max_consumption: '10000000000000000.00' }],
    ['reversed money', { min_consumption: '2.00', max_consumption: '1.99' }],
  ])('rejects %s', (_label, value) => {
    expect(() => parseAdminCustomerListQuery(value)).toThrowError(ApplicationError);
  });

  it('parses direct and Agent transfer requests into one canonical shape', () => {
    expect(parseCustomerTransferBody({ reason: '  Return to direct  ' })).toEqual({
      reason: 'Return to direct',
      targetAgentId: null,
    });
    expect(parseCustomerTransferBody({ reason: 'Transfer ownership', target_agent_id: AGENT_ID })).toEqual({
      reason: 'Transfer ownership',
      targetAgentId: AGENT_ID,
    });
    expect(parseCustomerTransferConfirmationBody({
      confirmation_hash: HASH,
      preview_token: TOKEN,
      reason: '  Transfer ownership  ',
      target_agent_id: AGENT_ID,
    })).toEqual({
      confirmationHash: HASH,
      previewToken: TOKEN,
      reason: 'Transfer ownership',
      targetAgentId: AGENT_ID,
    });
  });

  it.each([
    ['unknown preview field', { reason: 'Valid reason', unexpected: true }],
    ['invalid target Agent', { reason: 'Valid reason', target_agent_id: 'agent' }],
    ['short reason', { reason: 'x' }],
    ['control reason', { reason: 'bad\nreason' }],
    ['missing confirmation', { reason: 'Valid reason', preview_token: TOKEN }],
    ['short token', { confirmation_hash: HASH, preview_token: 'short', reason: 'Valid reason' }],
    ['uppercase hash', { confirmation_hash: 'A'.repeat(64), preview_token: TOKEN, reason: 'Valid reason' }],
  ])('rejects transfer %s', (_label, value) => {
    const parse = Object.hasOwn(value, 'preview_token') || Object.hasOwn(value, 'confirmation_hash')
      ? parseCustomerTransferConfirmationBody
      : parseCustomerTransferBody;
    expect(() => parse(value)).toThrowError(ApplicationError);
  });

  it('accepts only a customer ULID and an empty detail query', () => {
    expect(parseAdminCustomerId(CUSTOMER_ID)).toBe(CUSTOMER_ID);
    expect(() => parseAdminCustomerId('customer')).toThrowError(ApplicationError);
    expect(parseAdminCustomerEmptyQuery({})).toBeUndefined();
    expect(() => parseAdminCustomerEmptyQuery({ include_private: 'true' })).toThrowError(ApplicationError);
  });
});
