# 超级运营中心

> 上游 **LobeChat / LobeHub 2.1.50** 的企业定制分叉。企业身份、角色授权、工具调用、
> 管理后台直接实现在上游源码里；工具的注册、鉴权、审计与上游系统适配由远程 **chat-gw** 服务承担。

部署在 Azure Container Apps，push `main` 自动发布。

企业分叉的全部文档在 [`enterprise/`](enterprise/)；上游 LobeChat 自己的文档仍在 `docs/`，两边不混。
上游原始 README 归档在 [`enterprise/upstream-lobechat-readme.md`](enterprise/upstream-lobechat-readme.md)。

---

## 架构

```
浏览器
  │
  ▼
超级运营中心  (Next.js / LobeChat · Azure Container Apps · 容器内 :3210)
  │
  ├── Casdoor OIDC 登录 ──────────▶ Casdoor
  │     Better Auth accounts 表存 access_token，过期自动 refresh
  │     角色来自 JWT 的 roles claim，本仓不维护映射表
  │
  ├── tRPC chatGateway.callTool ──▶ chat-gw  POST /mcp
  │     JSON-RPC，Bearer = Casdoor token
  │     工具注册表 / 角色授权 / 客户授权 / 审计 / 上游适配都在对端
  │
  ├── tRPC enterpriseAdmin.*  ────▶ chat-gw  /admin/*      仅 cloud_admin
  │
  └── 客户编号登录 ───────────────▶ gongdan  /api/auth/customer-login
        HS256 JWT，role=CUSTOMER，本仓只透传不解析
  │
  ▼
Postgres (pgvector pg16) —— 单库 lobechat
```

## 角色

角色由 Casdoor JWT 的 `roles` claim 决定：

| 角色            | 说明                                                         |
| --------------- | ------------------------------------------------------------ |
| `cloud_admin`   | 等价 super\_admin。可进企业管理页、可改 provider /model 配置 |
| `cloud_ops`     | 运维                                                         |
| `cloud_finance` | 财务                                                         |
| `cloud_viewer`  | 只读                                                         |
| `cloud_sales`   | 销售                                                         |

非 `cloud_admin` 的登录用户只能读管理员配好的 provider 与模型，不能增删改 endpoint / API key。
门控实现在 [`requireEnterpriseAdmin.ts`](src/libs/trpc/lambda/middleware/requireEnterpriseAdmin.ts)。

## 管理后台

挂在 `/settings/enterprise-admin/*`，8 个页面：

**企业管理**（走 chat-gw `/admin/*`，仅 cloud\_admin）
仪表盘・工具注册・角色授权・客户授权・审计日志

**AI 网关**（走 chat-gw `/mcp`，任意登录用户以自己角色的视角查看）
健康・目录・调试

## 相对上游的改动面

58 个文件带 `[enterprise-fork]` 标记，可直接枚举：

```bash
rg "\[enterprise-fork\]" --files-with-matches
```

大致分三类：

- **新增企业能力** —— `src/server/services/chatGateway/`、`src/server/services/enterpriseRole/`、`src/server/services/gongdan/`、`src/features/EnterpriseAdmin/`、`src/server/routers/lambda/{chatGateway,enterpriseAdmin,enterpriseRole}/`、Azure Blob 存储适配器
- **收紧上游** —— provider /model 配置改为管理员独占；设置页与 Agent 渠道集成 tab 按角色隐藏；工具执行器加 `chatgw-` 前缀专线
- **去品牌** —— 品牌常量、logo、favicon，以及 `locales/` 下 217 个文件的 value 替换为「超级运营中心」。**i18n key 名未改**

## 本地开发

```bash
pnpm install # 冷装约 25 分钟
pnpm run type-check
pnpm run build:spa
docker compose up -d
```

`docker compose` 起 `db`（pgvector pg16）+ `lobechat`，UI 在 <http://localhost:3010。>
Redis 与本地 gateway 已随架构调整移除。

> **构建前必读**：`.npmrc` 设了 `lockfile=false` + `resolution-mode=highest`，
> 仓库没有也生成不出 lockfile，每次安装都解析到当天最新版本。365 个依赖里 273 个是 caret 范围。
> 详见 [CLAUDE.md 的「依赖陷阱」](CLAUDE.md)。

## 部署

`.github/workflows/deploy-aca.yml`，push `main` 触发：

1. GitHub runner 上 `docker build`（ACR 自带 agent 内存不足以跑 LobeChat 的 next build）
2. 推到 ACR `lobechatacroperation`
3. `az containerapp update` 更新 Container App `lobechat`（资源组 `Operation`，区域 southeastasia）

密钥经 ACA secretref 注入，清单见 [`enterprise/operations/secrets.md`](enterprise/operations/secrets.md)。

## 上游系统对接文档

业务方提供的接口规格，改相关适配代码前先查：

- [`enterprise/integrations/ai-brain-api.md`](enterprise/integrations/ai-brain-api.md)
- [`enterprise/integrations/super-ops-api.md`](enterprise/integrations/super-ops-api.md)
- [`enterprise/integrations/gongdan-api.md`](enterprise/integrations/gongdan-api.md)
