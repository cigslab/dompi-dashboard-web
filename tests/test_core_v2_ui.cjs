const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname,'../static/core-v2.js'),'utf8');
class Element {
  constructor() {this.children=[];this.hidden=false;this.value='';this.listeners={};this.textContent='';}
  set innerHTML(_) {throw Error('Unsafe HTML sink');}
  appendChild(node) {this.children.push(node);if(!this.value)this.value=node.value || '';}
  replaceChildren() {this.children=[];this.value='';}
  addEventListener(event,fn) {this.listeners[event]=fn;}
}
const ids=['Panel','Refresh','Status','Balance','Quota','Usage','Credits','Orders','MoreUsage','MoreCredits','Product','OrderForm','OrderSubmit'];
const elements=Object.fromEntries(ids.map(id=>['coreV2'+id,new Element()]));
const el=id=>elements['coreV2'+id];
let legacy=false,fail=false,posts=[],calls=[];
const attack='<img src=x onerror=alert(1)>';
const context=vm.createContext({Map,crypto:{randomUUID:()=> 'fixed-key'},encodeURIComponent,
  document:{getElementById:id=>elements[id],createElement:()=>new Element()},
  apiFetch:async (url,options={})=>{
    calls.push(url);
    if(fail)throw Error('offline');
    let data;
    if(url.endsWith('overview'))data=legacy?{cohort:'legacy'}:{cohort:'v2_purchase',available:90,reserved:10,balance:100,
      quotas:[{feature:attack,used:1,included:100,reserved:0,remaining:99}],channel:'telegram',period_start:'start',period_end:'end',
      products:[{code:'topup_100',credits:100,price_idr:10000}],orders_enabled:true};
    else if(options.method==='POST'){posts.push(JSON.parse(options.body));data={checkout_available:false};}
    else data={items:[{id:attack,feature:attack,created_at:'today',state:'committed',funding:'quota',credits:0,kind:attack,amount:100,status:'paid',price_idr:10000}],next_cursor:null};
    return {ok:true,json:async()=>data};
  }});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
(async()=>{
  vm.runInContext(source,context);assert.equal(calls.length,0);
  await el('Refresh').listeners.click();
  assert.match(el('Balance').textContent,/90 kredit tersedia/);
  assert.match(el('Usage').children[0].textContent,/<img/);
  assert.equal(el('OrderForm').hidden,false);
  el('OrderForm').listeners.submit({preventDefault(){}});await tick();
  el('OrderForm').listeners.submit({preventDefault(){}});await tick();
  assert.equal(posts.length,2);assert.equal(posts[0].idempotency_key,posts[1].idempotency_key);
  assert.deepEqual(Object.keys(posts[0]).sort(),['idempotency_key','product_code']);
  legacy=true;await el('Refresh').listeners.click();
  assert.equal(el('OrderForm').hidden,true);assert.match(el('Status').textContent,/Hak paket lama/);
  assert.equal(el('Balance').textContent,'');
  fail=true;await el('Refresh').listeners.click();assert.match(el('Status').textContent,/Coba lagi/);
  assert.equal(el('Refresh').disabled,false);
  vm.runInNewContext(source,{document:{getElementById:()=>null}});
  console.log('PASS Core v2 UI: inert load, safe text, catalog, same-key retries, legacy, errors, missing panel');
})().catch(error=>{console.error(error);process.exitCode=1;});
