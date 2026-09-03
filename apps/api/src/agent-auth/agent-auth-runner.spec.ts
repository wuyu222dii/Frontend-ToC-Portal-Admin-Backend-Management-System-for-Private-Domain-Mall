import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const repositoryRoot = resolve(__dirname, '../../../..');
const packagePath = join(repositoryRoot, 'package.json');
const runnerPath = join(repositoryRoot, 'scripts/ci/test-b13-agent.mjs');
const smokeWorkflowPath = join(repositoryRoot, '.github/workflows/supabase-smoke.yml');
const projectRef = 'abcdefghijklmnopqrst';

describe('B13 Agent gate runner', () => {
  let temporaryDirectory: string;
  let callsPath: string;
  let caPath: string;

  beforeEach(() => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), 'qingxu-b13-runner-'));
    callsPath = join(temporaryDirectory, 'pnpm-calls.txt');
    caPath = join(temporaryDirectory, 'supabase-ca.crt');
    const fakePnpm = join(temporaryDirectory, 'pnpm');
    writeFileSync(caPath, 'test-only-ca');
    writeFileSync(fakePnpm, [
      '#!/bin/sh',
      'printf \'%s\\n\' "$*" >> "$B13_RUNNER_CALLS"',
      'call_count="$(wc -l < "$B13_RUNNER_CALLS" | tr -d \' \')"',
      'test "$B13_RUNNER_FAIL_CALL" != "$call_count" || exit 17',
      '',
    ].join('\n'));
    chmodSync(fakePnpm, 0o700);
  });

  afterEach(() => {
    rmSync(temporaryDirectory, { force: true, recursive: true });
  });

  function execute(environment: NodeJS.ProcessEnv) {
    return spawnSync(process.execPath, [runnerPath], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      env: {
        B13_RUNNER_CALLS: callsPath,
        PATH: `${temporaryDirectory}${delimiter}${process.env.PATH ?? ''}`,
        ...environment,
      },
    });
  }

  it('runs rollback validation without Redis and preserves the three target commands', () => {
    const result = execute({
      B13_AGENT_AUTH_DATABASE_TEST_MODE: 'rollback',
      CI: 'true',
      DATABASE_URL: `postgresql://mall_runtime:runtime-password@db.${projectRef}.supabase.co:5432/postgres?sslmode=verify-full&sslrootcert=${encodeURIComponent(caPath)}`,
      NODE_ENV: 'test',
      PGSSLROOTCERT: caPath,
      SUPABASE_PROJECT_REF: projectRef,
    });

    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('B13 Agent rollback database checks passed.');
    expect(readFileSync(callsPath, 'utf8').trim().split('\n')).toEqual([
      'build:packages',
      '--filter @qingxu/api exec vitest run --no-file-parallelism src/agent-auth/agent-auth.integration.spec.ts',
      '--filter @qingxu/database exec vitest run --no-file-parallelism src/agent-commerce.integration.spec.ts',
      '--filter @qingxu/database exec vitest run --no-file-parallelism src/agent-operations.integration.spec.ts',
    ]);
  });

  it('requires an explicit mode before running any target command', () => {
    const result = execute({});

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      'B13_AGENT_AUTH_DATABASE_TEST_MODE must be explicitly set to full or rollback',
    );
    expect(() => readFileSync(callsPath, 'utf8')).toThrow();
  });

  it.each(['', 'FULL', 'unknown'])(
    'refuses invalid mode %j before running any target command',
    (invalidMode) => {
      const result = execute({ B13_AGENT_AUTH_DATABASE_TEST_MODE: invalidMode });

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(
        'B13_AGENT_AUTH_DATABASE_TEST_MODE must be explicitly set to full or rollback',
      );
      expect(() => readFileSync(callsPath, 'utf8')).toThrow();
    },
  );

  it('refuses the ephemeral PostgreSQL capability in rollback mode', () => {
    const result = execute({
      ALLOW_CI_EPHEMERAL_POSTGRES: '1',
      B13_AGENT_AUTH_DATABASE_TEST_MODE: 'rollback',
      DATABASE_URL: `postgresql://mall_runtime:runtime-password@db.${projectRef}.supabase.co:5432/postgres`,
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('rollback mode cannot use the ephemeral PostgreSQL capability');
    expect(() => readFileSync(callsPath, 'utf8')).toThrow();
  });

  it('refuses full mode without Redis before running any target command', () => {
    const result = execute({
      ALLOW_CI_EPHEMERAL_POSTGRES: '1',
      B13_AGENT_AUTH_DATABASE_TEST_MODE: 'full',
      CI: 'true',
      DATABASE_URL: 'postgresql://mall_runtime:runtime-password@127.0.0.1:5432/mall_ci_test',
      DIRECT_URL: 'postgresql://mall_migrator:migrator-password@127.0.0.1:5432/mall_ci_test',
      NODE_ENV: 'test',
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('REDIS_URL is required for full mode');
    expect(() => readFileSync(callsPath, 'utf8')).toThrow();
  });

  it.each([
    ['CI', 'false'],
    ['NODE_ENV', 'development'],
    ['ALLOW_CI_EPHEMERAL_POSTGRES', '0'],
  ] as const)('refuses full mode when %s has value %s', (name, value) => {
    const environment = {
      ALLOW_CI_EPHEMERAL_POSTGRES: '1',
      B13_AGENT_AUTH_DATABASE_TEST_MODE: 'full',
      CI: 'true',
      DATABASE_URL: 'postgresql://mall_runtime:runtime-password@127.0.0.1:5432/mall_ci_test',
      DIRECT_URL: 'postgresql://mall_migrator:migrator-password@127.0.0.1:5432/mall_ci_test',
      NODE_ENV: 'test',
      REDIS_URL: 'redis://:isolated-redis-password@127.0.0.1:6379/15',
      [name]: value,
    };
    const result = execute(environment);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      'full mode requires NODE_ENV=test and the explicit ephemeral CI PostgreSQL capability',
    );
    expect(() => readFileSync(callsPath, 'utf8')).toThrow();
  });

  it('propagates a target command failure and never reports a passing gate', () => {
    const result = execute({
      B13_AGENT_AUTH_DATABASE_TEST_MODE: 'rollback',
      B13_RUNNER_FAIL_CALL: '3',
      CI: 'true',
      DATABASE_URL: `postgresql://mall_runtime:runtime-password@db.${projectRef}.supabase.co:5432/postgres?sslmode=verify-full&sslrootcert=${encodeURIComponent(caPath)}`,
      NODE_ENV: 'test',
      PGSSLROOTCERT: caPath,
      SUPABASE_PROJECT_REF: projectRef,
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('command failed: pnpm --filter @qingxu/database exec vitest run');
    expect(result.stdout).not.toContain('database checks passed');
    expect(readFileSync(callsPath, 'utf8').trim().split('\n')).toHaveLength(3);
  });

  it('keeps the protected rollback smoke ordered after B12 without a Redis secret', () => {
    const workflow = readFileSync(smokeWorkflowPath, 'utf8');
    const b12Index = workflow.indexOf('Run rollback-only B12 aftersales');
    const b13Index = workflow.indexOf(
      'Run rollback-only B13.1-B13.3 Agent authentication, commerce and operations smoke',
    );
    const nextStepIndex = workflow.indexOf('\n      - name:', b13Index + 1);
    const b13Step = workflow.slice(b13Index, nextStepIndex === -1 ? undefined : nextStepIndex);

    expect(b12Index).toBeGreaterThan(-1);
    expect(b13Index).toBeGreaterThan(b12Index);
    expect(b13Step).toContain('B13_AGENT_AUTH_DATABASE_TEST_MODE: rollback');
    expect(b13Step).toContain('DATABASE_URL: ${{ secrets.SUPABASE_RUNTIME_URL }}');
    expect(b13Step).toContain('run: pnpm db:test-b13-agent');
    expect(b13Step).not.toContain('REDIS_URL');
    expect(workflow).not.toContain('ALLOW_CI_EPHEMERAL_POSTGRES');
    expect(JSON.parse(readFileSync(packagePath, 'utf8')).scripts['db:test-b13-agent'])
      .toBe('node scripts/ci/test-b13-agent.mjs');
  });
});
