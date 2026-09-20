# enterprise/ — 企业分叉文档

本目录收纳**所有与企业分叉相关的文档**。上游 LobeChat 自己的文档仍在 `docs/`，两边不混。

这样分开有具体原因：`.i18nrc.js` 的文档翻译任务 entry 是 `./docs/**/*.md`，
`.seorc.cjs` 是 `./docs/**/*.mdx`。企业文档放进 `docs/` 会被上游工具链扫到并尝试处理；
放在 `enterprise/` 则完全隔离，将来合并上游也不会撞。

## 目录

```
enterprise/
├── README.md                      本文件
├── integrations/                  业务方提供的上游系统接口规格
│   ├── ai-brain-api.md            AI Brain API
│   ├── super-ops-api.md           Super Ops（销售系统）API
│   └── gongdan-api.md             工单系统 API（原「工单接口.md」）
├── operations/
│   ├── secrets.md                 生产密钥清单与轮换说明
│   └── skillhub.md                可选的 SkillHub 旁挂说明
└── upstream-lobechat-readme.md    上游 LobeChat 原始 README 归档
```

## 怎么用

| 我要做什么                | 先读哪份                                                                |
| ------------------------- | ----------------------------------------------------------------------- |
| 了解整体架构、角色、部署  | 仓库根 [`README.md`](../README.md)                                      |
| 改代码（人或 AI）         | 仓库根 [`CLAUDE.md`](../CLAUDE.md)                                      |
| 改 gongdan / 上游工具适配 | [`integrations/`](integrations/) 下对应那份                             |
| 轮换密钥、排查配置缺失    | [`operations/secrets.md`](operations/secrets.md)                        |
| 旁挂 SkillHub 注册中心    | [`operations/skillhub.md`](operations/skillhub.md)                      |
| 查上游原生能力怎么用      | [`upstream-lobechat-readme.md`](upstream-lobechat-readme.md) 或 `docs/` |

## 约定

- 新增企业文档一律放本目录，不要放 `docs/`，也不要堆在仓库根。
- 文件名用小写连字符 ASCII（中文文件名在 shell / CI 里会出编码问题，`工单接口.md` 已因此改名）。
- 企业代码改动请在源码里留 `[enterprise-fork]` 注释标记，这是枚举分叉面的唯一手段：
  ```bash
  rg "\[enterprise-fork\]" --files-with-matches
  ```
