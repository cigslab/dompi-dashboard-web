const assert = require('node:assert/strict');
const {test} = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync('templates/dashboard.html','utf8');
class Element {
    constructor(tag='div') {this.tag=tag;this.children=[];this.nodes=new Map();this.events={};this.dataset={};this.textContent='';this.value='';
        const classes=new Set();this.classList={add:v=>classes.add(v),remove:v=>classes.delete(v),contains:v=>classes.has(v)};}
    addEventListener(event, fn) {this.events[event]=fn;}
    querySelector(selector) {if(!this.nodes.has(selector)){const e=new Element();e.parent=this;this.nodes.set(selector,e);}return this.nodes.get(selector);}
    querySelectorAll(selector) {return selector.split(',').map(s=>this.querySelector(s.trim()));}
    appendChild(child) {this.children.push(child);}
    set innerHTML(value) {this.children=[];}
    closest(selector) {if(selector==='.all-transaction-item')return this.parent;return null;}
}
function harness() {
    const nodes=new Map(), clicks=[], calls=[];
    const el=id=>{if(!nodes.has(id)) nodes.set(id,new Element());return nodes.get(id);};
    // HTML text inputs remove line breaks; no-op edits must not resubmit that loss.
    for(const id of ['editTransactionCategory','editTransactionNote','editTransactionAmount','editTransactionType']) {
        let value='';Object.defineProperty(el(id),'value',{get:()=>value,set:v=>{value=String(v).replace(/[\r\n]/g,'');}});
    }
    const context=vm.createContext({document:{getElementById:el,createElement:tag=>new Element(tag),addEventListener:(event,fn)=>{if(event==='click')clicks.push(fn)},querySelectorAll:()=>[]},
        console, Date, Number, Intl, URLSearchParams, formatRupiah:n=>'Rp'+n,alert(){},confirm:()=>true,
        apiFetch:async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return {ok:true,json:async()=>({success:true})}},
        loadSummary:async()=>{},loadCategories:async()=>{},loadCashflowChart:async()=>{},window:{loadAnalytics:async()=>{}}});
    const source=html.slice(html.indexOf('const TRANSACTIONS_API_URL'),html.indexOf('// FILTER TRANSAKSI'));
    vm.runInContext(source,context);
    context.loadTransactions=async()=>{};
    return {context,el,calls,open(item,route){
        if(route==='dialog')context.openTransactionEditor({...item,description:item.category,category:'Analytics label'});
        else {
            context.renderTransactionRows([item]);
            const row=el('allTransactionList').children.at(-1),button=row.querySelector('.transaction-edit-button');
            button.dataset.transactionId=String(item.transaction_id);
            // Poison display values: canonical editor values must come from item.
            row.querySelector('.transaction-category').textContent='placeholder';
            row.querySelector('.transaction-note').textContent='-';
            row.querySelector('.transaction-amount').textContent='Rp999';
            for(const fn of clicks)fn({target:{closest:s=>s==='.transaction-edit-button'?button:null}});
        }
    }};
}
for(const route of ['list','dialog']) {
    test(route+': amount-only round trip preserves exact canonical fields',async()=>{
        for(const note of ['-','  copy\n\t☕  ','',null,'<img src=x onerror=alert(1)>']) {
            const h=harness();const item={transaction_id:1,category:'  category\ncopy  ',note,amount:10,type:'income',date:'2026-10-01',analytics_category:'Gaji'};
            h.open(item,route);
            assert.equal(h.el('editTransactionCategory').value,'  categorycopy  ');
            assert.equal(h.el('editTransactionNote').value,(note??'').replace(/[\r\n]/g,''));
            assert.equal(h.el('editTransactionAmount').value,'10');
            assert.equal(h.el('editTransactionType').value,'income');
            h.el('editTransactionAmount').value='25';
            await h.el('saveEditTransaction').events.click();
            assert.deepEqual(h.calls,[{url:'/api/transactions/1',body:{amount:25}}]);
            assert.equal(item.note,note);
        }
    });
}
test('intentional copy edits preserve whitespace; unchanged editor sends no mutation',async()=>{
    const h=harness(),item={transaction_id:1,category:'x',note:null,amount:10,type:'expense'};
    h.open(item,'dialog');await h.el('saveEditTransaction').events.click();assert.equal(h.calls.length,0);
    h.open(item,'dialog');h.el('editTransactionCategory').value='  new copy  ';h.el('editTransactionNote').value='-';
    await h.el('saveEditTransaction').events.click();
    assert.deepEqual(h.calls[0].body,{category:'  new copy  ',note:'-'});
});

test('null description does not fall back to analytics label or mutate untouched fields',async()=>{
    const h=harness();
    h.context.openTransactionEditor({transaction_id:1,description:null,category:'Analytics label',note:null,amount:10,type:'expense'});
    assert.equal(h.el('editTransactionCategory').value,'');
    h.el('editTransactionAmount').value='25';await h.el('saveEditTransaction').events.click();
    assert.deepEqual(h.calls[0].body,{amount:25});
});
