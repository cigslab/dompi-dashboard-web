const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync('templates/dashboard.html', 'utf8');
const source = html.slice(html.indexOf('const ctx ='), html.indexOf('loadCashflowChart();\n</script>'));

test('cashflow without a rendering target makes no access or API request', async () => {
    assert(!html.includes('id="cashflowChart"'));
    let requests = 0, access = 0;
    const context = vm.createContext({document:{getElementById:()=>null},
        DashboardAccess:{allow:async()=>{access++;return true;},isPro:()=>true},
        homeMonth:{selected:'2026-10',url:path=>path},
        apiFetch:async()=>{requests++;return {ok:true,json:async()=>[]};},console});
    vm.runInContext(source, context);
    await context.loadCashflowChart();
    assert.equal(requests, 0);
    assert.equal(access, 0);
});

test('cashflow with a target still fetches and renders the backend contract', async () => {
    let requested, rendered;
    const canvas = {};
    const context = vm.createContext({document:{getElementById:()=>canvas},
        DashboardAccess:{allow:async()=>true,isPro:()=>true},
        homeMonth:{selected:'2026-10',url:path=>path+'?month=2026-10'},
        apiFetch:async path=>{requested=path;return {ok:true,json:async()=>[{date:'2026-10-01',income:20,expense:10}]};},
        Chart:class {constructor(target,options){rendered={target,options};}},
        DompiTheme:{color:()=> '#000'},console});
    vm.runInContext(source, context);
    await context.loadCashflowChart();
    assert.equal(requested, '/api/cashflow?month=2026-10');
    assert.equal(rendered.target, canvas);
    assert.equal(rendered.options.data.datasets[0].data[0], 20);
});
