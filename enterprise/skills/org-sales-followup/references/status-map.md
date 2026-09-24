# 销售状态对照

来源：`enterprise/integrations/super-ops-api.md`。本表只给对话口径，不代替接口调用。

| 字段               | 系统值    | 对外                   |
| ------------------ | --------- | ---------------------- |
| customer\_status   | prospect  | 潜在客户               |
| customer\_status   | active    | 合作中                 |
| customer\_status   | inactive  | 暂停合作               |
| customer\_status   | frozen    | 已冻结                 |
| assignment trigger | manual    | 人工分配               |
| assignment trigger | auto      | 规则自动分配           |
| assignment trigger | recycle   | 回收（无接收人则回池） |
| assignment trigger | import    | 导入                   |
| allocation\_status | PENDING   | 待生效                 |
| allocation\_status | CANCELLED | 已取消                 |

销售成员、分配规则、货源、客户洞察一律走对话里的「销售」工具。
