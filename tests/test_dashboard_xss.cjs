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
    window.__testCalls.push({path:pathname,query:new URL(url,location.href).search,method:options.method||'GET',body:options.body,auth:new Headers(options.headers).get('Authorization')});
    let data;
    const fixtureKey={'/api/analytics/monthly':'monthly','/api/categories/breakdown':'categories','/api/categories/review':'reviews'}[pathname];
    if(window.__analyticsFixture&&fixtureKey) {
      const captured=JSON.stringify(window.__analyticsFixture[fixtureKey]);
      if(window.__analyticsDelay&&new URL(url,location.href).searchParams.get('start')?.endsWith('-01')) await new Promise(r=>setTimeout(r,100));
      if(window.__analyticsFailure)return new Response('{}',{status:500});
      return new Response(captured,{headers:{'Content-Type':'application/json'}});
    }

    if(pathname==='/api/profile') { if(window.__profileError) return new Response('{}',{status:500}); data={display_name:attack?payloads[0]:'Nama A',username:window.__noUsername?null:(attack?payloads[1]:'user_a')}; }
    else if(pathname==='/api/account') { if(window.__accountError) return new Response('{}',{status:500}); data={entitlement:window.__accountEntitlement??{effective_plan:window.__unknownAccount?null:(window.__accountPlan||'free'),entitlement_source:window.__unknownAccount?null:(window.__accountPlan==='pro'?'pro_lifetime':'free'),requires_review:!!window.__unknownAccount,lifetime:window.__accountPlan==='pro',legacy_expires_at:null},plan:window.__unknownAccount?null:(window.__accountPlan||'free'),monthly_usage:window.__unknownAccount?null:(window.__accountUsage??37),usage_month:month,joined_at:window.__accountJoined??'2026-09-07',free_monthly_limit:window.__accountLimit??null}; }
    else if(pathname==='/api/export/transactions') { await new Promise(r=>setTimeout(r,100)); return new Response('date,type,description,analytics_category,amount,note\r\n',{status:window.__exportError?500:200,headers:{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="dompi-export-2026-09-19.csv"'}}); }
    else if(pathname==='/api/transactions/reset') { if(options.method==='DELETE') { await new Promise(r=>setTimeout(r,100)); data={success:true}; } else data={count:4,token:'test-reset-token'}; }
    else if(pathname.endsWith('/type-review/confirm')) { window.__typeReviewFixture={items:[],count:0,has_more:false}; data={success:true}; }
    else if(options.method&&options.method!=='GET') data={success:true};
    else if(pathname==='/api/categories/breakdown') {
      if(window.__analyticsError) return new Response('{}',{status:500});
      if(window.__categoryDelay && new URL(url,location.href).searchParams.get('month')==='2000-01') await new Promise(resolve=>setTimeout(resolve,180));
      data=new URL(url,location.href).searchParams.get('month')==='2000-01'?{total_expense:0,category_count:0,largest_category:null,categories:[]}:{total_expense:10000,category_count:4,largest_category:texts[3],categories:texts.map((category,i)=>({category,total:(i+1)*1000,transaction_count:i+1,percentage:(i+1)*10})).reverse()};
    }
    else if(pathname==='/api/reports') {
      await new Promise(resolve=>setTimeout(resolve,100));
      if(window.__reportsError) return new Response('{}',{status:500});
      const empty=new URL(url,location.href).searchParams.get('start')==='2000-01-01';
      data={start:'2026-09-01',end:'2026-09-16',days:16,income:empty?0:12000000,expense:empty?0:4000000,balance:empty?0:8000000,average_daily_expense:empty?0:250000,transaction_count:empty?0:24,categories:empty?[]:texts.map((category,i)=>({category,total:(i+1)*400000,percentage:(i+1)*10})).reverse(),comparison:{start:'2026-08-16',end:'2026-08-31',expense:5000000,change_percentage:empty?-100:-20}};
    }
    else if(pathname==='/api/summary') data={income:2000,expense:8000,balance:-6000};
    else if(pathname==='/api/cashflow') data=[{date,income:2000,expense:8000}];
    else if(pathname==='/api/categories') data=texts.map((category,i)=>({category,total:1000*(i+1)}));
    else if(pathname==='/api/analytics/monthly') { if(window.__monthlyError) return new Response('{}',{status:500}); data=window.__monthlyEmpty?[]:[{month,income:200000,expense:800000,transaction_count:attack?payloads[0]:24}]; if(window.__previousActivity){ const previous=new Date(now.getFullYear(),now.getMonth()-1,1); data=[{month,income:0,expense:0,transaction_count:0},{month:`${previous.getFullYear()}-${String(previous.getMonth()+1).padStart(2,'0')}`,income:10,expense:10,transaction_count:1}]; } }
    else if(pathname==='/api/transactions/type-review') data=window.__typeReviewFixture||{items:[],count:0,has_more:false};
    else if(pathname==='/api/categories/review') data={items:[]};
    else if(pathname==='/api/categories/transactions') data={items:[],has_more:false};
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
  const refreshEndpoints=['/api/summary','/api/cashflow','/api/categories','/api/transactions','/api/analytics/monthly','/api/categories/breakdown','/api/categories/review'];
  const counts=()=>Object.fromEntries(refreshEndpoints.map(path=>[path,window.__testCalls.filter(c=>c.path===path&&c.method==='GET').length]));
  const assertRefresh=async(before,label)=>{
    for(let i=0;i<50&&refreshEndpoints.some(path=>counts()[path]<=before[path]);i++) await wait();
    for(const path of refreshEndpoints) eq(counts()[path]-before[path],1,label+' refresh '+path);
  };
  const send=(selector,event)=>document.querySelector(selector).dispatchEvent(new Event(event,{bubbles:true}));
  try {
    for(let i=0;i<50&&document.querySelectorAll('#allTransactionList .all-transaction-item').length!==4;i++)await wait();
    await wait();
    eq(window.__testErrors,[],'page errors');
    eq(text('[data-display-name]'),Array(4).fill(attack?window.__testTexts[0]:'Nama A'),'database name rendered as text');
    eq(text('.menu .menu-item'),['Beranda','Transaksi','Analitik','Akun'],'four primary destinations');
    eq(document.querySelectorAll('#categoriesPage,#reportsPage,#categoriesMenu,#reportsMenu').length,0,'legacy pages and menus removed');
    eq(document.querySelector('#analyticsBreakdown').closest('#analyticsPage')!==null,true,'breakdown inside analytics');
    eq(document.querySelector('#analyticsSummaryTitle').closest('#analyticsPage')!==null,true,'summary inside analytics');
    if(innerWidth<=900) {
      const nav=document.querySelector('.menu').getBoundingClientRect();
      eq(getComputedStyle(document.querySelector('.sidebar')).position,'sticky','top navigation sticky');
      window.scrollTo(0,200);await wait();
      eq(Math.abs(document.querySelector('.sidebar').getBoundingClientRect().top)<2,true,'top navigation stays anchored on scroll');
      window.scrollTo(0,0);
      eq([...document.querySelectorAll('.menu-item')].every(e=>e.getBoundingClientRect().height>=44),true,'navigation touch targets');
      eq(getComputedStyle(document.querySelector('.menu')).position,'static','no fixed bottom navigation');
    }

    eq(document.querySelector('#accountPlan').textContent,'Paket Free','backend plan rendered');
    send('#accountMenu','click');await wait();
    eq(document.querySelector('#accountPage').classList.contains('page-hidden'),false,'account visible');
    await wait();await wait();
    eq(document.querySelector('#accountUsername').textContent,attack?'@<svg onload="window.__dompiXss = 2"></svg>':'@user_a','username rendered as text');
    eq(document.querySelector('#accountUsage').textContent,'37 pencatatan digunakan','account ledger independent of report count');
    window.__profileError=true;window.__accountError=true;
    await loadProfile();await wait();await wait();
    eq(document.querySelector('#accountProfileRetry').hidden,false,'profile error retry');
    eq(document.querySelector('#accountUsageRetry').hidden,false,'usage error retry');
    window.__profileError=false;window.__accountError=false;window.__noUsername=true;
    send('#accountProfileRetry','click');await wait();await wait();await wait();
    eq(document.querySelector('#accountUsername').hidden,true,'missing username hidden');
    eq(document.querySelector('#accountUsage').textContent,'37 pencatatan digunakan','usage retry recovered');
    eq(document.querySelector('#accountProfileRetry').hidden,true,'profile retry recovered');
    eq(document.querySelector('#accountQuotaProgress').hidden,true,'missing limit has no progress');
    window.__accountLimit=50;await loadAccountUsage();
    eq(document.querySelector('#accountUsage').textContent,'37 / 50 pencatatan bulan ini','configured Free usage and limit');
    eq(document.querySelector('#accountQuotaProgress').hidden,false,'Free progress visible');
    eq(document.querySelector('#accountQuotaProgress').value,37,'Free progress value');
    eq(document.querySelector('#accountQuotaProgress').max,50,'Free progress maximum');
    eq(document.querySelector('#accountQuotaRemaining').hidden,true,'no warning with ample quota');
    eq(document.querySelector('#accountJoined').textContent,'Bergabung 7 Sep 2026','human joined date');
    eq(formatAccountJoined('2026-02-30'),'','invalid date hidden');
    eq(formatAccountJoined('<img src=x onerror=alert(1)>'),'','unsafe date hidden');
    eq(text('.account-action > span:first-child'),['Upgrade ke Pro','Bantuan & Feedback','Kebijakan Privasi','Syarat & Ketentuan','Hapus Data / Akun'],'compact account action list');
    const callsBeforeActions=window.__testCalls.length;
    document.querySelectorAll('button.account-action:disabled').forEach(button=>button.click());
    eq(window.__testCalls.length,callsBeforeActions,'placeholders never call API');
    eq(document.querySelector('#accountDeleteOpen').disabled,false,'transaction reset entry active');
    eq([...document.querySelectorAll('a.account-action')].map(a=>a.getAttribute('href')),['/upgrade','/help','/privacy','/terms'],'public upgrade help and legal links active');
    window.__accountUsage=49;await loadAccountUsage();
    eq(document.querySelector('#accountQuotaRemaining').textContent,'Tersisa 1 pencatatan bulan ini','near limit message');
    eq(document.querySelector('#accountQuotaRemaining').hidden,false,'near limit visible');

    window.__accountUsage=70;await loadAccountUsage();
    eq(document.querySelector('#accountUsage').textContent,'70 / 50 pencatatan bulan ini','over limit count preserved');
    eq(document.querySelector('#accountQuotaProgress').value,50,'over limit progress capped');
    window.__accountPlan='pro';await loadAccountUsage();
    eq(document.querySelector('#accountQuotaProgress').hidden,true,'Pro hides Free progress');
    eq(document.querySelector('#accountQuotaRemaining').hidden,true,'Pro hides quota warning');
    eq(document.querySelector('#accountUsage').textContent,'Unlimited — pencatatan tanpa batas','Pro unlimited status');
    window.__accountEntitlement={effective_plan:'starter',entitlement_source:'starter_lifetime',requires_review:false};
    window.__accountUsage=149;await loadAccountUsage();
    eq(document.querySelector('#accountPlan').textContent,'Starter Lifetime','Starter badge');
    eq(document.querySelector('#accountUsage').textContent,'149 / 150 transaksi bulan ini','Starter quota');
    for(const name of ['Receipt','Export','Advanced']) {
      eq(document.querySelector('#account'+name+'Lock').hidden,false,'Starter feature lock '+name);
      eq(document.querySelector('#account'+name+'Lock').getAttribute('href'),'/upgrade','locked feature upgrade route');
    }
    window.__accountEntitlement={effective_plan:'pro',entitlement_source:'pro_lifetime',requires_review:false};await loadAccountUsage();
    eq(document.querySelector('#accountUpgradeAction').hidden,true,'Pro upgrade hidden');
    eq(document.querySelector('#accountReceiptStatus').textContent,'Aktif','Pro receipt active');
    eq(document.querySelector('#accountExportStatus').textContent,'Aktif','Pro export active');
    eq(document.querySelector('#accountExportControls').hidden,false,'Pro export controls visible');
    eq(document.querySelector('#accountAdvancedStatus').textContent,'Belum tersedia','advanced not yet available');
    for(const id of ['accountExportPanel','accountExportPeriod','accountExportDownload']) {
      const el=document.getElementById(id), rect=el.getBoundingClientRect();
      eq(rect.left>=0&&rect.right<=innerWidth,true,'export within viewport '+id);
      eq(el.scrollWidth<=el.clientWidth+1,true,'export no horizontal overflow '+id);
    }
    eq([...document.querySelector('#accountExportPeriod').options].map(o=>o.value),['current_month','last_3_months','all'],'export periods');
    window.__exportError=true;
    send('#accountExportControls','submit');
    eq(document.querySelector('#accountExportPeriod').disabled,true,'export picker busy');
    for(let i=0;i<50&&document.querySelector('#accountExportDownload').disabled;i++)await wait();
    eq(document.querySelector('#accountExportMessage').textContent,'Export gagal. Silakan coba lagi.','export error');
    eq(document.querySelector('#accountExportPeriod').disabled,false,'export retry enabled');
    window.__exportError=false;

    window.__accountEntitlement.requires_review=true;await loadAccountUsage();
    eq(document.querySelector('#accountReceiptStatus').textContent,'Perlu ditinjau','ambiguous premium not active');
    window.__accountEntitlement=null;
    window.__accountPlan='free';window.__accountLimit='50';await loadAccountUsage();
    eq(document.querySelector('#accountQuotaProgress').hidden,true,'invalid limit hides progress');
    window.__accountLimit=50;window.__unknownAccount=true;await loadAccountUsage();
    eq(document.querySelector('#accountQuotaProgress').hidden,true,'unknown usage hides progress');
    window.__unknownAccount=false;window.__accountUsage=37;window.__accountLimit=null;

    eq(document.querySelectorAll('main > :not(.page-hidden):not(dialog)').length,1,'one visible page');
    send('#overviewMenu','click');
    eq(window.__dompiXss,0,'no executed payload');
    eq(document.querySelectorAll('img[src="x"],svg[onload],[onclick]').length,0,'no injected markup');
    for(const selector of ['#transactionList .transaction-category','#transactionList .transaction-note','#allTransactionList .transaction-category','#allTransactionList .transaction-note','.donut-legend-name'])
      eq(text(selector),window.__testTexts,selector);
    if(document.querySelector('#categoryList'))eq(text('#categoryList strong'),window.__testTexts,'category panel');
    eq(text('.analytics-category-name').sort(),[...window.__testTexts].sort(),'analytics categories');
    send('#analyticsMenu','click');await wait();
    send('#overviewMenu','click');
    eq(Array.from(document.querySelectorAll('.transaction-amount,.transaction-type'),e=>/^(transaction-amount|transaction-type) (income|expense)$/.test(e.className)).every(Boolean),true,'class whitelist');
    if(document.querySelector('.transaction-edit-button')){
      eq(document.querySelectorAll('.transaction-edit-button')[3].dataset.transactionId,String(window.__testTransactions[3].transaction_id),'ID literal');
      send('#transactionMenu','click');
      send('.transaction-action-button','click');
      eq(document.querySelector('.transaction-action-menu').classList.contains('open'),true,'action dropdown');
      send('.transaction-edit-button','click');
      eq(document.querySelector('#editTransactionCategory').value,window.__testTexts[0],'edit category literal');
      eq(document.querySelector('#editTransactionNote').value,window.__testTexts[0],'edit note literal');
      const beforeEdit=counts();
      send('#saveEditTransaction','click');await assertRefresh(beforeEdit,'edit');
      const update=window.__testCalls.find(c=>c.method==='PATCH');
      eq(JSON.parse(update.body).category,window.__testTexts[0],'PATCH literal');
      eq(update.path,'/api/transactions/1','PATCH path');
      const beforeDelete=counts();
      send('.transaction-delete-button','click');await assertRefresh(beforeDelete,'delete');
      eq(window.__testCalls.some(c=>c.method==='DELETE'&&c.path==='/api/transactions/1'),true,'DELETE behavior');
    }
    for (const endpoint of ['/api/summary','/api/cashflow','/api/categories','/api/transactions','/api/analytics/monthly','/api/categories/breakdown','/api/categories/review']) {
      eq(window.__testCalls.filter(c=>c.path===endpoint&&c.method==='GET').length>=3,true,'refresh after mutations '+endpoint);
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
    for (const menu of ['#overviewMenu', '#transactionMenu', '#analyticsMenu', '#accountMenu']) {
      send(menu, 'click');
      const expectedPage=menu.slice(1).replace('Menu','Page');
      eq([...document.querySelectorAll('main > [id$=Page]:not(.page-hidden)')].map(e=>e.id),[expectedPage],'only target page visible '+menu);
      eq([...document.querySelectorAll('.menu [aria-current=page]')].map(e=>e.id),[menu.slice(1)],'active navigation '+menu);
      eq(document.documentElement.scrollWidth <= innerWidth, true, menu+' no horizontal overflow');
      const rows = [...document.querySelectorAll('.transaction-item,.all-transaction-item')].filter(e=>e.getBoundingClientRect().width);
      for (const row of rows) {
        const cells = [...row.children].map(e=>e.getBoundingClientRect()).filter(r=>r.width&&r.height);
        eq(cells.every((a,i)=>cells.slice(i+1).every(b=>Math.min(a.right,b.right)-Math.max(a.left,b.left)<1 || Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)<1)),true,'transaction cells do not overlap');
      }
      if(innerWidth<=900 && menu==='#transactionMenu') eq([...document.querySelectorAll('.transaction-action-button')].every(e=>e.getBoundingClientRect().width>=44 && e.getBoundingClientRect().height>=44),true,'touch targets');
    }
    send('#analyticsMenu','click');await wait();
    checks+=await window.analyticsChecks(attack);
    send('#accountMenu','click');await wait();
    const resetDeletes=()=>window.__testCalls.filter(c=>c.path==='/api/transactions/reset'&&c.method==='DELETE').length;
    send('#accountDeleteOpen','click');
    eq(resetDeletes(),0,'opening dialog never deletes');
    send('#accountDeleteClose','click');
    eq(document.querySelector('#accountDeleteDialog').open,false,'cancel closes dialog');
    send('#accountDeleteOpen','click');send('#accountDeleteNext','click');await wait();
    eq(document.querySelector('#accountDeleteForm').hidden,false,'second confirmation shown');
    send('#accountDeleteForm','submit');eq(resetDeletes(),0,'typed confirmation required');
    document.querySelector('#accountDeleteInput').value='HAPUS';
    send('#accountDeleteForm','submit');send('#accountDeleteForm','submit');
    eq(resetDeletes(),1,'double submit sends one DELETE');
    for(let i=0;i<50&&!document.querySelector('#accountDeleteStatus').textContent.startsWith('Berhasil.');i++)await wait();
    eq(document.querySelector('#accountDeleteForm').hidden,true,'success prevents resubmit');
    eq(document.querySelector('#accountDeleteStatus').textContent.startsWith('Berhasil.'),true,'explicit success state');
    await wait();await wait();send('#accountDeleteClose','click');
    const result={pass:true,index,attack,checks,width:innerWidth};
    await window.__reportFetch('/results',{method:'POST',body:JSON.stringify(result)});
    const report=document.createElement('pre');report.id='xssTestResults';report.style.whiteSpace='pre-wrap';report.style.overflowWrap='anywhere';report.textContent=JSON.stringify(result);document.body.prepend(report);
  }catch(error){
    const result={pass:false,index,attack,checks,error:String(error)};
    await window.__reportFetch('/results',{method:'POST',body:JSON.stringify(result)});
    const report=document.createElement('pre');report.id='xssTestResults';report.style.whiteSpace='pre-wrap';report.style.overflowWrap='anywhere';report.textContent=JSON.stringify(result);document.body.prepend(report);
  }
}
// Targeted Export UI verification: /0?export=1 (optional &normal=1).
// Does not replace the full dashboard/XSS checkpoint gate.
async function runExportTests(index,attack) {
  let checks=0;
  const check=(value,label)=>{if(!value)throw Error(label);checks++;};
  const wait=()=>new Promise(r=>setTimeout(r,60));
  try {
    document.querySelector('#accountMenu').click();
    for(let i=0;i<50&&document.querySelector('#accountExportPanel').hidden;i++)await wait();
    for(const [plan,source] of [['free','free'],['starter','starter_lifetime'],['pro','pro_lifetime'],['pro','pro_legacy']]) {
      window.__accountEntitlement={effective_plan:plan,entitlement_source:source,requires_review:false,legacy_expires_at:'2099-01-01T00:00:00'};
      await loadAccountUsage();
      check(document.querySelector('#accountExportControls').hidden===(plan!=='pro'),'controls '+source);
      check(document.querySelector('#accountExportLock').hidden===(plan==='pro'),'lock '+source);
    }
    for(const id of ['accountExportPanel','accountExportPeriod','accountExportDownload']) {
      const el=document.getElementById(id),r=el.getBoundingClientRect();
      check(r.left>=0&&r.right<=innerWidth,'viewport '+id);
      check(el.scrollWidth<=el.clientWidth+1,'overflow '+id);
    }
    check(document.querySelector('#accountExportPeriod').options.length===3,'three periods');
    window.__exportError=true;
    document.querySelector('#accountExportControls').requestSubmit();
    check(document.querySelector('#accountExportDownload').disabled,'busy button');
    check(document.querySelector('#accountExportPeriod').disabled,'busy picker');
    for(let i=0;i<50&&document.querySelector('#accountExportDownload').disabled;i++)await wait();
    check(document.querySelector('#accountExportMessage').textContent.includes('gagal'),'error message');
    check(!document.querySelector('#accountExportPeriod').disabled,'retry picker');
    check(window.__dompiXss===0,'XSS payload inert');
    check(window.__testErrors.length===0,'no script errors');
    window.__exportError=false;
    const result={scope:'export',pass:true,index,attack,checks,width:innerWidth};
    await window.__reportFetch('/results',{method:'POST',body:JSON.stringify(result)});
    const report=document.createElement('pre');report.id='xssTestResults';report.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere';report.textContent=JSON.stringify(result);document.body.prepend(report);
  } catch(error) {
    const result={scope:'export',pass:false,index,attack,checks,error:String(error),width:innerWidth};
    await window.__reportFetch('/results',{method:'POST',body:JSON.stringify(result)});
    const report=document.createElement('pre');report.id='xssTestResults';report.textContent=JSON.stringify(result);document.body.prepend(report);
  }
}
async function runAnalyticsTests(index,attack) {
  let result;
  try { result={scope:'analytics',pass:true,index,attack,checks:await window.analyticsChecks(attack),width:innerWidth}; }
  catch(error) { result={scope:'analytics',pass:false,index,attack,error:String(error),width:innerWidth}; }
  await window.__reportFetch('/results',{method:'POST',body:JSON.stringify(result)});
  const report=document.createElement('pre');report.id='xssTestResults';report.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere';report.textContent=JSON.stringify(result);document.body.prepend(report);
}
// Focused finishing check: /0?insights=1. No analytics/browser matrix rerun.
async function runInsightTests(index,attack) {
  let checks=0,result;
  const check=(ok,label)=>{if(!ok)throw Error(label);checks++;};
  try {
    const now=new Date(),key=offset=>{const d=new Date(now.getFullYear(),now.getMonth()+offset,1);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');};
    const payload='<img src=x onerror="window.__dompiXss=1">';
    window.__analyticsFixture={monthly:[{month:key(0),income:118000,expense:93000},{month:key(-1),income:100000,expense:100000}],categories:{categories:[{category:payload,total:60000},{category:'Lainnya',total:30000}]},reviews:{items:[{type:'expense',count:1,total:3000}]}};
    document.getElementById('analyticsMenu').click();document.getElementById('analyticsPeriod').value='1';await window.loadAnalytics();
    const section=document.getElementById('analyticsInsights'),list=document.getElementById('analyticsInsightsList');
    check(!section.hidden&&list.children.length===3,'three supported insights');
    check(list.textContent.includes(payload)&&!list.querySelector('img'),'XSS literal');
    check(window.__dompiXss===0,'no execution');
    check(list.textContent.includes('18%')&&list.textContent.includes('7%'),'monthly changes');
    check(document.getElementById('monthlyComparisonList').compareDocumentPosition(section)&Node.DOCUMENT_POSITION_FOLLOWING,'after comparison');
    check(section.compareDocumentPosition(document.getElementById('analyticsReview'))&Node.DOCUMENT_POSITION_FOLLOWING,'before review');
    check(section.scrollWidth<=section.clientWidth&&document.documentElement.scrollWidth<=innerWidth,'no overflow');
    window.__analyticsFixture.categories={categories:[]};window.__analyticsFixture.monthly=[];await window.loadAnalytics();
    check(section.hidden&&list.children.length===0,'hide unsupported');
    window.__analyticsFixture.categories={categories:[{category:'Makan & Minum',total:60000},{category:'Lainnya',total:30000}]};
    window.__analyticsFixture.monthly=[{month:key(0),income:118000,expense:93000},{month:key(-1),income:100000,expense:100000}];
    await window.loadAnalytics();
    result={scope:'insights',pass:true,checks,width:innerWidth};
  } catch(error) {result={scope:'insights',pass:false,checks,error:String(error),width:innerWidth};}
  await window.__reportFetch('/results',{method:'POST',body:JSON.stringify(result)});
  const report=document.createElement('pre');report.id='xssTestResults';report.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere';report.textContent=JSON.stringify(result);document.body.prepend(report);
}
// Focused mismatch/confirmation browser check: /0?type-review=1.
async function runTypeReviewTests() {
  let checks=0,result;
  const check=(ok,label)=>{if(!ok)throw Error(label);checks++;};
  const wait=()=>new Promise(r=>setTimeout(r,30));
  try {
    const payload='<img src=x onerror="window.__dompiXss=1">';
    window.__typeReviewFixture={count:1,has_more:false,items:[{transaction_id:1,type:'expense',description:payload,note:payload.repeat(6),amount:5000,date:'2026-09-01',fingerprint:'mock-server-fingerprint'}]};
    document.getElementById('analyticsMenu').click();await window.loadAnalytics();
    const section=document.getElementById('analyticsTypeReview');
    check(!section.hidden,'mismatch visible');
    check(section.textContent.includes('1 transaksi perlu diperiksa'),'review copy');
    section.querySelector('button').click();
    for(let i=0;i<50&&!document.querySelector('.category-drill article');i++)await wait();
    const dialog=document.querySelector('.category-drill');
    check(dialog.open,'dialog open');
    check(dialog.textContent.includes(payload)&&!dialog.querySelector('img'),'XSS safe text');
    check(dialog.textContent.includes('Perbaiki transaksi'),'edit CTA');
    check(dialog.scrollWidth<=dialog.clientWidth,'dialog no overflow');
    check(document.documentElement.scrollWidth<=innerWidth,'page no overflow');
    [...dialog.querySelectorAll('button')].find(b=>b.textContent==='Sudah benar').click();
    for(let i=0;i<50&&document.querySelector('.category-drill');i++)await wait();
    check(!document.querySelector('.category-drill'),'empty dialog closed');
    check(section.hidden,'zero mismatch hides section');
    await window.loadAnalytics();check(section.hidden,'reload stays hidden');
    const call=window.__testCalls.find(c=>c.path.endsWith('/type-review/confirm'));
    check(call.method==='POST'&&JSON.parse(call.body).fingerprint==='mock-server-fingerprint','confirmation request');
    check(window.__dompiXss===0&&window.__testErrors.length===0,'no XSS or script error');
    result={scope:'type-review',pass:true,checks,width:innerWidth};
  } catch(error) {result={scope:'type-review',pass:false,checks,error:String(error),width:innerWidth};}
  await window.__reportFetch('/results',{method:'POST',body:JSON.stringify(result)});
  const report=document.createElement('pre');report.id='xssTestResults';report.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere';report.textContent=JSON.stringify(result);document.body.prepend(report);
}
http.createServer((req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1');
 if(url.pathname==='/results'){
  if(req.method==='POST'){let body='';req.on('data',b=>body+=b);req.on('end',()=>{const result=JSON.parse(body);results[`${result.index}-${result.attack}`]=result;console.log(JSON.stringify(result));res.end('ok');});return;}
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify(results));return;
 }
 if(['/static/analytics.js','/static/navigation.js','/static/export.js'].includes(url.pathname)){res.setHeader('Content-Type','application/javascript');res.end(fs.readFileSync(path.join(roots[0],url.pathname.slice(1))));return;}
 if(url.pathname.endsWith('style.css')){const i=Number(url.searchParams.get('index')||0);res.setHeader('Content-Type','text/css');res.end(fs.readFileSync(path.join(roots[i],'static/style.css')));return;}
 if(!/^\/0$/.test(url.pathname)){res.statusCode=404;res.end();return;}
 const index=Number(url.pathname.slice(1)),attack=url.searchParams.get('normal')!=='1';
 let html=fs.readFileSync(path.join(roots[index],'templates/dashboard.html'),'utf8');
 // All application innerHTML assignments must contain constant markup only.
 const applicationSource=html+'\n'+['analytics.js','navigation.js','export.js'].map(name=>fs.readFileSync(path.join(roots[index],'static',name),'utf8')).join('\n');
 for(const match of applicationSource.matchAll(/\.innerHTML\s*=\s*`([\s\S]*?)`/g))assert(!match[1].includes('${'));
 assert(!/\.innerHTML\s*=\s*\n?\s*\w+\.map/.test(applicationSource));
 html=html.replace(/<script src="https:[^"]+"><\/script>/g,'');
 html=html.replace('href="../static/style.css"',`href="/static/style.css?index=${index}"`);
 html=html.replace('<head>','<head><script>('+setup.toString()+')('+attack+');</script>');
 html=html.replace('</body>','<script>window.analyticsChecks='+require('./test_analytics_ui.cjs').toString()+';</script></body>');
 html=html.replace('</body>','<script>('+(url.searchParams.get('type-review')==='1'?runTypeReviewTests:url.searchParams.get('insights')==='1'?runInsightTests:url.searchParams.get('analytics')==='1'?runAnalyticsTests:url.searchParams.get('export')==='1'?runExportTests:runTests).toString()+')('+index+','+attack+');</script></body>');
 res.setHeader('Content-Type','text/html');res.end(html);
}).listen(8765,'127.0.0.1',()=>console.log('Dashboard tests: http://127.0.0.1:8765/0; add ?normal=1 for normal-data regression.'));
