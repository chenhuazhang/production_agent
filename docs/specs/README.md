# 变更级 Spec

`/code-review` 的 **Spec 轴**要回答一个问题：这次改动有没有真的实现当初要求的。
它按下面的顺序找依据：

1. commit message 里的工单号（`#123`、`Closes #45`、GitLab `!67`）
2. 命令行显式传入的路径
3. `docs/`、`specs/`、`.scratch/` 下与分支名或功能名匹配的文件

## 命名

```
docs/specs/<YYYY-MM-DD>-<feature>.md
```

分支名同名优先：`feat/order-list-filters` → `docs/specs/order-list-filters.md`。
一个需求一个文件，改需求就改文件并在文末记一行变更。

## 现在有什么

| 层级 | 文件 | 用途 |
|---|---|---|
| 系统级 | [需求规格](../../Doc/production-agent/cn/01-需求规格.md) | 已提交，覆盖 2.1–2.9 与全部业务规则。整仓评审可直接拿它当 Spec |
| 设计级 | [详细设计](../../documentation/detailed-design（功能详细设计）.md) | 接口、数据流、决策记录 |
| 变更级 | 本目录 | 单次改动的验收标准；目前为空，从下一个需求开始写 |

## 怎么写

复制 [_template.md](_template.md)，五节写满即可，不要写成设计文档：

- **背景**：为什么现在要做
- **目标**：这次必须成立的行为
- **不做**：明确排除的范围，防止评审把没做当成缺陷
- **验收**：可判定的条目，一条一句
- **影响面**：会碰到的模块、接口、文档

## 为什么值得写

没有 spec 时，code-review 会跳过 Spec 轴并写 `no spec available`，
评审就只剩代码风格意见——这正是「改得漂亮但改错了」最容易漏掉的地方。

写完 spec 后再改代码，commit message 带一句 `Spec: docs/specs/<file>.md`，
评审就不用靠猜。
