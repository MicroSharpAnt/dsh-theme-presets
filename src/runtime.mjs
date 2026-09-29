/**
 * dsh-theme-presets — browser-half source.
 *
 * `build-client.mjs` inlines this function's source into `lib/client.js`, so it
 * must stay completely self-contained: no imports, no references to module-level
 * bindings, and every dependency arrives as a parameter. That constraint is why
 * the palette data, React, and `require` are all passed in rather than imported.
 *
 * How the preset reaches the pixels, in three layers:
 *   1. Before this bundle loads, the host half has already keyed a palette off
 *      `body[data-dsh-theme-preset]`, so the first paint is correct.
 *   2. On adoption, this half drops that attribute and stacks the same palette
 *      as ui-theme alias-token overrides — ui-layout's presenter writes them as
 *      inline custom properties, which outrank every stylesheet rule.
 *   3. Switching a preset only replaces that override layer, so no reload and no
 *      re-registration is involved.
 *
 * @param {Function} require - the module loader handed to the bundle factory.
 * @param {object} React - the platform React instance.
 * @param {object} data - generated preset data (see build-client.mjs).
 * @returns {{ apply: Function, inject: string[] }} the cordis plugin halves.
 */
export function install(require, React, data) {
  const { defaultId, tokens, values, meta, namespace, attribute } = data

  const h = React.createElement
  const LOCALE_NS = 'settings.theme-presets'
  const OVERRIDE_SOURCE = 'theme-presets'

  const zh = {
    'presets.title': '主题预设',
    'presets.note': '预设决定配色，上一行决定明暗',
    'presets.default': '默认',
  }
  const en = {
    'presets.title': 'Theme preset',
    'presets.note': 'Pick the palette here; the row above picks light or dark',
    'presets.default': 'Default',
  }

  const CSS = `
.dshtp-group{display:flex;flex-direction:column;gap:8px;padding:16px 0;border-bottom:0.5px solid var(--dsw-alias-border-l2)}
.dshtp-head{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
.dshtp-title{font-size:14px;font-weight:400;line-height:22px;color:var(--dsw-alias-label-primary)}
.dshtp-note{font-size:12px;line-height:18px;color:var(--dsw-alias-label-caption)}
.dshtp-row{display:flex;align-items:stretch;gap:8px;flex-wrap:wrap}
.dshtp-item{box-sizing:border-box;flex:1 1 84px;min-width:84px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:10px 8px;border:0.5px solid var(--dsw-alias-border-l4);border-radius:14px;background:transparent;font:inherit;color:var(--dsw-alias-label-primary);cursor:pointer;transition:background-color var(--ds-transition-duration-fast) var(--ds-ease-in-out),border-color var(--ds-transition-duration-fast) var(--ds-ease-in-out)}
.dshtp-item:hover:not(.dshtp-selected){background:var(--dsw-alias-interactive-bg-hover)}
.dshtp-item:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.dshtp-selected{background:var(--dsw-alias-bg-module-platform);border-color:var(--dsw-static-neutral-bluish-400)}
.dshtp-swatches{display:flex;gap:3px}
.dshtp-swatch{width:14px;height:14px;border-radius:4px;border:0.5px solid var(--dsw-alias-border-l2);box-sizing:border-box}
.dshtp-swatch-default{background:linear-gradient(135deg,var(--dsw-alias-bg-base) 0 50%,var(--dsw-alias-label-secondary) 50% 100%)}
.dshtp-name{font-size:11px;line-height:16px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary)}
`.trim()

  const inject = ['theme', 'slots', 'locale', 'configForms', 'remote']

  /**
   * Render the preset picker.
   * @param {object} props - slot props plus this row's injected face.
   * @returns {object} the row element tree.
   */
  function Row(props) {
    const { t, readPreset, subscribePreset, readScheme, subscribeScheme, select, readSelectable } = props
    const current = React.useSyncExternalStore(subscribePreset, readPreset)
    const scheme = React.useSyncExternalStore(subscribeScheme, readScheme)

    // A bundle can be newer than the running host: the id list reaches the
    // host's `Config` through a static import, so a preset added to
    // `presets.mjs` enters the schema only after a restart, while HMR delivers
    // the new bundle on a plain refresh. Offering such a preset would look
    // selectable and then quietly collapse to the fallback, overwriting the
    // palette already stored — so only render what the host vouches for.
    const selectable = readSelectable === undefined ? undefined : readSelectable()
    const items = [{ id: defaultId, name: t('presets.default'), hint: undefined, preview: undefined }]
    for (const entry of meta) {
      if (selectable !== undefined && !selectable.has(entry.id)) continue
      items.push(entry)
    }

    return h('div', { className: 'dshtp-group' },
      h('div', { className: 'dshtp-head' },
        h('span', { className: 'dshtp-title' }, t('presets.title')),
        h('span', { className: 'dshtp-note' }, t('presets.note')),
      ),
      h('div', { className: 'dshtp-row' },
        items.map((item) => {
          const selected = current === item.id
          const preview = item.preview === undefined ? undefined : item.preview[scheme]
          return h('button', {
            key: item.id,
            type: 'button',
            className: selected ? 'dshtp-item dshtp-selected' : 'dshtp-item',
            'aria-pressed': selected,
            ...(item.hint === undefined ? {} : { title: item.hint }),
            onClick: () => { select(item.id) },
          },
          preview === undefined
            ? h('span', { className: 'dshtp-swatches' }, h('i', { className: 'dshtp-swatch dshtp-swatch-default' }))
            : h('span', { className: 'dshtp-swatches' },
              h('i', { className: 'dshtp-swatch', style: { background: preview[0] } }),
              h('i', { className: 'dshtp-swatch', style: { background: preview[1] } }),
              h('i', { className: 'dshtp-swatch', style: { background: preview[2] } }),
            ),
          h('span', { className: 'dshtp-name' }, item.name))
        }),
      ),
    )
  }

  /**
   * Mount the browser half.
   * @param {object} ctx - the client cordis context.
   */
  function apply(ctx) {
    const style = document.createElement('style')
    style.setAttribute('data-dsh-theme-presets', 'styles')
    style.textContent = CSS
    document.head.append(style)
    ctx.effect(() => () => { style.remove() }, 'theme-presets: styles')

    ctx.effect(() => ctx.locale.register(LOCALE_NS, { zh, en }), 'theme-presets: dictionaries')

    const scope = ctx.configForms.get(namespace)
    const presetListeners = new Set()
    const schemeListeners = new Set()

    /** Narrow the durable section to a preset this bundle can actually render. */
    const readDurablePreset = () => {
      const snapshot = scope.getSnapshot()
      const value = snapshot.value
      const candidate = value === null || value === undefined ? undefined : value.preset
      if (typeof candidate !== 'string') return defaultId
      return candidate === defaultId || values[candidate] !== undefined ? candidate : defaultId
    }

    /**
     * The preset ids the running host's schema accepts, or undefined when that
     * descriptor cannot be read.
     *
     * `host.js` reaches `PRESET_IDS` through a static import, so the schema is
     * fixed at process start: a preset added to `presets.mjs` becomes storable
     * only after a restart, while HMR ships this half the new bundle on a plain
     * refresh. Rendering an id the host does not know would look like an
     * ordinary choice and then collapse to the fallback, silently overwriting
     * the preset the user already had. Reading the union's own branches keeps
     * the picker to what the host will actually store.
     * @returns {Set<string>|undefined} accepted ids, or undefined if unreadable.
     */
    const readSelectable = () => {
      try {
        const view = ctx.configForms.describe().getSnapshot().view
        const section = view.namespaces.find((entry) => entry.ns === namespace)
        const refs = section.schema.refs
        const union = refs[refs[section.schema.uid].dict.preset]
        if (!Array.isArray(union.list)) return undefined
        const ids = union.list.map((id) => refs[id].value).filter((value) => typeof value === 'string')
        return ids.length > 0 ? new Set(ids) : undefined
      } catch (_unreadableSchema) {
        return undefined
      }
    }

    const overridesFor = (id) => {
      const entry = values[id]
      if (entry === undefined) return {}
      const result = {}
      for (let index = 0; index < tokens.length; index += 1) {
        result[tokens[index]] = { light: entry.light[index], dark: entry.dark[index] }
      }
      return result
    }

    /**
     * Replace the active preset. The host's attribute layer is dropped first so
     * a switch back to `default` is not shadowed by the boot rules; both writes
     * land in one task, so the document never paints between them.
     */
    const applyPreset = (id) => {
      document.body.removeAttribute(attribute)
      ctx.theme.overrideTokens(OVERRIDE_SOURCE, overridesFor(id))
    }

    let current = readDurablePreset()
    let scheme = ctx.theme.getTheme().active.colorScheme
    let adopted = false

    // Until the durable value resolves, leave the host's pre-paint layer alone:
    // adopting early would clear a preset and then re-apply it on arrival, which
    // is the flash this plugin exists to remove.
    const adopt = () => {
      if (scope.getSnapshot().status === 'loading') return
      const next = readDurablePreset()
      const changed = next !== current
      current = next
      if (!adopted || changed) {
        adopted = true
        applyPreset(next)
      }
      if (changed) for (const listener of presetListeners) listener()
    }

    ctx.effect(() => scope.subscribe(adopt), 'theme-presets: settings adoption')
    ctx.effect(() => ctx.on('theme/change', (snapshot) => {
      const next = snapshot.active.colorScheme
      if (next === scheme) return
      scheme = next
      for (const listener of schemeListeners) listener()
    }), 'theme-presets: scheme mirror')

    adopt()


    ctx.slots.inject('settings.general.item', () => ctx.slots.register({
      name: 'settings.general.item',
      id: 'theme-presets',
      order: 12,
      locale: LOCALE_NS,
      inject: () => ({
        readPreset: () => current,
        readSelectable,
        subscribePreset: (listener) => {
          presetListeners.add(listener)
          return () => { presetListeners.delete(listener) }
        },
        readScheme: () => scheme,
        subscribeScheme: (listener) => {
          schemeListeners.add(listener)
          return () => { schemeListeners.delete(listener) }
        },
        select: (id) => {
          if (id === current) return
          current = id
          if (document.body !== null) applyPreset(id)
          for (const listener of presetListeners) listener()
          // The form reports an unavailable or read-only write as false.
          // Restore the actual saved choice if this optimistic selection fails.
          void scope.set('preset', id).then(
            (saved) => { if (!saved && current === id) adopt() },
            () => { if (current === id) adopt() },
          )
        },
      }),
    }, Row))
  }

  return { apply, inject }
}
