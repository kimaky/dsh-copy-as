/**
 * dsh-copy-as — browser half.
 *
 * 给助手消息提供「复制为 ▸ Markdown / 纯文本 / 富文本」三个出口：
 *  - 右键菜单：调用官方 `contextMenus` 服务，贡献 `chatMessage` 目标的三个扁平条目；
 *  - 消息按钮：注册到 `conversation.chat.assistant-actions` 插槽。
 *
 * 富文本走 `text/html`，粘进 Word / WPS 时保留标题、列表、代码块与表格样式，
 * 不生成 .docx 文件。取值规则：消息内有选区就复制选区，否则复制整条消息。
 *
 * 本文件由 client-modules 以普通脚本注入，因此不写 `export`，直接调用
 * `window.__ModuleLoader__.load`。
 */
window.__ModuleLoader__.load({
  id: 'dsh-copy-as',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    // 消息行由宿主打上 data-chat-flow-kind（assistant / user / tool …）。
    const MESSAGE_SELECTOR = '[data-chat-flow-kind]'
    // 纯装饰或交互节点，复制时一律剔除。
    const SKIP_TAGS = new Set([
      'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'BUTTON', 'SVG', 'PATH',
      'INPUT', 'TEXTAREA', 'SELECT', 'CANVAS', 'VIDEO', 'AUDIO', 'IFRAME',
    ])
    const SKIP_SELECTORS = '[role="button"], [aria-hidden="true"], .sr-only, [data-copy-ignore]'
    const BLOCK_TAGS = new Set([
      'P', 'DIV', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'MAIN', 'ASIDE',
      'LI', 'PRE', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
      'TABLE', 'TR', 'UL', 'OL', 'HR', 'FIGURE', 'FIGCAPTION', 'DL', 'DT', 'DD',
    ])

    // ------------------------------------------------------------------
    // DOM 取用
    // ------------------------------------------------------------------

    /** 从事件目标或按钮自身向上找到消息行。 */
    function messageOf(el) {
      return el && el.closest ? el.closest(MESSAGE_SELECTOR) : null
    }

    /**
     * 找到消息正文的容器；退化为整行。
     * 已知的正文容器带有 data-chat-content / markdown-body 一类的标记时优先用它，
     * 避免把行内的操作栏、耗时等装饰文字一起复制。
     */
    function contentRootOf(el) {
      if (!el) return null
      const explicit = el.querySelector('[data-chat-content], .markdown-body, .prose, article')
      return explicit || el
    }

    /** 把 Range 的内容复制进一个脱离文档的 div，方便统一遍历。 */
    function fragmentOf(range) {
      const holder = document.createElement('div')
      holder.appendChild(range.cloneContents())
      return holder
    }

    // ------------------------------------------------------------------
    // 纯文本
    // ------------------------------------------------------------------

    /** 代码块取文本：兼容 shiki 的 `.line` 分行结构。 */
    function codeTextOf(pre) {
      const code = pre.querySelector('code') || pre
      const lines = code.querySelectorAll('.line')
      const raw = lines.length
        ? Array.from(lines).map((line) => line.textContent).join('\n')
        : code.textContent
      return raw.replace(/\u200b/g, '').replace(/\n+$/, '')
    }

    /** 纯文本递归：块级元素负责换行，列表补回 `- ` / `1. ` 标记。 */
    function plainOf(node, depth) {
      if (node.nodeType === 3) return node.nodeValue.replace(/\s+/g, ' ')
      if (node.nodeType !== 1) return ''
      const tag = node.tagName.toUpperCase()
      if (SKIP_TAGS.has(tag) || (node.matches && node.matches(SKIP_SELECTORS))) return ''
      if (node.classList && node.classList.contains('katex')) {
        const tex = node.querySelector('annotation')
        return tex ? tex.textContent : ''
      }
      if (tag === 'BR') return '\n'
      if (tag === 'PRE') return '\n' + codeTextOf(node) + '\n'
      if (tag === 'TD' || tag === 'TH') {
        return Array.from(node.childNodes).map((child) => plainOf(child, depth)).join('')
      }
      if (tag === 'TR') {
        const cells = Array.from(node.children)
          .map((cell) => plainOf(cell, depth).replace(/\s+/g, ' ').trim())
        return '\n' + cells.join('\t') + '\n'
      }
      if (tag === 'UL' || tag === 'OL') {
        const pad = '  '.repeat(depth)
        const ordered = tag === 'OL'
        const items = Array.from(node.children)
          .filter((child) => child.tagName.toUpperCase() === 'LI')
          .map((li, index) => {
            let head = ''
            let nested = ''
            Array.from(li.childNodes).forEach((child) => {
              const childTag = child.nodeType === 1 ? child.tagName.toUpperCase() : ''
              if (childTag === 'UL' || childTag === 'OL') nested += plainOf(child, depth + 1)
              else head += plainOf(child, depth)
            })
            const marker = ordered ? String(index + 1) + '. ' : '- '
            const line = pad + marker + head.replace(/\s+/g, ' ').trim()
            const tail = nested.replace(/^\n+|\n+$/g, '')
            return tail ? line + '\n' + tail : line
          })
        return '\n' + items.join('\n') + '\n'
      }
      if (tag === 'LI') {
        return Array.from(node.childNodes).map((child) => plainOf(child, depth)).join('')
      }
      const inner = Array.from(node.childNodes)
        .map((child) => plainOf(child, depth))
        .join('')
      return BLOCK_TAGS.has(tag) ? '\n' + inner + '\n' : inner
    }

    function toPlainText(root) {
      return plainOf(root, 0)
        .split('\n')
        .map((line) => {
          // 列表行的前导空格是层级，不能删；其余行按两端空白处理。
          const trimmed = line.replace(/[ \t]+$/, '')
          return /^[ \t]*(?:- |\d+\. )/.test(trimmed) ? trimmed : trimmed.replace(/^[ \t]+/, '')
        })
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/\n\n(?=[ \t]*(?:- |\d+\. ))/g, '\n')
        .replace(/\n\n(?=[^\n]*\t)/g, '\n')
        .replace(/^\n+|\n+$/g, '')
    }

    // ------------------------------------------------------------------
    // Markdown
    // ------------------------------------------------------------------

    function tidyInline(text) {
      return text.replace(/[ \t]+/g, ' ').replace(/ *\n */g, ' ').trim()
    }

    /** 代码块语言：shiki 把语言写在 `language-xxx` 类上。 */
    function codeLangOf(pre) {
      const code = pre.querySelector('code') || pre
      const match = /language-([\w+#-]+)/.exec(code.className || '')
      return match ? match[1] : ''
    }

    function markdownOfTable(table) {
      const rows = Array.from(table.querySelectorAll('tr'))
      if (!rows.length) return ''
      const grid = rows.map((tr) =>
        Array.from(tr.children).map((cell) => tidyInline(toMarkdown(cell)).replace(/\|/g, '\\|')),
      )
      const width = Math.max(1, ...grid.map((row) => row.length))
      const padded = grid.map((row) => {
        const next = row.slice()
        while (next.length < width) next.push('')
        return next
      })
      const [head, ...body] = padded
      const sep = new Array(width).fill('---')
      return [head, sep, ...body].map((row) => '| ' + row.join(' | ') + ' |').join('\n')
    }

    function markdownOfList(list, depth) {
      const ordered = list.tagName.toUpperCase() === 'OL'
      const items = Array.from(list.children).filter(
        (child) => child.tagName.toUpperCase() === 'LI',
      )
      const pad = '  '.repeat(depth)
      return items
        .map((li, index) => {
          let main = ''
          let nested = ''
          Array.from(li.childNodes).forEach((node) => {
            const tag = node.nodeType === 1 ? node.tagName.toUpperCase() : ''
            if (tag === 'UL' || tag === 'OL') nested += markdownOfList(node, depth + 1)
            else main += toMarkdown(node)
          })
          const marker = ordered ? String(index + 1) + '. ' : '- '
          const head = pad + marker + tidyInline(main)
          return nested ? head + '\n' + nested : head
        })
        .join('\n')
    }

    function toMarkdown(root) {
      const walk = (node) => {
        if (node.nodeType === 3) return node.nodeValue.replace(/\s+/g, ' ')
        if (node.nodeType !== 1) return ''
        const tag = node.tagName.toUpperCase()
        if (SKIP_TAGS.has(tag) || (node.matches && node.matches(SKIP_SELECTORS))) return ''
        if (node.classList && node.classList.contains('katex')) {
          const tex = node.querySelector('annotation')
          const body = tex ? tex.textContent : ''
          if (!body) return ''
          const display = node.classList.contains('katex-display')
          return display ? '\n$$\n' + body + '\n$$\n' : '$' + body + '$'
        }
        const inner = () => Array.from(node.childNodes).map(walk).join('')
        switch (tag) {
          case 'BR':
            return '  \n'
          case 'STRONG':
          case 'B': {
            const text = tidyInline(inner())
            return text ? '**' + text + '**' : ''
          }
          case 'EM':
          case 'I': {
            const text = tidyInline(inner())
            return text ? '*' + text + '*' : ''
          }
          case 'DEL':
          case 'S':
          case 'STRIKE': {
            const text = tidyInline(inner())
            return text ? '~~' + text + '~~' : ''
          }
          case 'CODE': {
            if (node.closest('pre')) return node.textContent
            const text = node.textContent.trim()
            if (!text) return ''
            const fence = text.includes('`') ? '``' : '`'
            return fence + text + fence
          }
          case 'PRE':
            return '\n```' + codeLangOf(node) + '\n' + codeTextOf(node) + '\n```\n'
          case 'H1':
          case 'H2':
          case 'H3':
          case 'H4':
          case 'H5':
          case 'H6': {
            const text = tidyInline(inner())
            return text ? '\n' + '#'.repeat(Number(tag[1])) + ' ' + text + '\n' : ''
          }
          case 'P':
            return '\n' + tidyInline(inner()) + '\n'
          case 'BLOCKQUOTE': {
            const text = tidyInline(inner())
            return text
              ? '\n' + text.split('\n').map((line) => '> ' + line).join('\n') + '\n'
              : ''
          }
          case 'UL':
          case 'OL':
            return '\n' + markdownOfList(node, 0) + '\n'
          case 'LI': {
            const text = tidyInline(inner())
            return text ? '\n- ' + text + '\n' : ''
          }
          case 'HR':
            return '\n---\n'
          case 'TABLE':
            return '\n' + markdownOfTable(node) + '\n'
          case 'A': {
            const href = node.getAttribute('href') || ''
            const text = tidyInline(inner())
            if (!text) return ''
            if (!href || href.startsWith('javascript:') || href.startsWith('#')) return text
            return '[' + text + '](' + href + ')'
          }
          case 'IMG': {
            const src = node.getAttribute('src') || ''
            const alt = node.getAttribute('alt') || ''
            return src ? '![' + alt + '](' + src + ')' : ''
          }
          default:
            return inner()
        }
      }
      return walk(root)
        .replace(/^[ \t]+$/gm, '')
        .replace(/[ \t]+$/gm, '')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/^\n+|\n+$/g, '')
        .trim()
    }

    // ------------------------------------------------------------------
    // 数据（TSV，粘进 Excel 直接分格）
    // ------------------------------------------------------------------

    function tableGridOf(table) {
      return Array.from(table.querySelectorAll('tr')).map((tr) =>
        Array.from(tr.children).map((cell) =>
          plainOf(cell, 0)
            .replace(/\s+/g, ' ')
            .trim()
            .replace(/\t/g, ' '),
        ),
      )
    }

    function toTsv(root) {
      const tables = []
      if (root.nodeType === 1 && root.tagName.toUpperCase() === 'TABLE') tables.push(root)
      if (root.querySelectorAll) tables.push(...Array.from(root.querySelectorAll('table')))
      const grids = tables.map(tableGridOf).filter((grid) => grid.length > 0)
      // 消息里没有表格时退回纯文本，至少不会白复制一次。
      if (!grids.length) return toPlainText(root)
      return grids
        .map((grid) => {
          const width = Math.max(...grid.map((row) => row.length))
          return grid
            .map((row) => row.concat(new Array(width - row.length).fill('')).join('\t'))
            .join('\n')
        })
        .join('\n\n')
    }

    // ------------------------------------------------------------------
    // 公式（LaTeX 源码，一行一条）
    // ------------------------------------------------------------------

    function texOf(katex) {
      const holder = katex.querySelector('annotation')
      return holder ? holder.textContent.replace(/\s+/g, ' ').trim() : ''
    }

    function toLatex(root) {
      const nodes = []
      if (root.nodeType === 1 && root.classList && root.classList.contains('katex')) nodes.push(root)
      if (root.querySelectorAll) nodes.push(...Array.from(root.querySelectorAll('.katex')))
      return nodes
        .map(texOf)
        .filter(Boolean)
        .join('\n')
    }

    // ------------------------------------------------------------------
    // JSON（结构化节点树）
    // ------------------------------------------------------------------

    function isSkipped(node) {
      const tag = node.tagName ? node.tagName.toUpperCase() : ''
      return SKIP_TAGS.has(tag) || Boolean(node.matches && node.matches(SKIP_SELECTORS))
    }

    /** 段落文本，公式保留 `$...$` 标记，避免和正文混成一串。 */
    function textWithMath(node) {
      if (node.nodeType === 3) return node.nodeValue.replace(/\s+/g, ' ')
      if (node.nodeType !== 1 || isSkipped(node)) return ''
      if (node.classList && node.classList.contains('katex')) {
        const tex = texOf(node)
        return tex ? '$' + tex + '$' : ''
      }
      return Array.from(node.childNodes).map(textWithMath).join('')
    }

    function formulasIn(node) {
      if (!node.querySelectorAll) return []
      return Array.from(node.querySelectorAll('.katex')).map(texOf).filter(Boolean)
    }

    function listItemsOf(list, depth) {
      const out = []
      Array.from(list.children)
        .filter((li) => li.tagName.toUpperCase() === 'LI')
        .forEach((li) => {
          let text = ''
          const subs = []
          Array.from(li.childNodes).forEach((child) => {
            const tag = child.nodeType === 1 ? child.tagName.toUpperCase() : ''
            if (tag === 'UL' || tag === 'OL') subs.push(child)
            else text += textWithMath(child)
          })
          const item = { text: tidyInline(text), depth }
          const formulas = formulasIn(li)
          if (formulas.length) item.formulas = formulas
          out.push(item)
          subs.forEach((sub) => out.push(...listItemsOf(sub, depth + 1)))
        })
      return out
    }

    function blocksOf(node) {
      const blocks = []
      let inline = ''
      let inlineFormulas = []
      const flush = () => {
        const text = tidyInline(inline)
        inline = ''
        const formulas = inlineFormulas
        inlineFormulas = []
        if (!text) return
        const block = { type: 'paragraph', text }
        if (formulas.length) block.formulas = formulas
        blocks.push(block)
      }

      Array.from(node.childNodes).forEach((child) => {
        if (child.nodeType === 3) {
          inline += child.nodeValue.replace(/\s+/g, ' ')
          return
        }
        if (child.nodeType !== 1 || isSkipped(child)) return
        const tag = child.tagName.toUpperCase()
        const isMath = child.classList && child.classList.contains('katex')
        if (isMath) {
          inline += textWithMath(child)
          const tex = texOf(child)
          if (tex) inlineFormulas.push(tex)
          return
        }
        if (/^H[1-6]$/.test(tag)) {
          flush()
          const text = tidyInline(textWithMath(child))
          if (text) blocks.push({ type: 'heading', level: Number(tag[1]), text })
          return
        }
        if (tag === 'PRE') {
          flush()
          blocks.push({ type: 'code', language: codeLangOf(child) || undefined, text: codeTextOf(child) })
          return
        }
        if (tag === 'TABLE') {
          flush()
          blocks.push({ type: 'table', rows: tableGridOf(child) })
          return
        }
        if (tag === 'UL' || tag === 'OL') {
          flush()
          const items = listItemsOf(child, 0)
          if (items.length) blocks.push({ type: 'list', ordered: tag === 'OL', items })
          return
        }
        if (tag === 'HR') {
          flush()
          blocks.push({ type: 'divider' })
          return
        }
        if (tag === 'BLOCKQUOTE') {
          flush()
          const text = tidyInline(textWithMath(child))
          if (text) blocks.push({ type: 'quote', text })
          return
        }
        if (tag === 'P' || tag === 'FIGCAPTION' || tag === 'DT' || tag === 'DD') {
          flush()
          const text = tidyInline(textWithMath(child))
          if (!text) return
          const block = { type: 'paragraph', text }
          const formulas = formulasIn(child)
          if (formulas.length) block.formulas = formulas
          blocks.push(block)
          return
        }
        // 其余容器（div / section / li …）继续往下拆。
        flush()
        blocks.push(...blocksOf(child))
      })

      flush()
      return blocks
    }

    function toJson(root) {
      return JSON.stringify({ version: 1, blocks: blocksOf(root) }, null, 2)
    }

    // ------------------------------------------------------------------
    // 富文本（粘到 Word 保留版式）
    // ------------------------------------------------------------------

    const RICH_STYLES = {
      H1: 'font-family:"Microsoft YaHei",sans-serif;font-size:20pt;font-weight:700;color:#1f3864;margin:14pt 0 6pt',
      H2: 'font-family:"Microsoft YaHei",sans-serif;font-size:15pt;font-weight:700;color:#1f3864;margin:12pt 0 5pt',
      H3: 'font-family:"Microsoft YaHei",sans-serif;font-size:12.5pt;font-weight:700;color:#2b4a7d;margin:10pt 0 4pt',
      H4: 'font-family:"Microsoft YaHei",sans-serif;font-size:11pt;font-weight:700;margin:8pt 0 4pt',
      P: 'margin:0 0 6pt;line-height:1.55',
      UL: 'margin:4pt 0 6pt 18pt;padding:0',
      OL: 'margin:4pt 0 6pt 18pt;padding:0',
      LI: 'margin:2pt 0;line-height:1.55',
      PRE: 'white-space:pre-wrap;font-family:Consolas,"Courier New",monospace;font-size:9.5pt;line-height:1.4;background:#f5f6f8;border:1px solid #e3e6eb;padding:6pt;margin:6pt 0',
      TABLE: 'border-collapse:collapse;margin:6pt 0;font-size:9.5pt',
      TD: 'border:1px solid #c9d1e0;padding:3pt 6pt;vertical-align:top',
      TH: 'border:1px solid #c9d1e0;padding:3pt 6pt;background:#f2f5fa;font-weight:700;vertical-align:top',
      BLOCKQUOTE: 'margin:6pt 0;padding:2pt 0 2pt 8pt;border-left:2pt solid #d3deec;color:#555',
      A: 'color:#1a56c4',
      HR: 'border:none;border-top:1px solid #d3deec;margin:8pt 0',
    }

    function sanitizeRich(root) {
      Array.from(root.querySelectorAll('*')).forEach((node) => {
        if (SKIP_TAGS.has(node.tagName.toUpperCase())) {
          node.remove()
          return
        }
        if (node.matches(SKIP_SELECTORS)) {
          node.remove()
          return
        }
        if (node.classList && node.classList.contains('katex')) {
          const tex = node.querySelector('annotation')
          const span = document.createElement('span')
          span.textContent = tex ? tex.textContent : ''
          node.replaceWith(span)
        }
      })
    }

    function decorateRich(root) {
      Array.from(root.querySelectorAll('*')).forEach((node) => {
        const tag = node.tagName.toUpperCase()
        node.removeAttribute('class')
        node.removeAttribute('style')
        node.removeAttribute('data-copy-ignore')
        const style = RICH_STYLES[tag]
        if (style) node.setAttribute('style', style)
        if (tag === 'CODE') {
          const inPre = node.closest('pre')
          node.setAttribute(
            'style',
            inPre
              ? 'font-family:Consolas,"Courier New",monospace;font-size:9.5pt'
              : 'font-family:Consolas,"Courier New",monospace;font-size:9.5pt;background:#f0f2f5;padding:0 2pt;border-radius:2pt',
          )
        }
      })
    }

    function toRichHtml(root) {
      const holder = document.createElement('div')
      holder.appendChild(root.cloneNode(true))
      sanitizeRich(holder)
      decorateRich(holder)
      return holder.innerHTML
    }

    // ------------------------------------------------------------------
    // 剪贴板
    // ------------------------------------------------------------------

    function legacyCopy(node) {
      const host = document.createElement('div')
      host.style.cssText = 'position:fixed;left:-99999px;top:0;white-space:pre-wrap'
      host.appendChild(node)
      document.body.appendChild(host)
      const range = document.createRange()
      range.selectNodeContents(host)
      const selection = window.getSelection()
      const previous = selection && selection.rangeCount ? selection.getRangeAt(0) : null
      let ok = false
      try {
        selection.removeAllRanges()
        selection.addRange(range)
        ok = document.execCommand('copy')
      } catch (error) {
        ok = false
      }
      selection.removeAllRanges()
      if (previous) selection.addRange(previous)
      host.remove()
      return ok
    }

    async function copyPlainText(text) {
      if (!text) return false
      try {
        await navigator.clipboard.writeText(text)
        return true
      } catch (error) {
        const div = document.createElement('div')
        div.textContent = text
        return legacyCopy(div)
      }
    }

    async function copyRich(html, text) {
      if (!html) return false
      try {
        const item = new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' }),
        })
        await navigator.clipboard.write([item])
        return true
      } catch (error) {
        const holder = document.createElement('div')
        holder.innerHTML = html
        return legacyCopy(holder)
      }
    }

    // ------------------------------------------------------------------
    // 复制动作
    // ------------------------------------------------------------------

    /**
     * 取本次复制的源：右键位置已捕获的选区优先，其次当前选区，最后整条消息。
     */
    function resolveSource(capturedEl, capturedRange) {
      const live = window.getSelection()
      if (capturedRange) return fragmentOf(capturedRange)
      if (capturedEl && live && live.rangeCount && !live.isCollapsed) {
        const range = live.getRangeAt(0)
        const start = range.startContainer
        const startEl = start.nodeType === 1 ? start : start.parentElement
        if (startEl && capturedEl.contains(startEl)) return fragmentOf(range)
      }
      return contentRootOf(capturedEl)
    }

    const FORMATS = [
      {
        id: 'copy-as.markdown',
        label: '复制为 Markdown',
        failureLabel: '复制 Markdown 失败',
        async run(source) {
          const root = source.el || source
          const md = toMarkdown(root)
          const ok = await copyPlainText(md)
          return { ok, text: md }
        },
      },
      {
        id: 'copy-as.text',
        label: '复制为纯文本',
        failureLabel: '复制纯文本失败',
        async run(source) {
          const root = source.el || source
          const text = toPlainText(root)
          const ok = await copyPlainText(text)
          return { ok, text }
        },
      },
      {
        id: 'copy-as.rich',
        label: '复制为富文本（粘到 Word）',
        failureLabel: '复制富文本失败',
        async run(source) {
          const root = source.el || source
          const html = toRichHtml(root)
          const text = toPlainText(root)
          const ok = await copyRich(html, text)
          return { ok, text }
        },
      },
      {
        id: 'copy-as.tsv',
        label: '复制为数据（TSV）',
        failureLabel: '复制表格数据失败',
        async run(source) {
          const root = source.el || source
          const text = toTsv(root)
          const ok = await copyPlainText(text)
          return { ok, text }
        },
      },
      {
        id: 'copy-as.latex',
        label: '复制为公式（LaTeX）',
        failureLabel: '这条消息里没有公式',
        async run(source) {
          const root = source.el || source
          const text = toLatex(root)
          if (!text) return { ok: false, text: '' }
          const ok = await copyPlainText(text)
          return { ok, text }
        },
      },
      {
        id: 'copy-as.json',
        label: '复制为 JSON',
        failureLabel: '复制 JSON 失败',
        async run(source) {
          const root = source.el || source
          const text = toJson(root)
          const ok = await copyPlainText(text)
          return { ok, text }
        },
      },
    ]

    function sourceOf(capturedEl, capturedRange) {
      const el = resolveSource(capturedEl, capturedRange)
      if (!el) return null
      return { el }
    }

    // ------------------------------------------------------------------
    // 消息操作栏按钮
    // ------------------------------------------------------------------

    const BUTTON_STYLE = {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 2,
      height: 24,
      padding: '0 8px',
      borderRadius: 12,
      border: 'none',
      background: 'transparent',
      color: 'var(--dsw-alias-label-tertiary, #6b7280)',
      fontSize: 12,
      lineHeight: 1,
      cursor: 'pointer',
      fontFamily: 'inherit',
    }

    const MENU_WIDTH = 210
    const MENU_GAP = 4
    const MENU_ITEM_HEIGHT = 33
    // 条目数会随格式增减，高度按条数估，够判断向下还是向上翻。
    const estimatedMenuHeight = () => FORMATS.length * MENU_ITEM_HEIGHT + 10

    // 菜单用 fixed 定位并按视口夹取：消息操作栏的祖先容器带 overflow 裁剪，
    // 绝对定位会被切掉下半截；下方空间不够时向上翻。
    const popoverStyle = (pos) => ({
      position: 'fixed',
      top: pos.top,
      left: pos.left,
      minWidth: MENU_WIDTH,
      maxHeight: '60vh',
      overflowY: 'auto',
      padding: 4,
      borderRadius: 8,
      background: 'var(--dsw-alias-bg-elevated, #fff)',
      boxShadow: '0 6px 24px rgba(15, 23, 42, 0.16)',
      border: '1px solid var(--dsw-alias-border-subtle, rgba(15,23,42,.1))',
      zIndex: 2147483000,
    })

    // 视口内取落点：默认贴在按钮下方，放不下就翻到上方，左右夹在视口内。
    function menuPosition(rect, viewportWidth, viewportHeight) {
      const maxLeft = Math.max(8, viewportWidth - MENU_WIDTH - 8)
      const left = Math.min(Math.max(8, rect.left), maxLeft)
      const below = viewportHeight - rect.bottom - MENU_GAP
      const height = estimatedMenuHeight()
      const top =
        below >= height
          ? rect.bottom + MENU_GAP
          : Math.max(8, rect.top - MENU_GAP - height)
      return { left, top }
    }

    const ITEM_STYLE = {
      display: 'block',
      width: '100%',
      padding: '7px 10px',
      border: 'none',
      borderRadius: 6,
      background: 'transparent',
      color: 'var(--dsw-alias-label-primary, #111827)',
      fontSize: 12.5,
      textAlign: 'left',
      cursor: 'pointer',
      fontFamily: 'inherit',
    }

    function hoverable(props) {
      return {
        onMouseEnter: (event) => {
          event.currentTarget.style.background = 'var(--dsw-alias-interactive-bg-hover, rgba(15,23,42,.06))'
        },
        onMouseLeave: (event) => {
          event.currentTarget.style.background = 'transparent'
        },
        ...props,
      }
    }

    function CopyAsButton(props) {
      const { notify } = props
      const rootRef = React.useRef(null)
      const buttonRef = React.useRef(null)
      const [open, setOpen] = React.useState(false)
      const [menuPos, setMenuPos] = React.useState(null)

      // 按钮位置决定菜单落点；滚动或改窗口大小时跟着重算。
      const placeMenu = React.useCallback(() => {
        const el = buttonRef.current || rootRef.current
        if (!el) return
        setMenuPos(menuPosition(el.getBoundingClientRect(), window.innerWidth, window.innerHeight))
      }, [])

      React.useEffect(() => {
        if (!open) return undefined
        placeMenu()
        const onPointerDown = (event) => {
          if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false)
        }
        const onKeyDown = (event) => {
          if (event.key === 'Escape') setOpen(false)
        }
        document.addEventListener('mousedown', onPointerDown, true)
        document.addEventListener('keydown', onKeyDown, true)
        window.addEventListener('resize', placeMenu)
        window.addEventListener('scroll', placeMenu, true)
        return () => {
          document.removeEventListener('mousedown', onPointerDown, true)
          document.removeEventListener('keydown', onKeyDown, true)
          window.removeEventListener('resize', placeMenu)
          window.removeEventListener('scroll', placeMenu, true)
        }
      }, [open, placeMenu])

      const runFormat = async (format) => {
        setOpen(false)
        const el = rootRef.current ? messageOf(rootRef.current) : null
        const source = sourceOf(el, null)
        if (!source) {
          notify('没有可复制的内容', false)
          return
        }
        try {
          const result = await format.run(source)
          if (result && result.ok) notify('已' + format.label, true)
          else notify(format.failureLabel, false)
        } catch (error) {
          notify(format.failureLabel, false)
        }
      }

      return h(
        'span',
        { ref: rootRef, style: { position: 'relative', display: 'inline-flex' } },
        h(
          'button',
          hoverable({
            ref: buttonRef,
            type: 'button',
            title: '复制为 Markdown / 纯文本 / 富文本',
            'aria-label': '复制为',
            'aria-expanded': open ? 'true' : 'false',
            style: BUTTON_STYLE,
            onClick: (event) => {
              event.preventDefault()
              event.stopPropagation()
              setOpen((value) => !value)
            },
          }),
          h('span', null, '复制为'),
          h('span', { style: { fontSize: 9, opacity: 0.7 } }, '▾'),
        ),
        open && menuPos
          ? h(
              'div',
              { style: popoverStyle(menuPos), role: 'menu' },
              FORMATS.map((format) =>
                h(
                  'button',
                  hoverable({
                    key: format.id,
                    type: 'button',
                    role: 'menuitem',
                    style: ITEM_STYLE,
                    onClick: (event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      void runFormat(format)
                    },
                  }),
                  format.label,
                ),
              ),
            )
          : null,
      )
    }

    // ------------------------------------------------------------------
    // 插件
    // ------------------------------------------------------------------

    return {
      inject: ['slots', 'contextMenus'],
      // 暴露转换函数，供离线冒烟测试（test/smoke.mjs）直接调用。
      __test: {
        toMarkdown,
        toPlainText,
        toRichHtml,
        toTsv,
        toLatex,
        toJson,
        menuPosition,
      },
      apply(ctx) {
        // 服务优先走 ctx.get()（dsh-chat-ctxmenu 的写法）；ctx 上直接挂属性的形态作兜底。
        const contextMenus = ctx.get('contextMenus') || ctx.contextMenus
        const slots = ctx.get('slots') || ctx.slots

        const notify = (text, ok) => {
          try {
            if (contextMenus && typeof contextMenus.notify === 'function') {
              contextMenus.notify(text, ok !== false)
            }
          } catch (error) {
            /* 通知失败不影响复制结果 */
          }
        }

        const logFailure = (what, error) => {
          try {
            ctx.logger?.debug?.(`[dsh-copy-as] ${what} failed: ${error && error.message}`)
          } catch {
            /* 日志也不可用时保持安静 */
          }
        }

        // 右键时先记住落点与选区，菜单项被点开时再取值。
        let capturedEl = null
        let capturedRange = null

        try {
          ctx.effect(() => {
            const onContextMenu = (event) => {
              const el = event.target instanceof Element ? messageOf(event.target) : null
              capturedEl = el
              capturedRange = null
              if (!el) return
              const selection = window.getSelection()
              if (selection && selection.rangeCount && !selection.isCollapsed) {
                const range = selection.getRangeAt(0)
                const start = range.startContainer
                const startEl = start.nodeType === 1 ? start : start.parentElement
                if (startEl && el.contains(startEl)) capturedRange = range.cloneRange()
              }
            }
            document.addEventListener('contextmenu', onContextMenu, true)
            return () => document.removeEventListener('contextmenu', onContextMenu, true)
          }, 'copy-as: contextmenu capture')
        } catch (error) {
          logFailure('contextmenu capture', error)
        }

        // 右键菜单：三种格式各贡献一条，不用子菜单——官方菜单项的嵌套形态没有实证，
        // 扁平条目与 dsh-chat-ctxmenu 里验证过的 {id,label,failureLabel,run} 完全一致。
        if (contextMenus && typeof contextMenus.register === 'function') {
          try {
            ctx.effect(
              () =>
                contextMenus.register({
                  id: 'copy-as.message',
                  target: 'chatMessage',
                  order: 120,
                  resolve() {
                    return FORMATS.map((format, index) => ({
                      id: format.id,
                      label: format.label,
                      failureLabel: format.failureLabel,
                      order: 120 + index,
                      run: async () => {
                        const source = sourceOf(capturedEl, capturedRange)
                        if (!source) {
                          notify('没有可复制的内容', false)
                          return
                        }
                        const result = await format.run(source)
                        if (result && result.ok) notify('已复制', true)
                        else notify(format.failureLabel, false)
                      },
                    }))
                  },
                }),
              'copy-as: context menu',
            )
          } catch (error) {
            logFailure('context menu', error)
          }
        }

        // 消息操作栏按钮；右下角的提示框由注入的 notify 提供。
        if (slots && typeof slots.register === 'function') {
          try {
            ctx.effect(
              () =>
                slots.inject('conversation.chat.assistant-actions', () =>
                  slots.register(
                    {
                      name: 'conversation.chat.assistant-actions',
                      id: 'copy-as-button',
                      order: 60,
                      inject: () => ({ notify }),
                    },
                    CopyAsButton,
                  ),
                ),
              'copy-as: assistant action button',
            )
          } catch (error) {
            logFailure('assistant action button', error)
          }
        }

        if (typeof console !== 'undefined') {
          console.info('[dsh-copy-as] ready — 消息操作栏「复制为」按钮已注册')
        }
      },
    }
  },
})
