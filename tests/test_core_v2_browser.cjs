// Runs inside the EXISTING eight-viewport normal/XSS harness. No real API.
module.exports=async function coreV2Checks() {
  let checks=0;
  const check=(condition,label)=>{if(!condition)throw Error(label);checks++;};
  const original=window.fetch;
  let legacy=false,fail=false,postKeys=[];
  const injected='<img src=x onerror="window.__dompiXss=77">';
  const status=document.getElementById('coreV2Status');
  window.fetch=async (url,options={})=>{
    if(!String(url).includes('/api/core-v2/'))return original(url,options);
    if(fail)return new Response('{}',{status:503});
    let data;
    if(String(url).endsWith('/overview'))data=legacy?{cohort:'legacy'}:{cohort:'v2_purchase',balance:100,reserved:5,available:95,
      channel:'telegram',period_start:'2026-10-01',period_end:'2026-11-01',orders_enabled:true,
      quotas:[{feature:'ai_text',used:3,included:100,reserved:0,remaining:97}],products:[{code:'topup_100',credits:100,price_idr:10000}]};
    else if(options.method==='POST'){postKeys.push(JSON.parse(options.body).idempotency_key);data={checkout_available:false};}
    else data={items:[{id:injected,feature:injected,state:'committed',funding:'quota',credits:0,kind:'topup',amount:100,
                      created_at:'2026-10-27',price_idr:10000,status:'paid'}],next_cursor:null};
    return new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});
  };
  async function complete(action) {
    action();
    for(let n=0;n<150;n++){
      await new Promise(r=>setTimeout(r,10));
      if(!document.getElementById('coreV2Refresh').disabled)return;
    }
    throw Error('Core v2 UI timed out');
  }
  try {
    document.getElementById('accountMenu').click();
    await complete(()=>document.getElementById('coreV2Refresh').click());
    check(document.getElementById('coreV2Balance').textContent.includes('95 kredit'),'balance');
    check(document.getElementById('coreV2Usage').textContent.includes(injected),'literal untrusted text');
    check(!document.getElementById('coreV2Panel').querySelector('img'),'no injected elements');
    for(let n=0;n<2;n++)await complete(()=>document.getElementById('coreV2OrderForm').dispatchEvent(new Event('submit',{cancelable:true})));
    check(postKeys.length===2&&postKeys[0]===postKeys[1],'same-key retry');
    check(document.documentElement.scrollWidth<=innerWidth,'core panel no overflow');
    legacy=true;await complete(()=>document.getElementById('coreV2Refresh').click());
    check(status.textContent.includes('Hak paket lama'),'legacy message');
    check(document.getElementById('coreV2OrderForm').hidden,'legacy no topup');
    fail=true;await complete(()=>document.getElementById('coreV2Refresh').click());
    check(status.textContent.includes('Coba lagi'),'error/retry');
    check(window.__dompiXss===0,'XSS not executed');
  } finally {window.fetch=original;}
  return checks;
};
