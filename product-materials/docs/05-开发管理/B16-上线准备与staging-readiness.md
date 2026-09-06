# B16 上线准备与 staging-readiness

> 批次：B16；目标：staging-ready；范围：脱敏 development 与一次性演练；当前状态：B16.4 发布演练清单完成，实际 staging 演练与外部复核待执行。

## 1. 上游与边界

B15 最终 SHA `8a743a901ff878bd92654c9c3ff54dcd68ca5413` 的 development migration Run `23` 与 rollback-only smoke Run `45` 同 SHA、依次成功。B15 development `GO`，CH-033 已失效。

B16 不新增业务功能、数据库迁移、Worker、队列、第三方依赖或 GitHub CI。真实微信、真实支付、真实客户/银行卡数据和 production 继续 `NO-GO`。

## 2. 已实施能力

- API 与 Worker 的 `/internal/health` 在 Redis、数据库或 MinIO 不可用时返回 503；依赖恢复后返回统一的数据库/Redis/存储检查结果。
- S3 存储复用现有客户端执行受控 `HeadBucket` 探活，不返回凭据或底层错误。
- API/Worker 启动失败输出不含敏感值的 JSON 事件，随后以非零状态退出；既有优雅关闭保持不变。
- Docker Compose 既有 Redis、MinIO 健康检查继续作为本地依赖门禁。

## 3. 串行批次与退出条件

| 批次 | 交付 | 退出条件 | 状态 |
|---|---|---|---|
| B16.0 | B15 收口、B16 主记录与发布候选冻结 | 证据、文档和状态一致 | 已完成 |
| B16.1 | API/Worker readiness、MinIO 探活、启动失败结构化日志 | 受影响模块构建通过，健康端点不泄露内部信息 | 已完成 |
| B16.2 | Supabase PITR/备份、数据库/MinIO/Redis 恢复与迁移回滚 runbook | 脱敏 development 一次恢复演练记录完整 | **runbook 已完成；演练待执行** |
| B16.3 | 环境变量、密钥轮换、最小权限与故障处置清单 | staging 准入检查项可逐项核对 | **已完成** |
| B16.4 | staging 发布 dry-run、核心 smoke、回滚与最终复审 | `P0=0/P1=0`，通过后标记 staging-ready | **清单已完成；实际演练待执行** |

## 4. 恢复与安全 runbook 要求

迁移前先记录目标 SHA、数据库快照/PITR 时间点和对象存储版本；恢复后核对迁移历史、运行时权限、RLS、Outbox/审计事实和对象数量。失败时停止切流并恢复到快照，不删除业务事实。所有演练仅使用虚构、脱敏数据。

密钥清单必须覆盖数据库、Redis、S3、JWT、字段加密、HMAC 和 Provider；staging 使用独立 key ring 与 audience。日志禁止密码、token、银行卡明文和客户 PII；数据库运行角色不得拥有迁移权限，S3 运行账号不得使用 root。详见 [B16.3 安全与环境准入清单](B16.3-安全与环境准入清单.md)。

## 5. 最小验证

仅运行受影响模块 build 与一次 readiness/release smoke；不运行全仓测试、历史阶段测试、浏览器 E2E 或 GitHub CI。出现具体失败信号需扩大验证时，先记录目的、范围、预计耗时和未验证原因。
