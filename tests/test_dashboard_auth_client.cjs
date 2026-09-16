// Run: node tests/test_dashboard_auth_client.cjs [standalone dashboard HTML path]
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const files = [path.resolve(__dirname, '../templates/dashboard.html')];
let checks = 0;
(async () => {
  for (const file of files) {
    const html = fs.readFileSync(file, 'utf8');
    const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]).filter(s => s.trim());
    for (const source of scripts) new vm.Script(source, {filename: file});
    checks++;
    for (const name of ['analytics.js', 'navigation.js']) {
      const source = fs.readFileSync(path.resolve(__dirname, '../static', name), 'utf8');
      new vm.Script(source, {filename: name});
      assert(!/\bfetch\s*\(/.test(source), name + ' must use apiFetch');
      assert(!/BOT_TOKEN|initDataUnsafe/.test(source), name + ' must not bypass verified auth');
      checks++;
    }
    assert(!html.includes('8532474600'));
    assert(!html.includes('BOT_TOKEN'));
    assert(!html.includes('initDataUnsafe'));
    const helper = scripts.find(s => s.includes('async function apiFetch'));
    assert(helper);
    assert.equal((html.match(/\bfetch\(/g) || []).length, 1);
    assert((html.match(/await apiFetch\(/g) || []).length >= 4);
    assert(html.indexOf('telegram-web-app.js') < html.indexOf('async function apiFetch'));
    checks++;
    function setup(initData, status = 200) {
      const elements = new Map();
      const calls = [];
      const context = vm.createContext({
        window: {Telegram: {WebApp: {initData, ready() {}}}}, Headers,
        document: {
          getElementById(id) { return elements.get(id); },
          createElement() { return {style: {}, setAttribute() {}}; },
          body: {appendChild(element) { elements.set(element.id, element); }}
        },
        fetch: async (...args) => { calls.push(args); return {status}; }
      });
      vm.runInContext(helper, context);
      return {context, calls, elements};
    }
    for (const method of ['GET', 'PATCH', 'DELETE']) {
      const {context, calls} = setup('signed-data');
      context.options = {method, headers: {'Content-Type': 'application/json', Authorization: 'untrusted-override'}, body: method === 'PATCH' ? '{"amount":5}' : undefined};
      await vm.runInContext('apiFetch("https://api.example.test/api/transactions/1", options)', context);
      assert.equal(calls.length, 1);
      assert.equal(calls[0][1].headers.get('Authorization'), 'tma signed-data');
      assert.equal(calls[0][1].headers.get('Content-Type'), 'application/json');
      assert.equal(calls[0][1].method, method);
      assert.equal(calls[0][1].body, context.options.body);
      checks++;
    }
    {
      const {context, calls, elements} = setup('');
      await assert.rejects(vm.runInContext('apiFetch("/api/summary")', context));
      assert.equal(calls.length, 0);
      assert(elements.get('dashboardAuthError').textContent.includes('bot Dompi'));
      checks++;
    }
    {
      const {context, calls, elements} = setup('expired-data', 401);
      await assert.rejects(vm.runInContext('apiFetch("/api/summary")', context));
      assert(elements.get('dashboardAuthError').textContent.includes('Sesi berakhir'));
      await assert.rejects(vm.runInContext('apiFetch("/api/summary")', context));
      assert.equal(calls.length, 1);
      checks++;
    }
    console.log('PASS:', file);
  }
  console.log(`${checks} client checks passed (including syntax of all inline scripts).`);
})().catch(error => {console.error(error); process.exitCode = 1;});
