// Real-DOM checks injected by test_dashboard_xss.cjs; all API responses mocked.
module.exports = async function analyticsChecks(attack) {
    let checks=0;
    const eq=(a,b,label)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw Error(label+': '+JSON.stringify({a,b}));checks++;};
    const el=id=>document.getElementById(id);
    const send=(id,event)=>el(id).dispatchEvent(new Event(event,{bubbles:true}));
    const now=new Date();
    const key=offset=>{const d=new Date(now.getFullYear(),now.getMonth()+offset,1);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0');};
    const payload=attack?'<img src=x onerror="window.__dompiXss=1">':'Makan & Minum';
    const fixture={monthly:[{month:key(0),income:118000,expense:93000},{month:key(-1),income:100000,expense:100000},{month:key(-2),income:20000,expense:5000},{month:key(-13),income:999999,expense:999999}],
        categories:{categories:[{category:payload,total:60000},{category:'Lainnya',total:30000},{category:'Perlu ditinjau',total:3000},{category:'__remaining__',total:99999}]},
        reviews:{items:[{type:'expense',count:1,total:3000}]}};
    window.__analyticsFixture=fixture;
    el('analyticsMenu').click();
    el('analyticsPeriod').value='1';await window.loadAnalytics();
    eq(el('analyticsIncome').textContent,formatRupiah(118000),'summary income');
    eq(el('analyticsExpense').textContent,formatRupiah(93000),'summary includes review');
    eq(el('analyticsBalance').textContent,formatRupiah(25000),'summary balance');
    eq([...el('monthlyComparisonList').querySelectorAll('strong')].map(e=>e.textContent),['+18%','-7%'],'two monthly highlights');
    eq([...el('categoriesList').querySelectorAll('.analytics-category-name')].map(e=>e.textContent),[payload,'Lainnya'],'rank excludes review and bucket');
    eq([...el('categoriesList').querySelectorAll('.categories-percent')].map(e=>e.textContent),['66,7%','33,3%'],'ordinary percentages');
    eq(el('analyticsReview').hidden,false,'review visible');
    eq(el('analyticsReviewCount').textContent,'1 transaksi dengan kategori perlu diperiksa','review count');
    eq(el('analyticsPage').textContent.includes('__remaining__'),false,'no raw bucket');
    eq(el('analyticsPage').textContent.includes('__needs_category_review__'),false,'no raw review marker');
    eq(el('analyticsPage').querySelectorAll('img,svg[onload]').length,0,'no injected markup');
    eq(window.__dompiXss,0,'payload inert');
    const txBefore=window.__testCalls.filter(c=>c.path==='/api/transactions').length;
    for(const value of ['1','3','6','12']) {
        el('analyticsPeriod').value=value;await window.loadAnalytics();
        eq(el('cashflowChartArea').querySelectorAll('.cashflow-month').length,Number(value),'trend month count');
        const q=new URLSearchParams(window.__testCalls.filter(c=>c.path==='/api/categories/breakdown').at(-1).query);
        eq(q.get('start'),key(1-Number(value))+'-01','period start');
        eq(q.get('end'),key(0)+'-'+new Date(now.getFullYear(),now.getMonth()+1,0).getDate(),'period end');
        eq(document.documentElement.scrollWidth<=innerWidth,true,'no overflow '+value);
    }
    eq(el('analyticsIncome').textContent,formatRupiah(238000),'range summary excludes older data');
    const periodBefore=window.__testCalls.filter(c=>c.path==='/api/analytics/monthly').length;
    send('analyticsPeriod','change');await new Promise(r=>setTimeout(r,20));
    eq(window.__testCalls.filter(c=>c.path==='/api/analytics/monthly').length-periodBefore,1,'single period listener');
    eq(window.__testCalls.filter(c=>c.path==='/api/transactions').length,txBefore,'no recent-transactions dependency');
    eq(el('cashflowChartArea').querySelector('.cashflow-month:last-child .income-bar').title,'Pemasukan: '+formatRupiah(118000),'trend aggregate');
    el('cashflowChartArea').querySelector('.cashflow-month:last-child').click();
    eq(el('cashflowDetail').textContent.includes(formatRupiah(118000)),true,'tap readable amount');
    el('categoriesList').querySelector('button').click();
    await new Promise(r=>setTimeout(r,0));
    let q=new URLSearchParams(window.__testCalls.filter(c=>c.path==='/api/categories/transactions').at(-1).query);
    eq(q.get('category'),payload,'category drill safe text');eq(q.get('type'),'expense','drill type');
    eq(q.get('start'),key(-11)+'-01','drill bound period');
    document.querySelector('.category-drill[open]').close();await new Promise(r=>setTimeout(r,30));
    el('analyticsReviewActions').querySelector('button').click();await new Promise(r=>setTimeout(r,0));
    q=new URLSearchParams(window.__testCalls.filter(c=>c.path==='/api/categories/transactions').at(-1).query);
    eq(q.get('review'),'1','review marker filter');eq(q.get('category'),'Perlu ditinjau','review drill');
    document.querySelector('.category-drill[open]').close();await new Promise(r=>setTimeout(r,30));
    fixture.monthly=[{month:key(0),income:10,expense:20},{month:key(-1),income:0,expense:0}];await window.loadAnalytics();
    eq(el('monthlyComparisonList').querySelectorAll('strong').length,0,'zero baseline never infinite percent');
    fixture.reviews={items:[]};fixture.monthly=[];fixture.categories={categories:[]};await window.loadAnalytics();
    eq(el('analyticsReview').hidden,true,'review conditional');
    eq(el('analyticsIncome').textContent,formatRupiah(0),'empty summary');
    eq(el('monthlyComparisonList').querySelectorAll('.comparison-highlight').length,0,'no empty big comparison cards');
    eq(el('monthlyComparisonList').textContent.includes('belum cukup'),true,'comparison empty');
    eq(el('categoriesStatus').textContent.includes('Belum ada'),true,'category empty');
    eq(el('cashflowChartArea').textContent.includes('Belum ada'),true,'trend empty');
    window.__analyticsFailure=true;await window.loadAnalytics();
    eq(el('analyticsRetry').hidden,false,'retry shown');eq(el('analyticsIncome').textContent,'—','no stale summary');
    window.__analyticsFailure=false;
    const before=window.__testCalls.filter(c=>c.path==='/api/analytics/monthly').length;
    send('analyticsRetry','click');await new Promise(r=>setTimeout(r,20));
    eq(window.__testCalls.filter(c=>c.path==='/api/analytics/monthly').length-before,1,'single retry listener');
    eq(el('analyticsRetry').hidden,true,'retry success');
    window.__analyticsDelay=true;el('analyticsPeriod').value='3';const stale=window.loadAnalytics();
    el('analyticsPeriod').value='1';await window.loadAnalytics();await stale;window.__analyticsDelay=false;
    eq(el('analyticsRange').textContent.includes('–'),false,'late response ignored');
    for(const key of ['overview','transaction','account','analytics']) {
        el(key+'Menu').click();
        eq(el(key+'Menu').getAttribute('aria-current'),'page','active nav');
        eq(document.querySelectorAll('.menu-item.active').length,1,'one active pill');
        eq(el(key+'Menu').querySelector('svg').getAttribute('aria-hidden'),'true','decorative icon');
        const r=el(key+'Menu').querySelector('svg').getBoundingClientRect();eq(r.width>=18&&r.width<=20,true,'icon size');
    }
    eq(window.__testCalls.every(c=>c.auth==='tma test-init-data'),true,'auth headers');
    eq(window.__testErrors,[],'no page errors');
    // Leave a useful normal/attack preview for visual inspection.
    fixture.monthly=[{month:key(0),income:118000,expense:93000},{month:key(-1),income:100000,expense:100000},{month:key(-2),income:20000,expense:5000}];
    fixture.categories={categories:[{category:payload,total:60000},{category:'Lainnya',total:30000}]};fixture.reviews={items:[{type:'expense',count:1,total:3000}]};
    el('analyticsPeriod').value='3';await window.loadAnalytics();
    return checks;
};
