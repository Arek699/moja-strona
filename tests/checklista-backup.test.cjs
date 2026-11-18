const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '../lazienka-na-lata-v2-premium.html'), 'utf8');
const start = html.slice(html.indexOf('const ICONS ='), html.indexOf('const TOTAL_POINTS ='));
const importer = html.slice(html.indexOf("$('#import-file').addEventListener('change'"), html.indexOf("document.addEventListener('click',e=>{const btn=e.target.closest('[data-export]')"));
const key = 'lazienkaNaLata_snapshot_v1';
function app(seed = {}, blocked = false) {
  const storage = new Map(Object.entries(seed));
  let listener, warning;
  const messages = [];
  const context = vm.createContext({
    localStorage: {
      getItem: k => storage.get(k) ?? null,
      setItem: (k, v) => { if (blocked) throw Error('QuotaExceededError'); storage.set(k, v); },
    },
    document: {
      getElementById: () => warning,
      createElement: () => ({ setAttribute() {}, style: {}, remove() { warning = undefined; } }),
      body: { prepend: el => { warning = el; } },
    },
    $: () => ({ addEventListener: (_, fn) => { listener = fn; } }),
    $$: () => [],
    confirm: () => true,
    showToast: msg => messages.push(msg),
    closeExportModal() {}, updateProgress() {},
    FileReader: class { readAsText(file) { this.onload({ target: { result: file.text } }); } },
  });
  vm.runInContext(start + importer, context);
  return {
    storage, messages, context,
    snapshot: () => JSON.parse(vm.runInContext('JSON.stringify(currentSnapshot())', context)),
    import: data => listener({ target: { files: [{ text: typeof data === 'string' ? data : JSON.stringify(data) }], value: 'file' } }),
    warning: () => warning?.textContent,
  };
}
const initial = {
  state: { '01-01': true }, flags: { '01-02': true },
  notes: { '01-01': [{ date: '18.11.2026', text: 'Zdjęcie przed zakryciem' }] }, milestones: [1],
};
const seed = { [key]: JSON.stringify(initial) };
test('invalid files preserve all in-memory and stored data', () => {
  for (const invalid of [
    '{', null, [], { state: [], milestones: [] },
    { state: {}, milestones: {} }, { state: {}, flags: [] },
    { state: {}, notes: { '01-01': [{}] } },
    { state: { '01-01': 'yes' } }, { state: { '__unknown': true } },
    { state: {}, milestones: ['1'] }, { state: {}, milestones: [999] },
    { app: 'other', state: {} }, { version: 'future', state: {} },
    JSON.parse('{"state":{"__proto__":true}}'),
  ]) {
    const a = app(seed); a.import(invalid);
    assert.deepEqual(a.snapshot(), initial);
    assert.equal(a.storage.get(key), seed[key]);
    assert.match(a.messages.at(-1), /Plik niepoprawny/);
  }
});
test('complete valid v2 export restores all groups and survives reload', () => {
  const next = { state: { '01-02': true }, flags: {}, notes: { '01-02': [{ date: 'dzisiaj', text: '<tekst>' }] }, milestones: [2] };
  const a = app(seed); a.import({ app: 'Łazienka Na Lata™', version: 'v2', ...next });
  assert.deepEqual(a.snapshot(), next);
  assert.deepEqual(app(Object.fromEntries(a.storage)).snapshot(), next);
  assert.equal(a.messages.at(-1), 'Postęp przywrócony');
});
test('blocked storage leaves import untouched and reports failure', () => {
  const a = app(seed, true); a.import({ state: {}, flags: {}, notes: {}, milestones: [] });
  assert.deepEqual(a.snapshot(), initial);
  assert.equal(a.storage.get(key), seed[key]);
  assert.match(a.warning(), /Nie udało się zapisać/);
  assert.doesNotMatch(a.messages.join(' '), /Postęp przywrócony/);
});
test('cancelled import leaves data unchanged', () => {
  const a = app(seed); a.context.confirm = () => false; a.import({ state: {} });
  assert.deepEqual(a.snapshot(), initial);
  assert.equal(a.storage.get(key), seed[key]);
});
test('legacy browser data migrates without deleting the original keys', () => {
  const legacy = {
    lazienkaNaLata_v1: JSON.stringify(initial.state),
    lazienkaNaLata_flags_v1: JSON.stringify(initial.flags),
    lazienkaNaLata_dziennik_v1: JSON.stringify(initial.notes),
    lazienkaNaLata_milestones_v1: JSON.stringify(initial.milestones),
  };
  const a = app(legacy); assert.deepEqual(a.snapshot(), initial);
  vm.runInContext('saveState()', a.context);
  assert.deepEqual(app(Object.fromEntries(a.storage)).snapshot(), initial);
  for (const [k, v] of Object.entries(legacy)) assert.equal(a.storage.get(k), v);
});
test('older partial backup preserves omitted groups', () => {
  const a = app(seed); a.import({ state: {} });
  assert.deepEqual(a.snapshot(), { ...initial, state: {} });
});
test('ordinary save failure stays visible and later success clears warning', () => {
  const a = app(seed, true);
  assert.equal(vm.runInContext('saveNotes()', a.context), false);
  assert.match(a.warning(), /wyeksportuj kopię JSON/);
  a.context.localStorage.setItem = (k, v) => a.storage.set(k, v);
  assert.equal(vm.runInContext('saveNotes()', a.context), true);
  assert.equal(a.warning(), undefined);
});
test('file read error preserves current data', () => {
  const a = app(seed);
  a.context.FileReader = class { readAsText() { this.onerror(); } };
  a.import({ state: {} });
  assert.deepEqual(a.snapshot(), initial);
  assert.equal(a.storage.get(key), seed[key]);
  assert.match(a.messages.at(-1), /Nie udało się odczytać/);
});
test('all inline scripts parse', () => {
  for (const [, js] of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(js);
});
