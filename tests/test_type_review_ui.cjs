const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('static/analytics.js','utf8');
class Element {
  constructor(tag){this.tag=tag;this.children=[];this.events={};this.disabled=false;}
  append(...items){this.children.push(...items);}
  replaceChildren(...items){this.children=items;}
  addEventListener(name,fn){this.events[name]=fn;}
  setAttribute(){}
  showModal(){}
  close(){this.events.close();}
  remove(){this.removed=true;}
  set innerHTML(_){throw Error('unsafe HTML');}
}
const ids=Object.fromEntries(['analyticsTypeReview','analyticsTypeReviewActions','analyticsTypeReviewCount'].map(id=>[id,new Element('div')]));
const body=new Element('body'),calls=[];
let confirmed=false,fail=false,edited,refreshes=0;
const item={transaction_id:1,type:'expense',description:'<img src=x onerror=alert(1)>',note:'<svg onload=alert(1)>',amount:5,date:'2026-09-01',fingerprint:'server-fingerprint'};
const ctx={URLSearchParams,document:{body,createElement:tag=>new Element(tag),getElementById:id=>ids[id]},
  formatRupiah:n=>'Rp'+n,openTransactionEditor:value=>{edited=value;},
  text:(id,value)=>{ids[id].textContent=value;},node:(tag,cls,value)=>Object.assign(new Element(tag),{textContent:value}),
  window:{loadAnalytics:async()=>{refreshes++;ctx.renderTypeReviews({count:confirmed?0:1},{start:'2026-09-01',end:'2026-09-30'});}},
  apiFetch:async(url,options)=>{calls.push({url,options});if(options){if(!fail)confirmed=true;return {ok:!fail};}return {ok:true,json:async()=>({items:confirmed?[]:[item],count:confirmed?0:1,has_more:false})};}};
vm.createContext(ctx);
vm.runInContext(source.slice(source.indexOf('function openCategoryTransactions'),source.indexOf('function shiftMonth'))+source.slice(source.indexOf('function renderTypeReviews'),source.indexOf('async function loadAnalytics')),ctx);
const flush=()=>new Promise(r=>setImmediate(r));
(async()=>{
  const period={start:'2026-09-01',end:'2026-09-30'};
  ctx.renderTypeReviews({count:1},period);
  assert.equal(ids.analyticsTypeReview.hidden,false);assert.equal(ids.analyticsTypeReviewCount.textContent,'1 transaksi perlu diperiksa');
  ids.analyticsTypeReviewActions.children[0].events.click();await flush();
  let dialog=body.children.at(-1),row=dialog.children[3].children[0];
  assert.match(calls[0].url,/transactions\/type-review/);
  assert.equal(row.children[0].textContent,item.description);assert.equal(row.children[3].textContent,item.note);
  assert.equal(row.children.at(-2).textContent,'Perbaiki transaksi');assert.equal(row.children.at(-1).textContent,'Sudah benar');
  fail=true;await row.children.at(-1).events.click();assert.match(dialog.children[2].textContent,/Gagal/);assert.equal(row.children.at(-1).disabled,false);
  fail=false;const button=row.children.at(-1);const first=button.events.click();button.events.click();await first;
  assert.equal(calls.filter(c=>c.options).length,2); // failed attempt + one successful double-click
  const request=calls.findLast(c=>c.options);
  assert.equal(request.options.method,'POST');assert.deepEqual(JSON.parse(request.options.body),{fingerprint:item.fingerprint});
  assert(row.removed);assert(dialog.removed);assert.equal(refreshes,1);assert.equal(ids.analyticsTypeReview.hidden,true);assert.equal(ids.analyticsTypeReviewActions.children.length,0);
  confirmed=false;ctx.openCategoryTransactions('Perlu ditinjau',period,'mismatch');await flush();dialog=body.children.at(-1);row=dialog.children[3].children[0];row.children.at(-2).events.click();assert.equal(edited.transaction_id,1);assert.equal(edited.type,'expense');
  const html=fs.readFileSync('templates/dashboard.html','utf8');
  assert.match(html,/Periksa jenis transaksi agar laporan lebih akurat/);assert.match(html,/Kategori perlu diperiksa/);assert(!source.includes('belum terklasifikasi'));assert(!source.includes('__needs_category_review__'));
  console.log('PASS mismatch UI: conditional, XSS text, edit, confirmation, double-submit, error/retry, refresh and zero-count close');
})().catch(error=>{console.error(error);process.exitCode=1;});
