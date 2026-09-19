// Targeted actual renderer, inert DOM double, mocked API; no live services.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const html = fs.readFileSync(path.join(__dirname, '../templates/dashboard.html'), 'utf8');
const source = html.slice(html.indexOf('function formatAccountJoined'), html.indexOf('const resetDialog')) +
  html.slice(html.indexOf('let accountUsageRequest'), html.indexOf('async function loadProfile'));
assert(!source.includes('data.plan'), 'Must not infer entitlement from legacy plan');
const elements = new Map();
for (const [, id] of html.matchAll(/id="([^"]+)"/g)) {
  const element = {hidden: true, textContent: '', value: 0, max: 0};
  Object.defineProperty(element, 'innerHTML', {set() {throw Error('Unsafe HTML sink');}});
  elements.set(id, element);
}
let data, fail=false, pending;
const context = vm.createContext({Intl, Date, Number,
  document: {getElementById(id) {assert(elements.has(id), id); return elements.get(id);}},
  apiFetch: async url => {assert.equal(url, '/api/account'); if(pending) return pending; return {ok:!fail, json:async()=>data};}});
vm.runInContext(source,context);
const el = id => elements.get('account'+id);
const ent = (plan,source,extra={})=>({effective_plan:plan,entitlement_source:source,requires_review:false,legacy_expires_at:null,...extra});
const base = ()=>({monthly_usage:37,free_monthly_limit:50,joined_at:'2026-09-07',plan:'pro'});
async function render(entitlement, extra={}) {data={...base(),entitlement,...extra};await context.loadAccountUsage();}
let checks=0;
(async()=>{
  await render(ent('free','free'));
  assert.equal(el('Plan').textContent,'Paket Free');
  assert.equal(el('Usage').textContent,'37 / 50 pencatatan bulan ini');
  assert.equal(el('Features').hidden,true);assert.equal(el('UpgradeAction').hidden,false);
  assert.equal(el('ExportPanel').hidden,false);assert.equal(el('ExportLock').hidden,false);
  assert.equal(el('ExportControls').hidden,true);checks++;
  await render(ent('free','free'),{free_monthly_limit:null});
  assert.equal(el('QuotaProgress').hidden,true);assert.equal(el('Usage').textContent,'37 pencatatan digunakan');checks++;
  await render(ent('starter','starter_lifetime'),{monthly_usage:149});
  assert.equal(el('Plan').textContent,'Starter Lifetime');assert.equal(el('Usage').textContent,'149 / 150 transaksi bulan ini');
  assert.equal(el('QuotaProgress').max,150);assert.equal(el('QuotaProgress').hidden,false);
  assert.equal(el('QuotaRemaining').textContent,'Tersisa 1 pencatatan bulan ini');
  assert.equal(el('UpgradeAction').hidden,false);
  for(const feature of ['Receipt','Export','Advanced']) {
    assert.equal(el(feature+'Lock').hidden,false);
    assert.match(html,new RegExp('id="account'+feature+'Lock" href="/upgrade"'));
  }
  assert.equal(el('ExportControls').hidden,true);
  assert.match(el('FeatureNote').textContent,/belum tersedia/);checks++;
  await render(ent('starter','starter_lifetime'),{monthly_usage:170});
  assert.equal(el('QuotaProgress').value,150);assert.match(el('Usage').textContent,/170 \/ 150/);checks++;
  await render(ent('pro','pro_lifetime'),{plan:'free'});
  assert.equal(el('Plan').textContent,'Pro Lifetime');assert.match(el('Usage').textContent,/Unlimited/);
  assert.equal(el('UpgradeAction').hidden,true);assert.equal(el('QuotaProgress').hidden,true);
  assert.equal(el('QuotaRemaining').hidden,true);assert.equal(el('ReceiptStatus').textContent,'Aktif');
  assert.equal(el('ExportStatus').textContent,'Aktif');
  assert.equal(el('ExportControls').hidden,false);
  assert.equal(el('AdvancedStatus').textContent,'Belum tersedia');checks++;
  await render(ent('pro','pro_legacy',{legacy_expires_at:'2099-01-01T00:00:00',lifetime:true}));
  assert.equal(el('Plan').textContent,'Pro aktif sampai 1 Jan 2099');assert.equal(el('UpgradeAction').hidden,true);
  assert.equal(el('ReceiptStatus').textContent,'Aktif');assert.equal(el('ExportControls').hidden,false);checks++;
  for(const entitlement of [ent('pro','pro_lifetime',{requires_review:true}),ent(null,null,{requires_review:true}),undefined,ent('starter','pro_lifetime')]) {
    await render(entitlement);
    assert.equal(el('ExportControls').hidden,true);
    assert.notEqual(el('ReceiptStatus').textContent,'Aktif');assert.doesNotMatch(el('Usage').textContent,/Unlimited/);
  } checks++;
  const attack='<img src=x onerror=alert(1)>';
  await render(ent('pro','pro_legacy',{legacy_expires_at:attack}),{joined_at:attack,monthly_usage:attack});
  assert.doesNotMatch(el('Plan').textContent,/<img/);assert.equal(el('ReceiptStatus').textContent,'Perlu ditinjau');checks++;
  await render(ent('starter','starter_lifetime'));
  fail=true;await context.loadAccountUsage();
  assert.equal(el('ExportPanel').hidden,true);
  assert.equal(el('Features').hidden,true);assert.equal(el('UpgradeAction').hidden,true);assert.equal(el('UsageRetry').hidden,false);
  fail=false;await render(ent('pro','pro_lifetime'));assert.equal(el('UsageRetry').hidden,true);checks++;
  let resolve;
  pending=new Promise(r=>resolve=r);
  const stale=context.loadAccountUsage();
  assert.equal(el('ExportPanel').hidden,true);
  assert.equal(el('Features').hidden,true);assert.equal(el('UpgradeAction').hidden,true);
  pending=null;await render(ent('pro','pro_lifetime'));
  resolve({ok:true,json:async()=>({...base(),entitlement:ent('starter','starter_lifetime')})});await stale;
  assert.equal(el('Plan').textContent,'Pro Lifetime');checks++;
  console.log(`PASS ${checks} account UI groups: plans, locks, safe text, loading/error/retry, stale response`);
})().catch(error=>{console.error(error);process.exitCode=1;});
