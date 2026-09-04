import { randomBytes } from 'node:crypto';

import { loadPlatformConfig } from '@qingxu/config';
import {
  AuditRepository,
  BusinessRuleRepository,
  createDatabaseRuntime,
  runSerializableTransaction,
} from '@qingxu/database';
import { isValidUlid } from '@qingxu/platform-core';

interface InitialBusinessRuleBootstrapInput {
  actorAccountId: string;
  legalRecordRetentionYears: number;
}

export function parseInitialBusinessRuleBootstrapInput(
  argv: readonly string[],
  source: NodeJS.ProcessEnv,
): InitialBusinessRuleBootstrapInput {
  if (argv.length !== 2) throw new Error('Business-rule bootstrap does not accept command-line arguments');
  const actorAccountId = source.BUSINESS_RULE_BOOTSTRAP_ADMIN_ID;
  const retention = source.BUSINESS_RULE_LEGAL_RECORD_RETENTION_YEARS;
  if (actorAccountId === undefined || !isValidUlid(actorAccountId)) {
    throw new Error('BUSINESS_RULE_BOOTSTRAP_ADMIN_ID must identify an existing active SUPER_ADMIN');
  }
  if (retention === undefined || !/^(?:[1-9]|[1-9][0-9]|100)$/.test(retention)) {
    throw new Error('BUSINESS_RULE_LEGAL_RECORD_RETENTION_YEARS must be an integer from 1 to 100');
  }
  return { actorAccountId, legalRecordRetentionYears: Number(retention) };
}

export async function bootstrapInitialBusinessRules(): Promise<string> {
  const input = parseInitialBusinessRuleBootstrapInput(process.argv, process.env);
  const config = loadPlatformConfig(process.env, {
    service: 'api',
    requireDatabase: true,
    requireEncryption: true,
    requireStorage: false,
  });
  const database = createDatabaseRuntime({
    applicationName: 'qingxu-business-rule-bootstrap',
    allowInsecureLocalhost: config.database.allowInsecureLocalhost,
    connectionTimeoutMs: config.database.connectionTimeoutMs,
    databaseUrl: config.database.url,
    poolMax: 1,
    projectRef: config.database.projectRef,
    sslRootCertPath: config.database.sslRootCertPath,
  });
  await database.connect();
  try {
    const rules = new BusinessRuleRepository(database.prisma);
    const audit = new AuditRepository(config.encryption.ipHashKey);
    const requestId = `req_${randomBytes(16).toString('hex')}`;
    const rule = await runSerializableTransaction(database.prisma, async (transaction) => {
      const created = await rules.bootstrapInitialInTransaction(transaction, input);
      await audit.append(transaction, {
        action: 'PUBLISH',
        actorAccountId: input.actorAccountId,
        actorRole: 'SUPER_ADMIN',
        after: {
          aftersale_window_days: created.aftersaleWindowDays,
          minimum_withdrawal_amount: created.minimumWithdrawalAmount,
          status: 'PUBLISHED',
          version: created.version,
        },
        module: 'config',
        objectId: created.versionId,
        objectType: 'business_rule',
        reason: 'Controlled initial business-rule bootstrap',
        requestId,
        result: 'SUCCESS',
        resultCode: 'OK',
        summaryPolicy: 'BUSINESS_RULE_CHANGE',
      });
      return created;
    });
    return rule.versionId;
  } finally {
    await database.disconnect();
  }
}

if (require.main === module) {
  bootstrapInitialBusinessRules()
    .then((versionId) => process.stdout.write(`Initial business rules created: ${versionId}\n`))
    .catch(() => { process.stderr.write('Initial business-rule bootstrap failed\n'); process.exitCode = 1; });
}
