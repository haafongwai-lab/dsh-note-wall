/**
 * dsh-note-wall — Client half (browser).
 *
 * Web 客户端只接受 Module Loader 格式：脚本顶层调用
 * `window.__ModuleLoader__.load({ id, factory })`，factory 返回插件导出。
 *
 * 界面范式与参考图一致：
 *   - 侧边栏 `sidebar.panellist` 一个便签图标，主区 `main` 一面便签墙；
 *   - 顶部标题 + 副标题，右侧搜索框与便签计数；
 *   - 一张大号「写下灵感」输入卡：左下颜色圆点、右下 ⌘/Ctrl+Enter 与深色主按钮；
 *   - 下方便签网格：柔和的马卡龙底色、底部时间与操作；
 *   - 骨架沿用 Harness 自身的页面尺寸与主题 token，深色主题下自动换配色。
 */
window.__ModuleLoader__.load({
  id: 'dsh-note-wall',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'dsh-note-wall'
    const PANEL_ID = 'note-wall'
    const API = '/dsh-note-wall/api'
    const DRAFT_KEY = 'dsh-note-wall:draft'
    const MAX_TEXT = 2000

    /** 便签配色 id：与 Host 的 NOTE_COLORS 保持一致。 */
    const COLORS = ['butter', 'rose', 'sky', 'mint', 'lilac', 'cream']

    /**
     * 落地动画的时长与清理时机。
     *
     * `nw-note-land` 是 1.1s，`nw-note-sheen` 是 1s + 0.24s 延迟 = 1.24s，
     * 摘掉 `nw-note-enter` 必须晚于两者，否则动画会在半途被掐断。
     * 改 CSS 时长时同步改这里——测试会核对两者是否一致。
     */
    const LAND_MS = 1100
    const SHEEN_MS = 1000
    const SHEEN_DELAY_MS = 240
    const LANDING_MS = Math.max(LAND_MS, SHEEN_MS + SHEEN_DELAY_MS) + 150

    // -----------------------------------------------------------------------
    // Locale
    // -----------------------------------------------------------------------

    const DICT = {
      zh: {
        panelTitle: '便签墙',
        pageTitle: '便签墙',
        pageIntro: '每个灵感，都值得记下。便签自动保存。',
        searchPlaceholder: '搜索便签',
        countLabel: '{n} 张便签',
        composerPlaceholder: '写下你的下一个灵感…',
        add: '添加到墙上',
        save: '保存修改',
        cancel: '取消',
        editingHint: '正在编辑这张便签',
        submitHint: '{key} + Enter',
        colorLabel: '便签颜色',
        emptyHint: '还没有便签。写下第一句，它就会留在这里。',
        loading: '正在打开便签墙…',
        loadFailed: '便签墙加载失败',
        retry: '重试',
        edit: '编辑',
        remove: '删除',
        deleted: '已删除一张便签',
        undo: '撤销',
        justNow: '刚刚',
        minutesAgo: '{n} 分钟前',
        hoursAgo: '{n} 小时前',
        daysAgo: '{n} 天前',
        errEmpty: '先写点什么吧。',
        errFull: '便签墙满了，先清理几张。',
        errMissing: '这张便签已经不在了。',
        errGeneric: '操作失败，请重试。',
        filtered: '没有匹配的便签',
        clearSearch: '清除搜索',
        openNote: '打开全文',
        readerTitle: '便签全文',
        readerChars: '{n} 字',
        close: '关闭',
      },
      en: {
        panelTitle: 'Note Wall',
        pageTitle: 'Note Wall',
        pageIntro: 'Every spark deserves a place. Notes save as you go.',
        searchPlaceholder: 'Search notes',
        countLabel: '{n} notes',
        composerPlaceholder: 'Write down your next spark…',
        add: 'Add to wall',
        save: 'Save changes',
        cancel: 'Cancel',
        editingHint: 'Editing this note',
        submitHint: '{key} + Enter',
        colorLabel: 'Note color',
        emptyHint: 'No notes yet. Write the first line and it stays here.',
        loading: 'Opening the note wall…',
        loadFailed: 'Could not load the note wall',
        retry: 'Retry',
        edit: 'Edit',
        remove: 'Delete',
        deleted: 'Note deleted',
        undo: 'Undo',
        justNow: 'just now',
        minutesAgo: '{n} min ago',
        hoursAgo: '{n} h ago',
        daysAgo: '{n} d ago',
        errEmpty: 'Write something first.',
        errFull: 'The wall is full — clear a few notes.',
        errMissing: 'That note is gone already.',
        errGeneric: 'That did not work. Try again.',
        filtered: 'No matching notes',
        clearSearch: 'Clear search',
        openNote: 'Open full note',
        readerTitle: 'Full note',
        readerChars: '{n} chars',
        close: 'Close',
      },
    }

    /**
     * 这个面板固定说中文。
     *
     * 以前按 `locale.getLocale().active` 切中英：首屏渲染时宿主偏好还没解析
     * 完，先回退到 en，等快照到了再刷成 zh —— 界面会在两种语言之间跳一下。
     * 现在把语言钉死，字典仍然中英都注册，只是不再跟随运行时瞬时状态。
     */
    const PANEL_LOCALE = 'zh'

    function makeTranslator(locale) {
      let bound = null
      if (locale && typeof locale.bind === 'function') {
        try {
          bound = locale.bind(NS)
        } catch {
          bound = null
        }
      }
      return function translate(key, params) {
        let text
        // 先查自己钉死的字典，查不到才问宿主 —— 顺序反过来就会在字典注册
        // 完成前后拿到不同结果，那正是界面跳变的来源。
        const pinned = DICT[PANEL_LOCALE][key]
        if (typeof pinned === 'string') text = pinned
        if (text === undefined && bound) {
          try {
            const value = bound(key)
            if (typeof value === 'string' && value !== key) text = value
          } catch {
            /* fall through to the embedded dictionary */
          }
        }
        if (text === undefined) text = DICT[PANEL_LOCALE][key] || DICT.en[key] || key
        if (params) {
          for (const name of Object.keys(params)) {
            text = text.split(`{${name}}`).join(String(params[name]))
          }
        }
        return text
      }
    }

    // -----------------------------------------------------------------------
    // API
    // -----------------------------------------------------------------------

    const ERROR_KEY = {
      'empty-text': 'errEmpty',
      'wall-full': 'errFull',
      'note-not-found': 'errMissing',
      'unknown-color': 'errGeneric',
    }

    async function apiJson(path, options = {}) {
      const res = await fetch(API + path, {
        credentials: 'same-origin',
        ...options,
        headers: { ...(options.headers || {}) },
      })
      const text = await res.text()
      let body = null
      if (text) {
        try {
          body = JSON.parse(text)
        } catch {
          body = null
        }
      }
      if (!res.ok) {
        const error = new Error((body && (body.error || body.message)) || `HTTP ${res.status}`)
        error.code = body && body.error
        throw error
      }
      return body || {}
    }

    const postJson = (path, payload) => apiJson(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })

    const api = {
      list: () => apiJson('/notes'),
      add: (text, color) => postJson('/notes', { text, color }),
      update: (id, patch) => postJson('/notes/update', { id, ...patch }),
      remove: (id) => postJson('/notes/delete', { id }),
    }

    // -----------------------------------------------------------------------
    // Draft persistence
    // -----------------------------------------------------------------------

    function readDraft() {
      try {
        const raw = window.localStorage.getItem(DRAFT_KEY)
        if (!raw) return null
        const parsed = JSON.parse(raw)
        if (!parsed || typeof parsed.text !== 'string') return null
        return {
          text: parsed.text.slice(0, MAX_TEXT),
          color: COLORS.includes(parsed.color) ? parsed.color : 'butter',
        }
      } catch {
        return null
      }
    }

    function writeDraft(draft) {
      try {
        if (!draft || draft.text.length === 0) window.localStorage.removeItem(DRAFT_KEY)
        else window.localStorage.setItem(DRAFT_KEY, JSON.stringify(draft))
      } catch {
        /* private mode or a full quota: the draft is a convenience, not state */
      }
    }

    // -----------------------------------------------------------------------
    // Small helpers
    // -----------------------------------------------------------------------

    function relativeTime(ts, t) {
      const time = typeof ts === 'number' ? ts : Date.parse(ts)
      if (!Number.isFinite(time)) return ''
      const diff = Date.now() - time
      if (diff < 0 || diff < 60e3) return t('justNow')
      if (diff < 3600e3) return t('minutesAgo', { n: Math.floor(diff / 60e3) })
      if (diff < 86400e3) return t('hoursAgo', { n: Math.floor(diff / 3600e3) })
      if (diff < 7 * 86400e3) return t('daysAgo', { n: Math.floor(diff / 86400e3) })
      const d = new Date(time)
      return `${d.getMonth() + 1}/${d.getDate()}`
    }

    function errorText(error, t) {
      const key = error && error.code ? ERROR_KEY[error.code] : undefined
      return key ? t(key) : t('errGeneric')
    }

    function isMac() {
      try {
        return /mac/i.test(navigator.platform || navigator.userAgent || '')
      } catch {
        return false
      }
    }

    // -----------------------------------------------------------------------
    // Icons
    // -----------------------------------------------------------------------

    function strokeProps(size) {
      return {
        viewBox: '0 0 24 24',
        width: size,
        height: size,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.6,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': 'true',
        focusable: 'false',
        style: { display: 'inline-block', verticalAlign: 'middle' },
      }
    }

    function SearchIcon({ size = 15 }) {
      return h('svg', strokeProps(size),
        h('circle', { cx: 10.5, cy: 10.5, r: 6.2 }),
        h('path', { d: 'M15.1 15.1 20 20' }))
    }

    function PlusIcon({ size = 14 }) {
      return h('svg', strokeProps(size), h('path', { d: 'M12 5.5v13M5.5 12h13' }))
    }

    function PencilIcon({ size = 13 }) {
      return h('svg', strokeProps(size),
        h('path', { d: 'M4.6 19.4h3.2l9.3-9.3-3.2-3.2-9.3 9.3z' }),
        h('path', { d: 'M14.4 6.4 16.6 4.2a1.5 1.5 0 0 1 2.1 0l1.1 1.1a1.5 1.5 0 0 1 0 2.1l-2.2 2.2' }))
    }

    function TrashIcon({ size = 13 }) {
      return h('svg', strokeProps(size),
        h('path', { d: 'M4.8 6.9h14.4' }),
        h('path', { d: 'M9.4 6.9V5.2a1 1 0 0 1 1-1h3.2a1 1 0 0 1 1 1v1.7' }),
        h('path', { d: 'M6.6 6.9 7.5 19a1 1 0 0 0 1 .9h7a1 1 0 0 0 1-.9l.9-12.1' }))
    }

    function CloseIcon({ size = 12 }) {
      return h('svg', strokeProps(size), h('path', { d: 'M6 6l12 12M18 6 6 18' }))
    }

    /**
     * 侧边栏图标：一张折角的便签。
     *
     * 20px 下能读出来的关键是「纸 + 折角」两笔：外框给纸的轮廓，右下折角给出
     * 便签特有的撕口，内部两条短线是字。线条只用 currentColor，随侧边栏选中
     * 态变色。
     */
    function PanelIcon({ size = 20 }) {
      return h('svg', strokeProps(size),
        h('path', { d: 'M5.6 4.4h9.1l4.7 4.7v10.5a1.4 1.4 0 0 1-1.4 1.4H5.6a1.4 1.4 0 0 1-1.4-1.4V5.8a1.4 1.4 0 0 1 1.4-1.4z' }),
        h('path', { d: 'M14.6 4.6v4.3h4.4' }),
        h('path', { d: 'M7.6 13.4h7.2M7.6 16.6h4.6' }))
    }

    // -----------------------------------------------------------------------
    // Page
    // -----------------------------------------------------------------------

    function makeUi(t, locale, theme, subscribeTheme) {
      function useTranslate() {
        const [, setRevision] = React.useState(0)
        React.useEffect(() => {
          if (!locale || typeof locale.subscribe !== 'function') return undefined
          return locale.subscribe(() => setRevision((n) => n + 1))
        }, [])
        return t
      }

      function readScheme() {
        try {
          const snapshot = theme && theme.getTheme && theme.getTheme()
          const scheme = snapshot && snapshot.active && snapshot.active.colorScheme
          if (scheme === 'dark' || scheme === 'light') return scheme
        } catch {
          /* fall through to the media query */
        }
        try {
          return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
        } catch {
          return 'light'
        }
      }

      function useScheme() {
        const [scheme, setScheme] = React.useState(readScheme)
        React.useEffect(() => {
          if (typeof subscribeTheme !== 'function') return undefined
          const off = subscribeTheme(() => setScheme(readScheme()))
          return typeof off === 'function' ? off : undefined
        }, [])
        return scheme
      }

      /** 每 30 秒刷新一次「刚刚 / N 分钟前」，让时间标签自己走。 */
      function useClock() {
        const [, setTick] = React.useState(0)
        React.useEffect(() => {
          const id = setInterval(() => setTick((n) => n + 1), 30e3)
          return () => clearInterval(id)
        }, [])
      }

      /**
       * 便签格数量：窄窗 3 列 = 6 格，宽窗（≥1120px）4 列 = 8 格。
       * 列数由 CSS 断点决定，这里只读同一个断点来算要补几张占位卡，
       * 保证两处永远说同一件事。
       */
      const WIDE_QUERY = '(min-width:1120px)'

      function readWide() {
        try {
          return window.matchMedia(WIDE_QUERY).matches
        } catch {
          return false
        }
      }

      function useSlots() {
        const [wide, setWide] = React.useState(readWide)
        React.useEffect(() => {
          let query
          try {
            query = window.matchMedia(WIDE_QUERY)
          } catch {
            return undefined
          }
          const onChange = () => setWide(query.matches)
          // Safari < 14 只有 addListener；两者都没有时退化成一次性读取。
          if (typeof query.addEventListener === 'function') {
            query.addEventListener('change', onChange)
            return () => query.removeEventListener('change', onChange)
          }
          if (typeof query.addListener === 'function') {
            query.addListener(onChange)
            return () => query.removeListener(onChange)
          }
          return undefined
        }, [])
        return wide ? 8 : 6
      }

      function WallPage() {
        const translate = useTranslate()
        const scheme = useScheme()
        const slotCount = useSlots()
        useClock()

        const [loading, setLoading] = React.useState(true)
        const [loadError, setLoadError] = React.useState(null)
        const [notes, setNotes] = React.useState([])
        const [draftText, setDraftText] = React.useState('')
        const [draftColor, setDraftColor] = React.useState('butter')
        const [editingId, setEditingId] = React.useState(null)
        const [busy, setBusy] = React.useState(false)
        const [query, setQuery] = React.useState('')
        const [toast, setToast] = React.useState(null)
        // 正在阅读全文的那张便签：{ id }，null = 没有打开。
        const [reader, setReader] = React.useState(null)
        const textareaRef = React.useRef(null)
        const toastTimer = React.useRef(0)
        const toastSeq = React.useRef(0)
        const readerRef = React.useRef(null)
        // 进入编辑时先把「还没上墙的草稿」暂存起来，取消/保存后再放回输入框 ——
        // 否则点一下便签就把用户正在写的一段话吞掉了。
        const stashedDraft = React.useRef(null)
        // 刚落地的便签 id：只让「新贴上来」的那张播入场动画。
        // 刷新、搜索、切换颜色都不该重播，否则整面墙会一起抖。
        const [landing, setLanding] = React.useState(() => new Set())
        // 每张便签自己的清理计时器：连着贴两张时，前一张不会被后一张顶掉。
        const landingTimers = React.useRef(new Map())

        // 草稿：打开页面时恢复，输入时自动存 —— 副标题说的「便签自动保存」。
        React.useEffect(() => {
          const draft = readDraft()
          if (draft) {
            setDraftText(draft.text)
            setDraftColor(draft.color)
          }
        }, [])

        React.useEffect(() => {
          if (editingId) return
          writeDraft({ text: draftText, color: draftColor })
        }, [draftText, draftColor, editingId])

        const refresh = React.useCallback(async () => {
          try {
            const body = await api.list()
            setNotes(Array.isArray(body.notes) ? body.notes : [])
            setLoadError(null)
          } catch (error) {
            setLoadError(error)
          } finally {
            setLoading(false)
          }
        }, [])

        React.useEffect(() => {
          void refresh()
        }, [refresh])

        React.useEffect(() => () => {
          if (toastTimer.current) clearTimeout(toastTimer.current)
          for (const timer of landingTimers.current.values()) clearTimeout(timer)
          landingTimers.current.clear()
        }, [])

        /**
         * 浮层打开时：Esc 关闭、焦点移进对话框。
         * `keydown` 用 capture 并 stopPropagation —— 否则宿主也会收到 Esc
         * （比如退出全屏或打断当前回合），一次 Esc 会触发两件事。
         */
        React.useEffect(() => {
          if (!reader) return undefined
          const onKeyDown = (event) => {
            if (event.key !== 'Escape') return
            event.preventDefault()
            event.stopPropagation()
            setReader(null)
          }
          document.addEventListener('keydown', onKeyDown, true)
          const node = readerRef.current
          if (node && typeof node.focus === 'function') node.focus()
          return () => document.removeEventListener('keydown', onKeyDown, true)
        }, [reader])

        /**
         * 打开一张便签的全文浮层。
         *
         * 卡片本身就只显示前 7 行，超长内容（比如一段代码步骤）在墙上是看不全的；
         * 点卡片打开这个浮层读全文，比让卡片自己长高更稳 —— 墙的等高不会被破坏。
         */
        function openNote(note) {
          setReader({ id: note.id })
        }

        function closeReader() {
          setReader(null)
        }

        /** 浮层里点「编辑」：先关浮层，再把内容装进顶部输入卡。 */
        function editFromReader(note) {
          setReader(null)
          startEdit(note)
        }

        /** 浮层里删除：走同一条删除路径，删完关掉浮层。 */
        function removeFromReader(note) {
          setReader(null)
          void removeNote(note)
        }

        /** 标记一张便签为「刚贴上来」，动画播完就摘掉，避免重渲染时重播。 */
        function markLanding(id) {
          if (!id) return
          setLanding((current) => {
            if (current.has(id)) return current
            const next = new Set(current)
            next.add(id)
            return next
          })
          const existing = landingTimers.current.get(id)
          if (existing) clearTimeout(existing)
          landingTimers.current.set(id, setTimeout(() => {
            landingTimers.current.delete(id)
            setLanding((current) => {
              if (!current.has(id)) return current
              const next = new Set(current)
              next.delete(id)
              return next
            })
            // 必须比动画长：落地 1.05s、柔光 1.15s + 0.12s 延迟 = 1.27s。
            // 提前摘类会让动画中途被掐断，所以留足余量。
          }, LANDING_MS))
        }

        function notify(message, action) {
          toastSeq.current += 1
          const seq = toastSeq.current
          setToast({ message, action, seq })
          if (toastTimer.current) clearTimeout(toastTimer.current)
          toastTimer.current = setTimeout(() => {
            setToast((current) => (current && current.seq === seq ? null : current))
          }, 5200)
        }

        const editingNote = editingId ? notes.find((note) => note.id === editingId) : null

        function focusComposer() {
          const node = textareaRef.current
          if (node && typeof node.focus === 'function') node.focus()
        }

        function resetComposer() {
          const stashed = stashedDraft.current
          stashedDraft.current = null
          setEditingId(null)
          setDraftText(stashed ? stashed.text : '')
          setDraftColor(stashed ? stashed.color : 'butter')
        }

        async function submit() {
          const text = draftText.trim()
          if (text.length === 0 || busy) {
            if (text.length === 0) focusComposer()
            return
          }
          setBusy(true)
          try {
            if (editingId) {
              const body = await api.update(editingId, { text, color: draftColor })
              setNotes((current) => mergeNote(current, body.note))
              resetComposer()
            } else {
              const body = await api.add(text, draftColor)
              setNotes((current) => mergeNote(current, body.note))
              markLanding(body.note && body.note.id)
              setDraftText('')
              writeDraft(null)
            }
            setLoadError(null)
            focusComposer()
          } catch (error) {
            notify(errorText(error, translate))
          } finally {
            setBusy(false)
          }
        }

        function startEdit(note) {
          // 已经在这张便签上时不重复暂存，避免把便签内容当成草稿存回去。
          if (editingId !== note.id) {
            stashedDraft.current = editingId
              ? stashedDraft.current
              : (draftText.trim().length > 0 ? { text: draftText, color: draftColor } : null)
          }
          setEditingId(note.id)
          setDraftText(note.text)
          setDraftColor(note.color)
          focusComposer()
        }

        async function removeNote(note) {
          const previous = notes
          setNotes((current) => current.filter((entry) => entry.id !== note.id))
          if (editingId === note.id) resetComposer()
          try {
            await api.remove(note.id)
            notify(translate('deleted'), {
              label: translate('undo'),
              run: async () => {
                try {
                  const body = await api.add(note.text, note.color)
                  setNotes((current) => mergeNote(current, body.note))
                  markLanding(body.note && body.note.id)
                } catch (error) {
                  setNotes(previous)
                  notify(errorText(error, translate))
                }
              },
            })
          } catch (error) {
            setNotes(previous)
            notify(errorText(error, translate))
          }
        }

        function onKeyDown(event) {
          if (event.key !== 'Enter') return
          if (!(event.metaKey || event.ctrlKey)) return
          event.preventDefault()
          void submit()
        }

        const keyword = query.trim().toLowerCase()
        const visible = keyword
          ? notes.filter((note) => note.text.toLowerCase().includes(keyword))
          : notes
        // 空位补齐到整格数（6 或 8），让墙上始终是一整面墙而不是半排。
        // 搜索时不补位，否则会盖住「没有匹配」的提示。
        const showGhosts = keyword ? 0 : Math.max(0, slotCount - visible.length)

        const accentKey = isMac() ? '⌘' : 'Ctrl'

        function renderNote(note) {
          const active = editingId === note.id
          const entering = landing.has(note.id)
          // `toISOString()` throws on an invalid date, and a throw here would blank
          // the whole slot entry — one malformed timestamp must not take the wall down.
          const stamp = Number.isFinite(note.updatedAt) ? new Date(note.updatedAt).toISOString() : undefined
          return h('article', {
            key: note.id,
            className: 'nw-note'
              + (active ? ' is-editing' : '')
              + (entering ? ' nw-note-enter' : ''),
            'data-color': note.color,
            // 整张卡就是「打开全文」的按钮：role/tabIndex 让它可 Tab 聚焦、
            // 可回车打开，和鼠标点击走同一条路径（onOpen 而非编辑）。
            role: 'button',
            tabIndex: 0,
            'aria-label': translate('openNote'),
            onClick: (event) => {
              if (event.target && event.target.closest && event.target.closest('button')) return
              openNote(note)
            },
            onKeyDown: (event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return
              if (event.target && event.target.closest && event.target.closest('button')) return
              event.preventDefault()
              openNote(note)
            },
          },
          h('p', { className: 'nw-note-text' }, note.text),
          h('footer', { className: 'nw-note-foot' },
            h('time', { className: 'nw-note-time', dateTime: stamp },
              relativeTime(note.updatedAt, translate)),
            h('span', { className: 'nw-note-actions' },
              h('button', {
                type: 'button',
                className: 'nw-note-action',
                title: translate('edit'),
                'aria-label': translate('edit'),
                onClick: () => startEdit(note),
              }, h(PencilIcon)),
              h('button', {
                type: 'button',
                className: 'nw-note-action danger',
                title: translate('remove'),
                'aria-label': translate('remove'),
                onClick: () => void removeNote(note),
              }, h(TrashIcon)))))
        }

        function renderGhost(index) {
          const color = COLORS[(index + 2) % COLORS.length]
          return h('div', {
            key: `ghost-${index}`,
            className: 'nw-note ghost',
            'data-color': color,
            'aria-hidden': 'true',
          })
        }

        /**
         * 全文浮层。
         *
         * 卡片只露前 7 行，点开这里把整段读完。几个必须的细节：
         *  - 遮罩点空白关闭要判 `target === currentTarget`，否则在正文里
         *    拖选文字、手松在遮罩上会误关；
         *  - 正文 `max-height` + `overflow:auto`，几千字也不会把按钮顶出屏幕；
         *  - 保留 `white-space:pre-wrap`，代码缩进与换行原样呈现。
         */
        function renderReader() {
          if (!reader) return null
          const note = notes.find((entry) => entry.id === reader.id)
          // 便签在别处被删掉了（比如 Agent 动手）：静默关掉，不留一个空壳。
          if (!note) return null
          const stamp = Number.isFinite(note.updatedAt) ? new Date(note.updatedAt).toISOString() : undefined
          return h('div', {
            className: 'nw-scrim',
            onClick: (event) => {
              if (event.target === event.currentTarget) setReader(null)
            },
          },
          h('section', {
            className: 'nw-dialog',
            role: 'dialog',
            'aria-modal': 'true',
            'aria-labelledby': 'nw-reader-title',
            tabIndex: -1,
            ref: readerRef,
            'data-color': note.color,
          },
          h('header', { className: 'nw-dialog-head' },
            h('div', { className: 'nw-dialog-heading' },
              h('h2', { className: 'nw-dialog-title', id: 'nw-reader-title' }, translate('readerTitle')),
              h('p', { className: 'nw-dialog-meta' },
                h('time', { dateTime: stamp }, relativeTime(note.updatedAt, translate)),
                h('span', { className: 'nw-dialog-dot', 'aria-hidden': 'true' }),
                h('span', null, translate('readerChars', { n: note.text.length })))),
            h('button', {
              type: 'button',
              className: 'nw-dialog-close',
              title: translate('close'),
              'aria-label': translate('close'),
              onClick: () => setReader(null),
            }, h(CloseIcon, { size: 14 }))),
          h('div', { className: 'nw-dialog-body' },
            h('p', { className: 'nw-dialog-text' }, note.text)),
          h('footer', { className: 'nw-dialog-foot' },
            h('button', {
              type: 'button',
              className: 'nw-dialog-btn',
              onClick: () => removeFromReader(note),
            }, translate('remove')),
            h('div', { className: 'nw-dialog-actions' },
              h('button', {
                type: 'button',
                className: 'nw-dialog-btn',
                onClick: () => setReader(null),
              }, translate('close')),
              h('button', {
                type: 'button',
                className: 'nw-dialog-btn primary',
                onClick: () => editFromReader(note),
              }, translate('edit'))))))
        }

        return h('div', { className: 'nw-page', 'data-scheme': scheme },
          h('header', { className: 'nw-head' },
            h('div', { className: 'nw-heading' },
              h('h1', { className: 'nw-title' }, translate('pageTitle')),
              h('p', { className: 'nw-intro' }, translate('pageIntro'))),
            h('div', { className: 'nw-toolbar' },
              h('div', { className: 'nw-search' },
                h('span', { className: 'nw-search-icon' }, h(SearchIcon)),
                h('input', {
                  type: 'search',
                  className: 'nw-search-input',
                  value: query,
                  placeholder: translate('searchPlaceholder'),
                  'aria-label': translate('searchPlaceholder'),
                  onChange: (event) => setQuery(event.target.value),
                }),
                query
                  ? h('button', {
                    type: 'button',
                    className: 'nw-search-clear',
                    title: translate('clearSearch'),
                    'aria-label': translate('clearSearch'),
                    onClick: () => setQuery(''),
                  }, h(CloseIcon))
                  : null),
              h('span', { className: 'nw-count' }, translate('countLabel', { n: notes.length })))),

          h('section', {
            className: 'nw-composer',
            'data-color': draftColor,
            'data-editing': editingNote ? 'true' : 'false',
          },
          editingNote
            ? h('div', { className: 'nw-composer-banner' },
              h('span', { className: 'nw-composer-banner-text' }, translate('editingHint')),
              h('button', {
                type: 'button',
                className: 'nw-link',
                onClick: () => resetComposer(),
              }, translate('cancel')))
            : null,
          h('textarea', {
            ref: textareaRef,
            className: 'nw-composer-input',
            value: draftText,
            rows: 3,
            maxLength: MAX_TEXT,
            placeholder: translate('composerPlaceholder'),
            'aria-label': translate('composerPlaceholder'),
            onChange: (event) => setDraftText(event.target.value),
            onKeyDown,
          }),
          h('div', { className: 'nw-composer-foot' },
            h('div', { className: 'nw-swatches', role: 'group', 'aria-label': translate('colorLabel') },
              COLORS.map((color) => h('button', {
                key: color,
                type: 'button',
                className: 'nw-swatch',
                'data-color': color,
                'data-selected': draftColor === color ? 'true' : 'false',
                'aria-label': color,
                'aria-pressed': draftColor === color,
                title: color,
                onClick: () => setDraftColor(color),
              }))),
            h('div', { className: 'nw-submit-row' },
              h('span', { className: 'nw-hint' }, translate('submitHint', { key: accentKey })),
              h('button', {
                type: 'button',
                className: 'nw-submit',
                disabled: busy || draftText.trim().length === 0,
                onClick: () => void submit(),
              },
              h(PlusIcon),
              h('span', null, editingNote ? translate('save') : translate('add')))))),

          loading
            ? h('p', { className: 'nw-status' },
              h('span', { className: 'nw-spinner' }),
              translate('loading'))
            : loadError
              ? h('div', { className: 'nw-status bad' },
                h('span', null, translate('loadFailed')),
                h('button', {
                  type: 'button',
                  className: 'nw-link',
                  onClick: () => { void refresh() },
                }, translate('retry')))
              : h('section', { className: 'nw-grid' },
                visible.length === 0
                  ? h('p', { className: 'nw-status nw-grid-note' },
                    notes.length > 0 ? translate('filtered') : translate('emptyHint'))
                  : null,
                visible.map(renderNote),
                Array.from({ length: showGhosts }, (_, index) => renderGhost(index))),

          toast
            ? h('div', { className: 'nw-toast', role: 'status' },
              h('span', { className: 'nw-toast-text' }, toast.message),
              toast.action
                ? h('button', {
                  type: 'button',
                  className: 'nw-toast-action',
                  onClick: () => {
                    const action = toast.action
                    setToast(null)
                    void action.run()
                  },
                }, toast.action.label)
                : null)
            : null,
          renderReader())
      }

      return { PanelIcon, WallPage }
    }

    /** 新写的排前面：与 Host 的排序规则一致，列表不会因为一次刷新跳序。 */
    function mergeNote(list, note) {
      if (!note) return list
      const next = list.filter((entry) => entry.id !== note.id)
      next.push(note)
      next.sort((a, b) => {
        if (b.updatedAt !== a.updatedAt) return b.updatedAt - a.updatedAt
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
      })
      return next
    }

    // -----------------------------------------------------------------------
    // Styles
    // -----------------------------------------------------------------------

    const CSS = `
.nw-page{box-sizing:border-box;height:100%;overflow:auto;display:flex;flex-direction:column;gap:20px;padding:0 clamp(24px,4vw,48px) 40px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px}
.nw-page *{box-sizing:border-box}
/* 遮罩与 toast 必须排除在内容列规则之外：遮罩是 position:fixed;inset:0，
   被加上 max-width:960px + margin:auto 后会缩成一条居中窄带，只压暗中间。 */
.nw-page>*:not(.nw-scrim):not(.nw-toast){width:100%;max-width:960px;margin-inline:auto}
.nw-head{display:flex;flex-wrap:wrap;align-items:flex-start;justify-content:space-between;gap:16px;padding-top:28px}
[data-platform=darwin] .nw-head{padding-top:calc(28px + var(--dsh-frame-top-clearance,0px))}
.nw-heading{min-width:0}
.nw-title{margin:0;font-size:20px;font-weight:500;line-height:28px}
.nw-intro{margin:4px 0 0;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}
.nw-toolbar{display:flex;align-items:center;gap:12px;flex:none;padding-top:4px}
.nw-search{position:relative;display:flex;align-items:center;width:208px}
.nw-search-input{width:100%;height:30px;padding:0 28px 0 30px;border:.5px solid var(--dsw-alias-border-l2);border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;font-size:12.5px;line-height:18px;outline:none}
.nw-search-input::placeholder{color:var(--dsw-alias-label-tertiary)}
.nw-search-input:focus-visible{border-color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-bg-layer-1)}
.nw-search-input::-webkit-search-cancel-button{display:none}
.nw-search-icon{position:absolute;left:10px;display:inline-flex;color:var(--dsw-alias-label-tertiary);pointer-events:none}
.nw-search-clear{position:absolute;right:6px;display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;padding:0;border:0;border-radius:50%;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer}
.nw-search-clear:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.nw-count{flex:none;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;font-variant-numeric:tabular-nums}
.nw-composer{display:flex;flex-direction:column;gap:12px;padding:18px 20px 16px;border-radius:16px;background:var(--nw-card-butter);color:var(--nw-ink-butter);box-shadow:0 1px 2px rgba(0,0,0,.03);transition:background .16s ease}
.nw-composer[data-color=butter]{background:var(--nw-card-butter);color:var(--nw-ink-butter)}
.nw-composer[data-color=rose]{background:var(--nw-card-rose);color:var(--nw-ink)}
.nw-composer[data-color=sky]{background:var(--nw-card-sky);color:var(--nw-ink)}
.nw-composer[data-color=mint]{background:var(--nw-card-mint);color:var(--nw-ink)}
.nw-composer[data-color=lilac]{background:var(--nw-card-lilac);color:var(--nw-ink)}
.nw-composer[data-color=cream]{background:var(--nw-card-cream);color:var(--nw-ink)}
.nw-composer[data-editing=true]{box-shadow:0 0 0 1.5px currentColor,0 1px 2px rgba(0,0,0,.03)}
.nw-composer-banner{display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:12px;line-height:18px;opacity:.72}
.nw-composer-input{width:100%;min-height:76px;max-height:220px;padding:0;border:0;background:transparent;color:inherit;font:inherit;font-size:14px;line-height:22px;resize:vertical;outline:none}
.nw-composer-input::placeholder{color:currentColor;opacity:.55}
.nw-composer-foot{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}
.nw-swatches{display:flex;align-items:center;gap:7px}
.nw-swatch{width:17px;height:17px;padding:0;border:0;border-radius:5px;background:var(--nw-chip);box-shadow:inset 0 0 0 .5px rgba(0,0,0,.06);cursor:pointer;transition:transform .12s ease,box-shadow .12s ease}
.nw-swatch[data-color=butter]{--nw-chip:#f6dd93}
.nw-swatch[data-color=rose]{--nw-chip:#f4b8ce}
.nw-swatch[data-color=sky]{--nw-chip:#b6dcf0}
.nw-swatch[data-color=mint]{--nw-chip:#b5e6d6}
.nw-swatch[data-color=lilac]{--nw-chip:#cfc4f0}
.nw-swatch[data-color=cream]{--nw-chip:#efe6cf}
.nw-swatch:hover{transform:translateY(-1px)}
.nw-swatch[data-selected=true]{box-shadow:0 0 0 2px currentColor,inset 0 0 0 .5px rgba(0,0,0,.06)}
.nw-swatch:focus-visible{outline:2px solid currentColor;outline-offset:2px}
.nw-submit-row{display:flex;align-items:center;gap:12px;margin-left:auto}
.nw-hint{color:inherit;font-size:11.5px;line-height:16px;opacity:.55;white-space:nowrap}
.nw-submit{display:inline-flex;align-items:center;gap:5px;height:32px;padding:0 14px;border:0;border-radius:999px;background:var(--nw-accent-fill);color:var(--nw-accent-ink);font:inherit;font-size:12.5px;line-height:18px;font-weight:500;white-space:nowrap;cursor:pointer;transition:opacity .12s ease,transform .12s ease}
.nw-submit:hover:not(:disabled){opacity:.9}
.nw-submit:active:not(:disabled){transform:translateY(.5px)}
.nw-submit:disabled{opacity:.4;cursor:not-allowed}
.nw-submit:focus-visible{outline:2px solid currentColor;outline-offset:2px}
.nw-link{padding:0;border:0;background:none;color:inherit;font:inherit;font-size:12px;line-height:18px;text-decoration:underline;text-underline-offset:2px;cursor:pointer;opacity:.85}
.nw-link:hover{opacity:1}
/* stretch 而不是 start：同一行的便签按最高那张对齐，整面墙才是齐的。
   写 start 时每张只按自身内容撑高，两行与七行的便签高低不一。 */
.nw-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;align-items:stretch;grid-auto-rows:168px}
/* 固定行高 168px：高度不再由内容决定，卡片就不会随正文长高、
   更不会被撑成和宽度一样的正方形。正文在该高度内截断，全文点开看。 */
.nw-note{position:relative;display:flex;flex-direction:column;gap:10px;height:100%;min-height:0;padding:16px 16px 11px;border-radius:13px;background:var(--nw-card-cream);color:var(--nw-ink);cursor:pointer;transition:transform .12s ease,box-shadow .12s ease}
.nw-note:focus-visible{outline:2px solid currentColor;outline-offset:2px}
.nw-note[data-color=butter]{background:var(--nw-card-butter);color:var(--nw-ink-butter)}
.nw-note[data-color=rose]{background:var(--nw-card-rose);color:var(--nw-ink)}
.nw-note[data-color=sky]{background:var(--nw-card-sky);color:var(--nw-ink)}
.nw-note[data-color=mint]{background:var(--nw-card-mint);color:var(--nw-ink)}
.nw-note[data-color=lilac]{background:var(--nw-card-lilac);color:var(--nw-ink)}
.nw-note[data-color=cream]{background:var(--nw-card-cream);color:var(--nw-ink)}
.nw-note:hover{transform:translateY(-1px);box-shadow:0 4px 14px rgba(0,0,0,.06)}
.nw-note.is-editing{box-shadow:0 0 0 1.5px currentColor,0 4px 14px rgba(0,0,0,.06)}
.nw-note.ghost{cursor:default;min-height:132px;height:100%;opacity:.62}
.nw-note.ghost:hover{transform:none;box-shadow:none}
/* 便签「贴」上墙。
   关键点：animation-timing-function 是**逐段生效**的，一条 ease 曲线配 5 个
   关键帧，速度会在每个关键帧归零再重启 —— 那正是「不连贯」的来源。
   所以这里改用一条阻尼弹簧的密集采样 + linear：曲线已经烘焙进采样点，
   速度天然连续，卡片是「落定」而不是「一格一格跳」。
   弹簧参数取 d(1)=0（cos 2.5π = 0），落点正好静止，收尾不会硬切。 */
@keyframes nw-note-land{
  0%{opacity:0;transform:translateY(-22px) scale(.9) rotate(-1.8deg);box-shadow:0 12px 26px rgba(0,0,0,.12)}
  5%{opacity:.097;transform:translateY(-15.67px) scale(.9288) rotate(-1.28deg);box-shadow:0 8.5px 18.5px rgba(0,0,0,.085)}
  10%{opacity:.33;transform:translateY(-9.25px) scale(.958) rotate(-.76deg);box-shadow:0 5px 10.9px rgba(0,0,0,.05)}
  15%{opacity:.614;transform:translateY(-3.86px) scale(.9825) rotate(-.32deg);box-shadow:0 2.1px 4.6px rgba(0,0,0,.021)}
  20%{opacity:.865;transform:translateY(0) scale(1) rotate(0deg);box-shadow:0 0 0 rgba(0,0,0,0)}
  25%{opacity:.996;transform:translateY(2.29px) scale(1.0104) rotate(.19deg);box-shadow:0 0 0 rgba(0,0,0,0)}
  30%{opacity:1;transform:translateY(3.27px) scale(1.0149) rotate(.27deg);box-shadow:0 0 0 rgba(0,0,0,0)}
  35%{opacity:1;transform:translateY(3.29px) scale(1.015) rotate(.27deg);box-shadow:0 0 0 rgba(0,0,0,0)}
  40%{opacity:1;transform:translateY(2.75px) scale(1.0125) rotate(.22deg);box-shadow:0 0 0 rgba(0,0,0,0)}
  45%{opacity:1;transform:translateY(1.96px) scale(1.0089) rotate(.16deg);box-shadow:0 0 0 rgba(0,0,0,0)}
  50%{opacity:1;transform:translateY(1.16px) scale(1.0053) rotate(.09deg);box-shadow:0 0 0 rgba(0,0,0,0)}
  55%{opacity:1;transform:translateY(.48px) scale(1.0022) rotate(.04deg);box-shadow:0 0 0 rgba(0,0,0,0)}
  60%{opacity:1;transform:translateY(0) scale(1) rotate(0deg);box-shadow:0 0 0 rgba(0,0,0,0)}
  65%{opacity:1;transform:translateY(-.29px) scale(.9987) rotate(-.02deg);box-shadow:0 0 0 rgba(0,0,0,0)}
  70%{opacity:1;transform:translateY(-.41px) scale(.9981) rotate(-.03deg);box-shadow:0 0 0 rgba(0,0,0,0)}
  75%{opacity:1;transform:translateY(-.41px) scale(.9981) rotate(-.03deg);box-shadow:0 0 0 rgba(0,0,0,0)}
  80%{opacity:1;transform:translateY(-.34px) scale(.9984) rotate(-.03deg);box-shadow:0 0 0 rgba(0,0,0,0)}
  85%{opacity:1;transform:translateY(-.24px) scale(.9989) rotate(-.02deg);box-shadow:0 0 0 rgba(0,0,0,0)}
  90%{opacity:1;transform:translateY(-.14px) scale(.9993) rotate(-.01deg);box-shadow:0 0 0 rgba(0,0,0,0)}
  95%{opacity:1;transform:translateY(-.06px) scale(.9997) rotate(0deg);box-shadow:0 0 0 rgba(0,0,0,0)}
  100%{opacity:1;transform:translateY(0) scale(1) rotate(0deg);box-shadow:0 0 0 rgba(0,0,0,0)}
}
/* 柔光在落定之后才扫过，且自己也是线性推进，不再叠加第二层缓动。 */
@keyframes nw-note-sheen{
  0%{opacity:0;transform:translateX(-58%)}
  22%{opacity:.72}
  100%{opacity:0;transform:translateX(66%)}
}
/* 用 backwards 而不是 both：动画一结束就交还给普通样式，
   悬停抬升与选中描边立刻恢复，不会被最终关键帧压住。
   linear 是刻意的：缓动已经在关键帧里了。 */
.nw-note-enter{animation:nw-note-land 1.1s linear backwards;overflow:hidden}
.nw-note-enter::after{content:'';position:absolute;inset:0;border-radius:inherit;pointer-events:none;background:linear-gradient(112deg,transparent 34%,rgba(255,255,255,.62) 48%,transparent 62%);animation:nw-note-sheen 1s linear .24s both}
.nw-note-text{flex:1;min-height:0;margin:0;font-size:15.5px;font-weight:500;line-height:24px;letter-spacing:.1px;white-space:pre-wrap;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}
/* 固定行高 168px 下正文只放得下 4 行；剩下的交给浮层看全文。 */
/* 底部固定行高并顶到底：卡片等高后，footer 不 margin-top:auto 会浮在文字下面。 */
.nw-note-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;height:22px;margin-top:auto;flex:none}
.nw-note-time{font-size:11px;line-height:16px;opacity:.55;font-variant-numeric:tabular-nums}
.nw-note-actions{display:flex;align-items:center;gap:2px;opacity:0;transition:opacity .12s ease}
.nw-note:hover .nw-note-actions,.nw-note:focus-within .nw-note-actions{opacity:1}
.nw-note-action{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;padding:0;border:0;border-radius:6px;background:transparent;color:inherit;opacity:.6;cursor:pointer}
.nw-note-action:hover{background:rgba(0,0,0,.06);opacity:1}
.nw-note-action.danger:hover{background:rgba(190,60,60,.12);color:var(--dsw-alias-state-error-primary)}
.nw-note-action:focus-visible{outline:2px solid currentColor;outline-offset:1px;opacity:1}
.nw-status{display:flex;align-items:center;gap:8px;margin:8px 0 0;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px}
.nw-grid-note{grid-column:1/-1;margin:0 0 2px;padding:2px 0}
.nw-status.bad{color:var(--dsw-alias-state-error-primary)}
.nw-spinner{width:14px;height:14px;border:2px solid var(--dsw-alias-border-l2);border-top-color:var(--dsw-alias-brand-primary);border-radius:50%;animation:nw-spin .8s linear infinite}
@keyframes nw-spin{to{transform:rotate(360deg)}}
.nw-toast{position:sticky;bottom:16px;z-index:5;display:flex;align-items:center;gap:12px;align-self:center;width:fit-content;max-width:100%;margin:0 auto;padding:8px 10px 8px 14px;border-radius:999px;background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);box-shadow:var(--dsw-elevation-prominent);font-size:12.5px;line-height:18px;animation:nw-rise .16s ease-out}
.nw-toast-text{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.nw-toast-action{flex:none;padding:2px 10px;border:0;border-radius:999px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);font:inherit;font-size:12.5px;line-height:18px;cursor:pointer}
.nw-toast-action:hover{background:var(--dsw-alias-border-l1)}
@keyframes nw-rise{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
/* 全文浮层。遮罩顶部让出 frame clearance，否则会压暗 macOS 红绿灯并挡住拖动区。 */
.nw-scrim{position:fixed;top:var(--dsh-frame-top-clearance,0px);right:0;bottom:0;left:0;width:auto;max-width:none;margin:0;z-index:60;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(20,18,14,.32);backdrop-filter:blur(2px);animation:nw-fade .14s ease-out}
.nw-dialog{display:flex;flex-direction:column;width:min(600px,100%);max-height:min(80vh,660px);border-radius:16px;background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-layer-1));color:var(--dsw-alias-label-primary);box-shadow:var(--dsw-elevation-prominent,0 18px 48px rgba(0,0,0,.24));animation:nw-pop .18s cubic-bezier(.2,.9,.3,1);outline:none}
.nw-dialog-head{display:flex;align-items:flex-start;gap:10px;padding:16px 14px 12px 18px;border-bottom:.5px solid var(--dsw-alias-border-l1)}
.nw-dialog-heading{flex:1;min-width:0}
.nw-dialog-title{margin:0;font-size:14.5px;font-weight:500;line-height:21px}
.nw-dialog-meta{display:flex;align-items:center;gap:7px;margin:3px 0 0;font-size:11.5px;line-height:17px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.nw-dialog-dot{width:3px;height:3px;border-radius:50%;background:currentColor;opacity:.5}
.nw-dialog-close{display:inline-flex;flex:none;align-items:center;justify-content:center;width:26px;height:26px;padding:0;border:0;border-radius:50%;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
.nw-dialog-close:hover{background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-border-l1));color:var(--dsw-alias-label-primary)}
.nw-dialog-close:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.nw-dialog-body{display:flex;flex-direction:column;min-height:0;padding:14px 18px;overflow:auto}
/* 长文正文：保留原换行与缩进，超长行也不撑破容器。 */
.nw-dialog-text{margin:0;font-size:13.5px;line-height:22px;white-space:pre-wrap;overflow-wrap:anywhere}
.nw-dialog-foot{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:11px 14px 13px 18px;border-top:.5px solid var(--dsw-alias-border-l1);flex-wrap:wrap}
.nw-dialog-actions{display:flex;align-items:center;gap:8px;margin-left:auto}
.nw-dialog-btn{height:28px;padding:0 13px;border:.5px solid var(--dsw-alias-border-l2);border-radius:999px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:18px;cursor:pointer;transition:background .12s ease,opacity .12s ease}
.nw-dialog-btn:hover{background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-border-l1))}
.nw-dialog-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.nw-dialog-btn.primary{border-color:transparent;background:var(--nw-accent-fill);color:var(--nw-accent-ink);font-weight:500}
.nw-dialog-btn.primary:hover{opacity:.9;background:var(--nw-accent-fill)}
@keyframes nw-fade{from{opacity:0}to{opacity:1}}
@keyframes nw-pop{from{opacity:0;transform:translateY(6px) scale(.985)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.nw-spinner,.nw-toast,.nw-scrim,.nw-dialog{animation:none}.nw-note,.nw-swatch,.nw-submit,.nw-dialog-btn{transition:none}.nw-note-enter{animation:none}.nw-note-enter::after{display:none}}
/* 便签格数量：窗口窄时 3 列 6 格，宽时 4 列 8 格。
   宽窗同时放宽内容列，4 列才不会比 3 列还窄。 */
@media (min-width:1120px){
  .nw-page>*:not(.nw-scrim):not(.nw-toast){max-width:1120px}
  .nw-grid{grid-template-columns:repeat(4,minmax(0,1fr))}
}
@media (max-width:640px){.nw-page{padding:0 16px 32px}.nw-head{padding-top:20px}.nw-search{width:100%}.nw-toolbar{width:100%}.nw-grid{gap:10px}}
`

    /**
     * 便签配色。
     *
     * 卡片底色是「作品」而非界面：参考图里的马卡龙色必须原样保留，因此这里用
     * 自己的变量，并按主题给出深色版；界面骨架仍只用 --dsw-alias-* token。
     */
    const COLOR_CSS = `
.nw-page{--nw-ink:#3b3a36;--nw-ink-butter:#5b4c1f;--nw-card-butter:#fbe8a6;--nw-card-rose:#fcf0f7;--nw-card-sky:#f5f9fc;--nw-card-mint:#f6fbf9;--nw-card-lilac:#f7f6fd;--nw-card-cream:#fcfaf6;--nw-accent-fill:#1c1c1c;--nw-accent-ink:#ffffff}
/* 深色主题下主按钮保持黑色：黑底 + 白字在深色便签上依然是最清晰的一档对比，
   换成浅色反而会和便签底色糊在一起。 */
.nw-page[data-scheme=dark]{--nw-ink:#e9e7e1;--nw-ink-butter:#f4e6b4;--nw-card-butter:#4a3f1c;--nw-card-rose:#3a2b32;--nw-card-sky:#25313a;--nw-card-mint:#24322d;--nw-card-lilac:#2c2939;--nw-card-cream:#302d26;--nw-accent-fill:#000000;--nw-accent-ink:#ffffff}
.nw-page[data-scheme=dark] .nw-note-action:hover{background:rgba(255,255,255,.1)}
`

    // -----------------------------------------------------------------------
    // Plugin export
    // -----------------------------------------------------------------------

    function installStyles(ctx) {
      if (typeof document === 'undefined') return
      ctx.effect(() => {
        const style = document.createElement('style')
        style.dataset.dshNoteWall = 'styles'
        style.textContent = CSS + COLOR_CSS
        document.head.append(style)
        return () => style.remove()
      })
    }

    return {
      name: NS,
      inject: ['slots'],
      apply(ctx) {
        const locale = typeof ctx.get === 'function' ? ctx.get('locale') : undefined
        if (locale && typeof locale.register === 'function') {
          try {
            ctx.effect(() => locale.register(NS, {
              zh: DICT.zh,
              'zh-CN': DICT.zh,
              en: DICT.en,
            }))
          } catch {
            /* 热重载时同名命名空间已存在，不能让整页空白 */
          }
        }

        const theme = typeof ctx.get === 'function' ? ctx.get('theme') : undefined
        // 主题订阅只挂一次：`theme/change` 是 emit 事件，页面组件只是订阅者。
        // 组件挂载/卸载只增删自己的回调，不重复注册监听。
        const schemeListeners = new Set()
        if (theme && typeof ctx.on === 'function') {
          ctx.effect(() => ctx.on('theme/change', () => {
            for (const listener of [...schemeListeners]) {
              try {
                listener()
              } catch {
                /* one broken subscriber must not stop the others */
              }
            }
          }))
        }
        const subscribeTheme = (listener) => {
          schemeListeners.add(listener)
          return () => {
            schemeListeners.delete(listener)
          }
        }

        const t = makeTranslator(locale)
        const { PanelIcon, WallPage } = makeUi(t, locale, theme, subscribeTheme)
        installStyles(ctx)

        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: PANEL_ID,
          order: 30,
          label: () => t('panelTitle'),
        }, PanelIcon))

        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: PANEL_ID,
        }, WallPage))
      },
    }
  },
})
