/**
 * dsh-note-wall — Host half.
 *
 * 一个便签墙：把灵感随时写到墙上，也让 Agent 能读写同一面墙。
 *
 * 设计要点：
 *  - 所有操作都收敛到一组纯 Host 方法（list / add / update / remove），
 *    HTTP 路由与 Agent 工具都只是这组方法的两个调用者，不存在两份逻辑。
 *  - 存储是 DSH_HOME 下的一个 JSON 文件，写入走「临时文件 + rename」，
 *    并把并发写串行化，避免半截文件。
 *  - 服务全部惰性读取（Loader 并发挂载，apply 时 ctx.get 可能为 undefined）。
 *
 * HTTP API（同源，前缀 /dsh-note-wall/api）：
 *   GET  /notes          列出全部便签
 *   POST /notes          新建（{ text, color? }）
 *   POST /notes/update   修改（{ id, text?, color? }）
 *   POST /notes/delete   删除（{ id }）
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

export const name = 'dsh-note-wall'

/** 便签颜色：与客户端调色板保持同一组 id。 */
export const NOTE_COLORS = ['butter', 'rose', 'sky', 'mint', 'lilac', 'cream']
const DEFAULT_COLOR = 'butter'
const MAX_TEXT_LENGTH = 2000
const MAX_BODY_BYTES = 256 * 1024

/**
 * 卡片几何。
 *
 * `span` 是跨的列数（1–4），`height` 是像素高度（0 = 用客户端的默认高度）。
 * 宽度不做自由像素值，而是整列吸附：网格仍是 3/4 列，自由像素宽度会溢出
 * 自己那一格并压住邻居。列数 1–4 配合自由高度，既能「任意拉伸」，又不会
 * 把墙挤乱。
 */
const MIN_SPAN = 1
const MAX_SPAN = 4
export const MIN_HEIGHT = 132
export const MAX_HEIGHT = 1200

function clampSpan(value) {
  if (!Number.isFinite(value)) return 1
  return Math.min(MAX_SPAN, Math.max(MIN_SPAN, Math.trunc(value)))
}

function clampHeight(value) {
  if (!Number.isFinite(value) || value <= 0) return 0
  return Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.round(value)))
}

export const Config = {
  '~standard': {
    version: 1,
    vendor: 'dsh-note-wall',
    validate(value) {
      if (value === undefined || value === null) value = {}
      if (typeof value !== 'object' || Array.isArray(value)) {
        return { issues: [{ message: 'plugin config must be an object' }] }
      }
      const maxNotes = Number.isFinite(value.maxNotes)
        ? Math.min(Math.max(1, Math.trunc(value.maxNotes)), 5000)
        : 500
      return {
        value: {
          /** 便签存储文件；留空 = <DSH_HOME>/note-wall/notes.json。 */
          storagePath: typeof value.storagePath === 'string' ? value.storagePath : '',
          maxNotes,
        },
      }
    },
  },
}

const DSH_HOME = () => process.env.DSH_HOME || join(homedir(), '.dsh')
const STORE_VERSION = 1

function defaultStoragePath() {
  return join(DSH_HOME(), 'note-wall', 'notes.json')
}

function warn(...args) {
  console.error('[dsh-note-wall]', ...args)
}

function isColor(value) {
  return typeof value === 'string' && NOTE_COLORS.includes(value)
}

function normalizeText(value) {
  if (typeof value !== 'string') return ''
  // 保留内部换行，去掉首尾空白；超长内容截断而不是拒绝，避免一次误粘贴丢掉全部输入。
  return value.replace(/\r\n/g, '\n').trim().slice(0, MAX_TEXT_LENGTH)
}

function normalizeNote(raw) {
  if (!raw || typeof raw !== 'object') return undefined
  const text = normalizeText(raw.text)
  if (text.length === 0) return undefined
  const id = typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : randomUUID()
  const createdAt = Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now()
  const updatedAt = Number.isFinite(raw.updatedAt) ? raw.updatedAt : createdAt
  return {
    id,
    text,
    color: isColor(raw.color) ? raw.color : DEFAULT_COLOR,
    createdAt,
    updatedAt,
    // 卡片形状：老数据没有这两个字段，落到 1 列 / 默认高度。
    span: clampSpan(raw.span),
    height: clampHeight(raw.height),
  }
}

/** 排序：新写的在最前面；同一毫秒内按创建时间与 id 兜底，保证稳定。 */
function sortNotes(notes) {
  return notes.slice().sort((a, b) => {
    if (b.updatedAt !== a.updatedAt) return b.updatedAt - a.updatedAt
    if (b.createdAt !== a.createdAt) return b.createdAt - a.createdAt
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
}

/**
 * 便签存储：读盘 → 内存 → 串行落盘。
 * 每个公开方法返回的是**结果或明确的失败**，调用者不吞异常。
 */
function createNoteStore(options) {
  const file = resolve(options.storagePath || defaultStoragePath())
  const maxNotes = options.maxNotes
  let loaded = false
  let notes = []
  /** 串行化写盘：上一次写完再写下一次，避免 rename 竞争。 */
  let writeChain = Promise.resolve()
  let lastError

  async function ensureLoaded() {
    if (loaded) return
    try {
      const raw = await readFile(file, 'utf8')
      const parsed = JSON.parse(raw)
      const list = Array.isArray(parsed) ? parsed : parsed && Array.isArray(parsed.notes) ? parsed.notes : []
      notes = sortNotes(list.map(normalizeNote).filter(Boolean))
    } catch (error) {
      if (error && error.code !== 'ENOENT') {
        warn('读取便签存储失败，将以空墙启动：', error && error.message)
        lastError = 'storage-unreadable'
      }
      notes = []
    }
    loaded = true
  }

  function persist() {
    const snapshot = JSON.stringify({ version: STORE_VERSION, notes }, null, 2)
    const target = file
    const attempt = writeChain.then(async () => {
      await mkdir(dirname(target), { recursive: true })
      const temp = `${target}.${process.pid}.${Date.now()}.tmp`
      await writeFile(temp, snapshot, 'utf8')
      await rename(temp, target)
    })
    // `writeChain` 必须始终是一条**已解决**的链：一次写失败若留在链上，
    // 后面每次 `.then()` 都会被跳过，之后的便签就再也写不进去了。
    // 失败只由本次调用者（attempt）看到，链本身照常往下走。
    writeChain = attempt.then(
      () => undefined,
      (error) => {
        warn('写入便签存储失败：', error && error.message)
        lastError = 'storage-write-failed'
      },
    )
    return attempt
  }

  /**
   * 先改内存、再落盘；落盘失败就把内存回滚到改动前。
   * 否则界面会显示一张「已经上墙」但磁盘上不存在的便签，重启后凭空消失。
   */
  async function commit(mutate) {
    const before = notes
    const result = mutate(before)
    if (!result.changed) return result
    notes = result.notes
    try {
      await persist()
    } catch {
      notes = before
      return { ok: false, error: 'storage-write-failed', total: before.length }
    }
    return result
  }

  async function list(query) {
    await ensureLoaded()
    const keyword = typeof query === 'string' ? query.trim().toLowerCase() : ''
    const visible = keyword
      ? notes.filter((note) => note.text.toLowerCase().includes(keyword))
      : notes
    return { ok: true, notes: visible.map((note) => ({ ...note })), total: notes.length }
  }

  async function add(input) {
    await ensureLoaded()
    const text = normalizeText(input && input.text)
    if (text.length === 0) return { ok: false, error: 'empty-text' }
    if (notes.length >= maxNotes) return { ok: false, error: 'wall-full', total: notes.length }
    const now = Date.now()
    const note = {
      id: randomUUID(),
      text,
      color: isColor(input && input.color) ? input.color : DEFAULT_COLOR,
      createdAt: now,
      updatedAt: now,
      span: clampSpan(input && input.span),
      height: clampHeight(input && input.height),
    }
    return commit((before) => ({
      ok: true,
      changed: true,
      notes: sortNotes([note, ...before]),
      note: { ...note },
      total: before.length + 1,
    }))
  }

  async function update(input) {
    await ensureLoaded()
    const id = input && typeof input.id === 'string' ? input.id : ''
    const current = notes.find((note) => note.id === id)
    if (!current) return { ok: false, error: 'note-not-found' }
    let changed = false
    let text = current.text
    if (input.text !== undefined) {
      const next = normalizeText(input.text)
      if (next.length === 0) return { ok: false, error: 'empty-text' }
      if (next !== current.text) {
        text = next
        changed = true
      }
    }
    let color = current.color
    if (input.color !== undefined) {
      if (!isColor(input.color)) return { ok: false, error: 'unknown-color' }
      if (input.color !== current.color) {
        color = input.color
        changed = true
      }
    }
    // 拖拽改卡片形状走同一条 update：不传就不动，传了才比较。
    let span = current.span
    if (input.span !== undefined) {
      const nextSpan = clampSpan(input.span)
      if (nextSpan !== current.span) {
        span = nextSpan
        changed = true
      }
    }
    let height = current.height
    if (input.height !== undefined) {
      const nextHeight = clampHeight(input.height)
      if (nextHeight !== current.height) {
        height = nextHeight
        changed = true
      }
    }
    if (!changed) return { ok: true, note: { ...current }, total: notes.length }
    // 只有形状变化时不动 updatedAt：拖一下卡片不该把它顶到墙的最前面。
    const shapeOnly = text === current.text && color === current.color
    const next = {
      ...current,
      text,
      color,
      span,
      height,
      updatedAt: shapeOnly ? current.updatedAt : Date.now(),
    }
    return commit((before) => ({
      ok: true,
      changed: true,
      notes: shapeOnly ? before.map((note) => (note.id === id ? next : note)) : sortNotes(before.map((note) => (note.id === id ? next : note))),
      note: { ...next },
      total: before.length,
    }))
  }

  async function remove(id) {
    await ensureLoaded()
    if (typeof id !== 'string' || id.length === 0) return { ok: false, error: 'note-not-found' }
    if (!notes.some((note) => note.id === id)) return { ok: false, error: 'note-not-found' }
    return commit((before) => ({
      ok: true,
      changed: true,
      notes: before.filter((note) => note.id !== id),
      removed: id,
      total: before.length - 1,
    }))
  }

  return {
    file,
    list,
    add,
    update,
    remove,
    lastErrorOf: () => lastError,
  }
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

function sendJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(payload)
}

function readJsonBody(req) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = []
    let size = 0
    let tooLarge = false
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        tooLarge = true
        chunks.length = 0
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (tooLarge) {
        rejectBody(new Error('request-body-too-large'))
        return
      }
      try {
        const text = Buffer.concat(chunks).toString('utf8')
        resolveBody(text ? JSON.parse(text) : {})
      } catch (error) {
        rejectBody(error)
      }
    })
    req.on('error', rejectBody)
  })
}

function registerRoutes(sub, store) {
  const prefix = '/dsh-note-wall/api'

  sub.webServer.register({
    kind: 'exact',
    path: `${prefix}/notes`,
    handler: async (req, res) => {
      try {
        if (req.method === 'GET') {
          const url = new URL(req.url || '/', 'http://dsh.local')
          return sendJson(res, 200, await store.list(url.searchParams.get('q') || ''))
        }
        if (req.method === 'POST') {
          const body = await readJsonBody(req)
          const result = await store.add(body)
          return sendJson(res, result.ok ? 200 : 400, result)
        }
        return sendJson(res, 405, { ok: false, error: 'method-not-allowed' })
      } catch (error) {
        return sendJson(res, 500, { ok: false, error: String((error && error.message) || error) })
      }
    },
  })

  sub.webServer.register({
    kind: 'exact',
    path: `${prefix}/notes/update`,
    handler: async (req, res) => {
      if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method-not-allowed' })
      try {
        const result = await store.update(await readJsonBody(req))
        return sendJson(res, result.ok ? 200 : 400, result)
      } catch (error) {
        return sendJson(res, 500, { ok: false, error: String((error && error.message) || error) })
      }
    },
  })

  sub.webServer.register({
    kind: 'exact',
    path: `${prefix}/notes/delete`,
    handler: async (req, res) => {
      if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method-not-allowed' })
      try {
        const body = await readJsonBody(req)
        const result = await store.remove(body && body.id)
        return sendJson(res, result.ok ? 200 : 400, result)
      } catch (error) {
        return sendJson(res, 500, { ok: false, error: String((error && error.message) || error) })
      }
    },
  })
}

// ---------------------------------------------------------------------------
// Agent tool
// ---------------------------------------------------------------------------

const NOTE_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'Note id.' },
    text: { type: 'string', description: 'Note text; line breaks are kept.' },
    color: { type: 'string', enum: NOTE_COLORS, description: 'Card color.' },
    createdAt: { type: 'integer', description: 'Creation time in epoch milliseconds.' },
    updatedAt: { type: 'integer', description: 'Last change in epoch milliseconds.' },
    span: { type: 'integer', description: 'Card width in grid columns (1-4).' },
    height: { type: 'integer', description: 'Card height in px; 0 = the default card height.' },
  },
  required: ['id', 'text', 'color', 'createdAt', 'updatedAt', 'span', 'height'],
  additionalProperties: false,
}

const TOOL_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    action: { type: 'string' },
    error: { type: 'string' },
    total: { type: 'integer' },
    note: NOTE_SCHEMA,
    notes: { type: 'array', items: NOTE_SCHEMA },
  },
  required: ['ok', 'action'],
  additionalProperties: false,
}

function renderToolValue(args, value) {
  if (!value.ok) {
    return [{ type: 'text', text: `note_wall ${value.action} failed: ${value.error || 'unknown error'}` }]
  }
  if (value.action === 'list') {
    if (!value.notes || value.notes.length === 0) return [{ type: 'text', text: 'The note wall is empty.' }]
    const lines = value.notes.map((note) => `- [${note.color}] ${note.id} — ${note.text.replace(/\n/g, ' / ')}`)
    return [{ type: 'text', text: `${value.notes.length} note(s) on the wall:\n${lines.join('\n')}` }]
  }
  if (value.action === 'delete') {
    return [{ type: 'text', text: `Deleted a note. ${value.total ?? 0} note(s) remain.` }]
  }
  const note = value.note
  if (!note) return [{ type: 'text', text: `note_wall ${value.action} succeeded.` }]
  return [{
    type: 'text',
    text: `note_wall ${value.action} ok — ${note.id} [${note.color}]: ${note.text.replace(/\n/g, ' / ')}`,
  }]
}

function registerTool(sub, store) {
  sub.tools.register({
    name: 'note_wall',
    description: 'Read and write the user\'s note wall (便签墙), the sticky-note board in the sidebar where the user captures ideas. Use `list` to read notes (optionally filtered by `query`), `add` to put a new note on the wall, `update` to change the text or color of an existing note, and `delete` to remove one. Notes are shared with the user\'s UI immediately.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'add', 'update', 'delete'],
          description: 'Operation to perform.',
        },
        id: { type: 'string', description: 'Target note id; required for update and delete.' },
        text: {
          type: 'string',
          description: 'Note text (max 2000 characters). Required for add; optional for update.',
        },
        color: {
          type: 'string',
          enum: NOTE_COLORS,
          description: 'Card color; defaults to butter for a new note.',
        },
        query: { type: 'string', description: 'For list: only notes whose text contains this text.' },
        span: {
          type: 'integer',
          description: 'Card width in grid columns, 1-4; defaults to 1. Only used by add/update.',
        },
        height: {
          type: 'integer',
          description: `Card height in px, ${MIN_HEIGHT}-${MAX_HEIGHT}; 0 means the default card height. Only used by add/update.`,
        },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: {
      schema: TOOL_OUTPUT_SCHEMA,
      render: renderToolValue,
    },
    async execute(args) {
      const action = String((args && args.action) || '')
      if (action === 'list') {
        const result = await store.list(args && args.query)
        return { ok: true, action, total: result.total, notes: result.notes }
      }
      if (action === 'add') {
        const result = await store.add({
          text: args && args.text,
          color: args && args.color,
          span: args && args.span,
          height: args && args.height,
        })
        if (!result.ok) return { ok: false, action, error: result.error, total: result.total }
        return { ok: true, action, note: result.note, total: result.total }
      }
      if (action === 'update') {
        const result = await store.update({
          id: args && args.id,
          text: args && args.text,
          color: args && args.color,
          span: args && args.span,
          height: args && args.height,
        })
        if (!result.ok) return { ok: false, action, error: result.error }
        return { ok: true, action, note: result.note, total: result.total }
      }
      if (action === 'delete') {
        const result = await store.remove(args && args.id)
        if (!result.ok) return { ok: false, action, error: result.error }
        return { ok: true, action, total: result.total }
      }
      return { ok: false, action, error: 'unknown-action' }
    },
  })
}

// ---------------------------------------------------------------------------
// Plugin entry
// ---------------------------------------------------------------------------

export function apply(ctx, config) {
  const store = createNoteStore({
    storagePath: config && config.storagePath,
    maxNotes: config && config.maxNotes,
  })

  ctx.inject(['webServer'], (sub) => {
    registerRoutes(sub, store)
    console.log('[dsh-note-wall] routes mounted at /dsh-note-wall/api')
  })

  ctx.inject(['tools'], (sub) => {
    registerTool(sub, store)
  })
}
