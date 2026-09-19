# 腾讯云 staging 基础设施操作手册

> 默认读者：**一人创业、自己运维**。日常继续本机 Docker，云上只买过不了代码门禁的最小集。  
> 完整（偏贵）落地见 [腾讯云部署方案](腾讯云部署方案.md)。准入清单见 [B16.3](../05-开发管理/B16.3-安全与环境准入清单.md)。空库命令见 [scripts/db/README.md](../../../scripts/db/README.md)。  
> B16/B17 证据未闭合前，**staging 切流、production、真实客户数据、真实资金仍为 `NO-GO`**。

---

## 先读这三句

1. **现在不用买云。** 本机 `postgres-ci` + Redis + MinIO 就能开发、演示给自己看。
2. **第一次需要公网**（微信填 request 域名、给投资人/客户看线上、自己手机打真实 HTTPS）再买下面「最小集」。
3. **省钱只省规格和台数，不省门禁。** TLS、分角色、独立密钥、Mock staging 这几项省掉进程会拒启，或把真实数据暴露到公网。

## 现在不要买

| 产品 | 原因 |
|---|---|
| 凭据管理系统 SSM | 进程不读 SSM；一人用 1Password / Bitwarden / macOS 钥匙串即可 |
| 负载均衡 CLB | 一台 CVM + Nginx 终结 HTTPS 就够 |
| CDN | 后台/代理用 Nginx 同源反代；图片走 COS 源站 |
| 跳板机 / 第二台 CVM | SSH 只放行你的家庭/办公 IP |
| 第二套子网、第二只静态桶 | 一个 VPC、一个子网、一个 COS 桶 |
| NAT 网关、云日志 CLS、云监控付费套餐 | staging 用 systemd journal |
| production 任何资源 | 真实微信/支付未演练前不要建 |

开通产品入口（控制台点一次、通常不按实例计费）可以以后再做。**不要点「新建实例」。**

## 第一次公网演练才买（最小集）

全部选**同一地域**（建议广州）、**按量或包月以控制台当时最低档为准**，能选单节点/基础版就不要选高可用、集群、只读副本。

| 产品 | 怎么选 | 备注 |
|---|---|---|
| VPC + 1 个子网 + 1 个安全组 | 免费 | 必须有，库和 Redis 不能挂公网 |
| CAM 子用户 ×1 | 免费 | **只**给 COS 运行时用，不要把主账号密钥写进 API |
| 云数据库 Redis | 当前最低内存档、标准架构、**开加密传输**、关公网 | 代码强制 `rediss://` |
| COS | **1 个**私有桶 | 不要整桶公有读 |
| TencentDB PostgreSQL | 当前最低规格、单可用区、**关外网**、开 SSL | 代码强制内网域名 + `verify-full` |
| CVM | 2 核 4 GB 或控制台最低能跑 Node 22 的档、Ubuntu 22.04、**1 台** | API + Worker + Nginx 后台/代理全放这台 |

包月前先确认：不用就释放。TencentDB / Redis 按小时计费，空转最亏。

地域示例用 **广州 `ap-guangzhou`**。选上海则替换 COS 源站主机名。

## 不能省的门禁

| 约束 | 含义 |
|---|---|
| 禁止任何 `SUPABASE_*` | 进程拒启 |
| TencentDB 内网域名 + `sslmode=verify-full` + CA | 不要填内网 IP，不要 `sslmode=disable` |
| `DATABASE_URL` = `mall_runtime`；`DIRECT_URL` = `mall_migrator` | 运行环境不放 owner / migrator |
| Redis `rediss://` | 禁止明文 `redis://` |
| COS path-style | `S3_ENDPOINT` 无 path；`S3_PUBLIC_BASE_URL` path 恰好是 `/<桶名>` |
| COS 运行密钥 ≠ 主账号 | 子用户只授 `public/*` `private/*` `staging/*` |
| staging 独立 issuer / 三个 audience / 全部 key ring | 禁止照抄 `.env.example` 和本机 `.env` |
| 空库才 `pnpm db:bootstrap` | 已有表立刻停；禁止 `prisma migrate reset` |

---

## 0. 网络（免费，买库前做）

### 0.1 控制台登录

用你自己的腾讯云账号，打开 [MFA](https://console.cloud.tencent.com/cam/mfa)。一人不必再建 `qingxu-ops` 用户组。

需要用到时再开通（仍不新建实例）：[CVM](https://console.cloud.tencent.com/cvm)、[PostgreSQL](https://console.cloud.tencent.com/postgres)、[Redis](https://console.cloud.tencent.com/redis)、[COS](https://console.cloud.tencent.com/cos)、[CAM](https://console.cloud.tencent.com/cam)。

### 0.2 只建一个 COS 运行子用户

1. 打开 [CAM](https://console.cloud.tencent.com/cam)。
2. 新建子用户 `qingxu-cos-runtime-staging`：只勾选「编程访问」，不要控制台登录。
3. 保存 `SecretId` / `SecretKey` 到第 1 节保险柜。`SecretId` 即 `S3_ACCESS_KEY`，须字母或数字开头、至少 16 位。
4. 建桶后（第 3 节）只授该用户：`ListBucket` + `public/*`、`private/*`、`staging/*` 的 Get/Put/Delete。权限形状等价 [`scripts/storage/minio-runtime-policy.json`](../../../scripts/storage/minio-runtime-policy.json)。不要 `AdministratorAccess`。
5. **禁止**把主账号密钥写进 API/Worker。

### 0.3 一个 VPC、一个子网

1. 打开 [VPC](https://console.cloud.tencent.com/vpc)，地域与 COS/库相同。
2. 新建 `qingxu-staging-vpc`，网段例如 `10.20.0.0/16`。
3. 只建一个子网 `qingxu-staging`：`10.20.1.0/24`（CVM、Redis、TencentDB 都放这里）。

### 0.4 一个安全组

新建 `qingxu-staging-sg`。

入站：

| 来源 | 端口 | 用途 |
|---|---|---|
| 你的公网 IP `/32` | TCP 22 | SSH |
| `0.0.0.0/0` | TCP 80 / 443 | 证书申请 + HTTPS（买 CVM 后才需要） |

出站保持默认即可（CVM 要访问 COS `443`）。

不要对公网开放 `3000`、`5432`、`6379`、`9000`。TencentDB / Redis 的访问来源选本安全组或本 VPC，不要 `0.0.0.0/0`。

IP 变了就改安全组，不要为图省事改成全网 SSH。

---

## 1. 密钥（不开 SSM）

进程不读腾讯云 SSM。一人把 staging 密钥放进 **1Password / Bitwarden / macOS 钥匙串**，或本机权限 `0600` 的加密备份。禁止：微信、备忘录截图、Git、`.env` 提交、工单正文。

生成：

```bash
openssl rand -base64 32
```

字段加密、JWT 签名、幂等 HMAC、银行卡 HMAC、审计 IP 哈希、Store 手机号哈希、Mock 支付 HMAC 都是独立的 32 字节 canonical base64。数据库 / Redis 密码各 ≥24 位；`MALL_RUNTIME_PASSWORD` 与 `MALL_MIGRATOR_PASSWORD` 必须不同。

staging **禁止**使用这些 development 默认值：

| 禁止照抄 | 换成 |
|---|---|
| `AUTH_TOKEN_ISSUER=qingxu-api` | 独立 issuer |
| `AUTH_TOKEN_AUDIENCE=qingxu-admin-web` | 独立 admin audience |
| `AGENT_AUTH_TOKEN_AUDIENCE=qingxu-agent-web` | 独立 agent audience |
| `STORE_AUTH_TOKEN_AUDIENCE=qingxu-store` | 独立 store audience |

三者与 issuer 彼此不重叠。不要复制本机 `.env` 里的任何 `*_KEY_BASE64`。

最少要存：TencentDB 实例管理员（仅 bootstrap）、runtime / migrator 密码、Redis 密码、COS 子用户密钥、上述 key ring 与 audience。

---

## 2. Redis（最低档 + TLS）

要公网演练时才买。

1. [云数据库 Redis](https://console.cloud.tencent.com/redis) → 新建。
2. 同一 VPC / 子网 `qingxu-staging`。
3. Redis 7.x，标准架构，**控制台最低内存档**。不要集群、不要只读副本。
4. 密码认证开；**加密传输开**；**关公网**。
5. 白名单 / 安全组只放本 VPC 或 `qingxu-staging-sg`。

在未来那台 CVM 上：

```bash
redis-cli --tls -h '<redis内网地址>' -p 6379 -a "$REDIS_PASSWORD" ping
```

应返回 `PONG`。失败不要改成 `redis://`。

```text
REDIS_URL=rediss://:<URL编码后的密码>@<内网地址>:6379/0
```

密码里的 `@` `#` `:` `/` `%` 必须 URL 编码。

---

## 3. COS（一只桶）

1. [COS](https://console.cloud.tencent.com/cos) → 新建 `mall-staging`（全局唯一；被占用就加短后缀，环境变量跟着改）。
2. 地域与 VPC 相同；**私有读写**；打开版本控制。
3. 不要再建静态站桶。admin / agent 以后用同一台 CVM 的 Nginx 提供。
4. 把第 0.2 节子用户绑到本桶（`public/*` `private/*` `staging/*`）。
5. 匿名访问最多允许 `<桶名>/public/*` 的 `GetObject`。`private/*`、`staging/*` 保持私有。
6. CORS：有备案域名再填 `https://admin.…`、`https://agent.…`；没有就先留空。

```text
S3_ENDPOINT=https://cos.ap-guangzhou.myqcloud.com
S3_BUCKET=mall-staging
S3_PUBLIC_BASE_URL=https://cos.ap-guangzhou.myqcloud.com/mall-staging
S3_REGION=ap-guangzhou
S3_FORCE_PATH_STYLE=true
S3_ACCESS_KEY=<子用户 SecretId>
S3_SECRET_KEY=<子用户 SecretKey>
```

`S3_ENDPOINT` 不要带 path。不要用 `https://mall-staging.cos.ap-guangzhou.myqcloud.com`（过不了校验）。

```bash
curl -I "https://cos.ap-guangzhou.myqcloud.com/${S3_BUCKET}"
```

---

## 4. TencentDB PostgreSQL（最低档 + 关外网）

要公网演练时才买，和 Redis、CVM 同一天买，避免库空转。

1. [PostgreSQL](https://console.cloud.tencent.com/postgres) → 新建。
2. 同一 VPC / 子网 `qingxu-staging`。
3. 版本 16 或 17 稳定版即可（不必 18）。
4. **控制台最低规格、单可用区**；能选基础版就不要高可用。
5. **关闭外网**；开启 SSL；下载 CA 到 `/etc/qingxu/certs/tencent-postgres-ca.crt`（`0644`）。
6. 自动备份保留 7 天即可（控制台名称以产品为准）。
7. 记下 **内网域名**（`*.sql.tencentcdb.com` / `*.postgres.tencentcdb.com` / `*.pg.tencentcdb.com`），不要填内网 IP。
8. 实例管理员密码只进保险柜，仅用于下面 bootstrap。

空库初始化在**已经买好的那台 CVM**上做，不要再买跳板机。机器装好 Node `22.23.1`、pnpm `10.34.5`、`psql`，clone 冻结 SHA。连接串加单引号，避免 zsh 拆 `&`：

```bash
export DATABASE_PROVIDER=tencentdb
export DATABASE_OWNER_URL='postgresql://<实例管理员>:<管理员密码>@<内网域名>:5432/postgres?sslmode=verify-full&sslrootcert=/etc/qingxu/certs/tencent-postgres-ca.crt'
export DIRECT_URL='postgresql://mall_migrator:<迁移密码>@<内网域名>:5432/postgres?sslmode=verify-full&sslrootcert=/etc/qingxu/certs/tencent-postgres-ca.crt'
export DATABASE_URL='postgresql://mall_runtime:<运行密码>@<内网域名>:5432/postgres?sslmode=verify-full&sslrootcert=/etc/qingxu/certs/tencent-postgres-ca.crt'
export MALL_MIGRATOR_PASSWORD='<与 DIRECT_URL 相同>'
export MALL_RUNTIME_PASSWORD='<与 DATABASE_URL 相同>'
export PGSSLROOTCERT=/etc/qingxu/certs/tencent-postgres-ca.crt
export DATABASE_BOOTSTRAP_CONFIRM=BOOTSTRAP_EMPTY_DEV_DATABASE
```

不得有 `SUPABASE_*`。`public` 已有表立刻停。

```bash
pnpm db:bootstrap
node scripts/db/verify.mjs
node scripts/db/check-drift.mjs
```

不要对该库跑 `pnpm db:migrate:baseline`。成功后立刻 `unset DATABASE_OWNER_URL`，并从 CVM 环境文件里删掉实例管理员密码。

`psql "$DATABASE_URL" -c 'select current_user;'` 必须是 `mall_runtime`。用一次性 `DIRECT_URL` 会话看 `_prisma_migrations`，应有 `0001`–`0007` 共 7 行。

`DIRECT_URL` 只出现在你手动迁移的 shell 里，不写进 API/Worker 的 `runtime.env`。

---

## 买 CVM 之后（仍是一台机）

按 [腾讯云部署方案](腾讯云部署方案.md) 第 9 节装 Node / Nginx，但规格用 **2 核 4 GB、1 台**。同一 Nginx 反代：

- `https://api.<域名>/api/v1`、`/internal/health` → `127.0.0.1:3000`
- `https://admin.<域名>`、`https://agent.<域名>` → 本机静态 `dist`（或同机不同 server_name）

证书用腾讯云免费 DV 或 Let’s Encrypt。`API_TRUSTED_PROXY_CIDRS=127.0.0.1/32`。

`/etc/qingxu/runtime.env`（`0640`）至少：

```text
NODE_ENV=staging
STAGING_DEIDENTIFIED_MOCK_ACK=true
DATABASE_PROVIDER=tencentdb
DATABASE_URL=postgresql://mall_runtime:...sslmode=verify-full&sslrootcert=...
REDIS_URL=rediss://:...
S3_* 如上
STORE_IDENTITY_PROVIDER=MOCK
STORE_PHONE_PROVIDER=MOCK
STORE_PAYMENT_PROVIDER=MOCK
独立的 AUTH_TOKEN_ISSUER 与三个 audience
```

完整字段见 [`.env.example`](../../../.env.example)。先校验再启服务：

```bash
sudo /home/ubuntu/.nvm/versions/node/v22.23.1/bin/node \
  --env-file=/etc/qingxu/runtime.env \
  scripts/ci/validate-env.mjs
```

不用云的时候：在控制台**销毁或关机**按量 CVM；TencentDB / Redis 不能白关还计费就删实例（先确认没有要留的演练数据）。

## 登记（不含密钥）

| 项 | 值 |
|---|---|
| 地域 | |
| VPC / 子网 / 安全组 ID | |
| Redis 实例 ID / 内网地址 | |
| COS 桶名 | |
| TencentDB 实例 ID / 内网域名 | |
| CVM 实例 ID（若已买） | |
| 冻结 Git SHA | |

## 禁止事项

- 不要为省钱把本机 Docker 端口映射到公网
- 不要 `sslmode=disable` 或 Redis `redis://`
- 不要 `prisma migrate reset`、不要 `docker compose down -v` 当云上恢复
- 不要在复核完成前写入真实手机号、地址、银行卡或打开真实微信支付
- 不要把密钥写进镜像、Git、微信
