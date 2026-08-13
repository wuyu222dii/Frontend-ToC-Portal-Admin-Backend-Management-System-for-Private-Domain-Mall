import { link, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { assertSecureBootstrapInvocation, readBootstrapPasswordFile } from './bootstrap-super-admin.cli';

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'qingxu-admin-bootstrap-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { force: true, recursive: true })));
});

describe('readBootstrapPasswordFile', () => {
  it('reads one trailing newline from a private regular file', async () => {
    const path = join(await temporaryDirectory(), 'password');
    await writeFile(path, 'non-production-bootstrap-password\n', { mode: 0o600 });

    await expect(readBootstrapPasswordFile(path)).resolves.toBe('non-production-bootstrap-password');
  });

  it('rejects group- or world-readable password files', async () => {
    const path = join(await temporaryDirectory(), 'password');
    await writeFile(path, 'non-production-bootstrap-password', { mode: 0o640 });

    await expect(readBootstrapPasswordFile(path)).rejects.toThrow('private regular file');
  });

  it('rejects symbolic links even when their target is private', async () => {
    const directory = await temporaryDirectory();
    const target = join(directory, 'password-target');
    const link = join(directory, 'password-link');
    await writeFile(target, 'non-production-bootstrap-password', { mode: 0o600 });
    await symlink(target, link);

    await expect(readBootstrapPasswordFile(link)).rejects.toThrow('private regular file');
  });

  it('rejects multiply linked password files', async () => {
    const directory = await temporaryDirectory();
    const path = join(directory, 'password');
    await writeFile(path, 'non-production-bootstrap-password', { mode: 0o600 });
    await link(path, join(directory, 'password-alias'));

    await expect(readBootstrapPasswordFile(path)).rejects.toThrow('private regular file');
  });

  it('rejects multiline and invalid UTF-8 password material', async () => {
    const directory = await temporaryDirectory();
    const multiline = join(directory, 'multiline');
    const invalid = join(directory, 'invalid');
    await writeFile(multiline, 'first-line\nsecond-line\n', { mode: 0o600 });
    await writeFile(invalid, Buffer.from([0xc3, 0x28]), { mode: 0o600 });

    await expect(readBootstrapPasswordFile(multiline)).rejects.toThrow('single non-empty UTF-8 line');
    await expect(readBootstrapPasswordFile(invalid)).rejects.toThrow('single non-empty UTF-8 line');
  });
});

describe('assertSecureBootstrapInvocation', () => {
  it('accepts an argument-free invocation without a plaintext password variable', () => {
    expect(() => assertSecureBootstrapInvocation(['node', 'bootstrap-super-admin.cli.ts'], {})).not.toThrow();
  });

  it('rejects command-line arguments and any plaintext password variable', () => {
    expect(() => assertSecureBootstrapInvocation(
      ['node', 'bootstrap-super-admin.cli.ts', 'password-on-command-line'],
      {},
    )).toThrow('does not accept command-line arguments');
    expect(() => assertSecureBootstrapInvocation(
      ['node', 'bootstrap-super-admin.cli.ts'],
      { ADMIN_BOOTSTRAP_PASSWORD: '' },
    )).toThrow('does not accept plaintext password environment variables');
  });
});
