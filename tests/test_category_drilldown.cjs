const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'static/analytics.js'), 'utf8');
const fn = source.slice(source.indexOf('function openCategoryTransactions'), source.indexOf('                function shiftMonth'));
class Element {
  constructor(tag) { this.tag=tag; this.children=[]; this.events={}; this.disabled=false; }
  append(...items) { this.children.push(...items); }
  replaceChildren(...items) { this.children=items; }
  setAttribute() {}
  addEventListener(name, fn) { this.events[name]=fn; }
  showModal() { this.open=true; }
  close() { this.events.close(); }
  remove() { this.removed=true; }
  set innerHTML(_) { throw Error('Unsafe HTML renderer'); }
}
const body = new Element('body');
const calls=[];
let fail=false, empty=false;
const payload='<img src=x onerror=alert(1)>';
let edited;
const context={openTransactionEditor:item=>{edited=item;},document:{body,createElement:tag=>new Element(tag)}, URLSearchParams,
  formatRupiah:n=>'Rp'+n, apiFetch:async url=>{ calls.push(url); return {ok:!fail,json:async()=>({items:empty?[]:[{description:payload,date:'2026-09-01',amount:10,note:payload,category:payload}],has_more:calls.length===1})}; }};
vm.createContext(context); vm.runInContext(fn,context);
const flush=()=>new Promise(resolve=>setImmediate(resolve));
(async()=>{
  context.openCategoryTransactions('Lainnya',{month:'2026-09'}); await flush();
  const dialog=body.children[0];
  const [title,close,status,list,previous,next,retry]=dialog.children;
  assert.equal(title.textContent,'Lainnya');
  assert.equal(list.children[0].children[0].textContent,payload);
  assert.equal(list.children[0].children[3].textContent,payload);
  assert.equal(previous.disabled,true); assert.equal(next.disabled,false);
  next.events.click(); await flush();
  assert.equal(new URLSearchParams(calls[1].split('?')[1]).get('page'),'2');
  assert.equal(new URLSearchParams(calls[1].split('?')[1]).get('month'),'2026-09');
  assert.equal(new URLSearchParams(calls[1].split('?')[1]).get('type'),'expense');
  fail=true; previous.events.click(); await flush();
  assert.equal(retry.hidden,false); assert.match(status.textContent,/Gagal/);
  fail=false; empty=true; retry.onclick(); await flush();
  assert.match(status.textContent,/Tidak ada/);
  list.children.length || await (async()=>{ empty=false; retry.onclick(); await flush(); })();
  list.children[0].children.at(-1).events.click();
  assert.equal(edited.description,payload);
  assert.equal(dialog.removed,true);
  const html=fs.readFileSync(path.join(root,'templates/dashboard.html'),'utf8');
  assert.match(html,/category: "Kategori lain",\s+bucket_id: "__remaining__"/);
  assert.doesNotMatch(html,/category: "Lainnya",/);
  assert.match(source,/openCategoryTransactions\(item.category, \{month: month.value\}\)/);
  assert.match(source,/start: data.start, end: data.end/);
  assert.match(source,/filter\(item => item.category !== 'Perlu ditinjau'\)/);
  assert.match(source,/review: '1'/);
  assert.doesNotMatch(source,/__needs_category_review__/);
  const css=fs.readFileSync(path.join(root,'static/style.css'),'utf8');
  assert.match(css,/max-width: calc\(100vw - 24px\)/);
  assert.match(css,/overflow-wrap: anywhere/);
  console.log('PASS drill-down XSS-safe text, pagination, filters, error/retry/empty, close, chart bucket');
})().catch(error=>{console.error(error);process.exitCode=1;});
