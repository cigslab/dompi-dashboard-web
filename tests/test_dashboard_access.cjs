const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
let value, fail=false, requests=0, delayed;
const context=vm.createContext({Promise, Error, document:{querySelectorAll:()=>[],getElementById:()=>null,addEventListener(){}},apiFetch:async()=>{requests++;if(delayed)return delayed;return {ok:!fail,json:async()=>value};}});
context.window=context;
vm.runInContext(fs.readFileSync('static/dashboard-access.js','utf8'),context);
const access=context.DashboardAccess;
const ent=(plan,source,review=false)=>({entitlement:{effective_plan:plan,entitlement_source:source,requires_review:review,legacy_expires_at:source==='pro_legacy'?'2099-01-01T00:00:00':null}});
(async()=>{
 value=ent('starter','starter_lifetime');
 await Promise.all([access.account(),access.allow(),access.allow()]);
 assert.equal(requests,1);assert.equal(await access.allow(),false);
 for(const data of [ent('pro','pro_lifetime'),ent('pro','pro_legacy')]){value=data;await access.account(true);assert.equal(await access.allow(),true);}
 for(const data of [ent('pro','pro_lifetime',true),ent('pro','starter_lifetime'),{},ent('free','free'),{entitlement:{effective_plan:'pro',entitlement_source:'pro_legacy',requires_review:false}}]){value=data;await access.account(true);assert.equal(await access.allow(),false);}
 fail=true;await assert.rejects(access.account(true));assert.equal(await access.allow(),false);
 fail=false;value=ent('pro','pro_lifetime');await access.account(true);assert.equal(await access.allow(),true);
 let resolve;delayed=new Promise(r=>resolve=r);const old=access.account(true);
 delayed=null;value=ent('starter','starter_lifetime');await access.account(true);
 resolve({ok:true,json:async()=>ent('pro','pro_lifetime')});await old;
 assert.equal(await access.allow(),false,'stale Pro response must not unlock Starter');
 console.log('PASS access gate: shared request, Starter, Pro/legacy, unknown/error/retry, stale entitlement');
})().catch(e=>{console.error(e);process.exitCode=1;});
