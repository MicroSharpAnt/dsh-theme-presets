#!/usr/bin/env node
/** Cordis Config and Settings descriptor checks. */
import { strict as assert } from 'node:assert'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPresetSchema } from './src/schema.mjs'
import { DEFAULT_PRESET_ID, PRESET_IDS } from './presets.mjs'

/**
 * Resolve the vendored schemastery out of a dsh checkout.
 *
 * The client does not consume this descriptor as data: it rehydrates it with
 * the real schemastery and validates the stored section against the result, so
 * that library — not this package — decides whether a write is readable back.
 * @returns {string|undefined} module path, or undefined without a checkout.
 */
function resolveSchemastery() {
  const here = dirname(fileURLToPath(import.meta.url))
  const candidates = [
    process.env.DSH_CHECKOUT,
    join(homedir(), 'git', 'deepseek-harness'),
    join(here, '..', 'deepseek-harness'),
  ].filter(candidate => typeof candidate === 'string' && candidate !== '')
  for (const candidate of candidates) {
    const entry = join(candidate, 'vendor', 'schemastery', 'lib', 'index.mjs')
    if (existsSync(entry)) return entry
  }
  return undefined
}

// Built from the ids the Host actually passes (see host.js), never from a
// hand-written list. An earlier version of this suite supplied its own ids that
// already contained the fallback, which is precisely why a descriptor whose
// union rejected the fallback shipped unnoticed.
const schema = createPresetSchema(PRESET_IDS, DEFAULT_PRESET_ID)
for (const [raw, expected] of [
  [{}, DEFAULT_PRESET_ID], [{ preset: 'nord' }, 'nord'],
  [{ preset: DEFAULT_PRESET_ID }, DEFAULT_PRESET_ID],
  [{ preset: 'removed' }, DEFAULT_PRESET_ID], [undefined, DEFAULT_PRESET_ID],
]) {
  const result = schema['~standard'].validate(raw)
  assert.equal(result.value.preset.get(), expected)
  assert.equal(schema(raw).preset.get(), expected)
}
const ref = schema({ preset: 'nord' }).preset
ref[Symbol.for('cosmokit.volatile.write')]('dracula')
assert.equal(ref.get(), 'dracula')
const json = schema.toJSON()
assert.equal(schema.type, 'object')
assert.equal(schema.dict.preset.meta.volatile, true)
assert.equal(schema.dict.preset.toJSON().refs[schema.dict.preset.toJSON().uid].type, 'union')
const root = json.refs[json.uid]
assert.equal(root.type, 'object')
const union = json.refs[root.dict.preset]
assert.equal(union.type, 'union')
assert.equal(union.meta.default, DEFAULT_PRESET_ID)
assert.equal(union.meta.volatile, true)
// The fallback is a storable value, so it must be one of the union's branches.
assert.deepEqual(union.list.map(id => json.refs[id].value), [DEFAULT_PRESET_ID, ...PRESET_IDS])
assert.deepEqual(JSON.parse(JSON.stringify(json)), json)

// The decisive check: rehydrate exactly as the client does and validate the
// section shapes the Host can hand back. A union that omits its own fallback
// throws here, the client's decode drops the section, and the row silently
// snaps back to the previous preset while the Host has already saved the new one.
const schemastery = resolveSchemastery()
if (schemastery === undefined) {
  console.log('  skip  client rehydration needs a dsh checkout (set DSH_CHECKOUT)')
} else {
  const { default: Schema } = await import(schemastery)
  const hydrated = new Schema(json)
  for (const section of [{ preset: 'nord' }, { preset: DEFAULT_PRESET_ID }, {}]) {
    assert.doesNotThrow(() => hydrated(section),
      `client cannot rehydrate ${JSON.stringify(section)}`)
  }
}
console.log('PASS — Config validation and volatile descriptor')
