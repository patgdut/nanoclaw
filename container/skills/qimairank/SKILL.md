---
name: qimairank
description: 获取七麦数据 iOS 应用排名上升榜。从 qimai.cn 提取24小时内排名上升最快的 App 信息，包括名称、链接、排名变化。
allowed-tools: Bash(bb-browser:*), Bash(qimairank:*)
---

# qimairank - 七麦排名上升榜

## 功能

获取七麦数据 iOS App Store 24小时内排名上升榜，提取：
- App 名称
- 七麦详情页链接
- 排名上升幅度
- 总榜排名 & 分类榜排名
- 开发者名称

## 使用方式

直接调用脚本一键获取数据，无需手动操作浏览器：

```bash
qimairank                   # 默认输出文本表格，前20名
qimairank --top 10          # 前10名
qimairank --format json     # JSON 格式
qimairank --country cn      # 中国区
qimairank --brand paid      # 付费榜
```

## 重要：输出处理规则

1. **默认 text 格式**：直接将 qimairank 输出原样发送给用户，不要二次加工或重新排版。输出已经是适合聊天消息的格式。
2. **json 格式**：`--format json` 用于需要程序化处理数据时。
3. **不要用 markdown 的 bold/italic** 包裹 App 名称，因为有些 App 名字含有 `*` 等特殊字符，会破坏格式。

## 输出示例

### text 格式（默认，直接发给用户）
```
iOS 24h 排名上升榜 (US Free)

1. DICK'S Sporting Goods | +138 | 总榜#11 | 购物(免费)#2
   https://www.qimai.cn/app/rank/appid/556653197/country/us
2. ReelShort - Stream Drama & TV | +123 | 总榜#67 | 娱乐(免费)#13
   https://www.qimai.cn/app/rank/appid/1636235979/country/us
```

### json 格式
```json
{
  "rank": "1",
  "appName": "DICK'S Sporting Goods",
  "appUrl": "https://www.qimai.cn/app/rank/appid/556653197/country/us",
  "developer": "Dick's Sporting Goods",
  "rankChange": "138",
  "overallRank": "11",
  "overallCategory": "应用(免费)",
  "categoryRank": "2",
  "categoryName": "购物(免费)"
}
```

## 参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `--top N` | 20 | 获取前 N 名 |
| `--genre ID` | 36 | 类别 ID（36=全部应用） |
| `--country CC` | us | 国家/地区代码 |
| `--device DEV` | iphone | 设备类型 |
| `--brand TYPE` | free | free/paid/grossing |
| `--format FMT` | text | 输出格式：text 或 json |

## 页面结构参考（已记录，无需重新探索）

**目标 URL 模板：**
```
https://www.qimai.cn/rank/float/float/up/genre/{genre}/device/{device}/type/one/brand/{brand}/country/{country}
```

**DOM 结构：**
- 排名表格使用 iView UI 框架（`ivu-table`）
- 每行是 `.ivu-table-row`，包含 7 个 `td`：
  - `td[0]`：排名序号（`span` 文本）
  - `td[1]`：App 信息 - 名称（`a[href*="/app/"] img[alt]`）、链接（`a[href*="/app/"]` 的 href）、开发者（`.row-a` 最后一行文本）
  - `td[2]`：排名变化（`.change-text` 文本，上升为正数）
  - `td[3]`：总榜排名（`.big-txt` 文本）+ 类型（`.small-txt` 文本）
  - `td[4]`：分类榜排名（`.big-txt` 文本）+ 分类名（`.small-txt` 文本）
  - `td[5]`：最近更新日期
  - `td[6]`：上架日期
