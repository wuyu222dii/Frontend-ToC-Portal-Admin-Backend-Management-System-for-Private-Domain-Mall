# B17 staging 证据模板

> 仅记录脱敏摘要；禁止粘贴 URL 凭据、密码、token、银行卡、Provider payload 或客户 PII。全部项目必须绑定同一个候选 SHA。

| 字段 | 记录 |
|---|---|
| 候选 SHA | 待填写 |
| staging 项目/Redis/S3 脱敏标识 | 待填写 |
| Secret Manager 与 key ID 清单 | 待填写（仅 ID/版本） |
| 外部复核人/时间 | 待填写 |
| 最终结论 | `NO-GO` |

## B17.0 orphan 与残余风险

- [ ] 无当前、软删除或历史业务引用。
- [ ] 唯一完成 Outbox 满足回收条件。
- [ ] `READY -> REJECTED -> 对象删除 -> DELETED` 完成。
- [ ] 数据库、对象存储和 Redis 无测试残留。
- [ ] B13/B15 P2 已逐项标为闭合、非阻断保留或阻断。

证据摘要：待填写。

## B17.1 环境与密钥

- [ ] `NODE_ENV=staging`、`STAGING_DEIDENTIFIED_MOCK_ACK=true`、`SUPABASE_DATA_API_DISABLED_ACK=true`。
- [ ] 独立 Supabase/Redis/S3、不同于 development/test 默认值的 JWT audience/issuer、字段加密/HMAC key ring。
- [ ] `mall_runtime`/`mall_migrator` 分权、RLS/default grants、TLS、非 root S3 账号通过。
- [ ] Store identity/phone/payment 均为 `MOCK`，不含真实数据。
- [ ] `pnpm config:check` 在候选 SHA 通过。

证据摘要：待填写。

## B17.2 恢复与回滚

- [ ] clone PITR/快照恢复，不覆盖源项目。
- [ ] 迁移历史、权限、RLS、冻结指纹和 `migration diff=0` 通过。
- [ ] 订单/支付/退款/佣金/钱包/提现/审计/Outbox 只读事实一致。
- [ ] MinIO/S3 对象与 Redis 恢复及清理完成。

证据摘要：待填写。

## B17.3 发布与 smoke

- [ ] API/Worker 正常 readiness 均为 `200`。
- [ ] 分别停止数据库、Redis、MinIO 时 API/Worker readiness 为 `503`，恢复后回到 `200`。
- [ ] Admin、Agent、Store 脱敏登录，商品读取和订单只读 smoke 通过。
- [ ] 未创建真实支付、退款、提现或真实客户事实。
- [ ] 敏感扫描和全部 fixture 清理通过。

证据摘要：待填写。

## B17.4 外部复核与结论

- [ ] 外部复核覆盖代码、安全、数据库、PII 与恢复证据。
- [ ] `P0=0/P1=0`；保留项不阻断脱敏 Mock staging。
- [ ] 候选 SHA、构建、迁移、smoke 与复核完全一致。

只有以上全部完成，才能把最终结论改为 B16 `staging-ready`、B17 staging `GO`。该结论不适用于 production 或任何真实 Provider/数据/资金。
