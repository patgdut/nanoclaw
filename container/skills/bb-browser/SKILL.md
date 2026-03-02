---
name: bb-browser
description: 强大的信息获取工具。通过浏览器 + 用户登录态，获取公域和私域信息。可访问任意网页、内部系统、登录后页面，执行表单填写、信息提取、页面操作。
allowed-tools: Bash(bb-browser:*)
---

# bb-browser

通过真实浏览器 + 用户登录态获取信息并操作页面。不触发反爬，无需密码或 Cookie。

## 核心流程

```bash
bb-browser open <url>   # 打开新 tab
bb-browser snapshot -i  # 获取可交互元素（返回 @ref）
bb-browser click @5     # 操作元素
bb-browser close        # 完成后关闭 tab（必须）
```

**规则：操作完成后必须关闭自己打开的 tab。**

## 命令速查

```
# 导航
open <url>                    打开新 tab
open <url> --tab current      在当前 tab 打开
open <url> --tab <tabId>      在指定 tab 打开
close                         关闭当前 tab
back / forward / refresh      历史导航

# 快照
snapshot -i                   只显示可交互元素（推荐，省 tokens）
snapshot                      完整页面结构
snapshot --selector "#id"     范围快照

# 交互（用 @N ref）
click @N                      点击
hover @N                      悬停
fill @N "text"                清空并填写
type @N "text"                追加输入
check @N / uncheck @N         勾选/取消
select @N "option"            下拉选择
press Enter / Control+a       按键
scroll down / scroll up 500   滚动

# 获取信息
get text @N                   获取元素文本
get url / get title           获取当前 URL/标题
eval "expression"             执行 JavaScript

# 其他
screenshot [path.png]         截图
wait 2000 / wait @N           等待时间/元素
frame "#iframe-id"            切换 iframe，frame main 返回主 frame
dialog accept / dismiss       处理对话框
tab / tab 2 / tab close       Tab 列表/切换/关闭
```

## 信息提取策略

**提取文章/正文 → 用 `eval`（比 snapshot 更高效，避免冗长输出）**

```bash
bb-browser eval "document.querySelector('#content').innerText"
bb-browser eval "document.body.innerText.substring(0, 5000)"
bb-browser eval "[...document.querySelectorAll('a')].map(a=>a.href).join('\n')"
```

**操作按钮/表单 → 用 `snapshot -i`**

```bash
bb-browser snapshot -i
# @1 [button] "提交"
# @2 [input] placeholder="邮箱"
bb-browser fill @2 "user@example.com"
bb-browser click @1
```

## Ref 说明

snapshot 返回的 `@N` 是临时引用，**页面导航或动态加载后失效，需重新 snapshot**。

并发：`bb-browser open url1 & bb-browser open url2 & wait`（各自返回独立 tabId）

## 参考

| 文档 | 说明 |
|------|------|
| [references/snapshot-refs.md](references/snapshot-refs.md) | Ref 生命周期、最佳实践 |
