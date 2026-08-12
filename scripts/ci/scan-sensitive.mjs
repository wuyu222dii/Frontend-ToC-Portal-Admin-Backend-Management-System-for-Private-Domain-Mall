import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

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
const rules = [
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["Supabase service role token", /\bservice_role\s*[:=]\s*["']?eyJ[A-Za-z0-9._-]+/i],
  ["live payment secret", /\b(?:sk_live_|wx(?:pay)?[_-]?secret\s*[:=]\s*["'][^"']{12,})/i],
  ["full bank card", /(?<!\d)(?:62\d{14,17})(?!\d)/],
  ["fixture phone number", /(?<!\d)1[3-9]\d{9}(?!\d)/],
];

const findings = [];
const allowlisted = [];
for (const file of textFiles) {
  const content = readFileSync(file, "utf8");
  for (const [label, pattern] of rules) {
    const matches = [...content.matchAll(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`))];
    for (const match of matches) {
      if (label === "fixture phone number" && syntheticPrototypePhoneFiles.has(file) && syntheticPrototypePhones.has(match[0])) {
        allowlisted.push(`${file}: ${match[0]}`);
      } else {
        findings.push(`${file}: ${label}`);
      }
    }
  }
}

if (findings.length > 0) {
  console.error(`sensitive content scan failed:\n${findings.join("\n")}`);
  process.exit(1);
}
console.log(`sensitive content scan passed (${textFiles.length} text files; ${allowlisted.length} documented synthetic prototype phone matches)`);
