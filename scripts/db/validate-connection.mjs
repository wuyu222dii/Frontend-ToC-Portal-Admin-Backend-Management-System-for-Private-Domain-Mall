import { readConnection } from "./lib/connection.mjs";

const [envName, mode] = process.argv.slice(2);
if (!envName || !mode) {
  console.error("usage: validate-connection.mjs URL_ENV owner|migrator|runtime|ci-replay");
  process.exit(64);
}

try {
  readConnection(envName, mode);
  console.log(`${envName}: connection policy passed`);
} catch (error) {
  console.error(`${envName}: ${error.message}`);
  process.exit(1);
}
