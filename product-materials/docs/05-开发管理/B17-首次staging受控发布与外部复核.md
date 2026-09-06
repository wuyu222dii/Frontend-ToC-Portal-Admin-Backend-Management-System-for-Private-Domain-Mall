# B17 首次 staging 受控发布与外部复核

> 批次：B17；目标：首次脱敏 Mock staging 准入；当前状态：B17.0 进行中，staging `NO-GO`。

## 1. 基线、范围与硬门禁

B17 以 B16 收口为前置，不新增业务功能、数据库迁移、Worker、队列、第三方依赖或 GitHub CI。业务 OpenAPI、operationId、数据库表、枚举和迁移链保持不变。真实微信、真实支付、真实物流、真实客户/银行卡数据和 production 继续 `NO-GO`。

当前代码起点为 `b689efb`，产品/API 基线为 `v2.4.13 / CH-032`。B17.0 完成后，以包含本批代码的精确提交 SHA 作为唯一候选；后续构建、迁移、smoke 和外部复核不得混用其他提交。

B12 的 `READY/PRIVATE` evidence orphan 已在 B15 实现两阶段回收代码：数据库锁内重验无历史、软删除和当前引用，依次执行 `READY -> REJECTED -> 对象删除 -> DELETED`。本次已在全新、仅虚构数据的临时 PostgreSQL/Redis/MinIO 环境完成引用保护、删除失败续跑、审计顺序和零残留演练；该证据仍需绑定最终候选 SHA，不能替代独立 staging 项目证据。

## 2. B16 收口核验

- B16.1 的 API/Worker `/internal/health`、数据库/Redis/MinIO 探活和脱敏启动失败日志已实现并完成受影响构建。
- B16.2 备份、PITR、数据库/MinIO/Redis 恢复与回滚 runbook 已记录；实际 clone 恢复演练尚无可核验的目标项目证据。
- B16.3 安全与环境准入清单已记录；staging 专用项目、Secret Manager 注入、RLS/权限和 Data API 关闭仍待现场核对。
- B16.4 发布演练清单已记录；实际 dry-run、依赖故障注入、敏感扫描和外部独立复核尚未完成。

因此 B16 只能保持“准备项完成、staging-ready 未取得证据”，B17.0 不得直接把 B16 标记为 `staging-ready`。

## 3. B17.0-B17.4 串行批次

| 批次 | 交付内容 | 退出条件 | 状态 |
|---|---|---|---|
| B17.0 | B16 证据核验、状态同步、CH-035、候选 SHA 冻结；闭合 B12 orphan | 唯一证据包、历史风险复核、外部复核人确认 | **orphan 隔离演练完成；候选 SHA/外部复核待执行** |
| B17.1 | 独立 staging 环境、密钥、数据库角色/RLS、TLS、Data API 和 Mock 配置 | `config:check`、密钥/权限清单和环境隔离均通过 | **代码门禁已实现；现场证据待执行** |
| B17.2 | clone 项目迁移、PITR/快照、MinIO/Redis 恢复与回滚演练 | 迁移历史、权限、RLS、事实、对象和 `migration diff=0` 一致 | 待执行 |
| B17.3 | API/Worker 发布、readiness、Admin/Agent/Store 脱敏核心 smoke、依赖故障与清理 | 正常 `200`、依赖异常 `503`、恢复 `200`，无残留/敏感泄露 | 待执行 |
| B17.4 | 外部独立代码/安全/数据库/PII/恢复复核与 Go/No-Go | `P0=0/P1=0`，复核签字齐全后 B16 `staging-ready`、B17 `GO` | 待执行 |

每批完成后暂停复审。未取得独立项目、Secret Manager 或外部复核证据时，结论固定为 `NO-GO`。

## 4. 运行时准入实现

共享配置现在接受 `NODE_ENV=staging`，并在启动时强制：

1. `STAGING_DEIDENTIFIED_MOCK_ACK=true`；
2. `SUPABASE_DATA_API_DISABLED_ACK=true`；
3. `AUTH_TOKEN_ISSUER`、Admin/Store/Agent 三个 audience 均使用独立于 development/test 默认值的 Secret-Manager 值，且彼此不重叠；
4. Store identity、phone 和 payment Provider 全部为 `MOCK`；
5. 远程 PostgreSQL/Redis/S3/推广地址使用受信 TLS/HTTPS，仍使用 `mall_runtime` 与 `mall_migrator` 分权和独立 key ring。

Mock Provider 仅在 development、test 或通过上述显式确认的 staging 中启用；production 继续 fail-closed。新增 `pnpm staging:readiness` 只读探测 API/Worker `/internal/health`，不输出响应正文、凭据或业务数据。

## 5. 最小验证与现场记录

只执行下列与 staging 准入直接相关的检查：

- 一次候选 SHA 的受影响构建、`pnpm config:check` 和 contracts lint/build；
- 一次迁移 dry-run、恢复 clone、只读权限/RLS/事实校验和 `migration diff=0`；
- 一次 `pnpm staging:readiness`：API/Worker 正常依赖为 `200`，分别停止数据库、Redis、MinIO 时为 `503`，恢复后回到 `200`；
- 一次脱敏 Admin、Agent、Store 登录、商品读取和订单只读 smoke，不创建真实支付、退款或提现事实；
- 一次敏感扫描、对象/Redis/数据库残留清理和外部独立复核。

每项记录候选 SHA、目标项目/桶/Redis 实例标识、时间、密钥 ID（不记录密钥值）、readiness 状态码、故障注入结果、清理摘要、复核人和未验证项。禁止把密码、token、银行卡明文、Provider payload 或客户 PII 写入证据包。

现场结果统一填写 [B17 staging 证据模板](B17-staging证据模板.md)，不得另建包含原始响应或秘密的附件。

### B17.0 本地隔离 orphan 演练（2026-09-06）

- 迁移链：临时 PostgreSQL 空库 `0001 -> 0007`；不连接 development 或远端项目。
- 场景：无引用 PRIVATE 文件、当前 BRAND_LOGO 引用、软删除引用仍保护、对象删除失败后从 `REJECTED` 续跑。
- 结果：`READY -> REJECTED -> 对象删除 -> DELETED`、拒绝审计先于对象删除；3 个虚构文件、6 条审计转换、数据库/对象/Redis 残留均为 `0`。
- 该结果仅证明代码在脱敏隔离环境的行为，最终仍需用候选 SHA 重做 staging 证据包并由外部复核人签字。

## 6. 当前 Go/No-Go

| 门禁 | 当前结论 |
|---|---|
| B12 orphan 两阶段回收现场证据 | **本地隔离演练已通过；候选 SHA 绑定和 staging 证据待执行** |
| B13/B15 残余 P2 与历史文档一致性 | 代码收敛已记录；外部 staging 复核待执行 |
| 独立 staging 项目、Secret Manager、TLS、RLS | **未提供，阻断** |
| clone 恢复、迁移回滚、依赖故障注入 | **未执行，阻断** |
| 外部独立复核与 `P0/P1` 清单 | **未签字，阻断** |
| B17 staging | **NO-GO** |

在上述阻断项全部取得可审计证据前，不标记 B16 `staging-ready`，不切入真实数据或 production。

## 7. 回退边界

B17 不删除账户、订单、支付、退款、佣金、钱包、提现、审计、Outbox、文件或迁移事实。应用回退通过停止 staging 新路由/导航依赖、恢复兼容版本和按 runbook 恢复 clone 完成；不得 reset 数据库或手工编辑迁移历史。
