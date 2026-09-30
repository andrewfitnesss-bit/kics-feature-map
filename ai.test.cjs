const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, 'ai.js'), 'utf8');
function setup(options, doc, annotations = []) {
  const calls = [], stored = {};
  const context = {
    AbortController, setTimeout, clearTimeout, URL,
    state: { mapId: 'a' }, currentUser: { id: 'u' },
    localStorage: { getItem: k => Object.hasOwn(stored, k) ? stored[k] : k === 'kics_ai_settings_v1' ? JSON.stringify(options) : k === 'kics_ai_doc_v1:u:a' ? JSON.stringify(doc || null) : null, setItem: (k,v) => { stored[k] = v; }, removeItem(k) { delete stored[k]; } },
    document: { readyState: 'loading', addEventListener() {} },
    sb: { auth: { getSession: async () => ({ data: { session: { access_token: 'test' } } }) } },
    window: { SUPABASE_CONFIG: { url: 'https://example.invalid' }, fetch: async (url, opts) => {
      calls.push({ url, body: JSON.parse(opts.body) });
      return { ok: true, json: async () => ({ content: 'OK', annotations, choices: [{ message: { content: 'OK', annotations } }] }) };
    } }
  };
  vm.createContext(context); vm.runInContext(source, context);
  return { api: context.window.KicsAI, calls, stored, context };
}
test('search + reasoning respects proxy', async () => {
  const s = setup({ provider: 'deepseek', webSearch: true, reasoning: true, useProxy: true });
  await s.api.complete([{ role: 'user', content: 'test' }]);
  assert.match(s.calls[0].url, /ai-proxy$/);
  assert.equal(s.calls[0].body.provider, 'openrouter');
  assert.equal(s.calls[0].body.reasoning, true);
  assert.equal(s.calls[0].body.webSearch, true);
  assert.equal(s.calls[0].body.maxTokens, 4096);
  assert(!s.calls[0].body.model.includes(':online'));
  assert.equal(s.calls[0].body.model, 'openai/gpt-4o-mini');
});
test('direct search includes reasoning', async () => {
  const s = setup({ webSearch: true, reasoning: true, openRouterKey: 'dummy' });
  await s.api.complete([]);
  assert.equal(s.calls[0].body.reasoning.enabled, true);
});
test('plaintext keys are not persisted', () => {
  const s = setup({ apiKey: 'secret-a', openRouterKey: 'secret-b' });
  assert(!s.stored.kics_ai_settings_v1.includes('secret-'));
});
test('documentation input survives closing and reopening another card, isolated per map', () => {
  const s = setup({});
  let elements = [];
  const element = tag => {
    const e = { tag, value: '', style: {}, events: {}, appendChild() {}, addEventListener(name, fn) { this.events[name] = fn; }, remove() {}, focus() {}, setAttribute() {} };
    elements.push(e); return e;
  };
  Object.assign(s.context.document, { createElement: element, body: element('body'), getElementById: () => null });
  s.context.getNodeById = id => ({ id, title: 'Card', tags: [] });
  s.api.openPanel('card', '1', 'fill-description');
  const field = elements.find(e => e.type === 'url');
  field.value = 'https://support.kaspersky.com/business'; field.events.input();
  elements = [];
  s.api.openPanel('card', '2', 'fill-description');
  assert.equal(elements.find(e => e.type === 'url').value, field.value);
  s.context.state.mapId = 'b'; elements = [];
  s.api.openPanel('card', '3', 'fill-description');
  assert.equal(elements.find(e => e.type === 'url').value, '');
});
test('Russian output instruction applies to normal and web-search requests', async () => {
  for (const webSearch of [false, true]) {
    const s = setup({ provider: 'deepseek', useProxy: true, webSearch });
    await s.api.complete([{ role: 'user', content: 'Describe Device Control in JSON' }]);
    assert(s.calls[0].body.messages.some(m => m.role === 'system' && m.content.includes('только на русском языке') && m.content.includes('структуру JSON не меняй')));
  }
});
test('English selection applies to search evidence and generation without Russian override', async () => {
  const s = setup({ provider: 'deepseek', useProxy: true, language: 'en' }, { url: 'https://support.kaspersky.com/business', product: 'KICS' }, [{ url_citation: { url: 'https://support.kaspersky.com/help' } }]);
  await s.api.complete([{ role: 'user', content: 'Напиши описание' }], { docQuery: 'Device control' });
  assert.equal(s.calls.length, 2);
  for (const call of s.calls) {
    assert(call.body.messages.some(m => m.role === 'system' && m.content.includes('only in English')));
    assert(!call.body.messages.some(m => m.content.includes('только на русском языке')));
  }
});
test('explicit task language overrides saved language', async () => {
  const s = setup({ provider: 'deepseek', useProxy: true, language: 'en' });
  await s.api.complete([], { language: 'ru' });
  assert(s.calls[0].body.messages.some(m => m.content.includes('только на русском языке')));
});
test('in-flight credit error is explained and never retried automatically', async () => {
  const s = setup({ provider: 'openrouter', useProxy: true });
  let requests = 0;
  s.context.window.fetch = async () => { requests++; return { ok: false, text: async () => JSON.stringify({ error: 'This request would exceed your available credits given your current in-flight requests.' }) }; };
  await assert.rejects(s.api.complete([]), /уже выполняющихся/);
  await assert.rejects(s.api.complete([]), /пауза на 60 секунд/);
  assert.equal(requests, 1);
});
test('page documentation mode uses selected provider without OpenRouter', async () => {
  const s = setup({ provider:'deepseek', useProxy:true, docMode:'page' }, {url:'https://docs.example.com/manual'});
  s.context.window.fetch = async (url, opts) => { s.calls.push({url,body:JSON.parse(opts.body)}); return {ok:true,json:async()=>url.endsWith('fetch-url') ? {text:'Verified page text'} : {content:'OK'}}; };
  await s.api.complete([], {docQuery:'Feature'});
  assert.equal(s.calls.length,2); assert.match(s.calls[0].url,/fetch-url$/);
  assert.equal(s.calls[1].body.provider,'deepseek');
  assert(s.calls[1].body.messages.some(m=>m.content.includes('Verified page text')));
});
test('simultaneous completions are rejected within a tab', async () => {
  const s = setup({ provider: 'deepseek', useProxy: true });
  let release;
  s.context.window.fetch = () => new Promise(resolve => { release = () => resolve({ ok: true, json: async () => ({ content: 'OK' }) }); });
  const first = s.api.complete([]);
  await assert.rejects(s.api.complete([]), /уже выполняется/);
  release();
  await first;
});
test('legacy migration never updates existing maps', () => {
  const sql = fs.readFileSync(path.join(__dirname, 'migrate_legacy.sql'), 'utf8');
  assert.match(sql, /on conflict \(id\) do nothing/i);
});
test('documentation search precedes selected model and restricts domain', async () => {
  const s = setup({ provider: 'deepseek', useProxy: true }, { url: 'https://support.kaspersky.com/business', product: 'KICS 3.3' }, [{ url_citation: { url: 'https://support.kaspersky.com/help' } }]);
  await s.api.complete([{ role: 'user', content: 'Generate' }], { docQuery: 'Device control' });
  assert.equal(s.calls.length, 2);
  assert.equal(s.calls[0].body.provider, 'openrouter');
  assert.deepEqual(s.calls[0].body.searchDomains, ['support.kaspersky.com']);
  assert.equal(s.calls[0].body.maxTokens, 3072);
  assert.equal(s.calls[1].body.provider, 'deepseek');
  assert(s.calls[1].body.messages.some(m => m.content.includes('Найденные сведения')));
});
test('documentation search without citations fails closed', async () => {
  const s = setup({ provider: 'deepseek', useProxy: true }, { url: 'https://support.kaspersky.com/business' });
  await assert.rejects(s.api.complete([], { docQuery: 'Device control' }), /подтверждённых ссылок/);
  assert.equal(s.calls.length, 1);
});
test('completion parser accepts text blocks but never reasoning as an answer', async () => {
  const { parseCompletion } = await import('./supabase/functions/_shared/completion.mjs');
  const value = parseCompletion({ choices: [{ finish_reason: 'stop', message: { content: [{ type: 'text', text: 'Answer' }] } }] }, 'test', 'test');
  assert.equal(value.content, 'Answer');
  assert.throws(() => parseCompletion({ choices: [{ finish_reason: 'stop', message: { content: '', reasoning_content: 'PRIVATE_REASONING' } }] }, 'test', 'test'), e => e.message.includes('hasReasoning') && !e.message.includes('PRIVATE_REASONING'));
  assert.throws(() => parseCompletion({ choices: [{ finish_reason: 'length', message: { content: 'partial' } }] }, 'test', 'test'), /обрезан/);
  assert.throws(() => parseCompletion({ choices: [{ finish_reason: 'stop', message: { content: ' ', tool_calls: [{}] } }] }, 'test', 'test'), /инструмента/);
});