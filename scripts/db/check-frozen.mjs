import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const artifacts = [
  {
    frozen: "product-materials/docs/03-技术设计/schema.prisma",
    formal: "prisma/schema.prisma",
    sha256: "9a25a8eb747df9b4514568c829029efbd9f2f5a6fe9bd59ec9232ff287e368a2",
  },
  {
    frozen: "product-materials/docs/03-技术设计/migrations/0001_initial/migration.sql",
    formal: "prisma/migrations/0001_initial/migration.sql",
    sha256: "f1e192fc6a93710e855770a27ed2de04665288fd9ab188652c0fd5f7683ba71b",
  },
];

function digest(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

try {
  for (const artifact of artifacts) {
    const frozen = readFileSync(artifact.frozen);
    const formal = readFileSync(artifact.formal);
    if (!frozen.equals(formal) || digest(formal) !== artifact.sha256) {
      throw new Error(`${artifact.formal} differs from its frozen artifact`);
    }
  }
  console.log("frozen Prisma schema and baseline migration match byte-for-byte");
} catch (error) {
  console.error(`frozen database artifact check failed: ${error.message}`);
  process.exit(1);
}
