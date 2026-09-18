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
    if(pathname==='/api/profile') { if(window.__profileError) return new Response('{}',{status:500}); data={display_name:attack?payloads[0]:'Nama A',username:window.__noUsername?null:(attack?payloads[1]:'user_a')}; }
    else if(pathname==='/api/account') { if(window.__accountError) return new Response('{}',{status:500}); data={entitlement:window.__accountEntitlement??{effective_plan:window.__unknownAccount?null:(window.__accountPlan||'free'),entitlement_source:window.__unknownAccount?null:(window.__accountPlan==='pro'?'pro_lifetime':'free'),requires_review:!!window.__unknownAccount,lifetime:window.__accountPlan==='pro',legacy_expires_at:null},plan:window.__unknownAccount?null:(window.__accountPlan||'free'),monthly_usage:window.__unknownAccount?null:(window.__accountUsage??37),usage_month:month,joined_at:window.__accountJoined??'2026-09-07',free_monthly_limit:window.__accountLimit??null}; }
    else if(pathname==='/api/transactions/reset') { if(options.method==='DELETE') { await new Promise(r=>setTimeout(r,100)); data={success:true}; } else data={count:4,token:'test-reset-token'}; }
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
  const refreshEndpoints=['/api/summary','/api/cashflow','/api/categories','/api/transactions','/api/analytics/monthly','/api/categories/breakdown','/api/reports'];
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
    eq(document.querySelector('#analyticsReport').closest('#analyticsPage')!==null,true,'report inside analytics');
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
    eq(document.querySelector('#accountExportStatus').textContent,'Belum tersedia','export not yet available');
    eq(document.querySelector('#accountAdvancedStatus').textContent,'Belum tersedia','advanced not yet available');
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
    eq(document.querySelectorAll('.monthly-comparison-empty').length,2,'zero pairs collapse to compact empty states');
    eq(document.querySelectorAll('.monthly-comparison-icon').length,0,'decorative comparison icons removed');
    eq(document.querySelector('.monthly-comparison-row:not(.monthly-comparison-empty)').querySelectorAll('.monthly-comparison-metric').length,4,'all four metric values preserved');
    if(innerWidth<=900) {
      const cells=[...document.querySelector('.monthly-comparison-metrics').children].map(e=>e.getBoundingClientRect());
      eq(Math.abs(cells[0].top-cells[1].top)<2&&Math.abs(cells[2].top-cells[3].top)<2&&cells[2].top>cells[0].bottom,true,'mobile metrics form two by two grid');
      eq(document.querySelector('.monthly-comparison-empty').getBoundingClientRect().height<120,true,'empty comparison compact');
    }
    send('#overviewMenu','click');

    window.__previousActivity=true;send('#analyticsPeriod','change');await wait();
    eq(document.querySelectorAll('.monthly-comparison-empty').length,1,'previous activity prevents false empty state');
    eq(document.querySelector('.monthly-comparison-content small').textContent.includes('100.0%'),true,'zero current month retains percentage decrease');
    window.__previousActivity=false;send('#analyticsPeriod','change');await wait();
    eq(Array.from(document.querySelectorAll('.transaction-amount,.transaction-type'),e=>/^(transaction-amount|transaction-type) (income|expense)$/.test(e.className)).every(Boolean),true,'class whitelist');
    if(document.querySelector('.transaction-edit-button')){
      eq(document.querySelectorAll('.transaction-edit-button')[3].dataset.transactionId,String(window.__testTransactions[3].transaction_id),'ID literal');
      eq(document.querySelector('.monthly-comparison-row').querySelectorAll('.monthly-comparison-content strong')[3].textContent.trim(),attack?window.__testTexts[0]:'24','monthly count');
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
    for (const endpoint of ['/api/summary','/api/cashflow','/api/categories','/api/transactions','/api/analytics/monthly','/api/categories/breakdown','/api/reports']) {
      eq(window.__testCalls.filter(c=>c.path===endpoint&&c.method==='GET').length>=3,true,'refresh after mutations '+endpoint);
    }
    const before=window.__testCalls.filter(c=>c.path==='/api/categories/breakdown').length;
    send('#analyticsCategoryMonth','change');await wait();
    eq(window.__testCalls.filter(c=>c.path==='/api/categories/breakdown').length-before,1,'single analytics category listener');
    const txBefore=window.__testCalls.filter(c=>c.path==='/api/transactions').length;
    document.querySelector('#analyticsPeriod').value='12';send('#analyticsPeriod','change');await wait();
    eq(document.querySelectorAll('.cashflow-month').length,12,'twelve months from aggregates');
    eq(window.__testCalls.filter(c=>c.path==='/api/transactions').length,txBefore,'analytics independent of transaction fetch');
    eq(document.querySelector('.cashflow-month:last-child .expense-bar').title.includes('800.000'),true,'trend uses full aggregate, not recent transactions');
    const selectedMonth=document.querySelector('#analyticsCategoryMonth').value;
    window.__categoryDelay=true;
    document.querySelector('#analyticsCategoryMonth').value='2000-01';
    document.querySelector('#analyticsCategoryMonth').value='2000-01';send('#analyticsCategoryMonth','change');
    document.querySelector('#analyticsCategoryMonth').value=selectedMonth;send('#analyticsCategoryMonth','change');
    await wait();await wait();await wait();await wait();
    eq(text('.analytics-category-name').length,4,'late response does not overwrite selected month');
    window.__categoryDelay=false;window.__analyticsError=true;
    send('#analyticsCategoryMonth','change');await wait();
    eq(document.querySelector('#categoriesStatus').textContent.includes('Gagal'),true,'analytics category error');
    eq(document.querySelector('#categoriesRetry').hidden,false,'category retry available');
    eq(document.querySelector('#categoriesContent').hidden,true,'category stale content hidden');
    window.__analyticsError=false;send('#categoriesRetry','click');await wait();
    eq(text('.analytics-category-name').length,4,'analytics retry');
    window.__monthlyError=true;send('#analyticsPeriod','change');await wait();
    eq(document.querySelector('#cashflowChartArea').textContent.includes('Gagal'),true,'monthly error state');
    window.__monthlyError=false;window.__monthlyEmpty=true;send('#analyticsRetry','click');await wait();
    eq(document.querySelector('#monthlyComparisonList').textContent.includes('Belum ada'),true,'monthly empty state');
    window.__monthlyEmpty=false;send('#analyticsRetry','click');await wait();await wait();
    eq(document.querySelectorAll('.cashflow-month').length,12,'monthly retry restores trend');
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
    for(let i=0;i<50&&document.querySelector('#categoriesContent').hidden;i++) await wait();
    eq(document.querySelector('#analyticsBreakdown').closest('main')!==null,true,'category inside main');
    eq(document.querySelector('#analyticsBreakdown').getBoundingClientRect().width>0,true,'category visible');
    eq(text('#categoriesList strong:not(.categories-amount)'),[...window.__testTexts].reverse(),'categories literal sorted');
    eq(document.querySelector('#categoriesCount').textContent,'4','category count');
    eq(text('.categories-percent'),['40%','30%','20%','10%'],'percentages');
    eq(document.documentElement.scrollWidth<=innerWidth,true,'category page no overflow');
    eq(window.__dompiXss,0,'category XSS');
    document.querySelector('#analyticsCategoryMonth').value='2000-01';send('#analyticsCategoryMonth','change');
    for(let i=0;i<50&&document.querySelector('#categoriesContent').hidden;i++) await wait();
    eq(document.querySelector('#categoriesCount').textContent,'0','empty category count');
    eq(document.querySelector('#categoriesStatus').textContent,'Belum ada pengeluaran pada periode ini.','empty state');
    send('#categoriesAllTime','click');
    for(let i=0;i<50&&document.querySelector('#categoriesContent').hidden;i++) await wait();
    eq(document.querySelector('#categoriesCount').textContent,'4','all time reload');
    send('#analyticsMenu','click');await wait();
    eq(document.querySelector('#reportsStatus').textContent,'Memuat laporan…','report loading');
    const reportReady=async()=>{for(let i=0;i<50&&document.querySelector('#reportsContent').hidden;i++)await wait();};
    await reportReady();
    eq(document.querySelector('#analyticsReport').closest('main')!==null,true,'report inside main');
    eq(document.querySelector('#analyticsReport').getBoundingClientRect().width>0,true,'report visible');
    eq(text('.reports-category-row strong:not(.reports-category-amount)'),[...window.__testTexts].reverse(),'report category literal');
    eq(text('.reports-category-row span'),['40%','30%','20%','10%'],'report percentages');
    eq(document.querySelector('#reportsIncome').textContent.includes('12.000.000'),true,'report income');
    eq(document.querySelector('#reportsExpense').textContent.includes('4.000.000'),true,'report expense');
    eq(document.querySelector('#reportsBalance').textContent.includes('8.000.000'),true,'report balance');
    eq(document.querySelector('#reportsAverage').textContent.includes('250.000'),true,'report average');
    eq(document.querySelector('#reportsCount').textContent,'24','report count');
    eq(document.querySelector('#reportsInsight').textContent.includes('turun 20%'),true,'report insight');
    eq(document.documentElement.scrollWidth<=innerWidth,true,'report no overflow');
    document.querySelector('#reportsPeriod').value='last';send('#reportsPeriod','change');await reportReady();
    eq(window.__testCalls.at(-1).query,'?period=last','last month query');
    document.querySelector('#reportsPeriod').value='custom';send('#reportsPeriod','change');await reportReady();
    eq(document.querySelector('#reportsCustom').hidden,false,'custom controls visible');
    eq(document.documentElement.scrollWidth<=innerWidth,true,'custom controls no overflow');
    document.querySelector('#reportsStart').value='2000-01-01';document.querySelector('#reportsEnd').value='2000-01-31';send('#reportsFilters','submit');await reportReady();
    eq(window.__testCalls.at(-1).query,'?period=custom&start=2000-01-01&end=2000-01-31','custom query');
    eq(document.querySelector('#reportsStatus').textContent,'Belum ada transaksi pada periode ini.','report empty');
    window.__reportsError=true;send('#reportsFilters','submit');
    for(let i=0;i<50&&document.querySelector('#reportsRetry').hidden;i++)await wait();
    eq(document.querySelector('#reportsStatus').textContent,'Gagal memuat laporan. Silakan coba lagi.','report error');
    eq(document.querySelector('#reportsContent').hidden,true,'stale content hidden on error');
    window.__reportsError=false;send('#reportsRetry','click');await reportReady();
    eq(document.querySelector('#reportsRetry').hidden,true,'report retry succeeds');
    send('#overviewMenu','click');
    eq(document.querySelector('#analyticsPage').classList.contains('page-hidden'),true,'leave reports');
    eq(document.querySelector('#overviewPage').getBoundingClientRect().width>0,true,'overview unchanged');
    document.querySelector('#reportsPeriod').value='current';send('#reportsPeriod','change');send('#analyticsMenu','click');await reportReady();
    eq(window.__dompiXss,0,'report no XSS execution');
    eq(document.querySelectorAll('#analyticsReport img,#analyticsReport svg[onload]').length,0,'report no injected markup');
    eq(window.__testCalls.every(c=>c.auth==='tma test-init-data'),true,'reports authenticated');
    eq(window.__testErrors,[],'reports no page errors');
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
http.createServer((req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1');
 if(url.pathname==='/results'){
  if(req.method==='POST'){let body='';req.on('data',b=>body+=b);req.on('end',()=>{const result=JSON.parse(body);results[`${result.index}-${result.attack}`]=result;console.log(JSON.stringify(result));res.end('ok');});return;}
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify(results));return;
 }
 if(['/static/analytics.js','/static/navigation.js'].includes(url.pathname)){res.setHeader('Content-Type','application/javascript');res.end(fs.readFileSync(path.join(roots[0],url.pathname.slice(1))));return;}
 if(url.pathname.endsWith('style.css')){const i=Number(url.searchParams.get('index')||0);res.setHeader('Content-Type','text/css');res.end(fs.readFileSync(path.join(roots[i],'static/style.css')));return;}
 if(!/^\/0$/.test(url.pathname)){res.statusCode=404;res.end();return;}
 const index=Number(url.pathname.slice(1)),attack=url.searchParams.get('normal')!=='1';
 let html=fs.readFileSync(path.join(roots[index],'templates/dashboard.html'),'utf8');
 // All application innerHTML assignments must contain constant markup only.
 const applicationSource=html+'\n'+['analytics.js','navigation.js'].map(name=>fs.readFileSync(path.join(roots[index],'static',name),'utf8')).join('\n');
 for(const match of applicationSource.matchAll(/\.innerHTML\s*=\s*`([\s\S]*?)`/g))assert(!match[1].includes('${'));
 assert(!/\.innerHTML\s*=\s*\n?\s*\w+\.map/.test(applicationSource));
 html=html.replace(/<script src="https:[^"]+"><\/script>/g,'');
 html=html.replace('href="../static/style.css"',`href="/static/style.css?index=${index}"`);
 html=html.replace('<head>','<head><script>('+setup.toString()+')('+attack+');</script>');
 html=html.replace('</body>','<script>('+runTests.toString()+')('+index+','+attack+');</script></body>');
 res.setHeader('Content-Type','text/html');res.end(html);
}).listen(8765,'127.0.0.1',()=>console.log('Dashboard tests: http://127.0.0.1:8765/0; add ?normal=1 for normal-data regression.'));
