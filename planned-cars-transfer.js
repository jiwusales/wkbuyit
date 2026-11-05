(function(root){
'use strict';
const HOSTS=new Set(['chiikawamarket.jp','nagano-market.jp','chiikawamogumogu.shop','chiikawa-pocket-goods-store.com']);
const states=new WeakMap();
function normalizeItem(item,carNumber){
 const fail=()=>{throw Error(`第 ${carNumber} 車有缺少或不支援的商品網址，請先修正後再傳送。`);};
 if(!item||typeof item.url!=='string'||item.url.length>4000)fail();
 let url;try{url=new URL(item.url);}catch{fail();}
 const host=url.hostname.toLowerCase().replace(/^www\./,''),match=url.pathname.match(/\/products\/([^/]+)\/?$/);
 if(url.protocol!=='https:'||url.port||url.username||url.password||!HOSTS.has(host)||!match)fail();
 const variant=url.searchParams.get('variant');url.hostname=host;url.pathname='/products/'+match[1];url.search='';url.hash='';if(variant)url.searchParams.set('variant',variant);
 return {host,url:url.href,title:String(item.name||item.title||'').slice(0,1000),image:typeof item.img==='string'&&/^https?:\/\//.test(item.img)?item.img.slice(0,4000):''};
}
async function digest(value){
 const bytes=new TextEncoder().encode(value),hash=await root.crypto.subtle.digest('SHA-256',bytes);
 return [...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('');
}
async function buildPayload(cars,{category='',tab='',isHidden=()=>false}={}){
 if(!Array.isArray(cars)||cars.length>1000)throw Error('排車資料無法確認，請重新整理後再試。');
 // Capture all visible cards before the first await, so a later drag cannot mix snapshots.
 const prepared=[];
 cars.forEach((car,index)=>{
  if(!Array.isArray(car?.items)||car.items.length>5000)throw Error(`第 ${index+1} 車資料無法確認。`);
  const visible=car.items.filter(item=>!isHidden(item));if(!visible.length)return;
  const aggregated=new Map();let host='';
  visible.forEach(item=>{
   const normalized=normalizeItem(item,index+1);
   if(host&&host!==normalized.host)throw Error(`第 ${index+1} 車包含不同官網的商品，請分車後再傳送。`);
   host=normalized.host;
   const existing=aggregated.get(normalized.url);
   if(existing){existing.quantity++;if(existing.quantity>999)throw Error(`第 ${index+1} 車同款商品超過 999 件，未傳送。`);}
   else aggregated.set(normalized.url,{url:normalized.url,title:normalized.title,image:normalized.image,quantity:1});
  });
  const items=[...aggregated.values()],suffix=` 第${index+1}車`,label=String(category||'網頁排車').trim()||'網頁排車';
  prepared.push({host,name:label.slice(0,60-suffix.length)+suffix,items,index});
 });
 if(!prepared.length)throw Error('目前沒有可傳送的排車商品。');
 const batches=await Promise.all(prepared.map(async({index,...batch})=>({...batch,sourceKey:'helper-plan:'+await digest(JSON.stringify([String(tab),String(category),index,batch.host,batch.items.map(item=>[item.url,item.quantity])]))})));
 return {format:'jiwu-quick-batches',version:1,batches};
}
function sendPayload(payload,{window:win=root,timeoutMs=15000}={}){
 return new Promise((resolve,reject)=>{
  const id=root.crypto.randomUUID(),origin=win.location.origin;
  let timer;
  const done=()=>{win.clearTimeout(timer);win.removeEventListener('message',receive);};
  const receive=event=>{
   if(event.source!==win||event.origin!==origin||event.data?.type!=='jiwuImportPlannedCarsResult'||event.data.id!==id)return;
   done();if(event.data.ok===true)resolve(event.data);else reject(Error(event.data.error||'傳送失敗，請更新外掛並重新整理網頁後重試。'));
  };
  win.addEventListener('message',receive);
  timer=win.setTimeout(()=>{done();reject(Error('尚未確認匯入結果，請確認外掛已更新並重新整理網頁後重試。重送會略過重複清單。'));},timeoutMs);
  try{win.postMessage({type:'jiwuImportPlannedCars',id,payload},origin==='null'?'*':origin);}catch(error){done();reject(error);}
 });
}
function style(document){
 if(document.getElementById('jiwu-plan-transfer-style'))return;
 const node=document.createElement('style');node.id='jiwu-plan-transfer-style';
 node.textContent='.plan-extension-transfer{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin:12px 0;padding:12px;border:1px solid #e8deef;border-radius:9px;background:#fff;text-align:left}.plan-extension-transfer button{flex:0 0 auto;min-height:38px;padding:9px 14px;border:0;border-radius:7px;background:var(--theme,#D9C0FA);color:#333;font:700 13px/1.4 sans-serif;cursor:pointer}.plan-extension-transfer .plan-repack{background:#f5f0fa;border:1px solid #d6c7e8}.plan-extension-transfer [hidden]{display:none!important}.plan-extension-transfer button:disabled{opacity:.55;cursor:wait}.plan-extension-transfer p{flex:1 1 220px;margin:0;font:12px/1.6 sans-serif;color:#666}.plan-extension-transfer [role=status]{flex-basis:100%;font:12px/1.6 sans-serif;overflow-wrap:anywhere}.plan-extension-transfer [role=status]:empty{display:none}';
 document.head.appendChild(node);
}
function mount(target,getCars,options={}){
 const document=target.ownerDocument;style(document);
 let state=states.get(target);
 if(!state){
  const panel=document.createElement('div');panel.className='plan-extension-transfer';
  const button=document.createElement('button');button.type='button';button.textContent='傳送到外掛';
  const repack=document.createElement('button');repack.type='button';repack.textContent='依品項重排';repack.className='plan-repack';
  const note=document.createElement('p');note.textContent='匯入目前 Chrome 設定檔的待執行清單，保留每車順序。只匯入，不會加購或啟動。';
  const status=document.createElement('div');status.setAttribute('role','status');status.setAttribute('aria-live','polite');panel.append(button,repack,note,status);
  state={panel,button,repack,status,getCars,options,busy:false};states.set(target,state);
  button.onclick=async()=>{
   if(state.busy)return;state.busy=true;button.disabled=true;repack.disabled=true;status.textContent='正在傳送排好的每一車…';
   try{const payload=await buildPayload(state.getCars(),state.options),result=await sendPayload(payload);status.textContent=`已匯入 ${Number(result.added)||0} 車，略過 ${Number(result.skipped)||0} 車重複清單。請到對應官網的小幫手查看。`;}
   catch(error){status.textContent=error.message||'傳送失敗，請重試。';}
   finally{state.busy=false;button.disabled=false;repack.disabled=false;}
  };
  repack.onclick=()=>{if(state.busy||typeof state.options.repack!=='function')return;state.options.repack();status.textContent='已依品項重排，不以金額拆車；每款限購數量維持原設定。';};
 }else{state.getCars=getCars;state.options=options;}
 state.repack.hidden=typeof state.options.repack!=='function';
 state.repack.title='把不同品項優先放同車，重新分組目前已排好的車';
 target.appendChild(state.panel);return state.panel;
}
const api={buildPayload,sendPayload,mount};
if(typeof module==='object'&&module.exports)module.exports=api;else root.JiwuPlannedCarsTransfer=api;
})(globalThis);
