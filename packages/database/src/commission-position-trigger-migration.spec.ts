import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const workspaceRoot = resolve(__dirname, '../../..');
const baselinePath = resolve(workspaceRoot, 'prisma/migrations/0001_initial/migration.sql');
const migrationPath = resolve(
  workspaceRoot,
  'prisma/migrations/0004_b10_commission_position_trigger_fix/migration.sql',
);
const frozenMigrationPath = resolve(
  workspaceRoot,
  'product-materials/docs/03-技术设计/migrations/0004_b10_commission_position_trigger_fix/migration.sql',
);

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

function functionDefinition(source: string, createClause: string): string {
  const start = source.indexOf(createClause);
  if (start < 0) throw new Error(`missing ${createClause}`);
  const end = source.indexOf('\nEND $$;', start);
  if (end < 0) throw new Error(`unterminated ${createClause}`);
  return source.slice(start, end + '\nEND $$;'.length);
}

describe('0004 B10 commission-position trigger migration', () => {
  const baseline = read(baselinePath);
  const migration = read(migrationPath);
  const frozenMigration = read(frozenMigrationPath);

  it('keeps the formal and frozen migration copies byte-identical', () => {
    expect(migration).toBe(frozenMigration);
  });

  it('is a transactional, repeatable function replacement with no privilege expansion', () => {
    expect(migration.startsWith('BEGIN;\n')).toBe(true);
    expect(migration.endsWith('\nCOMMIT;\n')).toBe(true);
    expect(migration.match(/CREATE OR REPLACE FUNCTION/g)).toHaveLength(1);
    expect(migration).toContain('SECURITY INVOKER');
    expect(migration).not.toContain('SECURITY DEFINER');
    expect(migration).not.toMatch(/\b(?:ALTER|DROP|GRANT|REVOKE)\b/);
    expect(migration).not.toMatch(/CREATE\s+(?!OR REPLACE)FUNCTION/);
  });

  it('changes only the snapshot SELECT lock relative to the frozen baseline function', () => {
    const baselineDefinition = functionDefinition(
      baseline,
      'CREATE FUNCTION public.enforce_commission_position_snapshot()',
    ).replace('\n  FOR SHARE;', ';');
    const migratedDefinition = functionDefinition(
      migration,
      'CREATE OR REPLACE FUNCTION public.enforce_commission_position_snapshot()',
    )
      .replace('CREATE OR REPLACE FUNCTION', 'CREATE FUNCTION')
      .replace('\nSECURITY INVOKER', '');

    expect(migratedDefinition).toBe(baselineDefinition);
    expect(migration).not.toMatch(/\bFOR\s+(?:KEY\s+)?SHARE\b/i);
    expect(migration).toContain('NEW."original_commission" IS DISTINCT FROM snapshot_original');
    expect(migration).toContain('NEW."snapshot_id" IS DISTINCT FROM OLD."snapshot_id"');
  });
});
