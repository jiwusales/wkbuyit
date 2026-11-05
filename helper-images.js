/* Image enrichment runs after the product list is usable. No cart or business API writes. */
(function(root){
'use strict';
const LIMIT=4,TIMEOUT=4000,SUCCESS_TTL=30*60*1000,MISSING_TTL=60*1000,MAX_CACHE=256;
const cache=new Map(),pending=new Map(),metadata=new Map(),queue=[];let active=0;
const current=check=>{try{return check()!==false;}catch{return false;}};
function product(value){
 try{
  const u=new URL(value);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)return null;
  u.hash='';const match=u.pathname.match(/\/products\/([^/]+)\/?$/);
  const variant=match?u.searchParams.get('variant')||'':'';
  if(match){u.pathname='/products/'+match[1];u.search='';if(variant)u.searchParams.set('variant',variant);}
  else{for(const key of [...u.searchParams.keys()])if(/^utm_|^(?:fbclid|gclid)$/.test(key))u.searchParams.delete(key);u.searchParams.sort();}
  const selectedStyle=u.hostname.replace(/^www\./,'')==='munyugurumi.jp'&&u.pathname==='/itemdetail'&&u.searchParams.has('sci');
  return {key:u.href,page:u.href,variant,selectedStyle,json:match?u.origin+'/products/'+match[1]+'.js':''};
 }catch{return null;}
}
function imageURL(value,base){
 if(value&&typeof value==='object')value=value.src||value.url;
 if(typeof value!=='string'||!value.trim())return '';
 try{const u=new URL(value,base);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password?u.href:'';}catch{return '';}
}
async function read(url,json){
 const controller=new AbortController();let timer;
 try{
  const work=(async()=>{const response=await root.fetch(url,{signal:controller.signal,credentials:'omit',cache:'force-cache'});if(!response.ok||response.redirected&&new URL(response.url||url).protocol!=='https:')throw Error('Image metadata unavailable');return json?response.json():response.text();})();
  const timeout=new Promise((_,reject)=>{timer=root.setTimeout(()=>{controller.abort();reject(Error('Image metadata timeout'));},TIMEOUT);});
  return await Promise.race([work,timeout]);
 }finally{root.clearTimeout(timer);}
}
function productMetadata(url){
 const prior=metadata.get(url);if(prior&&prior.until>Date.now())return prior.promise;if(prior)metadata.delete(url);
 const entry={until:Infinity};
 entry.promise=read(url,true).then(data=>{entry.until=Date.now()+SUCCESS_TTL;return data;},()=>{entry.until=Date.now()+MISSING_TTL;return null;});
 if(metadata.size>=MAX_CACHE)metadata.delete(metadata.keys().next().value);metadata.set(url,entry);return entry.promise;
}
function selectedImage(data,target){
 if(!target.variant)return imageURL(data?.featured_image||data?.images?.[0],target.page);
 const variant=data?.variants?.find(value=>String(value.id)===target.variant);
 if(!variant)return '';
 const raw=variant.featured_image||variant.featured_media?.preview_image||variant.image||data.images?.find(value=>value&&typeof value==='object'&&value.variant_ids?.some(id=>String(id)===target.variant));
 return imageURL(raw,target.page);
}
function schedule(work){
 return new Promise(resolve=>{queue.push({work,resolve});drain();});
}
function drain(){
 while(active<LIMIT&&queue.length){
  const job=queue.shift();active++;
  Promise.resolve().then(job.work).then(result=>{active--;job.resolve(result);drain();},()=>{active--;job.resolve({image:'',cacheable:true});drain();});
 }
}
async function lookup(target,live){
 if(!live())return {image:'',cacheable:false};
 // Munyu's shared product cover is not proof of the selected sci/color image.
 if(target.selectedStyle)return {image:'',cacheable:true};
 if(target.json){
  const data=await productMetadata(target.json),url=selectedImage(data,target);if(url)return {image:url,cacheable:true};
  // A product's generic hero/OG image can depict a different selected variant.
  if(target.variant)return {image:'',cacheable:true};
 }
 if(!live())return {image:'',cacheable:false};
 try{
  const html=await read(target.page,false);if(!live())return {image:'',cacheable:false};
  const doc=new root.DOMParser().parseFromString(html,'text/html');
  const raw=doc.querySelector('meta[property="og:image:secure_url"]')?.content||doc.querySelector('meta[property="og:image"]')?.content||doc.querySelector('meta[name="twitter:image"]')?.content||'';
  return {image:imageURL(raw,target.page),cacheable:true};
 }catch{return {image:'',cacheable:true};}
}
async function getImage(target,isCurrent){
 const cached=cache.get(target.key);if(cached&&cached.until>Date.now())return cached.image;if(cached)cache.delete(target.key);
 let task=pending.get(target.key);
 if(!task){
  task={checks:new Set()};pending.set(target.key,task);
  task.checks.add(isCurrent);
  task.promise=schedule(()=>lookup(target,()=>[...task.checks].some(current))).then(result=>{
   if(result.cacheable){if(cache.size>=MAX_CACHE)cache.delete(cache.keys().next().value);cache.set(target.key,{image:result.image,until:Date.now()+(result.image?SUCCESS_TTL:MISSING_TTL)});}
   if(pending.get(target.key)===task)pending.delete(target.key);return result.image;
  });
 }else task.checks.add(isCurrent);
 return task.promise;
}
async function hydrate(rows,{isCurrent=()=>true,onImage=(row,img)=>{row.img=img;}}={}){
 if(!Array.isArray(rows)||!current(isCurrent))return;
 const missing=rows.filter(row=>row&&!row.img&&typeof row.url==='string'&&row.url);let cursor=0;
 async function worker(){
  while(cursor<missing.length&&current(isCurrent)){
   const row=missing[cursor++];if(row.img)continue;const target=product(row.url);if(!target)continue;
   try{const img=await getImage(target,isCurrent);if(img&&current(isCurrent)&&!row.img)onImage(row,img);}catch{}
  }
 }
 await Promise.all(Array.from({length:Math.min(LIMIT,missing.length)},worker));
}
const api={hydrate};if(typeof module==='object'&&module.exports)module.exports=api;else root.JiwuHelperImages=api;
})(globalThis);
