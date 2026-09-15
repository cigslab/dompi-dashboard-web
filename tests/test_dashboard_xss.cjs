// Browser regression harness. Run: node tests/test_dashboard_xss.cjs
// Open http://127.0.0.1:8765/0. Each page runs assertions automatically.
// HTTP is loopback-only; fetch/Telegram/Chart are mocked. No production requests.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const roots=[path.resolve(__dirname,'..')];
const results={};
function setup(attack) {
  window.__dompiXss=0;
  window.__testErrors=[];
  window.addEventListener('error',e=>window.__testErrors.push(e.message));
  window.__testCalls=[];
  window.Telegram={WebApp:{initData:'test-init-data',ready(){}}};
  window.Chart=class {constructor(){} destroy(){}};
  window.confirm=()=>true;
  const now=new Date();
  const date=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-14`;
  const month=date.slice(0,7);
  const payloads=['<img src=x onerror="window.__dompiXss = 1">',
    '<svg onload="window.__dompiXss = 2"></svg>',
    '"><img src=x onerror="window.__dompiXss = 3">',
    'A&B "quotes" \'single\' <b>literal</b> &lt;img&gt; ☕'];
  const texts=attack?payloads:['Kopi','Gaji','Belanja','Transportasi'];
  window.__testTexts=texts;
  const transactions=texts.map((text,i)=>({transaction_id:i+1,category:text,note:text,analytics_category:text,
    amount:(i+1)*1000,date,type:i===1?'income':'expense',currency:attack?payloads[0]:'IDR'}));
  if(attack){transactions[2].type='expense" onclick="window.__dompiXss = 4';transactions[3].transaction_id='4"><img src=x onerror="window.__dompiXss = 5">';}
  window.__testTransactions=transactions;
  window.__reportFetch=window.fetch.bind(window);
  window.fetch=async (url,options={})=>{
    const pathname=new URL(url,location.href).pathname;
    window.__testCalls.push({path:pathname,method:options.method||'GET',body:options.body,auth:new Headers(options.headers).get('Authorization')});
    let data;
    if(pathname==='/api/profile') data={display_name:attack?payloads[0]:'Nama A'};
    else if(options.method&&options.method!=='GET') data={success:true};
    else if(pathname==='/api/summary') data={income:2000,expense:8000,balance:-6000};
    else if(pathname==='/api/cashflow') data=[{date,income:2000,expense:8000}];
    else if(pathname==='/api/categories') data=texts.map((category,i)=>({category,total:1000*(i+1)}));
    else if(pathname==='/api/analytics/monthly') data=[{month,income:2000,expense:8000,transaction_count:attack?payloads[0]:4}];
    else if(pathname==='/api/transactions') data=transactions;
    else throw new Error('Unexpected mocked API '+pathname);
    return new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
  };
}
async function runTests(index,attack){
  let checks=0;
  const eq=(actual,expected,name)=>{if(JSON.stringify(actual)!==JSON.stringify(expected))throw new Error(name+': '+JSON.stringify({actual,expected}));checks++;};
  const wait=()=>new Promise(r=>setTimeout(r,60));
  const text=(selector)=>Array.from(document.querySelectorAll(selector),e=>e.textContent.trim());
  const send=(selector,event)=>document.querySelector(selector).dispatchEvent(new Event(event,{bubbles:true}));
  try {
    for(let i=0;i<50&&document.querySelectorAll('#allTransactionList .all-transaction-item').length!==4;i++)await wait();
    await wait();
    eq(window.__testErrors,[],'page errors');
    eq(text('[data-display-name]'),Array(3).fill(attack?window.__testTexts[0]:'Nama A'),'database name rendered as text');
    eq(window.__dompiXss,0,'no executed payload');
    eq(document.querySelectorAll('img[src="x"],svg[onload],[onclick]').length,0,'no injected markup');
    for(const selector of ['#transactionList .transaction-category','#transactionList .transaction-note','#allTransactionList .transaction-category','#allTransactionList .transaction-note','.donut-legend-name'])
      eq(text(selector),window.__testTexts,selector);
    if(document.querySelector('#categoryList'))eq(text('#categoryList strong'),window.__testTexts,'category panel');
    eq(text('.analytics-category-name').sort(),[window.__testTexts[0],window.__testTexts[2],window.__testTexts[3]].sort(),'analytics categories');
    eq(Array.from(document.querySelectorAll('.transaction-amount,.transaction-type'),e=>/^(transaction-amount|transaction-type) (income|expense)$/.test(e.className)).every(Boolean),true,'class whitelist');
    if(document.querySelector('.transaction-edit-button')){
      eq(document.querySelectorAll('.transaction-edit-button')[3].dataset.transactionId,String(window.__testTransactions[3].transaction_id),'ID literal');
      eq(document.querySelector('.monthly-comparison-row').querySelectorAll('.monthly-comparison-content strong')[3].textContent.trim(),attack?window.__testTexts[0]:'4','monthly count');
      send('#transactionMenu','click');
      send('.transaction-action-button','click');
      eq(document.querySelector('.transaction-action-menu').classList.contains('open'),true,'action dropdown');
      send('.transaction-edit-button','click');
      eq(document.querySelector('#editTransactionCategory').value,window.__testTexts[0],'edit category literal');
      eq(document.querySelector('#editTransactionNote').value,window.__testTexts[0],'edit note literal');
      send('#saveEditTransaction','click');await wait();
      const update=window.__testCalls.find(c=>c.method==='PATCH');
      eq(JSON.parse(update.body).category,window.__testTexts[0],'PATCH literal');
      eq(update.path,'/api/transactions/1','PATCH path');
      send('.transaction-delete-button','click');await wait();
      eq(window.__testCalls.some(c=>c.method==='DELETE'&&c.path==='/api/transactions/1'),true,'DELETE behavior');
    }
    send('#transactionMenu','click');
    const search=document.querySelector('#transactionSearch');
    search.value=attack?'quotes':'Kopi';send('#transactionSearch','input');
    const shown=()=>Array.from(document.querySelectorAll('.all-transaction-item')).filter(e=>e.style.display!=='none').length;
    eq(shown(),1,'search');
    search.value='';send('#transactionSearch','input');
    document.querySelector('#transactionType').value='income';send('#transactionType','change');
    eq(shown(),1,'type filter');
    document.querySelector('#transactionType').value='all';send('#transactionType','change');
    eq(shown(),4,'filter reset');
    const months=document.querySelector('#transactionMonth');
    const choice=Array.from(months.options).find(o=>/^\d{4}-\d{2}$/.test(o.value));
    if(choice){months.value=choice.value;send('#transactionMonth','change');eq(shown(),4,'month filter');}
    eq(window.__testCalls.every(c=>c.auth==='tma test-init-data'),true,'auth header preserved');
    eq(window.__dompiXss,0,'no execution after rerender');
    eq(window.__testErrors,[],'no errors after interaction');
    for (const menu of ['#overviewMenu', '#transactionMenu', '#analyticsMenu']) {
      send(menu, 'click');
      eq(document.documentElement.scrollWidth <= innerWidth, true, menu+' no horizontal overflow');
      const rows = [...document.querySelectorAll('.transaction-item,.all-transaction-item')].filter(e=>e.getBoundingClientRect().width);
      for (const row of rows) {
        const cells = [...row.children].map(e=>e.getBoundingClientRect()).filter(r=>r.width&&r.height);
        eq(cells.every((a,i)=>cells.slice(i+1).every(b=>Math.min(a.right,b.right)-Math.max(a.left,b.left)<1 || Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)<1)),true,'transaction cells do not overlap');
      }
      if(innerWidth<=900 && menu==='#transactionMenu') eq([...document.querySelectorAll('.transaction-action-button')].every(e=>e.getBoundingClientRect().width>=44 && e.getBoundingClientRect().height>=44),true,'touch targets');
    }
    const result={pass:true,index,attack,checks,width:innerWidth};
    await window.__reportFetch('/results',{method:'POST',body:JSON.stringify(result)});
    const report=document.createElement('pre');report.id='xssTestResults';report.style.whiteSpace='pre-wrap';report.style.overflowWrap='anywhere';report.textContent=JSON.stringify(result);document.body.prepend(report);
  }catch(error){
    const result={pass:false,index,attack,checks,error:String(error)};
    await window.__reportFetch('/results',{method:'POST',body:JSON.stringify(result)});
    const report=document.createElement('pre');report.id='xssTestResults';report.style.whiteSpace='pre-wrap';report.style.overflowWrap='anywhere';report.textContent=JSON.stringify(result);document.body.prepend(report);
  }
}
http.createServer((req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1');
 if(url.pathname==='/results'){
  if(req.method==='POST'){let body='';req.on('data',b=>body+=b);req.on('end',()=>{const result=JSON.parse(body);results[`${result.index}-${result.attack}`]=result;console.log(JSON.stringify(result));res.end('ok');});return;}
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify(results));return;
 }
 if(url.pathname.endsWith('style.css')){const i=Number(url.searchParams.get('index')||0);res.setHeader('Content-Type','text/css');res.end(fs.readFileSync(path.join(roots[i],'static/style.css')));return;}
 if(!/^\/0$/.test(url.pathname)){res.statusCode=404;res.end();return;}
 const index=Number(url.pathname.slice(1)),attack=url.searchParams.get('normal')!=='1';
 let html=fs.readFileSync(path.join(roots[index],'templates/dashboard.html'),'utf8');
 // All application innerHTML assignments must contain constant markup only.
 for(const match of html.matchAll(/\.innerHTML\s*=\s*`([\s\S]*?)`/g))assert(!match[1].includes('${'));
 assert(!/\.innerHTML\s*=\s*\n?\s*\w+\.map/.test(html));
 html=html.replace(/<script src="https:[^"]+"><\/script>/g,'');
 html=html.replace('href="../static/style.css"',`href="/static/style.css?index=${index}"`);
 html=html.replace('<head>','<head><script>('+setup.toString()+')('+attack+');</script>');
 html=html.replace('</body>','<script>('+runTests.toString()+')('+index+','+attack+');</script></body>');
 res.setHeader('Content-Type','text/html');res.end(html);
}).listen(8765,'127.0.0.1',()=>console.log('Dashboard tests: http://127.0.0.1:8765/0; add ?normal=1 for normal-data regression.'));
