# 工单状态对照

来源：`enterprise/integrations/gongdan-api.md` 的工单模块。本表只给对话口径，不代替接口调用。

| 接口 `status`  | 对内   | 对外           |
| -------------- | ------ | -------------- |
| PENDING        | 待受理 | 待受理         |
| ACCEPTED       | 已受理 | 已受理         |
| IN\_PROGRESS   | 处理中 | 处理中         |
| PENDING\_CLOSE | 待关闭 | 待关闭，等确认 |
| CLOSED         | 已办结 | 已办结         |

平台字段：`taiji` / `xm` / `original`。
工程师等级：`L1` / `L2` / `L3`。

查列表、催单、留言、改状态一律走对话里的「工单」工具。
