import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const artifacts = [
  {
    frozen: "product-materials/docs/03-技术设计/schema.prisma",
    formal: "prisma/schema.prisma",
    sha256: "b691934957a712d93f3411ee21370e8a1aabdba4330425bda8b09e93794683c2",
  },
  {
    frozen: "product-materials/docs/03-技术设计/migrations/0001_initial/migration.sql",
    formal: "prisma/migrations/0001_initial/migration.sql",
    sha256: "f1e192fc6a93710e855770a27ed2de04665288fd9ab188652c0fd5f7683ba71b",
  },
  {
    frozen: "product-materials/docs/03-技术设计/migrations/0002_b9_inventory_fact_indexes/migration.sql",
    formal: "prisma/migrations/0002_b9_inventory_fact_indexes/migration.sql",
    sha256: "9c933d256e0cbe7c33acdd801b6385bae6f892ff3db10978c40e37ea2f89f5d0",
  },
  {
    frozen: "product-materials/docs/03-技术设计/migrations/0003_b10_payment_fact_indexes/migration.sql",
    formal: "prisma/migrations/0003_b10_payment_fact_indexes/migration.sql",
    sha256: "0d5109a6d0eab2598f2c6c98bbeca265bdd32733e7d89f8eb78eff67caedb836",
  },
  {
    frozen: "product-materials/docs/03-技术设计/migrations/0004_b10_commission_position_trigger_fix/migration.sql",
    formal: "prisma/migrations/0004_b10_commission_position_trigger_fix/migration.sql",
    sha256: "8d4c391af114c4691d2be80ae8bb44efc1c70658f5268ad4de7221a29d5ee102",
  },
  {
    frozen: "product-materials/docs/03-技术设计/migrations/0005_b12_aftersale_refund_guards/migration.sql",
    formal: "prisma/migrations/0005_b12_aftersale_refund_guards/migration.sql",
    sha256: "95f362667bdc6a0b751ae636d91a139a71a3f40155ba764937db01d5bbce412b",
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
  console.log("frozen Prisma schema and migration chain match byte-for-byte");
} catch (error) {
  console.error(`frozen database artifact check failed: ${error.message}`);
  process.exit(1);
}
