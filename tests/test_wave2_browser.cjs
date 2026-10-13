// Round trips through real list, category-drill, and type-review editor entry points.
module.exports = async function wave2Checks() {
    let checks=0;
    const check=(value,label)=>{if(!value)throw Error('Wave 2: '+label);checks++;};
    const wait=()=>new Promise(resolve=>setTimeout(resolve,10));
    const until=async predicate=>{for(let i=0;i<100&&!predicate();i++)await wait();check(predicate(),'async editor action completed');};
    const originalFetch=window.fetch;
    const response=data=>new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
    let item, patches=[], refreshes=0;
    try {
        window.fetch=async(url,options={})=>{
            const path=new URL(url,location.href).pathname;
            if(options.method==='PATCH') {
                const changes=JSON.parse(options.body);patches.push(changes);
                Object.assign(item,changes);return response({success:true});
            }
            if(path==='/api/categories/transactions')return response({items:[{...item,description:item.category,category:'Lainnya'}],has_more:false});
            if(path==='/api/transactions/type-review') {refreshes++;return response({items:[{...item,description:item.category,fingerprint:'fixture'}],count:1,has_more:false});}
            return originalFetch(url,options);
        };
        for(const route of ['list','category','review']) {
            for(const note of ['-', '  salin\n\t☕  ', '', null, '<img src=x onerror="window.__dompiXss=99">']) {
                item={transaction_id:999,category:'  copy\ncategory  ',note,amount:10,type:'income',date:homeMonth.selected+'-01',analytics_category:'Gaji'};
                const before={...item};patches=[];
                if(route==='list') {
                    document.getElementById('transactionMenu').click();
                    document.getElementById('allTransactionList').replaceChildren();
                    renderTransactionRows([item]);
                    const row=document.querySelector('.all-transaction-item');
                    row.querySelector('.transaction-category').textContent='placeholder';
                    row.querySelector('.transaction-note').textContent='-';
                    row.querySelector('.transaction-amount').textContent='Rp999';
                    row.querySelector('.transaction-edit-button').click();
                } else {
                    document.getElementById('analyticsMenu').click();await window.loadAnalytics();
                    if(route==='category')document.querySelector('#categoriesList .category-drill-trigger').click();
                    else document.querySelector('#analyticsTypeReviewActions button').click();
                    const selector=route==='category'?'.category-drill[open] article button':'.type-review-modal[open] .type-review-primary';
                    await until(()=>document.querySelector(selector));
                    document.querySelector(selector).click();
                }
                check(document.getElementById('editTransactionCategory').value==='  copycategory  ','canonical description, not displayed label');
                check(document.getElementById('editTransactionNote').value===(note??'').replace(/[\r\n]/g,''),'literal note preserved in control '+route+' '+JSON.stringify({expected:note,actual:document.getElementById('editTransactionNote').value}));
                document.getElementById('editTransactionAmount').value='25';
                const refreshBefore=refreshes;
                document.getElementById('saveEditTransaction').click();
                await until(()=>document.getElementById('editTransactionModal').classList.contains('hidden')&&patches.length===1);
                check(JSON.stringify(patches[0])===JSON.stringify({amount:25}),'only nominal changed');
                check(JSON.stringify(item)===JSON.stringify({...before,amount:25}),'round trip preserves all other fields');
                // Allow the mutation refresh to finish before replacing the next fixture.
                await until(()=>refreshes>refreshBefore&&document.getElementById('analyticsStatus').textContent===''&&document.getElementById('transactionListStatus').textContent!=='Memuat transaksi…');
            }
        }
        check(window.__dompiXss===0,'literal note never executes');
        document.getElementById('transactionMenu').click();
        check(document.documentElement.scrollWidth<=innerWidth,'editor round trip layout');
        return checks;
    } finally {
        window.fetch=originalFetch;
        await Promise.all([loadTransactions(),window.loadAnalytics()]);
    }
};
