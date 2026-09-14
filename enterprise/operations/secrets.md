# 生产密钥清单

本文件描述**超级运营中心当前实际使用**的密钥与配置项。清单来源于
`.github/workflows/deploy-aca.yml`、`docker-compose.yml` 与代码里的 `process.env` 读取点。

> 本仓禁止读取、输出或提交任何 `.env` / `.env.*` 文件。生产密钥只存在于
> GitHub Actions Secrets 与 Azure Container Apps 的 secret 存储中。

## 风险等级

| 等级     | 含义                                                 |
| -------- | ---------------------------------------------------- |
| **严重** | 泄露即导致数据泄露或身份伪造，必须立刻轮换并排查影响 |
| **高**   | 泄露导致越权访问上游系统，尽快轮换                   |
| **中**   | 泄露影响有限，按计划轮换                             |

---

## 一、Azure Container Apps secret（经 `secretref:` 注入容器）

| ACA secret 名       | 环境变量                            | 等级     | 说明                                                                                        | 轮换影响                                       |
| ------------------- | ----------------------------------- | -------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `database-url`      | `DATABASE_URL`                      | **严重** | Postgres 连接串，含账号密码                                                                 | 需重启 App；同时改 Postgres 侧密码             |
| `key-vaults-secret` | `KEY_VAULTS_SECRET`                 | **严重** | 加密用户存在库里的模型 API key。**轮换后所有用户已保存的 API key 全部解不开**，必须重新录入 | 需重启；提前通知用户                           |
| `auth-secret`       | `AUTH_SECRET`                       | **严重** | 会话签名密钥                                                                                | 需重启；所有会话失效，全员重新登录             |
| `casdoor-id`        | `AUTH_CASDOOR_ID`                   | 高       | Casdoor Application client id                                                               | 先在 Casdoor 控制台重建，再更新                |
| `casdoor-secret`    | `AUTH_CASDOOR_SECRET`               | **严重** | Casdoor client secret，泄露可伪造登录                                                       | 先在 Casdoor 控制台重置，再更新；期间 SSO 中断 |
| `gongdan-api-key`   | `GONGDAN_API_KEY`                   | 高       | 调 gongdan `/api/customers` 的 `X-Api-Key`，只在服务端使用，浏览器拿不到                    | 向 gongdan 管理方重新申请                      |
| `gongdan-pepper`    | `GONGDAN_SYNTHETIC_PASSWORD_PEPPER` | **严重** | 见下方专项说明                                                                              | **见下方，不可随意轮换**                       |

### `GONGDAN_SYNTHETIC_PASSWORD_PEPPER` 专项

客户走「客户编号登录」时不感知密码。系统用
`HMAC-SHA256(pepper, customerCode)` 推导出一个确定性密码，作为该客户在 Better Auth
里的登录凭据（见 [`customerAuth.ts`](../../src/server/services/gongdan/customerAuth.ts) 的
`deriveSyntheticPassword`）。

含义：

- pepper 不泄露时，即使知道 `customerCode` 也推不出密码；即使 DB 泄露（Better Auth 存 bcrypt hash），没有 pepper 也无法批量暴破。
- **pepper 一旦轮换，所有客户推导出的密码全部改变，存量客户账号立即无法登录。** 轮换必须配套一次客户账号凭据重置流程，不能当成普通密钥直接换。
- 生成方式：`openssl rand -base64 32`

---

## 二、GitHub Actions Secrets

`deploy-aca.yml` 从仓库 Secrets 读取，再写入 ACA：

| Secret                                                  | 用途                                                                       |
| ------------------------------------------------------- | -------------------------------------------------------------------------- |
| `AZURE_CREDENTIALS`                                     | `azure/login` 的服务主体凭据。**等级：严重**，泄露等于拿到订阅内的部署权限 |
| `DATABASE_URL` / `KEY_VAULTS_SECRET` / `AUTH_SECRET`    | 同上表                                                                     |
| `CASDOOR_ID` / `CASDOOR_SECRET`                         | 同上表                                                                     |
| `GONGDAN_API_KEY` / `GONGDAN_SYNTHETIC_PASSWORD_PEPPER` | 同上表                                                                     |
| `AZURE_STORAGE_CONNECTION_STRING`                       | 注入 ACA，打开 Azure Blob 文件存储。未配则生产仍是占位 S3                  |
| `AZURE_STORAGE_CONTAINER`                               | 可选，Blob 容器名，缺省 `lobechat`                                         |

ACR 的 admin 密码不在 Secrets 里，由工作流运行时 `az acr credential show` 临时取得。

---

## 三、非密钥配置（明文环境变量）

这些不是密钥，但属于内部拓扑信息，注意本仓目前是 **public 仓库**：

| 变量                     | 当前值来源            | 说明                                                                                                                                                                                                                 |
| ------------------------ | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AUTH_CASDOOR_ISSUER`    | 工作流明文            | Casdoor 签发方地址                                                                                                                                                                                                   |
| `CHAT_GW_URL`            | 工作流明文            | chat-gw 服务地址，MCP 与 admin API 都打到这里                                                                                                                                                                        |
| `GONGDAN_API_BASE`       | 工作流明文            | gongdan API 根地址                                                                                                                                                                                                   |
| `ENTERPRISE_ADMIN_EMAIL` | 工作流明文            | **授权敏感**：决定用谁的 vault 向全体用户提供 provider 配置，见 [`enterpriseRole/index.ts`](../../src/server/services/enterpriseRole/index.ts) 的 `resolveEnterpriseProviderOwnerId`。缺省回落 `sa@enterprise.local` |
| `APP_URL`                | 部署后回填            | Container App 的 FQDN                                                                                                                                                                                                |
| `FEATURE_FLAGS`          | 工作流明文            | 关掉 market /changelog 等非企业入口                                                                                                                                                                                  |
| `S3_ENDPOINT` 等         | 工作流明文 `disabled` | 见下方说明                                                                                                                                                                                                           |

---

## 四、已声明但当前未注入的变量

| 变量                              | 状态                                                                                                                                                                                                            |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AZURE_STORAGE_CONNECTION_STRING` | 已接到 `deploy-aca.yml` 的 update 路径：若 GitHub Secret 有值，则以 `secretref:azure-storage-connection-string` 注入。**Secret 未配置时生产仍走占位 S3，ZIP / 附件技能会失败。** 等级：严重（连接串含账号密钥） |
| `AZURE_STORAGE_CONTAINER`         | 可选 GitHub Secret，缺省代码侧为 `lobechat`                                                                                                                                                                     |

---

## 五、轮换前检查

1. 确认要换的密钥是否属于「换了就破坏存量数据」的那几个：`KEY_VAULTS_SECRET`（用户 API key）、`GONGDAN_SYNTHETIC_PASSWORD_PEPPER`（客户账号）。这两个需要配套迁移流程。
2. 先在来源系统（Casdoor /gongdan/ Azure）重置，再更新 GitHub Secrets，最后触发部署。
3. 部署后确认 Container App 实际起来了 —— 本仓历史上出现过部署失败但无人察觉、生产停留在旧镜像的情况。
4. 轮换记录写进变更记录，不要只改不记。
