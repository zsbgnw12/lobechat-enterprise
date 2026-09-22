# 组织 SOP 技能

这里放**说明书技能**（SKILL.md + 附件），给超级运营中心的组织目录用。

- 技能只约束模型和话术。
- 工单 / 客户 / 销售等真实 API 仍走 chat-gw 对话工具，不要写进技能包里的 HTTP 说明，也不要放密钥。
- 不要把 LobeHub 云沙箱或 `execScript` 写进这些技能。

## 现有技能

| 目录                                           | 用途                     |
| ---------------------------------------------- | ------------------------ |
| [`org-ticket-followup/`](org-ticket-followup/) | 工单跟进、催单、关单口径 |

## 怎么装进目录

管理员打开 **设置 → 技能目录 → 添加**：

1. **ZIP**：把某个技能目录打成 zip，保证根目录有 `SKILL.md`。可用同目录 `pack.ps1`。
2. **GitHub**：合进 `main` 后可用\
   `https://github.com/zsbgnw12/lobechat-enterprise/tree/main/enterprise/skills/org-ticket-followup`\
   添加菜单里也有「工单跟进」快捷按钮。
3. **SkillHub**：若已配置 `SKILLHUB_URL`，把同一包发到注册表后再从 SkillHub 页安装。

装好后，对话里勾选该技能才会按说明书回答。非管理员不能写入目录。
