import { spawnSync } from "node:child_process";
import { postgresEnvironment, readConnection } from "./connection.mjs";

const [envName, mode, separator, ...args] = process.argv.slice(2);
if (!envName || !mode || separator !== "--") {
  console.error("usage: run-psql.mjs URL_ENV MODE -- <psql arguments>");
  process.exit(64);
}

try {
  const connection = readConnection(envName, mode);
  const result = spawnSync("psql", ["-X", "-v", "ON_ERROR_STOP=1", ...args], {
    env: postgresEnvironment(connection),
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
} catch (error) {
  console.error(`database command refused: ${error.message}`);
  process.exit(1);
}
