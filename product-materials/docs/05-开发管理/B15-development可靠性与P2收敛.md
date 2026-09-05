# B15 development 可靠性与 P2 收敛

> 批次：B15；产品/API 基线：`v2.4.13 / CH-032`、OpenAPI `2.4.13-ch032`；交付门禁：CH-033；更新日期：2026-09-06；当前状态：B15.1 已完成并暂停复审，B15.2 尚未准入。

## 1. 上游与治理

B14 最终实现 SHA `f4521d4188cb74c3bac34b992016d8730468ae2a` 的 development migration Run `33960486774` 与随后 rollback-only smoke Run `33960618178` 同 SHA、依次成功。B14 development `GO`，CH-031 已自动失效；该历史结论不自动准入 B15。

- CH-032 已批准并立即执行，将产品/API 基线升级为 `v2.4.13 / 2.4.13-ch032`，只收敛既有 development 可靠性 P2。
- CH-033 已批准，但仅在 B15.0 门禁通过后用于 B15.1-B15.4 单维护者、Mock/脱敏 development；B15 development `GO` 后自动失效。
- 普通 GitHub CI 保持取消；不新增 workflow。最终仅手动运行现有 development migration attestation 与随后 rollback-only smoke。

## 2. 收敛范围

### 2.1 B12 文件 orphan

未绑定 `READY/PUBLIC` 或 `READY/PRIVATE` 文件采用统一 7 天回收策略。权威起点是文件完成事务唯一写入的 `file.staging_cleanup_requested` Outbox `created_at`；该事实缺失或重复时必须 fail closed，不从可变业务时间猜测。

七类业务关系全部计为引用，包含软删除或历史记录：Brand Logo、Category Icon、Product Image、Banner、Aftersale Evidence、Withdrawal Proof、Promotion QR。既有 Worker 只能在数据库锁内重验无引用后将文件从 `READY` 改为 `REJECTED`，删除精确 final/staging 对象，再将其改为 `DELETED`。新关联必须对文件行取得 `FOR SHARE`；清理必须 `SELECT ... FOR UPDATE`，从而让关联与删除竞态串行收敛。

`PENDING/staging` 的既有 24 小时候选规则保持不变。B15 不创建新 Worker、队列、环境变量、存储前缀或第三方依赖。

### 2.2 B13.8 五类 P2

1. 佣金版本变更记录冻结目标类型、目标 ID、不可变目标名、快照来源、变更前配置值和变更后配置值；通用审计只保留跳转，不在版本详情重复拼装第二份历史。
2. 规则发布发生 409 后，前端重新拉取权威版本列表/详情并保留待编辑变更，不显示陈旧成功状态。
3. 代理重新启用复用既有幂等命令和 pending 禁用，防止重复点击形成第二个动作。
4. preview 即使费率数值相同，也必须显示 `SKU > CATEGORY > PLATFORM` 命中来源变化。
5. 提现付款凭证未知结果使用同会话恢复 journal 重放原 `file_id + idempotency_key`，不重复创建上传意图。

## 3. 契约与数据决策

- 保持 `173 paths / 198 operations` 和全部 operationId；不新增业务路由。
- 写入 DTO `CommissionRuleChange` 保持不变；响应专用 `CommissionRuleVersionChangeView` 增加 `target_name_snapshot`、`target_name_snapshot_source` 与 `before_configured_rate`，避免把只读历史字段混入命令。
- 历史佣金条目由 0007 在迁移时解析当前名称并标记 `MIGRATION_CAPTURED`；新发布条目标记 `PUBLISH_CAPTURED`。任何旧目标无法解析时迁移原子失败，不生成伪名称。
- `target_name_snapshot_source` 只允许 `MIGRATION_CAPTURED | PUBLISH_CAPTURED`；配置值继续区分 `null` 继承与 `0%` 明确无佣金。
- 0007 只允许增加佣金历史快照列/约束、READY 回收历史预检和数据库竞态守卫；不得增加业务表或枚举，不修改 `0001` 至 `0006`。
- 所有业务事实、幂等、审计和 Outbox 继续在同一事务提交；B15 不改变 B10-B13 资金锁序。

## 4. 提现凭证恢复 journal

Admin Web 只在当前登录会话的 `sessionStorage` 保存：`schema_version`、`account_fingerprint`、`withdrawal_id`、`file_id`、`idempotency_key`、`created_at`。最长保留 24 小时；账号不一致、过期或结构损坏时先清除且不得发请求。

仅在成功且详情确认绑定，或确定性 `400/403/404/409/422`（`SESSION_CHANGED` 除外）时清除。网络失败、Abort、401、429、5xx、`INVALID_RESPONSE` 和 `SESSION_CHANGED` 保留，重新认证后必须确认账号指纹相同再重放。journal 不保存文件正文、文件名、签名 URL、银行卡号、token 或服务端响应体。

## 5. 严格串行批次

| 批次 | 交付内容 | 最小退出条件 | 当前状态 |
|---|---|---|---|
| B15.0 | B14 收口登记；B15 主记录；CH-032/033；OpenAPI 与 generated contracts | Redocly、连续两次生成无漂移、contracts build、`git diff --check` 通过；不含迁移/Worker/业务实现 | **已完成并暂停** |
| B15.1 | `0007_b15_development_convergence_guards`、READY 回收和佣金历史数据底座 | 既有 Worker 完成两阶段回收；引用/清理竞态、Outbox 异常和迁移原子失败闭合；一个定向服务端测试及受影响构建通过 | **已完成并暂停复审** |
| B15.2 | 佣金版本历史解释、发布冲突恢复、来源变化 preview、代理重新启用保护 | 严格响应、旧/新名称快照、审计跳转、409 刷新和重复点击闭合；复用 B15 服务端测试及受影响构建 | **未准入** |
| B15.3 | 提现付款凭证 session journal | 丢包/重认证同键恢复、确定性清除和跨账号零请求闭合；一个定向前端测试及 Admin Web build 通过 | **未准入** |
| B15.4 | 最终复审、文档同步与 development 远端门禁 | `P0=0/P1=0`；最终 SHA migration attestation 后 rollback-only smoke 成功；B15 development `GO`，CH-033 失效 | **未准入** |

每批完成后必须暂停复审。已通过且代码未变化、无法提供新信息的检查不重复运行。

## 6. 最小验证

- B15 全阶段最多新增两个基础测试文件：服务端状态机一个、前端 journal 一个；预计各 1-2 分钟。
- B15.0 只运行 `pnpm contracts:lint`、连续两次 `pnpm contracts:generate` 的 SHA-256 比对、`pnpm --filter @qingxu/contracts build` 和 `git diff --check`。
- B15.1-B15.3 默认仅运行对应定向测试和受影响模块 build；不运行全仓、历史阶段测试或浏览器 E2E。
- 出现具体失败信号且必须扩大测试时，先说明目的、范围与预计耗时，等待用户确认。
- 环境限制导致未验证时，退出记录必须列出原因、最小手工步骤、预期结果和注意事项，不得记为通过。

## 7. 回退与发布边界

0007 一旦部署到 development 只允许前向保留。运行时回退通过停止 READY 清理候选、隐藏 B15 前端交互增强并继续读取兼容字段完成，不删除文件、佣金历史、提现、审计或 Outbox 事实。

B15 仅限 Mock Provider、虚构文件与脱敏 development。真实微信身份、支付、退款、物流，真实银行卡或客户数据，staging 和 production 均不在本阶段；B19 的管理员密码/TOTP 与双人离线恢复也不进入 B15。

## 8. 当前检查点

| 项目 | 结论 |
|---|---|
| B14 上游 | **development `GO`；最终 SHA 两项远端门禁同 SHA、依次成功** |
| CH-031 | **已失效，不得用于 B15** |
| CH-032 | **已批准；当前基线 `v2.4.13 / 2.4.13-ch032`** |
| CH-033 | **已批准；覆盖 B15.1-B15.4 单维护者脱敏 development** |
| B15.1 | **已完成并暂停复审；B15.2 尚未准入** |
| staging/真实数据 | **其余 P2 尚未以实现证据闭合，继续 `NO-GO`** |

## 9. B15.0 退出证据

- `pnpm contracts:lint` 通过，Redocly 以 `mall@v2.4.13` 验证 OpenAPI 无错误。
- generated contracts 连续生成两次，`packages/contracts/src/generated/openapi.ts` 两次 SHA-256 均为 `f26d8d249a4f64c0215ad52fe025e2057d802c85f6f7477fcc59ad8283285357`。
- `pnpm --filter @qingxu/contracts build` 与 `git diff --check` 通过。
- 未新增迁移、Worker、依赖、GitHub workflow、业务实现或测试文件；B15.1 保持未准入。
- 本机 `shasum` 因不可用的 `C.UTF-8` locale 崩溃，哈希改由系统 `openssl dgst -sha256` 计算；该限制不影响生成文件或 TypeScript 构建。

## 10. B15.1 退出证据

- `0007_b15_development_convergence_guards` 两份迁移逐字节一致，增加 READY 完成事件历史预检/唯一索引、佣金目标名快照回填与发布期守卫，并以文件行 `FOR SHARE/FOR UPDATE` 串行化关联和清理。
- 既有 FileCleanup Worker 按唯一完成事件的时间执行 7 天回收，状态固定为 `READY -> REJECTED -> DELETED`；对象删除失败停留在 `REJECTED` 并可由下一轮恢复，不新增 Worker、队列、配置或依赖。
- 新发布佣金版本在同一事务锁定并冻结 PLATFORM/CATEGORY/SKU 目标名；历史数据由迁移标记 `MIGRATION_CAPTURED`，新增数据标记 `PUBLISH_CAPTURED`。
- `pnpm --filter @qingxu/database build`、`pnpm --filter @qingxu/worker build` 通过；唯一新增的服务端状态机测试 `2 passed`。未重复运行已通过的历史测试或全仓测试。
- PostgreSQL 18.3 一次性空库完成 `0001 -> 0007` 回放；结构核对为 76 tables、59 enums、24 partial indexes、177 CHECK、47 user triggers、28 owned functions，三项原生定义指纹均已冻结并通过。
- 异常 READY 历史的 `0006 -> 0007` 故障注入按预期以 `23514` 拒绝，失败后快照列、唯一索引和 CHECK 残留均为零；一次性容器及两套数据库已删除。
- development 尚未部署 `0007`；该远端迁移和 rollback-only smoke 只在 B15.4 最终 SHA 执行，不把本次临时回放记为 development 证据。
