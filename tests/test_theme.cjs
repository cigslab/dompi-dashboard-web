const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync('static/theme.js','utf8');
function boot(store={},blocked=false){
 const callbacks={},attrs={},button={setAttribute:(k,v)=>attrs[k]=v,addEventListener:(k,v)=>callbacks[k]=v};
 const document={documentElement:{dataset:{}},getElementById:()=>button,addEventListener:(k,v)=>callbacks[k]=v};
 const chart={options:{plugins:{legend:{labels:{}},tooltip:{}},scales:{y:{ticks:{},grid:{}}}},update(){this.updated=true;}};
 const window={Chart:{instances:{one:chart},register(){}}};
 vm.runInNewContext(source,{window,document,localStorage:{getItem:k=>{if(blocked)throw Error();return store[k]},setItem:(k,v)=>{if(blocked)throw Error();store[k]=v}},getComputedStyle:()=>({getPropertyValue:k=>document.documentElement.dataset.theme+k})});
 return {document,window,chart,attrs,ready:()=>callbacks.DOMContentLoaded(),click:()=>callbacks.click()};
}
test('first render defaults light before DOM ready',()=>assert.equal(boot().document.documentElement.dataset.theme,'light'));
test('invalid preference defaults light',()=>assert.equal(boot({'dompi-theme':'system'}).document.documentElement.dataset.theme,'light'));
test('toggle dark persists across reload; toggle returns light',()=>{const store={},a=boot(store);a.ready();a.click();assert.equal(store['dompi-theme'],'dark');const b=boot(store);assert.equal(b.document.documentElement.dataset.theme,'dark');b.ready();b.click();assert.equal(store['dompi-theme'],'light')});
test('unavailable storage still allows toggle',()=>{const a=boot({},true);a.ready();assert.equal(a.document.documentElement.dataset.theme,'light');a.click();assert.equal(a.document.documentElement.dataset.theme,'dark')});
test('toggle updates chart ticks grid legend tooltip and accessible label',()=>{const a=boot();a.ready();a.click();assert.equal(a.chart.options.scales.y.ticks.color,'dark--muted');assert.equal(a.chart.options.scales.y.grid.color,'dark--border');assert.equal(a.chart.options.plugins.legend.labels.color,'dark--text');assert.equal(a.chart.options.plugins.tooltip.backgroundColor,'dark--surface');assert.equal(a.attrs['aria-pressed'],'true');assert.equal(a.attrs['aria-label'],'Aktifkan tema terang');assert.ok(a.chart.updated)});
test('theme script precedes CSS and toggle belongs to account page',()=>{const html=fs.readFileSync('templates/dashboard.html','utf8');assert.ok(html.indexOf('/static/theme.js')<html.indexOf('stylesheet'));assert.ok(html.indexOf('id="themeToggle"')>html.indexOf('id="accountPage"'))});
