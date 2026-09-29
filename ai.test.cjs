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
    localStorage: { getItem: k => k === 'kics_ai_settings_v1' ? JSON.stringify(options) : k === 'kics_ai_doc_v1:u:a' ? JSON.stringify(doc || null) : null, setItem: (k,v) => { stored[k] = v; }, removeItem() {} },
    document: { readyState: 'loading', addEventListener() {} },
    sb: { auth: { getSession: async () => ({ data: { session: { access_token: 'test' } } }) } },
    window: { SUPABASE_CONFIG: { url: 'https://example.invalid' }, fetch: async (url, opts) => {
      calls.push({ url, body: JSON.parse(opts.body) });
      return { ok: true, json: async () => ({ content: 'OK', annotations, choices: [{ message: { content: 'OK', annotations } }] }) };
    } }
  };
  vm.createContext(context); vm.runInContext(source, context);
  return { api: context.window.KicsAI, calls, stored };
}
test('search + reasoning respects proxy', async () => {
  const s = setup({ provider: 'deepseek', webSearch: true, reasoning: true, useProxy: true });
  await s.api.complete([{ role: 'user', content: 'test' }]);
  assert.match(s.calls[0].url, /ai-proxy$/);
  assert.equal(s.calls[0].body.provider, 'openrouter');
  assert.equal(s.calls[0].body.reasoning, true);
  assert.equal(s.calls[0].body.webSearch, true);
  assert(!s.calls[0].body.model.includes(':online'));
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
  assert.equal(s.calls[1].body.provider, 'deepseek');
  assert(s.calls[1].body.messages.some(m => m.content.includes('Найденные сведения')));
});
test('documentation search without citations fails closed', async () => {
  const s = setup({ provider: 'deepseek', useProxy: true }, { url: 'https://support.kaspersky.com/business' });
  await assert.rejects(s.api.complete([], { docQuery: 'Device control' }), /подтверждённых ссылок/);
  assert.equal(s.calls.length, 1);
});