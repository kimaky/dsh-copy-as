/**
 * 接线测试：用假的 ctx 调 apply()，验证右键菜单与消息按钮都注册成功，
 * 并走通「右键 → 菜单项 → 写剪贴板」这条链路（剪贴板用 execCommand 桩）。
 *
 * 前置：`npm i -D jsdom`；运行：`node test/apply.mjs`
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'

const src = readFileSync(fileURLToPath(new URL('../client.js', import.meta.url)), 'utf8')
const HTML = `<!doctype html><html><body>
<div data-chat-flow-kind="assistant"><div data-chat-content><p>正文<strong>粗</strong></p></div></div>
</body></html>`

const dom = new JSDOM(HTML, { url: 'http://127.0.0.1:59559/' })
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
window.eval(src)
if (!factory) throw new Error('client.js 未调用 __ModuleLoader__.load')

const plugin = factory(() => ({
  createElement: (type, props, ...children) => ({ type, props, children }),
  useRef: () => ({ current: null }),
  useState: (initial) => [initial, () => {}],
  useEffect: () => {},
}))

let menuContribution = null
let slotOptions = null
let slotComponent = null
const notifications = []

const services = {
  contextMenus: {
    register(contribution) {
      menuContribution = contribution
      return () => {}
    },
    notify(text, ok) {
      notifications.push([text, ok])
    },
  },
  slots: {
    inject(_name, callback) {
      return callback()
    },
    register(options, component) {
      slotOptions = options
      slotComponent = component
      return () => {}
    },
  },
}

const ctx = {
  get: (name) => services[name],
  effect: (fn) => {
    fn()
    return () => {}
  },
  logger: { debug() {} },
}

plugin.apply(ctx)

let copied = ''
window.document.execCommand = () => {
  copied = window.getSelection().toString()
  return true
}

const cases = [
  ['注册了 chatMessage 菜单', () => menuContribution?.target === 'chatMessage'],
  ['菜单给出六种格式', () => menuContribution.resolve().length === 6],
  ['菜单含数据/公式/JSON', () => {
    const ids = menuContribution.resolve().map((item) => item.id)
    return ['copy-as.tsv', 'copy-as.latex', 'copy-as.json'].every((id) => ids.includes(id))
  }],
  ['菜单项带 run', () => menuContribution.resolve().every((item) => typeof item.run === 'function')],
  ['注册了消息按钮', () => slotOptions?.id === 'copy-as-button'],
  ['按钮注入 notify', () => typeof slotOptions.inject().notify === 'function'],
  ['按钮组件可用', () => typeof slotComponent === 'function'],
]

const message = window.document.querySelector('[data-chat-flow-kind]')
const target = message.querySelector('p')
target.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true }))

const items = menuContribution.resolve()
await items[0].run()

cases.push(['菜单复制产出 Markdown', () => copied.includes('**粗**')])
cases.push(['复制后给出提示', () => notifications.length === 1 && notifications[0][1] === true])

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
  console.log('copied=' + JSON.stringify(copied), 'notifications=' + JSON.stringify(notifications))
  process.exitCode = 1
}
