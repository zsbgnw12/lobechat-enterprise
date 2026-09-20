# SkillHub 旁挂

超级运营中心不内嵌 Java 注册中心。组织目录仍写本仓 `agent_skills`；[iflytek/skillhub](https://github.com/iflytek/skillhub) 只作为可选的上游注册表。

## 本仓做什么

配了 `SKILLHUB_URL` 之后，管理员在技能目录「添加」里会出现 **从 SkillHub 导入**：

1. 用 ClawHub 兼容接口搜索 `GET {apiBase}/search?q=`
2. 下载 `GET {apiBase}/download?slug=`
3. 解析 `SKILL.md` 后写入组织目录（和 GitHub / ZIP 同一条导入链）

未配置时入口不出现，不影响现有 GitHub / URL / ZIP 导入。

## 怎么起 SkillHub

SkillHub 是独立的 Java 21 服务（Postgres + Redis + 对象存储），不要塞进 lobechat 这一个库。发布模板见上游 `docs/09-deployment.md`：

```bash
git clone https://github.com/iflytek/skillhub.git
cd skillhub
cp .env.release.example .env.release
docker compose --env-file .env.release -f compose.release.yml up -d
```

OIDC 可接现有 Casdoor。对象存储可以继续用已有 Azure Blob，不必再起 MinIO。

## 接到超级运营中心

GitHub Secrets（可选）：

| Secret           | 注入                       |
| ---------------- | -------------------------- |
| `SKILLHUB_URL`   | 明文 `SKILLHUB_URL`        |
| `SKILLHUB_TOKEN` | `secretref:skillhub-token` |

合进 `main` 后的 ACA 部署会带上这两项。配好后强制刷新，添加菜单里才会出现 SkillHub。

工单 / 客户等真实 API 仍走 chat-gw，不要做成 SkillHub 技能包里的 HTTP 说明。
