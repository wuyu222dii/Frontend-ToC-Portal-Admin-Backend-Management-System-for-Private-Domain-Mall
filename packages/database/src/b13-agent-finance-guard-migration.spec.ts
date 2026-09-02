import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const workspaceRoot = resolve(__dirname, '../../..');
const migrationPath = resolve(
  workspaceRoot,
  'prisma/migrations/0006_b13_agent_finance_guards/migration.sql',
);
const frozenMigrationPath = resolve(
  workspaceRoot,
  'product-materials/docs/03-技术设计/migrations/0006_b13_agent_finance_guards/migration.sql',
);
const previousMigrations = [
  ['0001_initial', 'f1e192fc6a93710e855770a27ed2de04665288fd9ab188652c0fd5f7683ba71b'],
  ['0002_b9_inventory_fact_indexes', '9c933d256e0cbe7c33acdd801b6385bae6f892ff3db10978c40e37ea2f89f5d0'],
  ['0003_b10_payment_fact_indexes', '0d5109a6d0eab2598f2c6c98bbeca265bdd32733e7d89f8eb78eff67caedb836'],
  ['0004_b10_commission_position_trigger_fix', '8d4c391af114c4691d2be80ae8bb44efc1c70658f5268ad4de7221a29d5ee102'],
  ['0005_b12_aftersale_refund_guards', '95f362667bdc6a0b751ae636d91a139a71a3f40155ba764937db01d5bbce412b'],
] as const;
const historyGates = [
  'scripts/db/bootstrap.mjs',
  'scripts/db/check-drift.mjs',
  'scripts/db/lib/migration-history.mjs',
  'scripts/db/sql/post-bootstrap.sql',
  'scripts/db/sql/verify.sql',
] as const;

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

function sha256(source: string): string {
  return createHash('sha256').update(source).digest('hex');
}

describe('0006 B13 agent-finance guard migration', () => {
  const migration = read(migrationPath);
  const frozenMigration = read(frozenMigrationPath);

  it('keeps the formal and frozen migration copies byte-identical', () => {
    expect(migration).toBe(frozenMigration);
  });

  it('does not rewrite the frozen 0001 through 0005 history', () => {
    for (const [name, expectedHash] of previousMigrations) {
      const source = read(resolve(workspaceRoot, `prisma/migrations/${name}/migration.sql`));
      expect(sha256(source), name).toBe(expectedHash);
    }
  });

  it('pins every exact-history gate to all six frozen migration checksums', () => {
    const expectedHashes = [
      ...previousMigrations.map(([, hash]) => hash),
      sha256(migration),
    ];
    for (const gate of historyGates) {
      const source = read(resolve(workspaceRoot, gate));
      for (const hash of expectedHashes) expect(source, `${gate}: ${hash}`).toContain(hash);
    }
  });

  it('wires development deployment and replay to the same exact-history predicate', () => {
    const deployment = read(resolve(workspaceRoot, 'scripts/db/deploy-development.mjs'));
    const replay = read(resolve(workspaceRoot, 'scripts/db/replay-ci.mjs'));
    for (const source of [deployment, replay]) {
      expect(source).toContain('from "./lib/migration-history.mjs"');
      expect(source).toContain('B13_MIGRATION_HISTORY_SQL');
      expect(source).toContain('isApprovedB13Predecessor');
      expect(source).toContain('isExactB13History');
    }
    expect(deployment).toContain('if (requiresB13HistoricalPreflight(before)) {');
    expect(deployment).not.toContain('if (!isExactB13History(before)) {');
    expect(replay).toContain('requiresB13HistoricalPreflight(B13_DEPLOYED_HISTORY)');
  });

  it('wires development deployment and replay to every shared B13 preflight predicate', () => {
    const preflight = read(resolve(workspaceRoot, 'scripts/db/lib/b13-preflight.mjs'));
    const deployment = read(resolve(workspaceRoot, 'scripts/db/deploy-development.mjs'));
    const replay = read(resolve(workspaceRoot, 'scripts/db/replay-ci.mjs'));
    const keys = [
      'agent-promotion',
      'commission-rule',
      'commission-snapshot',
      'commission-ledger',
      'commission-ledger-duplicates',
      'wallet',
      'bank-account',
      'withdrawal-bank-snapshot',
      'withdrawal-envelope',
      'withdrawal-completeness',
    ];
    for (const key of keys) expect(preflight).toContain(`key: "${key}"`);
    expect(preflight.match(/key: "/g)).toHaveLength(keys.length);
    for (const source of [deployment, replay]) {
      expect(source).toContain('from "./lib/b13-preflight.mjs"');
      expect(source).toContain('B13_PREDEPLOY_CHECKS');
    }
  });

  it('is one forward-only, failure-atomic guard transaction', () => {
    expect(migration.startsWith('BEGIN;\n')).toBe(true);
    expect(migration.endsWith('\nCOMMIT;\n')).toBe(true);
    expect(migration.match(/^BEGIN;$/gm)).toHaveLength(1);
    expect(migration.match(/^COMMIT;$/gm)).toHaveLength(1);
    expect(migration).toContain("SET LOCAL lock_timeout = '5s';");
    expect(migration).toContain('public."order_item",\n  public."refund",');
    expect(migration).toContain('IN SHARE MODE;');
    expect(migration).not.toMatch(/\bCREATE\s+(?:TABLE|TYPE)\b/i);
    expect(migration).not.toMatch(/\bALTER\s+TYPE\b/i);
    expect(migration).not.toMatch(/\bDROP\s+(?:TABLE|TYPE|COLUMN)\b/i);
    expect(migration).not.toMatch(/\b(?:TRUNCATE|GRANT|REVOKE)\b/i);
  });

  it('preflights every B13 ownership, lifecycle and finance envelope', () => {
    for (const message of [
      'agent profile contains an invalid AGENT_ADMIN role or state envelope',
      'AGENT_ADMIN account and agent profile are not a complete one-to-one pair',
      'agent invite code contains an invalid lifecycle envelope',
      'promotion asset contains an invalid target, lifecycle, or agent envelope',
      'attribution candidate contains an invalid lifecycle or agent envelope',
      'commission rule version contains an invalid lifecycle or base reference',
      'commission snapshot contains an invalid order-item or agent envelope',
      'commission ledger contains an invalid reference or balance-change envelope',
      'agent bank account contains an invalid encrypted-value envelope',
      'withdrawal contains an invalid state, amount, or administrator envelope',
      'withdrawal contains an incomplete bank snapshot, ledger, or proof envelope',
    ]) {
      expect(migration, message).toContain(message);
    }
    expect(migration).toContain("USING ERRCODE = '23505'");
    expect(migration.match(/USING ERRCODE = '23514'/g)).toHaveLength(13);
  });

  it('installs only closed CHECK, partial-index and SECURITY INVOKER guards', () => {
    expect(migration.match(/ADD CONSTRAINT "chk_b13_/g)).toHaveLength(10);
    expect(migration.match(/^CREATE UNIQUE INDEX /gm)).toHaveLength(1);
    expect(migration).toContain('"uq_commission_ledger_withdrawal_type"');
    expect(migration.match(/^CREATE FUNCTION public\./gm)).toHaveLength(12);
    expect(migration.match(/^SECURITY INVOKER$/gm)).toHaveLength(12);
    expect(migration).not.toContain('SECURITY DEFINER');
    expect(migration.match(/^CREATE (?:CONSTRAINT )?TRIGGER /gm)).toHaveLength(21);
  });

  it('keeps withdrawal completion checks deferred to the transaction boundary', () => {
    for (const trigger of [
      'trg_b13_withdrawal_consistency_parent',
      'trg_b13_withdrawal_consistency_bank',
      'trg_b13_withdrawal_consistency_proof',
      'trg_b13_withdrawal_consistency_ledger',
    ]) {
      expect(migration).toContain(`CREATE CONSTRAINT TRIGGER "${trigger}"`);
    }
    expect(migration.match(/DEFERRABLE INITIALLY DEFERRED/g)).toHaveLength(10);
    expect(migration).toContain('PAID withdrawal requires at least one payment proof');
    expect(migration).toContain('withdrawal requires exactly one immutable bank snapshot');
    expect(migration).toContain('withdrawal ledger lifecycle is incomplete or duplicated');
  });

  it('pins the three withdrawal balance transitions and immutable snapshots', () => {
    expect(migration).toContain("l.\"ledger_type\" = 'WITHDRAWAL_FREEZE'");
    expect(migration).toContain("l.\"ledger_type\" = 'WITHDRAWAL_RELEASE'");
    expect(migration).toContain("l.\"ledger_type\" = 'WITHDRAWAL_PAID'");
    expect(migration).toContain('"frozen_change" = -"available_change"');
    expect(migration).toContain('"available_change" = 0');
    expect(migration).toContain('withdrawal bank snapshot is immutable');
    expect(migration).toContain('account_no_last4" !~ \'^[0-9]{4}$\'');
  });

  it('serializes Agent role changes and freezes every commission reference parent', () => {
    expect(migration).toContain('WHERE "id" = NEW."account_id"\n    FOR SHARE;');
    expect(migration).toContain('agent profile account_id is immutable');
    expect(migration).toContain('trg_b13_agent_account_coverage_account');
    expect(migration).toContain('trg_b13_agent_account_coverage_profile');
    expect(migration).toContain('order-item commission snapshot is immutable');
    expect(migration).toContain('commission ledger is immutable');
    expect(migration).toContain('paid order-item commission source fields are immutable');
    expect(migration).toContain('refund order_id is immutable after commission reversal');
    expect(migration).toContain('trg_b13_commission_refund_parent_deferred');
    expect(migration).toContain('trg_b13_commission_order_item_parent_deferred');
    expect(migration).toContain('FOR SHARE OF oi;');
    expect(migration).toContain('invalid attribution candidate lifecycle transition');
  });

  it('freezes lifecycle identities and terminal facts while preserving guest-to-customer migration', () => {
    expect(migration.match(/NEW\."id" IS DISTINCT FROM OLD\."id"/g)).toHaveLength(4);
    expect(migration).toContain('terminal invite code lifecycle facts are immutable');
    expect(migration).toContain('terminal promotion asset lifecycle facts are immutable');
    expect(migration).toContain('terminal attribution candidate facts are immutable');
    expect(migration).toContain('invalid attribution candidate subject transition');
    expect(migration).toContain('OLD."candidate_token_hash" IS NOT NULL');
    expect(migration).toContain('NEW."candidate_token_hash" IS NULL');
    expect(migration).toContain('NEW."customer_id" IS NOT NULL');
    expect(migration).toContain('withdrawal identity, amount and frozen balance snapshot are immutable');
  });
});
