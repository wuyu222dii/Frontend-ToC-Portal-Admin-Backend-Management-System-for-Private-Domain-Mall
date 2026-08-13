import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(packageRoot, '../..');
const frozenSchemaPath = resolve(repositoryRoot, 'prisma/schema.prisma');
const outputPath = resolve(packageRoot, '.generated/prisma');
const temporaryDirectory = await mkdtemp(resolve(tmpdir(), 'qingxu-prisma-'));
const temporarySchemaPath = resolve(temporaryDirectory, 'schema.prisma');

function prismaExecutable() {
  const executable = process.platform === 'win32' ? 'prisma.cmd' : 'prisma';
  return resolve(repositoryRoot, 'node_modules/.bin', executable);
}

async function runPrisma(schemaPath) {
  await new Promise((resolvePromise, reject) => {
    const child = spawn(prismaExecutable(), ['generate', '--schema', schemaPath], {
      cwd: temporaryDirectory,
      env: process.env,
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      reject(new Error(`prisma generate failed (${signal ?? `exit ${String(code)}`})`));
    });
  });
}

try {
  const frozenSchema = await readFile(frozenSchemaPath, 'utf8');
  const generatorPattern = /generator client \{[\s\S]*?\n\}/;
  const matches = frozenSchema.match(new RegExp(generatorPattern.source, 'g')) ?? [];
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one frozen Prisma client generator block, found ${String(matches.length)}`);
  }

  const generatedSchema = frozenSchema.replace(
    generatorPattern,
    [
      'generator client {',
      '  provider            = "prisma-client"',
      `  output              = ${JSON.stringify(outputPath)}`,
      '  moduleFormat        = "cjs"',
      '  importFileExtension = ""',
      '}',
    ].join('\n'),
  );
  if (generatedSchema.replace(generatorPattern, matches[0]) !== frozenSchema) {
    throw new Error('Derived Prisma schema changed content outside the client generator block');
  }
  await writeFile(temporarySchemaPath, generatedSchema, { encoding: 'utf8', flag: 'wx' });
  await rm(outputPath, { force: true, recursive: true });
  await runPrisma(temporarySchemaPath);
} finally {
  await rm(temporaryDirectory, { force: true, recursive: true });
}
