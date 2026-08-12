import { createRequire } from "node:module";

const EXPECTED_PRISMA_VERSION = "7.9.1";
const require = createRequire(import.meta.url);

export function prismaInvocation(args) {
  const nodeMajor = Number.parseInt(process.versions.node.split(".")[0], 10);
  if (nodeMajor !== 22) throw new Error("database tooling requires Node.js 22");

  const version = require("prisma/package.json").version;
  if (version !== EXPECTED_PRISMA_VERSION) {
    throw new Error(`database tooling requires Prisma ${EXPECTED_PRISMA_VERSION}, found ${version}`);
  }
  return {
    args: [require.resolve("prisma/build/index.js"), ...args],
    command: process.execPath,
  };
}

export function prismaEnvironment(directUrl, extra = {}) {
  const env = {};
  for (const name of ["CI", "HOME", "LANG", "LC_ALL", "LC_CTYPE", "PATH", "SYSTEMROOT", "TMPDIR"]) {
    if (process.env[name]) env[name] = process.env[name];
  }
  return {
    ...env,
    DIRECT_URL: directUrl,
    PRISMA_HIDE_UPDATE_MESSAGE: "1",
    ...extra,
  };
}
