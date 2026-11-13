/**
 * 冒烟测试：在 jsdom 里加载 client.js，直接调用三个转换函数，断言输出要点。
 *
 * 前置：`npm i -D jsdom`（jsdom 只用于测试，不写进依赖，免得安装插件时被拉下来）
 * 运行：`node test/smoke.mjs`
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'

const clientPath = fileURLToPath(new URL('../client.js', import.meta.url))
const source = readFileSync(clientPath, 'utf8')

const HTML = `<!doctype html><html><body>
<div data-chat-flow-kind="assistant">
  <div data-chat-content>
    <h2>标题二</h2>
    <p>普通段落，含 <strong>加粗</strong>、<em>斜体</em>、<code>inline_code</code> 与 <a href="https://example.com">链接</a>。</p>
    <ul><li>项一</li><li>项二<ul><li>子项</li></ul></li></ul>
    <ol><li>第一步</li><li>第二步</li></ol>
    <pre><code class="language-sql"><span class="line">SELECT 1</span><span class="line">FROM DUAL;</span></code></pre>
    <table><thead><tr><th>表名</th><th>行数</th></tr></thead><tbody><tr><td>T1</td><td>10</td></tr></tbody></table>
    <blockquote><p>引用一行</p></blockquote>
    <p><span class="katex"><span class="katex-html">garbled</span><annotation encoding="application/x-tex">E=mc^2</annotation></span></p>
    <div><span>工具栏文字</span><button type="button">复制</button></div>
  </div>
</div>
</body></html>`

const dom = new JSDOM(HTML, { url: 'https://example.com/' })
const { window } = dom
globalThis.window = window
globalThis.document = window.document
globalThis.Element = window.Element

let factory = null
window.__ModuleLoader__ = {
  load(entry) {
    factory = entry.factory
  },
}
window.eval(source)
if (!factory) throw new Error('client.js 未调用 __ModuleLoader__.load')

const plugin = factory(() => ({
  createElement: (type, props, ...children) => ({ type, props, children }),
  useRef: () => ({ current: null }),
  useState: (initial) => [initial, () => {}],
  useEffect: () => {},
}))
const { toMarkdown, toPlainText, toRichHtml, toTsv, toLatex, toJson, menuPosition } = plugin.__test
const root = window.document.querySelector('[data-chat-content]')

const md = toMarkdown(root)
const text = toPlainText(root)
const html = toRichHtml(root)
const tsv = toTsv(root)
const latex = toLatex(root)
let model = null
try {
  model = JSON.parse(toJson(root))
} catch {
  model = null
}

const cases = [
  ['MD 标题', () => md.includes('## 标题二')],
  ['MD 加粗斜体', () => md.includes('**加粗**') && md.includes('*斜体*')],
  ['MD 行内代码', () => md.includes('`inline_code`')],
  ['MD 链接', () => md.includes('[链接](https://example.com)')],
  ['MD 列表紧凑', () => md.includes('- 项一\n- 项二\n  - 子项')],
  ['MD 有序列表', () => md.includes('1. 第一步') && md.includes('2. 第二步')],
  ['MD 代码围栏+语言', () => md.includes('```sql')],
  ['MD shiki 行还原', () => md.includes('SELECT 1\nFROM DUAL;')],
  ['MD 表格', () => md.includes('| 表名 | 行数 |') && md.includes('| T1 | 10 |')],
  ['MD 引用', () => md.includes('> 引用一行')],
  ['MD 公式取 annotation', () => md.includes('$E=mc^2$') && !md.includes('garbled')],
  ['MD 无空白行残留', () => !/^[ \t]+$/m.test(md)],
  ['TXT 正文', () => text.includes('标题二') && text.includes('普通段落')],
  ['TXT 列表标记', () => text.includes('- 项一') && text.includes('1. 第一步')],
  ['TXT 嵌套列表缩进', () => text.includes('\n  - 子项')],
  ['TXT 表格制表符', () => text.includes('表名\t行数') && text.includes('T1\t10')],
  ['TXT 无 HTML 标签', () => !/[<>]/.test(text)],
  ['RICH 有标题标签', () => html.includes('<h2')],
  ['RICH 内联样式', () => html.includes('style="') && html.includes('border-collapse')],
  ['RICH 无 class', () => !/class="/.test(html)],
  ['RICH 无按钮', () => !html.includes('<button')],
  // 下拉落点：默认向下、底部放不下时上翻、靠右时向左夹。
  ['MENU 默认向下', () => {
    const p = menuPosition({ left: 100, top: 200, bottom: 224 }, 1200, 900)
    return p.top === 228 && p.left === 100
  }],
  ['MENU 底部上翻', () => {
    const p = menuPosition({ left: 100, top: 800, bottom: 824 }, 1200, 900)
    return p.top < 800 && p.top >= 8
  }],
  ['MENU 右侧夹取', () => {
    const p = menuPosition({ left: 1100, top: 200, bottom: 224 }, 1200, 900)
    return p.left === 1200 - 210 - 8
  }],
  ['TSV 表格分格', () => tsv === '表名\t行数\nT1\t10'],
  ['TSV 无 markdown 管道', () => !tsv.includes('|')],
  ['LATEX 单条', () => latex === 'E=mc^2'],
  ['JSON 可解析', () => model !== null && model.version === 1],
  ['JSON 标题块', () => (model?.blocks || []).some((b) => b.type === 'heading' && b.level === 2 && b.text === '标题二')],
  ['JSON 代码块', () => (model?.blocks || []).some((b) => b.type === 'code' && b.language === 'sql' && b.text === 'SELECT 1\nFROM DUAL;')],
  ['JSON 表格块', () => (model?.blocks || []).some((b) => b.type === 'table' && b.rows[1][0] === 'T1' && b.rows[1][1] === '10')],
  ['JSON 列表块', () => (model?.blocks || []).some((b) => b.type === 'list' && b.ordered && b.items[0].text === '第一步')],
  ['JSON 引用块', () => (model?.blocks || []).some((b) => b.type === 'quote' && b.text === '引用一行')],
  ['JSON 公式标记', () => (model?.blocks || []).some((b) => b.text === '$E=mc^2$' && b.formulas?.[0] === 'E=mc^2')],
]

let failed = 0
for (const [name, check] of cases) {
  let ok = false
  try {
    ok = check()
  } catch {
    ok = false
  }
  if (!ok) {
    failed += 1
    console.log('FAIL  ' + name)
  }
}
console.log(`\n${cases.length - failed}/${cases.length} passed`)
if (failed) {
  console.log('\n--- markdown ---\n' + md)
  console.log('\n--- text ---\n' + JSON.stringify(text))
  process.exitCode = 1
}
