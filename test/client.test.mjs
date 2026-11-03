/**
 * Client-half registration test.
 *
 * The Client module is a browser artifact: it calls
 * `window.__ModuleLoader__.load({ id, factory })` at top level and expects
 * `react` from the module table. This harness supplies both and asserts the
 * facts the live slot inspection cannot show on its own — the exact module id,
 * the locale namespace and both dictionaries, the two slot registrations with
 * their ids/labels/keys, and that the exported components are functions.
 *
 * Rendering itself is verified in the running page; this test does not emulate
 * React or the DOM.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const source = await readFile(join(import.meta.dirname, '..', 'client.js'), 'utf8')

let loaded
globalThis.window = {
  __ModuleLoader__: {
    load(entry) {
      loaded = entry
    },
  },
}

// The artifact is not an ES module; evaluate it as a classic script body.
new Function('require', 'window', source)((name) => {
  if (name === 'react') return { createElement: () => null, useState: () => [undefined, () => {}], useEffect: () => {}, useRef: () => ({ current: null }), useCallback: (fn) => fn }
  throw new Error('unexpected require: ' + name)
}, globalThis.window)

const assert = (cond, message) => {
  if (!cond) throw new Error('ASSERT: ' + message)
}

assert(loaded && loaded.id === 'dsh-note-wall', 'module id equals the package name')

const plugin = loaded.factory((name) => {
  if (name === 'react') return { createElement: () => null, useState: () => [undefined, () => {}], useEffect: () => {}, useRef: () => ({ current: null }), useCallback: (fn) => fn }
  throw new Error('unexpected require: ' + name)
})
assert(plugin && typeof plugin.apply === 'function', 'plugin exports apply')
assert(plugin.name === 'dsh-note-wall', 'plugin name')
assert(Array.isArray(plugin.inject) && plugin.inject.includes('slots'), 'declares the slots dependency')

// --- capture registrations --------------------------------------------------
const injections = []
const dicts = []
const effects = []
const styleElements = []
let themeListener

const ctx = {
  get(name) {
    if (name === 'locale') {
      return {
        getLocale: () => ({ active: 'zh' }),
        register(ns, dictionaries) {
          dicts.push({ ns, dictionaries })
          return () => {}
        },
        bind: () => (key) => key,
        subscribe: () => () => {},
      }
    }
    if (name === 'theme') return { getTheme: () => ({ active: { colorScheme: 'light' } }) }
    return undefined
  },
  on(event, listener) {
    if (event === 'theme/change') themeListener = listener
    return () => {}
  },
  effect(fn) {
    const dispose = fn()
    effects.push(dispose)
    return dispose
  },
  slots: {
    inject(key, callback) {
      injections.push({ key, callback })
      return () => {}
    },
    register(options, component) {
      return { options, component }
    },
  },
}

globalThis.document = {
  createElement: () => ({ dataset: {}, textContent: '', remove() {} }),
  head: {
    append(node) {
      styleElements.push(node)
    },
  },
}

plugin.apply(ctx)

// --- locale -----------------------------------------------------------------
assert(dicts.length === 1, 'one locale registration')
assert(dicts[0].ns === 'dsh-note-wall', 'locale namespace')
const { zh, en } = dicts[0].dictionaries
assert(zh && en, 'both dictionaries supplied')
assert(zh.panelTitle === '便签墙', 'zh panel title')
assert(en.panelTitle === 'Note Wall', 'en panel title')
assert(zh.pageIntro === '每个灵感，都值得记下。便签自动保存。', 'zh intro matches the requested copy')
assert(zh.composerPlaceholder === '写下你的下一个灵感…', 'zh composer placeholder')
assert(zh.add === '添加到墙上', 'zh add label')
assert(zh.searchPlaceholder === '搜索便签', 'zh search placeholder')
assert(zh.countLabel.includes('{n}') && en.countLabel.includes('{n}'), 'count label is interpolated')
for (const key of Object.keys(zh)) {
  assert(typeof en[key] === 'string', `en dictionary covers "${key}"`)
}
for (const key of Object.keys(en)) {
  assert(typeof zh[key] === 'string', `zh dictionary covers "${key}"`)
}

// --- styles -----------------------------------------------------------------
assert(styleElements.length === 1, 'one stylesheet installed')
const css = styleElements[0].textContent
assert(css.includes('.nw-page'), 'page styles')
assert(css.includes('.nw-composer'), 'composer styles')
assert(css.includes('.nw-note'), 'note styles')
assert(css.includes('[data-scheme=dark]'), 'dark scheme overrides')
assert(css.includes('prefers-reduced-motion'), 'reduced-motion guard')
for (const color of ['butter', 'rose', 'sky', 'mint', 'lilac', 'cream']) {
  assert(css.includes(`--nw-card-${color}`), `palette entry ${color}`)
}

// The primary pill button is black in BOTH schemes.
// It used to be a warm dark brown in light mode and a pale cream in dark mode;
// the pale one vanished against the pastel notes.
const lightAccent = /--nw-accent-fill:(#[0-9a-f]{3,8})/i.exec(css)
assert(lightAccent, 'the light-mode accent fill is declared')
assert(/^#1c1c1c$/i.test(lightAccent[1]), `the light-mode pill is black (got ${lightAccent[1]})`)
const darkAccent = /\[data-scheme=dark\][^`]*?--nw-accent-fill:(#[0-9a-f]{3,8})/i.exec(css)
assert(darkAccent, 'the dark-mode accent fill is declared')
assert(/^#000000$/i.test(darkAccent[1]), `the dark-mode pill is black (got ${darkAccent[1]})`)
const accentInks = [...css.matchAll(/--nw-accent-ink:(#[0-9a-f]{3,8})/gi)].map((m) => m[1])
assert(accentInks.length === 2, `both schemes declare the accent ink (got ${accentInks.length})`)
assert(accentInks.every((ink) => /^#ffffff$/i.test(ink)),
  `the pill label is white in both schemes (got ${accentInks.join(',')})`)

// --- grid: 3 columns by default, 4 columns at >=1120px ----------------------
const baseGrid = /\.nw-grid\{[^}]*grid-template-columns:repeat\((\d+),minmax\(0,1fr\)\)/.exec(css)
assert(baseGrid, 'grid declares an explicit column count (not auto-fill)')
assert(baseGrid[1] === '3', 'narrow window is 3 columns = 6 slots')
assert(!/\.nw-grid\{[^}]*auto-fill/.test(css), 'grid no longer relies on auto-fill')

const wideBlock = /@media \(min-width:1120px\)\{([\s\S]*?)\n\}/.exec(css)
assert(wideBlock, 'a min-width:1120px breakpoint widens the grid')
const wideRules = wideBlock[1]
assert(/grid-template-columns:repeat\(4,/.test(wideRules), 'wide window is 4 columns = 8 slots')
// 4 columns inside a 960px column would be narrower per card than 3 columns;
// the same breakpoint must also widen the content column.
assert(/\.nw-page>\*:not\(\.nw-scrim\):not\(\.nw-toast\)\{max-width:1120px\}/.test(wideRules),
  'wide breakpoint also widens the content column (still excluding scrim/toast)')
// The slot counter reads the same breakpoint the CSS uses, so the two cannot drift.
const clientSource = await readFile(join(import.meta.dirname, '..', 'client.js'), 'utf8')
assert(clientSource.includes("'(min-width:1120px)'"), 'the viewport hook reads the same 1120px breakpoint')

// --- cards must be equal height AND never grow with their content -----------
// 用户报的 bug：卡片会随内容变成正方形。根因是行高由最高那张卡的内容决定，
// 7 行正文在 3 列宽卡上正好把行高顶到接近卡宽 -> 整行看起来是正方形。
// 解法是把行高钉死，让内容永远决定不了卡片高度。
assert(/\.nw-grid\{[^}]*align-items:stretch/.test(css), 'grid stretches rows (not align-items:start)')
assert(!/\.nw-grid\{[^}]*align-items:start/.test(css), 'align-items:start makes cards uneven')
const fixedRow = /\.nw-grid\{[^}]*grid-auto-rows:(\d+)px/.exec(css)
assert(fixedRow, 'grid declares a fixed row height, so content cannot size the row')
const rowPx = Number(fixedRow[1])
assert(rowPx > 0 && rowPx < 260, `row height stays card-shaped, not square (got ${rowPx}px)`)
assert(/\.nw-note\{[^}]*height:100%/.test(css), 'card fills the fixed row')
assert(/\.nw-note\{[^}]*min-height:0/.test(css), 'card drops min-height so the row height wins')
assert(/\.nw-note\.ghost\{[^}]*height:100%/.test(css), 'ghost card matches the row height')
assert(/\.nw-note-foot\{[^}]*height:22px/.test(css), 'card footer has a fixed height')
assert(/\.nw-note-foot\{[^}]*flex:none/.test(css), 'card footer must not grow')
assert(clientSource.includes('wide ? 8 : 6'), 'slot count is 8 wide and 6 narrow')

// Cards clamp their text; the full note is read in the dialog instead.
const clamp = /\.nw-note-text\{[^}]*-webkit-line-clamp:(\d+)/.exec(css)
assert(clamp, 'card text is line-clamped')
assert(Number(clamp[1]) >= 3 && Number(clamp[1]) <= 6, `clamp fits the fixed row height (got ${clamp[1]} lines)`)
assert(/\.nw-note-text\{[^}]*overflow:hidden/.test(css), 'card clips the overflow')
assert(!/\.nw-note-text\{[^}]*overflow:visible/.test(css), 'card must not spill its text')

// --- the drag-to-resize feature is gone -------------------------------------
// 用户要求「取消右下角拖拽拉伸」，改为点开看全文。这些残留会重新引入拖拽手势。
assert(!/nw-note-grip/.test(css), 'no resize grip in the stylesheet')
assert(!/nw-note-grip/.test(clientSource), 'no resize grip in the markup')
assert(!/beginResize|onGripKeyDown|saveShape|resetShape/.test(clientSource), 'no resize handlers remain')
assert(!/resizing/.test(clientSource), 'no resize state remains')
assert(!/--nw-span/.test(css), 'no column-span rule remains')

// --- click a card to read the whole note ------------------------------------
assert(/\.nw-scrim\{[^}]*position:fixed/.test(css), 'reader uses a fixed scrim')
assert(/\.nw-scrim\{[^}]*top:var\(--dsh-frame-top-clearance/.test(css),
  'scrim starts below the window frame so it never dims the traffic lights')
assert(/\.nw-scrim\{[^}]*width:auto/.test(css) && /\.nw-scrim\{[^}]*max-width:none/.test(css),
  'scrim escapes the content-column width rule')
assert(/\.nw-page>\*:not\(\.nw-scrim\):not\(\.nw-toast\)/.test(css),
  'the content-column rule excludes the scrim and toast')
assert(/\.nw-dialog-body\{[^}]*overflow:auto/.test(css), 'dialog body scrolls instead of overflowing')
assert(/\.nw-dialog-body\{[^}]*min-height:0/.test(css), 'dialog body may shrink so the footer stays visible')
assert(/\.nw-dialog-text\{[^}]*white-space:pre-wrap/.test(css), 'dialog keeps the note line breaks')
assert(/\.nw-dialog-text\{[^}]*overflow-wrap:anywhere/.test(css), 'long words cannot break the dialog')

// Opening is wired for pointer AND keyboard, and Esc closes.
assert(/role: 'button'/.test(clientSource), 'card is exposed as a button')
assert(/tabIndex: 0/.test(clientSource), 'card is reachable by Tab')
assert(/event\.key !== 'Enter' && event\.key !== ' '/.test(clientSource), 'Enter and Space open the note')
assert(/event\.target === event\.currentTarget/.test(clientSource),
  'clicking the scrim closes, but dragging a text selection must not')
assert(/event\.key !== 'Escape'/.test(clientSource), 'Escape closes the reader')
assert(/addEventListener\('keydown', onKeyDown, true\)/.test(clientSource),
  'Escape is captured before the host sees it')
assert(/event\.stopPropagation\(\)/.test(clientSource), 'Escape does not also reach the host')

// --- note typography is prominent ------------------------------------------
const noteText = /\.nw-note-text\{[^}]*font-size:([\d.]+)px/.exec(css)
assert(noteText, 'note text declares a font size')
assert(Number(noteText[1]) >= 15, `note text is at least 15px (got ${noteText[1]}px)`)
assert(/\.nw-note-text\{[^}]*font-weight:500/.test(css), 'note text carries weight, not just size')

// --- landing animation ------------------------------------------------------
assert(/@keyframes nw-note-land\{/.test(css), 'landing keyframes exist')
assert(/@keyframes nw-note-sheen\{/.test(css), 'sheen keyframes exist')
assert(/\.nw-note-enter\{animation:nw-note-land/.test(css), 'enter class runs the landing animation')
assert(/\.nw-note-enter\{[^}]*backwards/.test(css), 'fill is backwards so hover styling resumes after it ends')
assert(/\.nw-note-enter\{[^}]*overflow:hidden/.test(css), 'enter class clips the sheen to the card')
const reducedMotion = /@media \(prefers-reduced-motion:reduce\)\{(.*)\}\s*$/m.exec(css)
assert(reducedMotion, 'a reduced-motion block exists')
assert(/\.nw-note-enter\{animation:none\}/.test(reducedMotion[1]), 'reduced motion disables the landing animation')
assert(/\.nw-note-enter::after\{display:none\}/.test(reducedMotion[1]), 'reduced motion drops the sheen')

// The landing animation is deliberately unhurried.
const landDuration = /\.nw-note-enter\{animation:nw-note-land ([\d.]+)s/.exec(css)
assert(landDuration, 'landing duration is declared')
assert(Number(landDuration[1]) >= 1, `landing animation is at least 1s (got ${landDuration[1]}s)`)
const sheenDuration = /\.nw-note-enter::after\{[^}]*animation:nw-note-sheen ([\d.]+)s[^;]*?([\d.]+)s/.exec(css)
assert(sheenDuration, 'sheen duration and delay are declared')

// The JS cleanup timer must outlast BOTH animations, or the class is stripped
// mid-flight and the card snaps. Compare the constants against the CSS values.
const num = (source, name) => {
  const match = new RegExp(`const ${name} = (\\d+)`).exec(source)
  return match ? Number(match[1]) : undefined
}
const landMs = num(clientSource, 'LAND_MS')
const sheenMs = num(clientSource, 'SHEEN_MS')
const sheenDelayMs = num(clientSource, 'SHEEN_DELAY_MS')
assert(landMs === Number(landDuration[1]) * 1000, `LAND_MS (${landMs}) matches the CSS landing duration`)
assert(sheenMs === Number(sheenDuration[1]) * 1000, `SHEEN_MS (${sheenMs}) matches the CSS sheen duration`)
assert(sheenDelayMs === Number(sheenDuration[2]) * 1000, `SHEEN_DELAY_MS (${sheenDelayMs}) matches the CSS sheen delay`)
assert(/const LANDING_MS = Math\.max\(LAND_MS, SHEEN_MS \+ SHEEN_DELAY_MS\) \+ 150/.test(clientSource),
  'LANDING_MS is derived from the animation constants, not a magic number')
assert(/setTimeout\([\s\S]{0,400}?\}, LANDING_MS\)/.test(clientSource), 'the cleanup timer uses LANDING_MS')

// --- continuity ------------------------------------------------------------
// A CSS timing function applies to EACH keyframe segment, so a handful of
// keyframes driven by one ease curve stalls at every stop and restarts. That
// was the reported "不连贯". The fix is a densely sampled spring driven by
// `linear`, where the easing lives in the samples themselves.
assert(/\.nw-note-enter\{animation:nw-note-land [\d.]+s linear/.test(css),
  'landing uses linear timing (the curve is baked into the keyframes)')
assert(/\.nw-note-enter::after\{[^}]*animation:nw-note-sheen [\d.]+s linear/.test(css),
  'sheen uses linear timing too, so no second easing stacks on top')

const landBlock = /@keyframes nw-note-land\{([\s\S]*?)\n\}/.exec(css)
assert(landBlock, 'landing keyframes parse')
const stops = [...landBlock[1].matchAll(/([\d.]+)%\{[^}]*?translateY\((-?[\d.]+)(?:px)?\)/g)]
  .map((m) => ({ at: Number(m[1]), y: Number(m[2]) }))
assert(stops.length >= 15, `landing is densely sampled (got ${stops.length} stops)`)
assert(stops[stops.length - 1].at === 100, 'the trace ends on a 100% stop')

// The trace must start above the wall, overshoot below it, and come to rest
// at exactly 0 — otherwise the card snaps on the final frame.
assert(stops[0].y < -10, `starts above the wall (got ${stops[0].y}px)`)
assert(stops.some((s) => s.y > 0.5), 'overshoots below rest before settling')
assert(stops[stops.length - 1].y === 0, `ends exactly at rest (got ${stops[stops.length - 1].y}px)`)

// Continuity: no stop may reverse direction with a large step, and the
// per-stop travel must decay smoothly rather than restart each segment.
const deltas = stops.slice(1).map((s, i) => Math.abs(s.y - stops[i].y))
const biggestJump = Math.max(...deltas)
assert(biggestJump < 8, `no discontinuous jump between stops (max ${biggestJump.toFixed(2)}px)`)
// Monotone decay of the tail: the last third must move less than the middle.
const third = Math.floor(deltas.length / 3)
const earlyTravel = deltas.slice(0, third).reduce((a, b) => a + b, 0)
const lateTravel = deltas.slice(-third).reduce((a, b) => a + b, 0)
assert(lateTravel < earlyTravel / 4, 'the tail settles rather than restarting')

// --- theme ------------------------------------------------------------------
assert(typeof themeListener === 'function', 'theme listener registered through ctx.on')

// --- slots ------------------------------------------------------------------
assert(injections.length === 2, 'two slot injections')
const sidebar = injections.find((entry) => entry.key === 'sidebar.panellist')
const main = injections.find((entry) => entry.key === 'main')
assert(sidebar, 'sidebar.panellist injected')
assert(main, 'main injected')

const iconEntry = sidebar.callback()
assert(iconEntry.options.name === 'sidebar.panellist', 'sidebar slot name')
assert(iconEntry.options.id === 'note-wall', 'sidebar id')
assert(typeof iconEntry.options.label === 'function', 'sidebar label is a thunk (follows locale)')
assert(iconEntry.options.label() === '便签墙', 'sidebar label resolves the active locale')
assert(typeof iconEntry.component === 'function', 'sidebar icon is a component')

const pageEntry = main.callback()
assert(pageEntry.options.name === 'main', 'main slot name')
assert(pageEntry.options.key === 'note-wall', 'main key equals the sidebar id, so the icon opens the page')
assert(typeof pageEntry.component === 'function', 'wall page is a component')

// --- disposal ---------------------------------------------------------------
for (const dispose of effects) if (typeof dispose === 'function') dispose()

console.log('OK — client half: module id, locales, styles, theme, and both slots register correctly')
