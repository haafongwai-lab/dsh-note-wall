/**
 * Failure-path test for the note store.
 *
 * The happy paths live in host.test.mjs. This file covers the cases that are
 * easy to get wrong and expensive to discover in production:
 *
 *  - a failed disk write must roll the in-memory wall back, so the UI never
 *    shows a note that is not actually stored;
 *  - one failed write must not poison the write chain, so the NEXT write still
 *    succeeds (this is the classic `.catch()`-on-a-shared-promise bug);
 *  - a corrupt store file must not throw on load — the wall opens empty.
 */
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const mod = await import(pathToFileURL(join(import.meta.dirname, '..', 'index.js')).href)

const assert = (cond, message) => {
  if (!cond) throw new Error('ASSERT: ' + message)
}

function mount(storagePath, maxNotes = 500) {
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
  mod.apply(ctx, { storagePath, maxNotes })
  return routes
}

function call(routes, path, method, body) {
  const route = routes.find((r) => r.path === path)
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

// --- 1. corrupt store opens empty instead of throwing -----------------------
const dirA = await mkdtemp(join(tmpdir(), 'note-wall-corrupt-'))
const corrupt = join(dirA, 'notes.json')
await writeFile(corrupt, '{ this is not json', 'utf8')
let routes = mount(corrupt)
let result = await call(routes, '/dsh-note-wall/api/notes', 'GET')
assert(result.status === 200, 'corrupt store still answers')
assert(result.body.notes.length === 0, 'corrupt store opens empty')
// ...and the wall is still writable, replacing the bad file.
result = await call(routes, '/dsh-note-wall/api/notes', 'POST', { text: 'after corrupt' })
assert(result.status === 200, 'writable after corrupt load')
const recovered = JSON.parse(await readFile(corrupt, 'utf8'))
assert(recovered.notes.length === 1, 'corrupt file replaced with a valid store')
await rm(dirA, { recursive: true, force: true })

// --- 2. a failed write rolls back memory and does not poison the chain ------
const dirB = await mkdtemp(join(tmpdir(), 'note-wall-fail-'))
const target = join(dirB, 'nested', 'notes.json')
routes = mount(target)

result = await call(routes, '/dsh-note-wall/api/notes', 'POST', { text: 'good one' })
assert(result.status === 200, 'first write succeeds')
const goodId = result.body.note.id

// Make the directory a FILE so mkdir/rename fails on the next write.
await rm(join(dirB, 'nested'), { recursive: true, force: true })
await writeFile(join(dirB, 'nested'), 'not a directory', 'utf8')

result = await call(routes, '/dsh-note-wall/api/notes', 'POST', { text: 'should fail' })
assert(result.status === 500 || result.status === 400, 'failed write is reported')
assert(!result.body.ok, 'failed write is not ok')

result = await call(routes, '/dsh-note-wall/api/notes', 'GET')
assert(result.body.notes.length === 1, 'failed write rolled back in memory')
assert(result.body.notes[0].id === goodId, 'the surviving note is the first one')

// Clear the obstruction: the NEXT write must succeed (chain not poisoned).
await rm(join(dirB, 'nested'), { force: true })
await mkdir(join(dirB, 'nested'), { recursive: true })
result = await call(routes, '/dsh-note-wall/api/notes', 'POST', { text: 'recovered' })
assert(result.status === 200 && result.body.ok, 'write chain survives a failure')
assert(result.body.total === 2, 'both notes present after recovery')

const persisted = JSON.parse(await readFile(target, 'utf8'))
assert(persisted.notes.length === 2, 'disk agrees with memory after recovery')
await rm(dirB, { recursive: true, force: true })

console.log('OK — host half: corrupt store, write rollback, and write-chain recovery')
