import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

describe('worker bootstrap failure', () => {
  it('prints only the fixed startup message', async () => {
    const marker = 'PRIVATE_DATABASE_PASSWORD_MARKER';
    const tsx = resolve(process.cwd(), 'node_modules/.bin/tsx');

    try {
      await execFileAsync(tsx, ['src/main.ts'], {
        cwd: process.cwd(),
        env: {
          DATABASE_URL: `postgresql://mall_runtime:${marker}@example.test/postgres`,
          NODE_ENV: 'test',
          PATH: process.env.PATH,
        },
      });
      throw new Error('Expected worker bootstrap to fail');
    } catch (error) {
      const result = error as { stderr?: string; stdout?: string };
      expect(result.stdout).toBe('');
      expect(result.stderr).toBe('Worker startup failed\n');
      expect(result.stderr).not.toContain(marker);
      expect(result.stderr).not.toContain('Error:');
    }
  });
});
