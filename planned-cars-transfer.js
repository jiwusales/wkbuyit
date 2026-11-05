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
 const bytes=new TextEncoder().encode(value);
 if(root.crypto?.subtle){const hash=await root.crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('');}
 // Local HTTP has no SubtleCrypto; this non-secret plan identity must match HTTPS SHA-256.
 const constants=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
 const hash=[0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19],size=Math.ceil((bytes.length+9)/64)*64,data=new Uint8Array(size),view=new DataView(data.buffer),words=new Uint32Array(64),rotate=(x,n)=>(x>>>n)|(x<<(32-n));
 data.set(bytes);data[bytes.length]=128;view.setUint32(size-8,Math.floor(bytes.length/0x20000000));view.setUint32(size-4,(bytes.length*8)>>>0);
 for(let offset=0;offset<size;offset+=64){
  for(let i=0;i<16;i++)words[i]=view.getUint32(offset+i*4);
  for(let i=16;i<64;i++){const a=words[i-15],b=words[i-2];words[i]=(words[i-16]+(rotate(a,7)^rotate(a,18)^(a>>>3))+words[i-7]+(rotate(b,17)^rotate(b,19)^(b>>>10)))>>>0;}
  let [a,b,c,d,e,f,g,h]=hash;
  for(let i=0;i<64;i++){const one=(h+(rotate(e,6)^rotate(e,11)^rotate(e,25))+((e&f)^(~e&g))+constants[i]+words[i])>>>0,two=((rotate(a,2)^rotate(a,13)^rotate(a,22))+((a&b)^(a&c)^(b&c)))>>>0;h=g;g=f;f=e;e=(d+one)>>>0;d=c;c=b;b=a;a=(one+two)>>>0;}
  [a,b,c,d,e,f,g,h].forEach((x,i)=>hash[i]=(hash[i]+x)>>>0);
 }
 return hash.map(x=>x.toString(16).padStart(8,'0')).join('');
}
async function buildPayload(cars,{category='',tab='',isHidden=()=>false,carIndexOffset=0}={}){
 if(!Number.isInteger(carIndexOffset)||carIndexOffset<0||carIndexOffset>999)throw Error('車次無法確認，請重新整理後再試。');
 if(!Array.isArray(cars)||cars.length>1000||cars.length+carIndexOffset>1000)throw Error('排車資料無法確認，請重新整理後再試。');
 // Capture all visible cards before the first await, so a later drag cannot mix snapshots.
 const prepared=[];
 cars.forEach((car,relativeIndex)=>{
  const index=relativeIndex+carIndexOffset;
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
  const items=[...aggregated.values()];
  prepared.push({host,name:`第${index+1}車`,items,index});
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
 node.textContent='.plan-extension-transfer{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin:12px 0;padding:12px;border:1px solid #e8deef;border-radius:9px;background:#fff;text-align:left}.plan-extension-transfer button{flex:0 0 auto;min-height:38px;padding:9px 14px;border:1px solid #d6c7e8;border-radius:7px;background:#f5f0fa;color:#333;font:700 13px/1.4 sans-serif;cursor:pointer}.plan-extension-transfer p{flex:1 1 220px;margin:0;font:12px/1.6 sans-serif;color:#666}.plan-extension-transfer [role=status]{flex-basis:100%;font:12px/1.6 sans-serif;overflow-wrap:anywhere}.plan-extension-transfer [role=status]:empty{display:none}.plan-car-transfer{display:flex;flex-direction:column;align-items:center;gap:6px;margin-top:8px;max-width:56px;white-space:normal}.plan-car-transfer button{width:56px;min-height:34px;box-sizing:border-box;padding:5px 3px;border:0;border-radius:6px;background:var(--theme,#D9C0FA);color:#333;font:700 10px/1.4 sans-serif;white-space:normal;cursor:pointer}.plan-car-transfer button:disabled{opacity:.55;cursor:wait}.plan-car-transfer [role=status]{display:block;max-width:56px;font:10px/1.4 sans-serif;color:#666;overflow-wrap:anywhere}.plan-car-transfer [role=status]:empty{display:none}';
 document.head.appendChild(node);
}
function mount(target,getCars,options={}){
 const document=target.ownerDocument;style(document);
 let state=states.get(target);
 if(!state){
  const panel=document.createElement('div');panel.className='plan-extension-transfer';
  const repack=document.createElement('button');repack.type='button';repack.textContent='依品項重排';repack.className='plan-repack';
  const note=document.createElement('p');note.textContent='不同品項優先放同車。每車編號下方可單獨傳送到目前 Chrome 設定檔。';
  const status=document.createElement('div');status.setAttribute('role','status');status.setAttribute('aria-live','polite');panel.append(repack,note,status);
  state={panel,repack,status,getCars,options};states.set(target,state);
  repack.onclick=()=>{if(typeof state.options.repack!=='function')return;state.options.repack();status.textContent='已依品項重排，不以金額拆車；每款限購數量維持原設定。';};
 }else{state.getCars=getCars;state.options=options;}
 if(typeof options.repack==='function')target.appendChild(state.panel);
 return state.panel;
}
function mountCar(numberColumn,getCar,options={}){
 const document=numberColumn.ownerDocument;style(document);
 let state=states.get(numberColumn);
 if(!state){
  const panel=document.createElement('div');panel.className='plan-car-transfer';
  const button=document.createElement('button');button.type='button';button.textContent='傳送';
  const status=document.createElement('span');status.setAttribute('role','status');status.setAttribute('aria-live','polite');panel.append(button,status);
  state={panel,button,status,getCar,options,busy:false};states.set(numberColumn,state);
  button.onclick=async()=>{
   if(state.busy)return;state.busy=true;button.disabled=true;status.textContent='傳送中…';
   try{
    const payload=await buildPayload([state.getCar()],{...state.options,carIndexOffset:state.options.carIndex});
    const result=await sendPayload(payload);
    status.textContent=Number(result.added)>0?'已匯入':'已在清單';
    status.title=`第 ${state.options.carIndex+1} 車：已匯入 ${Number(result.added)||0} 車，略過 ${Number(result.skipped)||0} 車重複清單。`;
   }catch(error){status.textContent=error.message||'傳送失敗，請重試。';status.title=status.textContent;}
   finally{state.busy=false;button.disabled=false;}
  };
 }else{state.getCar=getCar;state.options=options;}
 state.button.title=`只傳送第 ${Number(options.carIndex)+1} 車到目前 Chrome 設定檔，不會加購或啟動`;
 numberColumn.appendChild(state.panel);return state.panel;
}
const api={buildPayload,sendPayload,mount,mountCar};
if(typeof module==='object'&&module.exports)module.exports=api;else root.JiwuPlannedCarsTransfer=api;
})(globalThis);
