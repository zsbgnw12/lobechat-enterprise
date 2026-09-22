# SkillHub 旁挂

超级运营中心不内嵌 Java 注册中心。组织目录仍写本仓 `agent_skills`；[iflytek/skillhub](https://github.com/iflytek/skillhub) 只作为可选的上游注册表。

## 本仓做什么

配了 `SKILLHUB_URL` 之后，管理员在技能目录里会多出 **SkillHub** 页，并可在「添加」里看到 **从 SkillHub 导入**：

1. 浏览 `GET {apiBase}/skills`，或搜索 `GET {apiBase}/search?q=`
2. 下载 `GET {apiBase}/download?slug=`
3. 解析 `SKILL.md` 后写入组织目录（和 GitHub / ZIP 同一条导入链）
4. 已导入且带 `skillHubSlug` 的技能可以「从源刷新」

未配置时入口不出现，技能目录仍只有组织列表，不影响现有 GitHub / URL / ZIP 导入。

## 怎么独立拉起 SkillHub

不要把 SkillHub 的 Postgres / Redis / Java 塞进本仓根 `docker-compose.yml`。官方发布模板也不要整份拷进 git（会过期、也很大）。本仓只留一层启动器：下载**钉死版本**的官方 Compose，用独立项目名跑。

当前钉死：`v0.2.21`。覆盖端口避开本仓的 `5432` / `3010`：

| 服务     | 宿主端口 |
| -------- | -------- |
| Web UI   | `18088`  |
| API      | `18080`  |
| Postgres | `5434`   |
| Redis    | `6380`   |

Windows:

```powershell
pwsh enterprise/operations/skillhub/up.ps1 up
pwsh enterprise/operations/skillhub/up.ps1 ps
pwsh enterprise/operations/skillhub/up.ps1 down
```

Linux / macOS:

```bash
bash enterprise/operations/skillhub/up.sh up
```

第一次 `up` 会把官方 `compose.release.yml` 和 `.env.release.example` 拉到 `enterprise/operations/skillhub/.runtime/`（已 gitignore），再套上 `env.heihub.example` 的端口覆盖。之后改密码只动 `.runtime/.env.release`。

接到本仓：

| 怎么跑超级运营中心 | `SKILLHUB_URL`                      |
| ------------------ | ----------------------------------- |
| 宿主机 `pnpm dev`  | `http://127.0.0.1:18088`            |
| 根目录 docker 栈   | `http://host.docker.internal:18088` |

```bash
# 宿主机开发
set SKILLHUB_URL=http://127.0.0.1:18088
pnpm dev

# 或和根 compose 一起
SKILLHUB_URL=http://host.docker.internal:18088 docker compose up -d
```

也仍可以直接按上游文档自己 clone 再起：

```bash
git clone https://github.com/iflytek/skillhub.git
cd skillhub
git checkout v0.2.21
cp .env.release.example .env.release
docker compose --env-file .env.release -f compose.release.yml up -d
```

生产对象存储可以继续用已有 Azure Blob（S3 兼容接口），不必再起 MinIO。OIDC 可接现有 Casdoor，变量写在 `.runtime/.env.release`。

## 接到超级运营中心（生产）

GitHub Secrets（可选）：

| Secret           | 注入                       |
| ---------------- | -------------------------- |
| `SKILLHUB_URL`   | 明文 `SKILLHUB_URL`        |
| `SKILLHUB_TOKEN` | `secretref:skillhub-token` |

合进 `main` 后的 ACA 部署会带上这两项。配好后强制刷新，技能目录才会出现 SkillHub 页和导入入口。

工单 / 客户等真实 API 仍走 chat-gw，不要做成 SkillHub 技能包里的 HTTP 说明。
