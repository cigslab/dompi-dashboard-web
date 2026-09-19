const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.join(__dirname,'..');
const source=fs.readFileSync(path.join(root,'static/analytics.js'),'utf8');
const html=fs.readFileSync(path.join(root,'templates/dashboard.html'),'utf8');
const css=fs.readFileSync(path.join(root,'static/style.css'),'utf8');
const elements={analyticsInsights:{hidden:true},analyticsInsightsList:{replaceChildren(...items){this.children=items;}}};
const context=vm.createContext({document:{getElementById:id=>elements[id]},node:(tag,cls,text)=>({tag,textContent:text})});
vm.runInContext(source.slice(source.indexOf('function shiftMonth'),source.indexOf('function monthLabel'))+
    source.slice(source.indexOf('function monthlyInsights'),source.indexOf('function renderReviews')),context);
const period={current:'2026-01',months:['2026-01']};
const monthly=[{month:'2026-01',income:118,expense:93},{month:'2025-12',income:100,expense:100}];
const categories={categories:[{category:'Makan & Minum',total:60},{category:'Lainnya',total:30},{category:'Perlu ditinjau',total:900},{category:'__remaining__',total:900}]};
const insights=(m=monthly,c=categories,p=period)=>Array.from(context.monthlyInsights(m,c,p));
let checks=0;
assert.equal(insights().length,3);assert.match(insights()[0],/Makan & Minum.*66,7%/);assert.match(insights()[1],/meningkat 18%/);assert.match(insights()[2],/menurun 7%/);checks++;
assert.equal(insights(monthly,categories,{...period,months:['2025-12','2026-01']}).length,2);checks++;
assert.deepEqual(insights([],{categories:[]}),[]);assert.equal(insights([monthly[0]],categories).length,1);checks++;
assert.equal(insights([{...monthly[0],income:0,expense:0},{...monthly[1],income:0,expense:0}],{categories:[]}).length,0);checks++;
assert.equal(insights([{...monthly[0],income:NaN,expense:Infinity},monthly[1]],{categories:[]}).length,0);checks++;
assert.match(insights([{...monthly[0],income:100,expense:100},monthly[1]],{categories:[]})[0],/sama dengan/);checks++;
const payload='<img src=x onerror=alert(1)>';
context.renderInsights([],{categories:[{category:payload,total:1}]},period);
assert.equal(elements.analyticsInsights.hidden,false);assert.match(elements.analyticsInsightsList.children[0].textContent,/<img/);
assert(!source.slice(source.indexOf('function monthlyInsights'),source.indexOf('function renderReviews')).includes('innerHTML'));checks++;
context.renderInsights([],{categories:[]},period);assert.equal(elements.analyticsInsights.hidden,true);assert.equal(elements.analyticsInsightsList.children.length,0);checks++;
assert(html.indexOf('id="monthlyComparisonList"')<html.indexOf('id="analyticsInsights"'));assert(html.indexOf('id="analyticsInsights"')<html.indexOf('id="analyticsReview"'));checks++;
for(const old of ['analyticsCategoryMonth','categoriesDonut','categoriesCount','categoriesLargest','categoriesContent','reportsFilters','reportsCategories','monthly-comparison-metrics','analytics-card-header']) {
    for(const file of [html,css,source])assert(!file.includes(old),'orphan '+old);
}
// Static literal references are either template IDs or the dynamically created chart detail.
for(const [,id] of source.matchAll(/getElementById\(['"]([^'"]+)['"]\)/g)) {
    assert(html.includes('id="'+id+'"')||id==='cashflowDetail','missing DOM '+id);
}
const insightSource=source.slice(source.indexOf('function monthlyInsights'),source.indexOf('function renderReviews'));
assert(!/apiFetch|fetch\(/.test(insightSource));checks++;
console.log(checks+' Insight/DOM cleanup checks passed');
