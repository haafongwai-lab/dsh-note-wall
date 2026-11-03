/**
 * Host-half smoke test: drive the plugin's own methods through a fake Cordis
 * context, so storage, HTTP handlers, and the agent tool are exercised without
 * a running Harness.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const dir = await mkdtemp(join(tmpdir(), 'note-wall-test-'))
const storagePath = join(dir, 'notes.json')

const mod = await import(pathToFileURL(join(import.meta.dirname, '..', 'index.js')).href)

const routes = []
const tools = []
const effects = []
const ctx = {
  inject(names, callback) {
    const sub = {
      webServer: {
        register(route) {
          routes.push(route)
        },
      },
      tools: {
        register(definition) {
          tools.push(definition)
        },
      },
    }
    callback(sub)
  },
  effect(fn) {
    const dispose = fn()
    effects.push(dispose)
    return dispose
  },
  get() {
    return undefined
  },
}

mod.apply(ctx, { storagePath, maxNotes: 3 })

const assert = (cond, message) => {
  if (!cond) throw new Error('ASSERT: ' + message)
}

function findRoute(path) {
  const route = routes.find((r) => r.path === path)
  if (!route) throw new Error('missing route ' + path + ' (have ' + routes.map((r) => r.path).join(', ') + ')')
  return route
}

function makeRes() {
  return {
    status: 0,
    body: '',
    writeHead(status) {
      this.status = status
    },
    end(payload) {
      this.body = payload
    },
  }
}

function makeReq(method, body, url = '/') {
  const listeners = {}
  const req = {
    method,
    url,
    on(event, handler) {
      listeners[event] = handler
      return req
    },
  }
  queueMicrotask(() => {
    if (body !== undefined) listeners.data?.(Buffer.from(JSON.stringify(body), 'utf8'))
    listeners.end?.()
  })
  return req
}

async function call(path, method, body, url) {
  const res = makeRes()
  await findRoute(path).handler(makeReq(method, body, url), res)
  return { status: res.status, body: res.body ? JSON.parse(res.body) : null }
}

// --- empty wall -------------------------------------------------------------
let result = await call('/dsh-note-wall/api/notes', 'GET')
assert(result.status === 200, 'list 200')
assert(result.body.notes.length === 0, 'empty wall')
assert(result.body.total === 0, 'empty total')

// --- add --------------------------------------------------------------------
result = await call('/dsh-note-wall/api/notes', 'POST', { text: '第一个灵感', color: 'rose' })
assert(result.status === 200, 'add 200')
assert(result.body.note.text === '第一个灵感', 'add text')
assert(result.body.note.color === 'rose', 'add color')
const first = result.body.note.id
assert(typeof first === 'string' && first.length > 0, 'add id')

result = await call('/dsh-note-wall/api/notes', 'POST', { text: '   ' })
assert(result.status === 400 && result.body.error === 'empty-text', 'reject empty')

result = await call('/dsh-note-wall/api/notes', 'POST', { text: 'second', color: 'bogus' })
assert(result.body.note.color === 'butter', 'unknown color falls back')
const second = result.body.note.id

// --- persisted to disk ------------------------------------------------------
const onDisk = JSON.parse(await readFile(storagePath, 'utf8'))
assert(onDisk.notes.length === 2, 'persisted 2 notes')
assert(onDisk.version === 1, 'store version')

// --- update -----------------------------------------------------------------
result = await call('/dsh-note-wall/api/notes/update', 'POST', { id: first, text: '改过的灵感' })
assert(result.status === 200, 'update 200')
assert(result.body.note.text === '改过的灵感', 'update text')

result = await call('/dsh-note-wall/api/notes/update', 'POST', { id: first, color: 'sky' })
assert(result.body.note.color === 'sky', 'update color')

result = await call('/dsh-note-wall/api/notes/update', 'POST', { id: 'nope', text: 'x' })
assert(result.status === 400 && result.body.error === 'note-not-found', 'update missing')

result = await call('/dsh-note-wall/api/notes/update', 'POST', { id: first, color: 'neon' })
assert(result.status === 400 && result.body.error === 'unknown-color', 'update bad color')

// --- list order (newest updated first) --------------------------------------
result = await call('/dsh-note-wall/api/notes', 'GET')
assert(result.body.notes[0].id === first, 'updated note first')

// --- search -----------------------------------------------------------------
result = await call('/dsh-note-wall/api/notes', 'GET', undefined, '/dsh-note-wall/api/notes?q=改过')
assert(result.body.notes.length === 1 && result.body.notes[0].id === first, 'search filter')
assert(result.body.total === 2, 'search keeps total')

// --- delete -----------------------------------------------------------------
result = await call('/dsh-note-wall/api/notes/delete', 'POST', { id: second })
assert(result.status === 200 && result.body.total === 1, 'delete')
result = await call('/dsh-note-wall/api/notes/delete', 'POST', { id: second })
assert(result.status === 400, 'delete twice')

// --- wall full --------------------------------------------------------------
await call('/dsh-note-wall/api/notes', 'POST', { text: 'a' })
await call('/dsh-note-wall/api/notes', 'POST', { text: 'b' })
result = await call('/dsh-note-wall/api/notes', 'POST', { text: 'c' })
assert(result.status === 400 && result.body.error === 'wall-full', 'maxNotes enforced')

// --- method guards ----------------------------------------------------------
result = await call('/dsh-note-wall/api/notes', 'DELETE')
assert(result.status === 405, 'method guard')

// --- agent tool -------------------------------------------------------------
assert(tools.length === 1, 'one tool registered')
const tool = tools[0]
assert(tool.name === 'note_wall', 'tool name')

let value = await tool.execute({ action: 'list' })
assert(value.ok === true && Array.isArray(value.notes), 'tool list')
const rendered = tool.output.render({ action: 'list' }, value)
assert(rendered[0].type === 'text' && rendered[0].text.includes('note(s)'), 'tool list render')

value = await tool.execute({ action: 'add', text: 'agent note', color: 'mint' })
assert(value.ok === false && value.error === 'wall-full', 'tool add full')

// make room, then add through the tool
await call('/dsh-note-wall/api/notes/delete', 'POST', { id: value.notes ? value.notes[0].id : '' })
const listing = await call('/dsh-note-wall/api/notes', 'GET')
await call('/dsh-note-wall/api/notes/delete', 'POST', { id: listing.body.notes[0].id })
value = await tool.execute({ action: 'add', text: 'agent note', color: 'mint' })
assert(value.ok === true && value.note.text === 'agent note', 'tool add')
const agentId = value.note.id

value = await tool.execute({ action: 'update', id: agentId, text: 'agent note v2' })
assert(value.ok === true && value.note.text === 'agent note v2', 'tool update')

value = await tool.execute({ action: 'delete', id: agentId })
assert(value.ok === true, 'tool delete')

value = await tool.execute({ action: 'bogus' })
assert(value.ok === false && value.error === 'unknown-action', 'tool unknown action')

value = await tool.execute({ action: 'list', query: 'zzz' })
assert(value.ok === true && value.notes.length === 0, 'tool empty query')

// --- dispose -----------------------------------------------------------------
for (const dispose of effects) if (typeof dispose === 'function') dispose()
await rm(dir, { recursive: true, force: true })

console.log('OK — host half: storage, routes, and note_wall tool all behave')
