const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../static/export.js'), 'utf8');
function setup({hidden=false, period='all', status=200, bad=false, pending=null, mobile=null, native=true, accepted=true, https=true}={}) {
    const nodes = Object.fromEntries(['Controls','Download','Message','Period'].map(name => ['accountExport'+name,
        {hidden:name==='Controls' && hidden, value:period, disabled:false, textContent:''}]));
    let submit;
    nodes.accountExportControls.addEventListener=(name,fn)=>{assert.equal(name,'submit');assert(!submit);submit=fn;};
    Object.defineProperty(nodes.accountExportMessage,'innerHTML',{set(){throw Error('unsafe HTML');}});
    const calls=[], downloads=[], revoked=[], timers=[], removed=[], nativeDownloads=[], bodies=[];
    const context=vm.createContext({
        window:mobile?{location:{origin:'https://dompi.test',protocol:https?'https:':'http:'},Telegram:{WebApp:{platform:mobile,
            isVersionAtLeast:()=>native,
            downloadFile:(params,callback)=>{nativeDownloads.push(params);timers.push(()=>callback(accepted));}
        }}}:undefined,
        document:{getElementById:id=>nodes[id],body:{appendChild(){}},createElement:tag=>{
            assert.equal(tag,'a'); return {click(){assert.equal(this.hidden,true);assert.equal(this.target,undefined);downloads.push([this.href,this.download]);},remove(){removed.push(true);}};
        }},
        URL:{createObjectURL:blob=>{assert.equal(blob,'CSV BLOB');return 'blob:local';},
             revokeObjectURL:url=>revoked.push(url)},
        setTimeout:fn=>timers.push(fn),encodeURIComponent,
        apiFetch:async (url,options)=>{
            bodies.push(options);
            calls.push(url);
            if(pending)await pending;
            return {ok:status===200,status,
                headers:{get:name=> name==='Content-Disposition' ? (bad?'filename="../../bad"':'attachment; filename="dompi-export-2026-09-19.csv"') : 'text/csv; charset=utf-8'},
                json:async()=>({path:bad?'https://evil.test/leak':'/downloads/export/opaque_token==',filename:'dompi-export-2026-09-19.csv'}),
                blob:async()=>'CSV BLOB'};
        }
    });
    vm.runInNewContext(source,context);
    return {nodes,calls,downloads,revoked,timers,removed,nativeDownloads,bodies,submit:()=>submit({preventDefault(){}})};
}
(async()=>{
    let checks=0;
    for(const period of ['current_month','last_3_months','all']){
        const s=setup({period});await s.submit();
        assert.deepEqual(s.calls,['/api/export/transactions?period='+period]);
        assert.deepEqual(s.downloads,[['blob:local','dompi-export-2026-09-19.csv']]);
        assert.equal(s.nodes.accountExportDownload.disabled,false);
        assert.equal(s.nodes.accountExportPeriod.disabled,false);
        assert.equal(s.nodes.accountExportDownload.textContent,'Unduh CSV');
        assert.match(s.nodes.accountExportMessage.textContent,/Unduhan CSV diminta/);
        assert.equal(s.removed.length,1);
        s.timers.forEach(fn=>fn());assert.deepEqual(s.revoked,['blob:local']);
    } checks++;
    for(const options of [{hidden:true},{period:'all&user_id=202'}]){
        const s=setup(options);await s.submit();assert.equal(s.calls.length,0);
    } checks++;
    for(const status of [401,403,500]){
        const s=setup({status});await s.submit();
        assert.equal(s.downloads.length,0);assert.equal(s.nodes.accountExportDownload.disabled,false);
        assert.match(s.nodes.accountExportMessage.textContent,status===403?/Pro/:/gagal/);
        await s.submit();assert.equal(s.calls.length,2); // read-only retry remains usable
    } checks++;
    const invalid=setup({bad:true});await invalid.submit();assert.equal(invalid.downloads.length,0);checks++;
    let release;
    const s=setup({pending:new Promise(resolve=>release=resolve)});
    const first=s.submit();await s.submit();
    assert.equal(s.calls.length,1);assert.equal(s.nodes.accountExportDownload.disabled,true);
    assert.equal(s.nodes.accountExportPeriod.disabled,true);
    assert.equal(s.nodes.accountExportDownload.textContent,'Menyiapkan CSV…');
    release();await first;assert.equal(s.downloads.length,1);checks++;
    for(const mobile of ['ios','android']) {
        const s=setup({mobile});await s.submit();
        assert.deepEqual(s.calls,['/api/export/ticket']);
        assert.equal(s.bodies[0].method,'POST');
        assert.deepEqual(JSON.parse(s.bodies[0].body),{period:'all'});
        assert.deepEqual(JSON.parse(JSON.stringify(s.nativeDownloads)),[{url:'https://dompi.test/downloads/export/opaque_token==',file_name:'dompi-export-2026-09-19.csv'}]);
        assert.equal(s.downloads.length,0);assert.equal(s.revoked.length,0);
        s.timers.forEach(fn=>fn());assert.match(s.nodes.accountExportMessage.textContent,/Unduhan CSV diminta/);
    } checks++;
    const old=setup({mobile:'ios',native:false});await old.submit();
    assert.deepEqual(old.downloads,[['https://dompi.test/downloads/export/opaque_token==','dompi-export-2026-09-19.csv']]);
    assert.equal(old.removed.length,1);checks++;
    const cancel=setup({mobile:'android',accepted:false});await cancel.submit();cancel.timers.forEach(fn=>fn());
    assert.match(cancel.nodes.accountExportMessage.textContent,/dibatalkan/);checks++;
    for(const options of [{bad:true},{status:401},{status:403},{https:false}]) {
        const denied=setup({mobile:'ios',...options});await denied.submit();
        assert.equal(denied.nativeDownloads.length,0);assert.equal(denied.downloads.length,0);
        assert.equal(denied.nodes.accountExportDownload.disabled,false);
    } checks++;
    const desktopTelegram=setup({mobile:'tdesktop'});await desktopTelegram.submit();
    assert.equal(desktopTelegram.calls[0],'/api/export/transactions?period=all');
    assert.equal(desktopTelegram.downloads[0][0],'blob:local');checks++;
    console.log(checks+' export download UI checks passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
