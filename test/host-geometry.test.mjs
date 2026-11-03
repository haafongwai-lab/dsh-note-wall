/**
 * Card geometry: span (grid columns) and height (px).
 *
 * Two behaviours are easy to get wrong and worth pinning:
 *
 *  - dragging a card must NOT bump `updatedAt`, otherwise the note jumps to
 *    the front of the wall every time the user nudges its size;
 *  - both fields are clamped on every path (read, add, update), so a hostile
 *    or buggy client cannot store a card that breaks the grid.
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const mod = await import(pathToFileURL(join(import.meta.dirname, '..', 'index.js')).href)

const assert = (cond, message) => {
  if (!cond) throw new Error('ASSERT: ' + message)
}

function mount(storagePath) {
  const routes = []
  const ctx = {
    inject(_names, callback) {
      callback({
        webServer: { register: (route) => routes.push(route) },
        tools: { register: () => {} },
      })
    },
    effect: (fn) => fn(),
    get: () => undefined,
  }
  mod.apply(ctx, { storagePath, maxNotes: 100 })
  return routes
}

function call(routes, path, method, body) {
  const route = routes.find((r) => r.path === path)
  if (!route) throw new Error('missing route ' + path)
  const listeners = {}
  const req = {
    method,
    url: path,
    on(event, handler) {
      listeners[event] = handler
      return req
    },
  }
  queueMicrotask(() => {
    if (body !== undefined) listeners.data?.(Buffer.from(JSON.stringify(body), 'utf8'))
    listeners.end?.()
  })
  const res = {
    status: 0,
    body: '',
    writeHead(status) {
      this.status = status
    },
    end(payload) {
      this.body = payload
    },
  }
  return Promise.resolve(route.handler(req, res)).then(() => ({
    status: res.status,
    body: res.body ? JSON.parse(res.body) : null,
  }))
}

const dir = await mkdtemp(join(tmpdir(), 'note-wall-geom-'))
const routes = mount(join(dir, 'notes.json'))
const A = (p) => '/dsh-note-wall/api' + p

// --- create with geometry ---------------------------------------------------
let r = await call(routes, A('/notes'), 'POST', { text: 'geo', color: 'mint', span: 2, height: 300 })
assert(r.status === 200, 'create succeeds')
assert(r.body.note.span === 2, `create keeps span (got ${r.body.note.span})`)
assert(r.body.note.height === 300, `create keeps height (got ${r.body.note.height})`)
const id = r.body.note.id

// --- resizing must not reorder the wall -------------------------------------
const before = r.body.note.updatedAt
await new Promise((resolve) => setTimeout(resolve, 5))
r = await call(routes, A('/notes/update'), 'POST', { id, span: 3 })
assert(r.body.note.span === 3, 'resize sets span')
assert(r.body.note.height === 300, 'resize leaves height alone')
assert(r.body.note.updatedAt === before, 'resize does not bump updatedAt')

r = await call(routes, A('/notes/update'), 'POST', { id, height: 420 })
assert(r.body.note.height === 420, 'resize sets height')
assert(r.body.note.updatedAt === before, 'height change does not bump updatedAt either')

// --- a real text edit still bumps it ----------------------------------------
r = await call(routes, A('/notes/update'), 'POST', { id, text: 'edited' })
assert(r.body.note.updatedAt !== before, 'text edit bumps updatedAt')
assert(r.body.note.span === 3 && r.body.note.height === 420, 'text edit keeps the shape')

// --- clamping ---------------------------------------------------------------
r = await call(routes, A('/notes'), 'POST', { text: 'big', span: 99, height: 5 })
assert(r.body.note.span === 4, `span clamps to 4 (got ${r.body.note.span})`)
assert(r.body.note.height === 132, `height clamps up to 132 (got ${r.body.note.height})`)
const bigId = r.body.note.id

r = await call(routes, A('/notes/update'), 'POST', { id: bigId, span: -3, height: 99999 })
assert(r.body.note.span === 1, `span clamps up to 1 (got ${r.body.note.span})`)
assert(r.body.note.height === 1200, `height clamps down to 1200 (got ${r.body.note.height})`)

// --- reset ------------------------------------------------------------------
r = await call(routes, A('/notes/update'), 'POST', { id: bigId, span: 1, height: 0 })
assert(r.body.note.span === 1, 'reset span')
assert(r.body.note.height === 0, 'reset height means "default card height"')

// --- old records gain defaults on read --------------------------------------
await call(routes, A('/notes'), 'POST', { text: 'plain' })
r = await call(routes, A('/notes'), 'GET')
assert(r.body.notes.every((n) => typeof n.span === 'number'), 'every note exposes a numeric span')
assert(r.body.notes.every((n) => typeof n.height === 'number'), 'every note exposes a numeric height')

await rm(dir, { recursive: true, force: true })
console.log('OK — host half: card geometry (span/height) persists, clamps, and survives resize')
