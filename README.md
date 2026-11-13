# dsh-copy-as

[![test](https://github.com/kimaky/dsh-copy-as/actions/workflows/test.yml/badge.svg)](https://github.com/kimaky/dsh-copy-as/actions/workflows/test.yml)

把 DSH 会话里的助手输出按需复制成六种格式，粘到别处不再丢版式。

> **非官方插件。** 它通过 DSH 客户端插件机制接入，用到的是逆向得到的内部约定
> （`window.__ModuleLoader__` 加载协议、`conversation.chat.assistant-actions` 插槽、
> `contextMenus` 条目结构）。这些接口官方未承诺稳定，`package.json` 里的
> `engines.dsh` 限定为 `>=0.2.2-rc.1 <0.3.0`，DSH 大版本变化后可能失效，需要跟着改。
>
> 插件不联网、不读写存储、无遥测，全部逻辑在 `client.js` 一个文件里，便于审计。

| 格式 | 说明 |
| --- | --- |
| Markdown | 保留标题、列表、代码围栏、表格、链接 |
| 纯文本 | 段落换行、列表符号、表格转 Tab 分隔 |
| 富文本 | `text/html`，粘进 Word / WPS 保留标题层级、代码块底色、表格边框 |
| 数据（TSV） | 只取消息里的表格，制表符分隔、无表头竖线，粘进 Excel 自动分格；没有表格时退回纯文本 |
| 公式（LaTeX） | 只取消息里的公式，一行一条 LaTeX 源码（如 `\frac{a}{b}`），不带 `$` |
| JSON | 整条消息拆成节点树：`heading` / `paragraph` / `list` / `code` / `table` / `quote` / `divider`，公式另带 `formulas` 数组 |

## 用法

两个入口，取同一份内容：

1. **消息操作栏**：助手消息下多出一个「复制为 ▾」按钮，点开选格式。
2. **右键菜单**：在消息上右键，菜单里直接出现六条「复制为 …」条目。

取值规则：消息里有选中文字就复制选区，没有就复制整条消息。

下拉菜单按视口定位（`position: fixed`），下方空间不足会自动上翻，左右夹在视口内，
不受消息行 `overflow` 裁剪影响。

## 安装

从 npm 装（包名 `dsh-copy-as`）：

```powershell
plugin_manager action=install_bundle target=dsh-copy-as
```

等价的命令行形式，`<profile>` 换成宿主实际使用的 profile（桌面端一般是 `desktop`）：

```powershell
dsh plugin --profile <profile> add dsh-copy-as
```

从源码装（改完不用重装，安装记录是指向源码目录的软链）：

```powershell
plugin_manager action=install_bundle target=<本地源码目录的绝对路径>
```

装完 **刷新浏览器页面**（客户端插件在刷新时由 client-modules 重新扫描）。

卸载：`plugin_manager action=remove_bundle target=dsh-copy-as`。

## 实现要点

- 浏览器半边 `client.js` 直接 `window.__ModuleLoader__.load(...)`，不需要打包器；
  `require('react')` 由宿主提供。
- 右键菜单走官方 `contextMenus` 服务（`target: 'chatMessage'`），负责手势、定位、键盘与图标，
  本插件只贡献条目，因此菜单外观与系统其他右键项一致。
- 消息按钮注册在 `conversation.chat.assistant-actions` 插槽。
- 富文本不生成 .docx：只写 `text/html` + `text/plain` 到剪贴板，由 Word 自己解释 HTML。
  标题用内联样式（不依赖 class），因此不受宿主 CSS 变量影响。
- 剪贴板优先 `navigator.clipboard`，失败回退到隐藏节点 + `document.execCommand('copy')`。

## 测试

`test/` 下两个脚本在 jsdom 里直接跑，不需要浏览器：

```powershell
npm install             # 只为跑测试装 jsdom（devDependencies）
npm test                # 两个脚本依次跑完
```

- `test/smoke.mjs`：六个转换函数 + 菜单落点，34 条断言
- `test/apply.mjs`：注册接线 + 右键→复制链路，9 条断言

## 已知限制

- 正文从 DOM 读，宿主渲染结构变化（换类名/换容器）可能影响取值；若复制到多余的行内装饰文字，
  先选中正文再复制即可。
- KaTeX 公式复制为 `$...$` 原文（取 `annotation`），粘到 Word 是公式源码而非排版后的公式。
- JSON 里的行内格式（加粗、斜体、链接）不单独建节点，只保留纯文本；需要保留时用 Markdown。
- 粘贴到 Word 后如需页码/页眉，仍需在 Word 里补。
