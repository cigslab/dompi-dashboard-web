const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('static/analytics.js','utf8');
class Element {
  constructor(tag){this.tag=tag;this.children=[];this.events={};this.attrs={};this.disabled=false;}
  append(...items){for(const item of items){item.parent=this;this.children.push(item);}}
  replaceChildren(...items){this.children=[];this.append(...items);}
  addEventListener(name,fn){this.events[name]=fn;}
  setAttribute(key,value){this.attrs[key]=value;}
  showModal(){this.open=true;}
  close(){this.events.close();}
  remove(){this.removed=true;if(this.parent)this.parent.children=this.parent.children.filter(c=>c!==this);}
  set innerHTML(_){throw Error('unsafe HTML');}
}
const find=(root,cls)=>root.children.flatMap(c=>[c,...desc(c)]).find(c=>c.className===cls);
const desc=root=>root.children.flatMap(c=>[c,...desc(c)]);
const ids=Object.fromEntries(['analyticsTypeReview','analyticsTypeReviewActions','analyticsTypeReviewCount'].map(id=>[id,new Element('div')]));
const body=new Element('body'),calls=[];
let fail=false,loadFail=false,edited,refreshes=0,release;
const seed={transaction_id:1,type:'expense',description:'<img src=x onerror=alert(1)>',note:'<svg onload=alert(1)>',amount:5,date:'2026-09-01',fingerprint:'server-fingerprint'};
let items=[seed];
const ctx={URLSearchParams,document:{body,createElement:tag=>new Element(tag),getElementById:id=>ids[id]},
  formatRupiah:n=>'Rp'+n,openTransactionEditor:value=>{edited=value;},
  text:(id,value)=>{ids[id].textContent=value;},node:(tag,cls,value)=>Object.assign(new Element(tag),{className:cls,textContent:value}),
  window:{loadAnalytics:async()=>{refreshes++;ctx.renderTypeReviews({count:items.length},{});}},
  apiFetch:async(url,options)=>{calls.push({url,options});if(options){await new Promise(r=>{release=r;});if(!fail)items=items.filter(i=>i.transaction_id!==Number(url.split('/')[3]));return {ok:!fail};}const page=Number(new URLSearchParams(url.split('?')[1]).get('page'));return {ok:!loadFail,json:async()=>({items:items.slice((page-1)*25,page*25),count:items.length,has_more:page*25<items.length})};}};
vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('function openCategoryTransactions'),source.indexOf('function shiftMonth'))+source.slice(source.indexOf('function renderTypeReviews'),source.indexOf('async function loadAnalytics')),ctx);
const flush=()=>new Promise(r=>setImmediate(r));
(async()=>{
  ctx.openCategoryTransactions('Perlu ditinjau',{},'mismatch');await flush();
  let dialog=body.children.at(-1),row=find(dialog,'type-review-item');
  assert.equal(find(dialog,'type-review-header').children[0].textContent,'Jenis transaksi perlu diperiksa');
  assert.equal(find(dialog,'type-review-close').textContent,'×');assert.equal(find(dialog,'type-review-close').attrs['aria-label'],'Tutup pemeriksaan transaksi');
  assert.equal(find(row,'type-review-description').textContent,seed.description);assert.equal(find(row,'type-review-note').textContent,seed.note);
  assert.equal(find(row,'type-review-badge is-expense').textContent,'Pengeluaran');
  assert(find(dialog,'type-review-pagination').hidden);
  const confirm=find(row,'type-review-secondary'),edit=find(row,'type-review-primary');
  fail=true;let task=confirm.events.click();confirm.events.click();assert(confirm.disabled&&edit.disabled);assert.equal(confirm.textContent,'Menyimpan…');release();await task;
  assert.equal(calls.filter(c=>c.options).length,1);assert.match(find(dialog,'type-review-status').textContent,/Gagal/);assert.equal(confirm.disabled,false);
  const reads=calls.filter(c=>!c.options).length;
  fail=false;task=confirm.events.click();release();await task;
  assert(row.removed);assert.equal(calls.filter(c=>!c.options).length,reads,'single-page confirmation must not reload list');assert.equal(refreshes,1);
  assert.equal(find(dialog,'type-review-status').textContent,'Tidak ada transaksi yang perlu diperiksa');assert.equal(ids.analyticsTypeReview.hidden,true);assert(!dialog.removed);
  assert.deepEqual(JSON.parse(calls.findLast(c=>c.options).options.body),{fingerprint:seed.fingerprint});
  find(dialog,'type-review-close').events.click();assert(dialog.removed);
  items=Array.from({length:26},(_,i)=>({...seed,transaction_id:i+1,type:i?'income':'expense'}));
  ctx.openTypeReview({});await flush();dialog=body.children.at(-1);
  let nav=find(dialog,'type-review-pagination');assert(!nav.hidden);assert(nav.children[0].hidden);assert.equal(nav.children[1].textContent,'Halaman 1 dari 2');
  nav.children[2].events.click();await flush();assert.equal(nav.children[1].textContent,'Halaman 2 dari 2');assert(nav.children[2].hidden);
  row=find(dialog,'type-review-item');assert.equal(find(row,'type-review-badge is-income').textContent,'Pemasukan');
  task=find(row,'type-review-secondary').events.click();release();await task;
  assert(nav.hidden);assert.equal(find(dialog,'type-review-list').children.length,25);assert.equal(nav.children[1].textContent,'Halaman 1 dari 1');
  find(find(dialog,'type-review-item'),'type-review-primary').events.click();assert.equal(edited.transaction_id,1);assert(dialog.removed);
  loadFail=true;ctx.openTypeReview({});await flush();dialog=body.children.at(-1);assert(!find(dialog,'type-review-retry').hidden);
  loadFail=false;find(dialog,'type-review-retry').onclick();await flush();assert.equal(find(dialog,'type-review-list').children.length,25);
  console.log('PASS type-review modal: title/close, badges, XSS, loading/double-submit, errors/retry, local removal, empty, pagination/reconciliation, edit');
})().catch(error=>{console.error(error);process.exitCode=1;});
