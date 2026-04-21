# Enterprise AI Workspace

> 本仓库 = **上游 LobeChat 源码** + **自建 Enterprise Gateway (gateway/)** + **docker-compose 编排**。
>
> 目标是在本地 Docker 跑一套企业 AI 工作台原型：权限/身份/数据范围/字段脱敏/审计 全部由 `gateway/` 承担，LobeChat 作为对话 UI。
>
> **本地原型**，不上云、不 push 部署、不对外开放。所有敏感字段仅存本地 `.env`。

---

## 与上游 LobeChat 的差异（完整清单）

### 新增目录 / 文件（全部是本项目新增的）

| 路径 | 作用 |
|---|---|
| `gateway/` | Fastify + Prisma + Postgres 实现的 **Enterprise Gateway**。16 工具、9 张企业表、capabilities + identity_map + data_scope + field_policies + audit 全链路。 |
| `gateway/src/routes/admin/*` | 后台管理 API：users / roles / tools / data-scopes / identity-map / audit / tool-schemas |
| `gateway/src/routes/admin/ui.ts` | 极简管理员 HTML UI（`/admin` + `/admin/login` 等 6 页，带 CSRF） |
| `gateway/src/routes/lobechatPlugin.ts` | 动态 LobeChat plugin manifest + tool-gateway 桥接 |
| `gateway/src/routes/metrics.ts` | Prometheus `/metrics`（super_admin 或 `Bearer METRICS_TOKEN`） |
| `gateway/src/core/{gateway,filter,masking,audit,capabilities,cache,auditQueue,metrics,rateLimiter,scopeDsl}.ts` | Gateway 核心流水 |
| `gateway/src/auth/{devAuth,casdoor,casdoorM2M,middleware}.ts` | 开发 header 认证 + Casdoor JWKS Bearer + M2M client_credentials |
| `gateway/src/tools/*` | 8 类工具适配器：gongdan / xiaoshou / cloudcost / kb / aiSearch (Serper) / sandbox (Daytona) / docGenerate |
| `gateway/prisma/schema.prisma` + `seed.ts` | 企业侧 9 张表 schema + 种子 |
| `gateway/scripts/acceptance.sh` | 43 条自动化验收（T1–T24） |
| `gateway/scripts/pilot-{gongdan,kb,xiaoshou,cloudcost,casdoor,ai-search,sandbox,doc,all}.sh` | 真实上游 pilot + 统一入口 |
| `docker-compose.yml` | 全栈编排：db (pgvector) + redis + gateway + lobechat |
| `db-init/01-create-dbs.sql` | 同一 Postgres 内建两个逻辑库：`enterprise_gateway` + `lobechat` |
| `lobechat-plugin-manifest/` | 给 LobeChat 用的 plugin manifest + 指引 |
| `docs/DELIVERY.md` | 交付清单 + 测试报告 |
| `docs/PRODUCTION-SECRETS.md` | 所有密钥的轮换与风险等级 |
| `docs/CASDOOR-SETUP.md` | Casdoor Application 配置手册 |
| `AI-BRAIN-API.md` / `EXTERNAL_SERVICES.md` / `SUPER_OPS_API.md` / `工单接口.md` | 四份上游系统对接文档（用户提供） |
| `.omc/plans/autopilot-impl.md` + `.omc/autopilot/spec.md` | 原始实施规划 |
| `README.gateway.md` + `README.lobechat.md` | 归档：旧的 Gateway-only README 与上游 LobeChat README |

### 修改了哪些上游 LobeChat 源码

| 路径 | 改动 |
|---|---|
| `packages/business/const/src/branding.ts` | `BRANDING_NAME='Enterprise AI Workspace'`、`ORG_NAME='Enterprise AI'`、`SOCIAL_URL=''`、`BRANDING_LOGO_URL='/brand/logo.svg'`、邮箱/链接全清 |
| `src/routes/(main)/settings/about/features/About.tsx` | 移除 Discord/GitHub/X/YouTube/Blog/RSS 自推广卡片，保留版本号 + 中性说明 |
| `src/routes/(main)/settings/about/index.tsx` | 移除 `<Analytics />`（LobeHub analytics 开关） |
| `src/services/marketApi.ts::getSkillDownloadUrl` | 默认 `https://market.lobehub.com` → `''`；不设 env 则不加载 LobeHub 市场插件 |
| `src/libs/next/config/define-config.ts` | `/discover` 重定向目标从 `/community` 改为 `/` |
| `packages/builtin-agents/src/agents/agent-builder/systemRole.ts` | 开场白去品牌 |
| `packages/builtin-agents/src/agents/group-supervisor/systemRole.ts` | 同上 |
| `public/favicon.ico` + `favicon-32x32.ico` + 18 个 .ico 变体 + `apple-touch-icon.png` + `public/icons/icon-*.png` | 换成 EAI 中性 logo |
| `public/brand/logo.svg` | 新建（EAI 灰色圆角方块） |
| `locales/**/*.json` | 批量替换 `LobeHub` / `LobeChat` → `Enterprise AI Workspace`、`LobeHub CLI` → `Enterprise AI CLI`、邮箱 `*@lobehub.com` → `support@enterprise-ai.local`。**242 个文件 / 760 处替换**。i18n key 名未改。 |
| `packages/database/migrations/0090_enable_pg_search.sql` | **注释为空 migration**：pg_search 扩展在 `pgvector/pgvector:pg16` 镜像里不存在；此原型用 pgvector 做向量 RAG 就够，BM25 全文搜索暂不启用。 |
| `packages/database/migrations/0093_add_bm25_indexes_with_icu.sql` | 同上，依赖 0090 的空操作 |

### 其他配置

- `.env.example` / `.env`（本地 gitignore）包含全部 env 变量模板 + 真实凭据（只在本地）
- `Dockerfile` 未改（直接用上游；构建参数 `USE_CN_MIRROR=true` 开启 npmmirror 国内源加速）
- `.gitignore` 补了 `.env` / `.env.pilot` / `.env.auth` / `.env.local` 确保密钥不入库

---

## 架构

```
┌────────────────────────────────────────────────────────────┐
│  浏览器 http://localhost:3010  ─ 对话 / Admin UI (gateway) │
│                              │                              │
│  ┌──────────────┐         ┌──▼──────────────┐              │
│  │  lobechat    │ tool    │ Enterprise      │              │
│  │ (Next.js)    │ bridge  │   Gateway       │  ◀── 企业 SSOT │
│  │  :3210       ├────────▶│  :3001          │              │
│  └──────┬───────┘         │ Fastify+Prisma  │              │
│         │                 └───┬──────────┬──┘              │
│         │                     │          │                  │
│         ▼                     ▼          ▼                  │
│    ┌────────┐           ┌─────────┐ ┌─────────┐             │
│    │Postgres│◀──────────┤ Redis   │ │ 8 类上游│             │
│    │pgvector│           │ cache + │ │  (HTTP) │             │
│    │pg16    │           │ BullMQ  │ └─────────┘             │
│    └────────┘           └─────────┘                         │
└────────────────────────────────────────────────────────────┘
   db (企业DB + lobechat DB)        gongdan / xiaoshou /
                                    cloudcost / kb / serper /
                                    daytona / doc-agent
```

---

## 端口

| 服务 | 本机 | 容器内 |
|---|---|---|
| LobeChat UI | `localhost:3010` | `3210` |
| Gateway | `localhost:3001` | `3001` |
| Postgres | `localhost:5432` | `5432` |
| Redis | （只在 compose 网络内） | `6379` |

---

## 启动

```bash
# 1. 填 .env（用 .env.example 作模板；本地已填真实凭据）
cp .env.example .env  # 如果还没有

# 2. 生成生产级 secret（可选，开发默认值能跑）
for k in KEY_VAULTS_SECRET AUTH_SECRET TOKEN_ENCRYPTION_KEY ADMIN_CSRF_SECRET METRICS_TOKEN; do
  echo "$k=$(openssl rand -base64 32)" >> .env
done

# 3. 起栈（LobeChat 镜像从本仓库根 Dockerfile 源码构建，首次 20+ 分钟）
docker compose build --build-arg USE_CN_MIRROR=true
docker compose up -d

# 4. 验收
curl -sf http://localhost:3001/health        # {"status":"ok","db":"ok"}
curl -sI http://localhost:3010/              # 200 或 307
bash gateway/scripts/acceptance.sh           # 43/43
bash gateway/scripts/pilot-all.sh            # 8 个上游 pilot
```

Admin 后台登录：浏览器开 `http://localhost:3001/admin`，用户 `sa`/`pa` 等 dev 用户名（dev 模式）。

---

## 开发/测试用户（seed）

| 用户名 | 角色 | 能看到的工具 |
|---|---|---|
| `sa` | super_admin | 全部 |
| `pa` | permission_admin | 仅 Admin 后台 |
| `sales1` | internal_sales | xiaoshou * 4 + kb + ai_search + doc |
| `ops1` | internal_ops | gongdan * 2 + cloudcost * 2 + xiaoshou + kb + doc |
| `tech1` | internal_tech | gongdan.get_ticket + kb + ai_search + sandbox + doc |
| `cust1` | customer | kb + ai_search + sandbox + doc + gongdan.create_ticket + gongdan.get_own_tickets |

dev 模式传头 `X-Dev-User: <username>` 即切换身份。

---

## Pilot 脚本（本地真实上游验证）

`bash gateway/scripts/pilot-all.sh` 一把跑：

| 脚本 | 目标 | 需要的 env |
|---|---|---|
| pilot-gongdan.sh | 工单真 upstream + identity_map 过滤 | `GONGDAN_API_KEY` |
| pilot-kb.sh | 知识库真 upstream + 60s Redis 缓存 | `KB_API_KEY` |
| pilot-ai-search.sh | Serper.dev 真 upstream | `AI_SEARCH_KEY` |
| pilot-sandbox.sh | Daytona workspace 列表（真 auth） | `SANDBOX_KEY` |
| pilot-doc.sh | 文档 agent 生成 docx（真 upstream） | `DOC_AGENT_KEY` |
| pilot-xiaoshou.sh | xiaoshou super-ops（若无 key clean-skip） | `SUPER_OPS_API_KEY`（待发） |
| pilot-cloudcost.sh | cloudcost Casdoor M2M（条件 pass） | `CLOUDCOST_M2M_*` |
| pilot-casdoor.sh | JWKS Bearer 路径（内置 mock IdP） | 无 |

---

## 已实现（摘要）

- Casdoor OIDC 代码 ready：dev 双路径 + JWKS Bearer 验证 + DB 角色 fallback + M2M client_credentials（AES-256-GCM 加密缓存到 Redis）
- **16 工具** 全部注册；gongdan/kb/serper/daytona auth/doc 已跑过真 upstream
- 管理后台：`/admin/*` 六页 + CSRF + dev 登录
- 权限栈：deny-wins capability + identity_map 过滤 + data_scope DSL（白名单 + `$in`/`$contains`/`$regex`）+ field_policies（drop/mask/hash + 通配）+ BullMQ 异步审计（sync 兜底）
- 速率限制：全局 300/min、tool 60/min、admin mutate 30/min
- Prometheus `/metrics`：tool_call 计数+直方图、audit 队列深度、cache 命中/未命中、identity_map 缺失
- 43 条 acceptance + 8 条 pilot
- LobeChat 源码级去品牌：brand 常量 + logo + 字体 + favicon + 默认 agent + About 页 + locales 760 处 + market 默认 URL 置空 + /discover 重定向

## 已知限制 / 需用户手工

1. **Casdoor Application** 需要用户在 Casdoor 后台创建（详见 `docs/CASDOOR-SETUP.md`），拿 Client ID / Client Secret 写入 `.env` 才能端到端 SSO。此前留的 admin 密钥已存入 `.env`。
2. **SUPER_OPS_API_KEY** 由 xiaoshou 系统管理员分发；无 key 时 pilot-xiaoshou 自动 skip。
3. **CLOUDCOST_M2M_CLIENT_ID/SECRET** 要在 Casdoor 另建 M2M App；无则 pilot-cloudcost 返回条件 pass。
4. **pg_search / BM25 全文搜索未启用**：`pgvector/pgvector:pg16` 镜像不带 `pg_search.control`。原型用 pgvector 做向量 RAG，本项未启用 BM25 索引。要启用需切 `paradedb/paradedb` 镜像并同步 pg 大版本（需数据迁移，非原型阶段范围）。
5. **Daytona sandbox 真 exec 闭环**要求账号侧先注册 `daytonaio/workspace-project:latest` snapshot；我们的 pilot 以"documented unsupported"形式通过。
6. **生产用 secret** 请先用 `openssl rand -base64 32` 替换 `.env` 里的 `replace_me_*` 占位值（`docs/PRODUCTION-SECRETS.md` 有清单）。

---

## 故障排查速查

```bash
docker compose ps -a               # 容器 / 端口状态
docker logs lobechat-gateway-1 --tail 50
docker logs lobechat-lobechat-1 --tail 50
docker exec lobechat-db-1 psql -U eg -d enterprise_gateway -c "\dt enterprise_*"
docker exec lobechat-redis-1 redis-cli keys 'cap:v1:*'    # 查看权限缓存
bash gateway/scripts/acceptance.sh | grep FAIL
```

---

## 清理

`docker compose down` 保留数据卷；`docker compose down -v` 连 pgdata 一起清。本原型**建议不要 down**，让用户人工核验。
