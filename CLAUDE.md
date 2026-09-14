# CLAUDE.md

本文件为 Claude Code (claude.ai/code) 在本仓库工作时提供指引。

## 这个仓库是什么

**上游 LobeChat / LobeHub 2.1.50 的企业定制硬分叉**，产品名 **超级运营中心**。不是插件、不是 submodule —— 企业能力直接写在上游源码里，共 58 个文件带 `[enterprise-fork]` 注释标记，用这个标记可以枚举全部分叉面：

```bash
rg "\[enterprise-fork\]" --files-with-matches
```

上游原始 README 归档在 `enterprise/upstream-lobechat-readme.md`。

**文档放置约定**：企业分叉的所有文档在 `enterprise/`，上游自己的文档留在 `docs/`，两边不混
（`docs/**` 会被 `.i18nrc.js` / `.seorc.cjs` 的上游工具链扫到）。新增企业文档放 `enterprise/`，
不要堆在仓库根。

> **重要历史**：本仓曾经有过一个本地 `gateway/` 目录（Fastify + Prisma + 自建 `enterprise_*` 表）。它在 commit `dce4ccd` 被**整个删除**，职责搬到了远程的 chat-gw 服务。任何提到 `gateway/`、`acceptance.sh`、`pilot-*.sh`、`enterprise_gateway` 数据库、`X-Dev-User` 开发头、`/admin` HTML 后台的说法都是**过期信息**。

## 架构

```
浏览器 ──▶ 超级运营中心 (Next.js/LobeChat, Azure Container Apps :3210)
              │
              ├─ Casdoor OIDC 登录 → Better Auth accounts 表存 access_token
              │
              ├─ tRPC chatGateway.callTool ──▶ chat-gw  POST /mcp
              │     (JSON-RPC, Bearer = Casdoor token)   工具注册/授权/审计/上游适配全在对端
              │
              ├─ tRPC enterpriseAdmin.*    ──▶ chat-gw  /admin/*   (cloud_admin only)
              │
              └─ 客户编号登录 ─────────────▶ gongdan  /api/auth/customer-login
                                              (HS256 JWT, role=CUSTOMER)
            Postgres (pgvector pg16) —— 只有 lobechat 一个库
```

权限模型完全在 Casdoor 侧：JWT 的 `roles` claim 决定角色，本仓不维护映射表。角色为
`cloud_admin` / `cloud_ops` / `cloud_finance` / `cloud_viewer` / `cloud_sales`。

## 企业代码地图

| 路径                                                        | 作用                                                         |
| ----------------------------------------------------------- | ------------------------------------------------------------ |
| `src/server/services/chatGateway/mcpClient.ts`              | chat-gw MCP JSON-RPC 薄客户端                                |
| `src/server/services/chatGateway/invokeTool.ts`             | `chatgw-` 前缀工具 → chat-gw `tools/call`                    |
| `src/server/services/chatGateway/adminClient.ts`            | chat-gw `/admin/*` 客户端                                    |
| `src/server/services/chatGateway/tokenStore.ts`             | 从 Better Auth accounts 取 Casdoor token，自动 refresh       |
| `src/server/services/enterpriseRole/index.ts`               | Casdoor JWT → 角色解析（5 分钟内存缓存）+ 管理员 vault owner |
| `src/server/services/gongdan/customerAuth.ts`               | 客户编号登录 /refresh                                        |
| `src/server/routers/lambda/chatGateway/`                    | 工具调用 tRPC router                                         |
| `src/server/routers/lambda/enterpriseAdmin/`                | 管理后台 tRPC router                                         |
| `src/libs/trpc/lambda/middleware/requireEnterpriseAdmin.ts` | provider/model 配置类 mutation 的硬门控                      |
| `src/features/EnterpriseAdmin/`                             | 管理后台 8 页 UI                                             |
| `src/app/(backend)/api/auth/customer-login/route.ts`        | 客户登录 route                                               |
| `src/server/modules/fileStorage.ts`                         | S3 / Azure Blob 存储选择                                     |

管理后台挂在 `/settings/enterprise-admin/*`。**SPA 路由必须同时注册在**
`src/spa/router/desktopRouter.config.tsx` **和** `desktopRouter.config.desktop.tsx`，
漏一个会白屏。

## 常用命令

```bash
pnpm install         # 冷装约 25 分钟，见下方「依赖陷阱」
pnpm run type-check  # tsgo --noEmit
pnpm run lint:ts     # eslint
pnpm run build:spa   # vite build，Docker 构建的第一步，最容易挂在这
docker compose up -d # 本地全栈（db + lobechat）

bunx vitest run --silent='passed-only' '[file]' # 单文件测试
```

**不要跑 `bun run test` / `pnpm run test-app`** —— 全量约 10 分钟，且需要 DB/Redis fixture。

## 依赖陷阱（动手前必读）

本仓继承了上游为高频迭代设计的依赖策略，但源码冻结在 2.1.50，两者冲突：

- `.npmrc: lockfile=false` —— **pnpm 根本不生成 lockfile**，仓库里没有也装不出 `pnpm-lock.yaml`。
- `.npmrc: resolution-mode=highest` —— 每个 range 一律解析到**已发布最高版**。
- root `package.json` 365 个依赖里 **273 个是 caret 范围**。

合起来的后果：**每次构建都是「用旧源码配当天最新依赖」**，构建结果不可复现，会周期性地凭空炸掉。

还有一个静默陷阱：**`pnpm-workspace.yaml` 里的 `overrides:` 块不生效**。两处 overrides 并存时
pnpm 只认 `package.json` 的 `pnpm.overrides`。要固定某个版本，**写进 `package.json#pnpm.overrides`**，
写在 `pnpm-workspace.yaml` 里会被静默忽略（实测 `react: 19.2.4` 被忽略，实装 19.3.0）。

## CI / 部署

- `.github/workflows/deploy-aca.yml` —— push main 触发：GitHub runner 构建镜像 → 推 ACR → 更新 Azure Container Apps。镜像在 runner 上构建（ACR 自带 agent 内存不够）。
- `.github/workflows/ci.yml` —— 触发条件是 `pull_request: [main]` + `push: branches-ignore: [main]`。**直推 main 不会触发 CI**。
- main **没有分支保护**，没有必需检查。

`next build` 和 vite 都用 esbuild 剥类型、**不做类型检查**。所以 TS 错误拦不住构建，
只会在运行时炸。改完务必自己跑 `pnpm run type-check`。

## 安全红线

- `.env` / `.env.*` 禁止读取、输出、提交。生产密钥走 ACA secretref，见 `enterprise/operations/secrets.md`。
- 不要直推 main、不要 force push。
- 不要把 TODO /mock/placeholder 说成生产完成。

## 上游对接文档

业务方提供的上游系统接口规格在 `enterprise/integrations/`：
`ai-brain-api.md`、`super-ops-api.md`、`gongdan-api.md`。
改任何与 gongdan / 上游工具相关的代码前先查对应那份。

---

## 上游 LobeChat 约定（改上游代码时仍然适用）

技术栈：Next.js 16 + React 19 + TS・`react-router-dom` SPA · `@lobehub/ui` + antd・
antd-style（优先 `createStaticStyles` + `cssVar.*`）· react-i18next · zustand · SWR ·
tRPC · Drizzle ORM · Vitest。

目录：`apps/desktop/` Electron · `packages/` 共享 `@lobechat/*` · `src/app/` Next.js App Router ·
`src/routes/` **薄**路由段（只从 `@/features/*` 引）・`src/features/` 领域 UI・`src/spa/` SPA 入口。

测试优先 `vi.spyOn` 而非 `vi.mock`。同一个问题修 2 次没成，停下来问。

i18n：只往 `src/locales/default/<namespace>.ts` 加 key；预览翻 `locales/zh-CN/` + `locales/en-US/`；
**不要跑 `pnpm i18n`**（CI 负责）。注意 locale **value 已整体去品牌**为「超级运营中心」，
i18n **key 名未改**，grep 品牌词前先看清楚。

包管理：`pnpm` 管依赖，`bun` 跑 script，`bunx` 跑可执行包。
