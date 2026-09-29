#!/usr/bin/env node
/**
 * self-test.mjs — exercise the browser half's logic in-process, with a stub
 * cordis context and a stub DOM, before anything touches a real page.
 *
 * It covers the three behaviours that are easy to get subtly wrong and hard to
 * see in a browser: when adoption is deferred, what the override layer contains,
 * and whether the host's pre-paint attribute is actually dropped.
 *
 * Run: node self-test.mjs
 */
import { DEFAULT_PRESET_ID, PRESET_IDS, PRESETS, deriveTokens } from './presets.mjs'
import { install } from './src/runtime.mjs'
import { presetSchemaJson } from './src/schema.mjs'

const failures = []
const passed = []

/** Assert one condition. */
function check(ok, label, detail = '') {
  if (ok) passed.push(label)
  else failures.push(`${label}${detail === '' ? '' : ` — ${detail}`}`)
}

// --- stub DOM ----------------------------------------------------------------
const appendedStyles = []
const bodyAttributes = new Map()

globalThis.document = {
  createElement(tag) {
    return {
      tag,
      attributes: {},
      textContent: '',
      setAttribute(key, value) { this.attributes[key] = value },
      remove() { this.removed = true },
    }
  },
  head: { append(element) { appendedStyles.push(element) } },
  body: {
    setAttribute(key, value) { bodyAttributes.set(key, value) },
    removeAttribute(key) { bodyAttributes.delete(key) },
    hasAttribute(key) { return bodyAttributes.has(key) },
  },
}

// --- stub context ------------------------------------------------------------
const effects = []
const slotRegistrations = []
const overrideCalls = []

/** Build a context + scope pair whose status the test can drive. */
function harness({ status = 'ready', preset = DEFAULT_PRESET_ID, writable = true, servedIds } = {}) {
  const scopeState = {
    status,
    value: preset === undefined ? undefined : { preset },
  }
  const scopeListeners = new Set()
  const writes = []

  const scope = {
    getSnapshot: () => ({
      status: scopeState.status,
      value: scopeState.status === 'loading' ? undefined : scopeState.value,
      revision: 1,
      writable,
      mode: 'host',
    }),
    subscribe(listener) { scopeListeners.add(listener); return () => { scopeListeners.delete(listener) } },
    set: async (field, value) => {
      writes.push([field, value])
      if (!writable) return false
      scopeState.value = { preset: value }
      return true
    },
  }

  let scheme = 'light'
  const themeListeners = new Set()

  const ctx = {
    effect(callback) { const disposer = callback(); effects.push(disposer); return () => {} },
    locale: { register(namespace, dict) { ctx.localeRegistrations.push([namespace, dict]) }, regs: [] },
    localeRegistrations: [],
    configForms: {
      get(entryId) { ctx.boundNamespace = entryId; return scope },
      // The describe mirror the row reads its selectable ids from. `servedIds`
      // stands in for the host's schema: omit it to model a host whose
      // descriptor cannot be read, pass a list to model one that predates this
      // bundle's presets.
      describe: () => ({
        getSnapshot: () => ({
          view: servedIds === undefined ? undefined : {
            namespaces: [{
              ns: 'theme-presets',
              schema: presetSchemaJson(servedIds, DEFAULT_PRESET_ID),
              value: { preset },
            }],
          },
        }),
      }),
    },
    theme: {
      getTheme: () => ({ active: { colorScheme: scheme }, preference: scheme, tokens: {} }),
      overrideTokens(source, tokens) { overrideCalls.push({ source, tokens }); return () => {} },
    },
    on(event, callback) {
      if (event === 'theme/change') themeListeners.add(callback)
      return () => {}
    },
    slots: {
      inject(slot, factory) { slotRegistrations.push([slot, factory()]) },
      register(options, component) {
        this.lastRegistration = { options, component }
        return { options, component }
      },
    },
    // test handles
    get writes() { return writes },
    setScheme(next) { scheme = next; for (const l of themeListeners) l({ active: { colorScheme: next } }) },
    pushScope() { for (const l of scopeListeners) l() },
    patchScope(patch) { Object.assign(scopeState, patch); for (const l of scopeListeners) l() },
    boundNamespace: undefined,
  }
  return ctx
}

const tokens = Object.keys(deriveTokens(PRESETS[0].light))
const data = {
  defaultId: DEFAULT_PRESET_ID,
  namespace: 'theme-presets',
  attribute: 'data-dsh-theme-preset',
  tokens,
  values: Object.fromEntries(PRESETS.map((preset) => {
    const light = deriveTokens(preset.light)
    const dark = deriveTokens(preset.dark)
    return [preset.id, {
      light: tokens.map(name => light[name]),
      dark: tokens.map(name => dark[name]),
    }]
  })),
  meta: PRESETS.map(preset => ({
    id: preset.id,
    name: preset.name,
    hint: `${preset.lightName} / ${preset.darkName}`,
    preview: {
      light: [preset.light.base, preset.light.accent, preset.light.text],
      dark: [preset.dark.base, preset.dark.accent, preset.dark.text],
    },
  })),
}

/** Preset ids the row rendered as buttons, in render order. */
const renderedButtons = []
const fakeReact = {
  createElement(type, props, ...children) {
    if (props !== null && typeof props === 'object' && 'aria-pressed' in props) renderedButtons.push(props.key)
    return { type, props, children }
  },
  useSyncExternalStore: () => DEFAULT_PRESET_ID,
}

/** Render the most recently registered row and report which presets it offered. */
function offeredPresets() {
  renderedButtons.length = 0
  const registration = slotRegistrations.at(-1)[1]
  registration.component({ t: (key) => key, ...registration.options.inject() })
  return [...renderedButtons]
}

// --- scenario 1: durable preset already resolved ------------------------------
{
  overrideCalls.length = 0
  bodyAttributes.set('data-dsh-theme-preset', 'nord')
  const ctx = harness({ status: 'ready', preset: 'nord' })
  const plugin = install(() => ({}), fakeReact, data)
  plugin.apply(ctx)

  check(plugin.inject.includes('theme') && plugin.inject.includes('configForms'),
    'plugin declares theme and configForms')
  check(ctx.boundNamespace === 'theme-presets', 'gets the theme-presets form')

  const adopted = overrideCalls.at(-1)
  check(adopted !== undefined && adopted.source === 'theme-presets', 'stacks one override layer')
  check(Object.keys(adopted.tokens).length === data.tokens.length,
    'override layer covers every token', `${Object.keys(adopted.tokens).length}/${data.tokens.length}`)
  check(adopted.tokens['--dsw-alias-bg-base'].light === '#eceff4'
    && adopted.tokens['--dsw-alias-bg-base'].dark === '#2e3440',
    'nord base resolves per mode')
  check(!bodyAttributes.has('data-dsh-theme-preset'), 'drops the host pre-paint attribute')

  const slot = slotRegistrations.at(-1)
  check(slot[0] === 'settings.general.item', 'registers into settings.general.item')
  check(slot[1].options.id === 'theme-presets' && slot[1].options.order === 12, 'row id and order are stable')
  check(appendedStyles.length === 1 && appendedStyles[0].attributes['data-dsh-theme-presets'] === 'styles',
    'injects its own stylesheet')
}

// --- scenario 2: switching a preset ------------------------------------------
{
  overrideCalls.length = 0
  const ctx = harness({ status: 'ready', preset: DEFAULT_PRESET_ID })
  const plugin = install(() => ({}), fakeReact, data)
  plugin.apply(ctx)
  overrideCalls.length = 0

  const injected = slotRegistrations.at(-1)[1].options.inject()
  injected.select('gruvbox')

  const call = overrideCalls.at(-1)
  check(call.tokens['--dsw-alias-bg-base'].dark === '#282828', 'gruvbox dark base applied on switch')
  check(call.tokens['--dsw-alias-bg-base'].light === '#fbf1c7', 'gruvbox light base applied on switch')
  check(ctx.writes.at(-1)[0] === 'preset' && ctx.writes.at(-1)[1] === 'gruvbox',
    'persists the selection through the settings scope')
  check(injected.readPreset() === 'gruvbox', 'row reads the new selection back')
}

// --- refused write restores the saved selection -------------------------------
{
  const ctx = harness({ status: 'ready', preset: DEFAULT_PRESET_ID, writable: false })
  install(() => ({}), fakeReact, data).apply(ctx)
  const injected = slotRegistrations.at(-1)[1].options.inject()
  injected.select('nord')
  await Promise.resolve()
  await Promise.resolve()
  check(injected.readPreset() === DEFAULT_PRESET_ID,
    'a refused settings write restores the saved selection')
}

// --- scenario 3: defer while the durable value is still loading ---------------
{
  overrideCalls.length = 0
  bodyAttributes.set('data-dsh-theme-preset', 'dracula')
  const ctx = harness({ status: 'loading', preset: undefined })
  const plugin = install(() => ({}), fakeReact, data)
  plugin.apply(ctx)

  check(overrideCalls.length === 0, 'adoption deferred while the scope is loading')
  check(bodyAttributes.get('data-dsh-theme-preset') === 'dracula',
    'host pre-paint layer survives the loading window')

  ctx.patchScope({ status: 'ready', value: { preset: 'dracula' } })
  const adopted = overrideCalls.at(-1)
  check(adopted !== undefined && adopted.tokens['--dsw-alias-bg-base'].dark === '#282a36',
    'adopts dracula once the durable value resolves')
  check(!bodyAttributes.has('data-dsh-theme-preset'), 'drops the host layer only after adopting')
}

// --- scenario 4: an unknown persisted id falls back --------------------------
{
  overrideCalls.length = 0
  const ctx = harness({ status: 'ready', preset: 'not-a-preset' })
  const plugin = install(() => ({}), fakeReact, data)
  plugin.apply(ctx)
  const call = overrideCalls.at(-1)
  check(Object.keys(call.tokens).length === 0, 'unknown preset id falls back to the default palette')
  check(slotRegistrations.at(-1)[1].options.inject().readPreset() === DEFAULT_PRESET_ID,
    'row reports the default for an unknown id')
}

// --- scenario 5: a bundle newer than the running host's schema ----------------
{
  // `host.js` takes its id list from a static import, so the schema is fixed at
  // process start while a refresh can hand this half a newer bundle. Offering
  // an id the host cannot store looks like an ordinary choice and then writes
  // the fallback over the preset the user already had.
  const ctx = harness({ status: 'ready', preset: 'nord', servedIds: ['nord', 'dracula'] })
  install(() => ({}), fakeReact, data).apply(ctx)
  const offered = offeredPresets()
  check(!offered.includes('everforest'),
    'a preset the host schema does not list is not offered', offered.join(', '))
  check(offered.includes('nord') && offered.includes('dracula'),
    'presets the host does list stay offered', offered.join(', '))
  check(offered.includes(DEFAULT_PRESET_ID), 'the default entry is always offered')

  const full = harness({ status: 'ready', preset: 'nord', servedIds: PRESET_IDS })
  install(() => ({}), fakeReact, data).apply(full)
  const every = offeredPresets()
  check(every.length === PRESET_IDS.length + 1,
    'a host that knows every preset offers them all', `${every.length}/${PRESET_IDS.length + 1}`)

  const unreadable = harness({ status: 'ready', preset: 'nord' })
  install(() => ({}), fakeReact, data).apply(unreadable)
  const fallback = offeredPresets()
  check(fallback.length === PRESET_IDS.length + 1,
    'an unreadable schema falls back to offering everything', String(fallback.length))
}

// --- report ------------------------------------------------------------------
for (const line of passed) console.log(`  ok   ${line}`)
for (const line of failures) console.log(`  FAIL ${line}`)
console.log(failures.length === 0
  ? `\nPASS — ${passed.length} checks`
  : `\nFAIL — ${failures.length} of ${passed.length + failures.length} checks`)
process.exit(failures.length === 0 ? 0 : 1)
