'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const sqlite3=require('sqlite3'),express=require('express'),multer=require('multer');
const fs=require('fs'),os=require('os'),path=require('path'),vm=require('vm');
const {ArchiveStore,dbAll}=require('./archive-store');
const {ListingStore,normalizeListing,evidenceUrl}=require('./listing-store');
const {collectListings}=require('./listing-search');
const {mountVehicleArchive}=require('./vehicle-archive');
const pilot=require('./listing-pilot.json').listings;
const close=db=>new Promise((resolve,reject)=>db.close(e=>e?reject(e):resolve()));
function fixture(price=30000,extra={}) {
 return {sourceUrl:'https://www.yad2.co.il/item/testinbox',manufacturer:'Test',model:'Car',trim:'Basic',year:2010,price,kilometers:100000,hand:2,publishedAt:null,
 evidence:[{url:'https://www.yad2.co.il/item/testinbox',excerpt:'Test Car Basic 2010',fields:['manufacturer','model','trim','year']},
 {url:'https://www.yad2.co.il/item/testinbox',excerpt:'מחיר '+price+' ₪ ק״מ 100000 יד 2',fields:['price','kilometers','hand']}],...extra};
}
test('real pilot has sourced asking prices and km, no invented plate/date; page scripts parse',()=>{
 assert.equal(pilot.length,2);
 assert.deepEqual(pilot.map(r=>normalizeListing(r).price),[78800,84999]);
 assert.deepEqual(pilot.map(r=>normalizeListing(r).kilometers),[142000,122613]);
 for(const p of pilot){assert.equal(normalizeListing(p).publishedAt,null);assert.equal('plate' in normalizeListing(p),false);}
 assert.match(evidenceUrl(pilot[0].evidence[2].url),/manufacturer=19/);
 for(const name of ['vehicle-listings.html','vehicle-history.html']) {
  const html=fs.readFileSync(path.join(__dirname,name),'utf8');
  for(const [,script] of html.matchAll(/<script>([\s\S]*?)<\/script>/g))new vm.Script(script,{filename:name});
 }
});
test('inbox persists old vehicles, deduplicates canonical URLs and counts latest price once',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'newcar-listing-store-')),file=path.join(dir,'test.db');
 let db=new sqlite3.Database(file),store=new ArchiveStore(db),inbox=new ListingStore(store);
 try {
  const results=await Promise.all(Array.from({length:8},()=>inbox.ingest([fixture()],'test')));
  assert.equal(results.filter(r=>r[0].created).length,1);
  await inbox.ingest([fixture(28000)],'test');
  await inbox.ingest([fixture(30000)],'test');
  const query={manufacturer:'Test',model:'Car',year:2010,trim:'Basic'};
  let data=await inbox.list(query);
  assert.equal(data.listings.length,1);assert.equal(data.listings[0].versions,3);
  assert.equal(data.statistics.count,1);assert.equal(data.statistics.average,30000);
  assert.equal(data.statistics.smallSample,true);assert.equal(data.listings[0].verifiedPlate,null);
  assert.equal((await store.history('1234567')).records.length,0);
  await close(db);db=new sqlite3.Database(file);store=new ArchiveStore(db);inbox=new ListingStore(store);
  data=await inbox.list(query);assert.equal(data.listings[0].year,2010);
  assert.equal((await inbox.versions(data.listings[0].id)).length,3);
  await assert.rejects(inbox.ingest([fixture(27000),fixture(27000,{price:-1})],'test'));
  assert.equal((await inbox.list(query)).listings[0].versions,3);
 } finally{await close(db);fs.rmSync(dir,{recursive:true});}
});
test('evidence validation rejects finance, test km, unsupported dates and off-site links',()=>{
 const change=(field,excerpt)=>{const r=fixture();r.evidence=r.evidence.filter(e=>!e.fields.includes(field));r.evidence.push({url:r.sourceUrl,excerpt,fields:['price','kilometers','hand']});return r;};
 assert.throws(()=>normalizeListing(change('price','הלוואה 30000 ₪ ק״מ 100000 יד 2')));
 assert.throws(()=>normalizeListing(change('kilometers','מחיר 30000 ₪ ק״מ בטסט 100000 יד 2')));
 assert.throws(()=>normalizeListing(fixture(30000,{publishedAt:'2020-01-01'})));
 assert.throws(()=>normalizeListing(fixture(30000,{sourceUrl:'https://example.com/item/one'})));
 assert.throws(()=>normalizeListing(fixture(77777,{evidence:fixture().evidence})));
 assert.throws(()=>normalizeListing(fixture(30000,{evidence:[{url:fixture().sourceUrl,excerpt:'x '.repeat(26),fields:['manufacturer']}]})));
});
test('linking requires human evidence and is atomic under concurrent requests',async()=>{
 const db=new sqlite3.Database(':memory:'),store=new ArchiveStore(db),inbox=new ListingStore(store);
 try {
  const [r]=await inbox.ingest([fixture()],'test');
  await assert.rejects(inbox.link(r.id,{plate:'1234567',confirmed:false},'owner'));
  const body={plate:'1234567',confirmed:true,identityNote:'Test fixture: verified in attached photo'};
  const results=await Promise.allSettled([inbox.link(r.id,body,'owner'),inbox.link(r.id,{...body,plate:'7654321'},'owner')]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  const [count]=await dbAll(db,'SELECT COUNT(*) AS n FROM archive_events');assert.equal(count.n,1);
  const h=await store.history('1234567');assert.equal(h.records[0].evidenceDate,null);assert.equal(h.records[0].dateKind,'unknown');
 } finally{await close(db);}
});
test('model collector uses indexed cited data, excludes wrong cohort/uncited URLs and needs key',async()=>{
 const item=fixture(),q={manufacturer:'Test',model:'Car',year:2010,trim:'Basic'};
 let request;
 const mock=async(url,opts)=>{
  request=JSON.parse(opts.body);
  return {ok:true,json:async()=>({status:'completed',output:[
   {type:'web_search_call',status:'completed',action:{sources:[{url:item.sourceUrl}]}},
   {type:'message',content:[{type:'output_text',text:JSON.stringify({listings:[item,item,{...item,sourceUrl:'https://www.yad2.co.il/item/notcited'},{...item,year:2011}]})}]}
  ]})};
 };
 const results=await collectListings(q,{apiKey:'test-only',fetchImpl:mock});
 assert.equal(results.length,1);assert.equal(results[0].price,30000);
 assert.equal(request.tools[0].external_web_access,false);assert.equal(request.store,false);
 await assert.rejects(collectListings(q,{}),/OPENAI_API_KEY/);
 await assert.rejects(collectListings(q,{apiKey:'test-only',fetchImpl:async()=>({ok:true,json:async()=>({status:'incomplete'})})}),/לא הושלם/);
});
test('inbox routes enforce admin/origin, share search cooldown and never auto-link',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'newcar-inbox-api-'));
 const previousPath=process.env.VEHICLE_ARCHIVE_DB_PATH,previousKey=process.env.OPENAI_API_KEY;
 process.env.VEHICLE_ARCHIVE_DB_PATH=path.join(dir,'test.db');delete process.env.OPENAI_API_KEY;
 const inventory=new sqlite3.Database(':memory:'),app=express();
 app.use(express.json());app.use((req,res,next)=>{req.auth={user:'test'};next();});
 const admin=(req,res,next)=>req.headers['x-role']==='admin'?next():res.status(403).json({error:'Forbidden'});
 const archive=mountVehicleArchive(app,{sqlite3,dbPath:path.join(dir,'cars.db'),inventoryDb:inventory,requireAdmin:admin,multer,listingSearch:async()=>[fixture()]});
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 const base='http://127.0.0.1:'+server.address().port;
 const call=(url,data,extra={})=>fetch(base+url,{headers:{'x-role':'admin','Content-Type':'application/json',...extra},...(data?{method:'POST',body:JSON.stringify(data)}:{})});
 const q={manufacturer:'Test',model:'Car',year:2010,trim:'Basic'};
 try{
  assert.equal((await call('/api/vehicle-listings',null,{'x-role':'limited'})).status,403);
  assert.equal((await call('/vehicle-listings',null,{'x-role':'limited'})).status,403);
  assert.equal((await call('/api/vehicle-listings/collect',q,{Origin:'https://evil.example'})).status,403);
  assert.equal((await call('/api/vehicle-listings/collect',q)).status,503);
  process.env.OPENAI_API_KEY='test-only';
  const collected=await call('/api/vehicle-listings/collect',q);assert.equal(collected.status,200);
  const data=await collected.json();assert.equal(data.found,1);assert.equal(data.listings[0].verifiedPlate,null);
  assert.equal((await call('/api/vehicle-listings/collect',q)).status,429);
  assert.equal((await call('/api/vehicle-listings/collect',{...q,year:1899})).status,400);
  const id=data.listings[0].id;
  assert.equal((await call('/api/vehicle-listings/'+id+'/versions')).status,200);
  assert.equal((await call('/api/vehicle-listings/'+id+'/link',{plate:'1234567',confirmed:true,identityNote:'Verified in a test fixture photo.'})).status,200);
  assert.equal((await archive.store.history('1234567')).records.length,1);
 }finally{
  await new Promise(resolve=>server.close(resolve));await archive.close();await close(inventory);
  if(previousPath===undefined)delete process.env.VEHICLE_ARCHIVE_DB_PATH;else process.env.VEHICLE_ARCHIVE_DB_PATH=previousPath;
  if(previousKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=previousKey;
  fs.rmSync(dir,{recursive:true});
 }
});
