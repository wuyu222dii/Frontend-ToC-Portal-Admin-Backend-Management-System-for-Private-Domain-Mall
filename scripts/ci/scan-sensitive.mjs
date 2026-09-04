import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import process from "node:process";

const files = execFileSync("git", ["-c", "core.quotepath=false", "ls-files", "--cached", "--others", "--exclude-standard"], {
  encoding: "utf8",
}).trim().split("\n").filter(Boolean);

const textFiles = files.filter((file) => (
  existsSync(file)
  && file !== "scripts/ci/scan-sensitive.mjs"
  && !/\.(png|jpe?g|webp|gif|ico)$/i.test(file)
));
const syntheticPrototypePhones = new Set(["13852185218", "13900001234"]);
const syntheticPrototypePhoneFiles = new Set([
  "product-materials/prototype/app.js",
  "product-materials/prototype/verify-prototype.cjs",
]);
const syntheticPhoneFixtures = new Map([
  ["apps/api/src/admin-agents/admin-agents.dto.spec.ts", new Set(["13900001234"])],
  ["apps/api/src/admin-agents/admin-agents.routes.e2e.spec.ts", new Set(["13812345678"])],
  ["apps/api/src/agent-auth/agent-auth.integration.spec.ts", new Set(["13800138000"])],
  ["apps/api/src/platform/security/agent-security.spec.ts", new Set(["13900001234"])],
  ["apps/api/src/store-address/store-address.dto.spec.ts", new Set(["13800000000"])],
  ["apps/api/src/store-address/store-address.routes.e2e.spec.ts", new Set(["13800000000"])],
  ["apps/api/src/store-address/store-address.service.spec.ts", new Set(["13800006821"])],
  ["apps/api/src/store-profile/store-phone-provider.spec.ts", new Set(["13800000000"])],
  ["apps/api/src/store-profile/store-profile.dto.spec.ts", new Set(["13800000000"])],
  ["apps/api/src/store-profile/store-profile.integration.spec.ts", new Set([
    "13800006820",
    "13800006821",
    "13900007932",
  ])],
  ["apps/api/src/store-profile/store-profile.routes.e2e.spec.ts", new Set(["13800000000"])],
  ["apps/api/src/store-profile/store-profile.service.spec.ts", new Set(["13812345678"])],
  ["packages/database/src/store-profile.repository.spec.ts", new Set([
    "13800138000",
    "13900139000",
  ])],
  ["packages/platform-core/test/store-phone.test.ts", new Set([
    "13800006821",
    "13900006821",
  ])],
  ["packages/platform-core/test/store-address.test.ts", new Set(["13800006821"])],
]);
const syntheticBankAccountFixtures = new Map([
  ["apps/api/src/agent-operations/agent-finance.service.spec.ts", new Set(["1234567890123456"])],
  ["apps/api/src/agent-operations/agent-operations.controller.spec.ts", new Set(["6222020012345678"])],
  ["apps/api/src/agent-operations/agent-operations.dto.spec.ts", new Set(["1234567890123456"])],
  ["apps/api/src/platform/security/bank-account-security.spec.ts", new Set(["1234567890123456"])],
  ["packages/database/src/agent-finance.integration.spec.ts", new Set([
    "1234567890123456",
    "9876543210987654",
  ])],
]);
const exactSyntheticSecrets = new Map([
  ["apps/api/src/admin-auth/admin-auth.controller.spec.ts", new Set([
    "password: '12345678'",
    "password: 'password123'",
  ])],
  ["apps/api/src/agent-auth/agent-auth.controller.spec.ts", new Set([
    "password: 'temporary-password'",
    "current_password: 'temporary-password'",
    "new_password: 'new-secure-password'",
  ])],
  ["apps/api/src/agent-auth/agent-auth.dto.spec.ts", new Set([
    "password: 'temporary-password'",
    "current_password: 'temporary-password'",
    "new_password: 'new-secure-password'",
    "password: 'password'",
    "current_password: 'current-password'",
  ])],
  ["apps/api/src/agent-auth/agent-auth.routes.e2e.spec.ts", new Set([
    "password: 'temporary-password-1'",
    "current_password: 'temporary-password-1'",
    "new_password: 'temporary-password-1'",
    "new_password: 'new-password-123'",
    "current_password: 'current-password-1'",
  ])],
  ["apps/api/src/agent-auth/agent-auth.service.spec.ts", new Set([
    "NEW_PASSWORD = 'new-secure-password'",
  ])],
  ["apps/api/src/admin-auth/admin-auth.integration.spec.ts", new Set([
    "password: 'B2-invalid-password'",
  ])],
  ["apps/api/src/admin-auth/admin-auth.routes.e2e.spec.ts", new Set([
    "password: 'password123'",
    "new_password: 'new-password-123'",
  ])],
  ["apps/api/src/platform/http/access-log.middleware.spec.ts", new Set([
    "password: 'should-not-be-logged'",
  ])],
  ["apps/worker/src/outbox-dispatcher.service.spec.ts", new Set([
    "secret: 'payload-must-not-be-logged'",
  ])],
  ["packages/platform-core/test/admin-auth-primitives.test.ts", new Set([
    "password = 'local-test-password-only'",
  ])],
  ["packages/platform-core/test/canonical-json.test.ts", new Set([
    "password: 'not-persisted'",
  ])],
  ["packages/platform-core/test/redaction-rbac-backoff.test.ts", new Set([
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIwMUhGN1lBVDAwIn0.signature-value",
    "password: 'never-log-this'",
    "secret: 'secret-value'",
  ])],
  ["tests/e2e/b2-admin-auth.spec.ts", new Set([
    "otpauth://totp/Qingxu:admin.operator?secret=RUNTIMEONLY&issuer=Qingxu",
  ])],
]);
const rules = [
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["Supabase service role token", /\bservice_role\s*[:=]\s*["']?eyJ[A-Za-z0-9._-]+/i],
  ["live payment secret", /\b(?:sk_live_|wx(?:pay)?[_-]?secret\s*[:=]\s*["'][^"']{12,})/i],
  ["full bank card", /(?<!\d)(?:62\d{14,17})(?!\d)/],
  ["fixture phone number", /(?<!\d)1[3-9]\d{9}(?!\d)/],
  ["application key material", /\b(?:FIELD_ENCRYPTION_KEY_BASE64|BANK_ACCOUNT_HASH_KEY_BASE64|AUDIT_IP_HASH_KEY_BASE64|IDEMPOTENCY_HASH_KEY_BASE64|AUTH_SIGNING_KEY_BASE64|AUTH_SECRET_HASH_KEY_BASE64|STORE_PHONE_HASH_KEY_BASE64|PAYMENT_MOCK_SIGNING_KEY_BASE64)\s*[:=]\s*["']?[A-Za-z0-9+/]{40,}={0,2}/],
  ["previous application key material", /["']key_base64["']\s*:\s*["'][A-Za-z0-9+/]{40,}={0,2}["']/],
  ["JWT credential", /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/],
  ["opaque authentication token", /\b(?:rfr|pat)_[A-Za-z0-9_-]{32,}\b/],
  ["TOTP enrollment URI", /otpauth:\/\/totp\/[^\s"']+\?[^\s"']*\bsecret=[A-Za-z0-9_-]{8,}[^\s"']*/i],
  ["recovery code", /\b[A-HJ-NP-Z2-9]{5}(?:-[A-HJ-NP-Z2-9]{5}){3}\b/],
  ["plaintext bootstrap password variable", /\bADMIN_BOOTSTRAP_PASSWORD\s*=/],
  ["fixed plaintext credential", /\b(?:password|current_password|new_password|credential|secret)\s*[:=]\s*["'][^"'\r\n]{8,}["']/i],
];

const bankAccountContext = /(?:bank[_ -]?)?account[_ -]?(?:number|no)(?![A-Za-z0-9_])/i;
const numericStringLiteral = /(["'`])([0-9](?:[0-9 -]*[0-9])?)\1/g;

function contextualBankAccountNumbers(content) {
  const matches = [];
  for (const line of content.split(/\r?\n/)) {
    if (!bankAccountContext.test(line)) continue;
    for (const match of line.matchAll(numericStringLiteral)) {
      const normalized = match[2].replace(/[ -]/g, "");
      if (/^[0-9]{6,32}$/.test(normalized)) matches.push(normalized);
    }
  }
  return matches;
}

const bankAccountSelfCheck = contextualBankAccountNumbers(
  "const account_number = '9876-5432 1098-7654';",
);
if (bankAccountSelfCheck.length !== 1
  || bankAccountSelfCheck[0].startsWith("62")
  || syntheticBankAccountFixtures.get("unallowlisted-production.ts")?.has(bankAccountSelfCheck[0])) {
  throw new Error("contextual bank-account scan self-check failed");
}

const findings = [];
const allowlisted = [];
for (const file of textFiles) {
  const content = readFileSync(file, "utf8");
  for (const [label, pattern] of rules) {
    const matches = [...content.matchAll(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`))];
    for (const match of matches) {
      if (label === "full bank card" && syntheticBankAccountFixtures.get(file)?.has(match[0])) {
        allowlisted.push(`${file}: ${label}`);
      } else if (label === "fixture phone number" && (
        (syntheticPrototypePhoneFiles.has(file) && syntheticPrototypePhones.has(match[0]))
        || syntheticPhoneFixtures.get(file)?.has(match[0])
      )) {
        allowlisted.push(`${file}: ${match[0]}`);
      } else if (exactSyntheticSecrets.get(file)?.has(match[0])) {
        allowlisted.push(`${file}: ${label}`);
      } else {
        findings.push(`${file}: ${label}`);
      }
    }
  }
  for (const accountNumber of contextualBankAccountNumbers(content)) {
    if (syntheticBankAccountFixtures.get(file)?.has(accountNumber)) {
      allowlisted.push(`${file}: contextual bank account number`);
    } else {
      findings.push(`${file}: contextual bank account number`);
    }
  }
}

if (findings.length > 0) {
  process.stderr.write(`sensitive content scan failed:\n${findings.join("\n")}\n`);
  process.exit(1);
}
process.stdout.write(
  `sensitive content scan passed (${textFiles.length} text files; ${allowlisted.length} documented synthetic fixture matches)\n`,
);
