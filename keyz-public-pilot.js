'use strict';
// Bounded public-document trial. No login, private APIs, proxies, retries or scheduler.
const path=require('path');
const {ListingStore,normalizeListing,publicationDateIn,handIn}=require('./listing-store');
const {ArchiveStore,dbAll,dbRun}=require('./archive-store');
const ORIGIN='https://keyz.ai', USER_AGENT='NewCarSourceCheck/0.1';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function decode(value) {
  return value.replace(/&(?:quot|apos|amp|lt|gt|nbsp|#\d+|#x[\da-f]+);/gi,entity=>{
    const names={'&quot;':'"','&apos;':"'",'&amp;':'&','&lt;':'<','&gt;':'>','&nbsp;':' '};
    if(names[entity.toLowerCase()]!==undefined)return names[entity.toLowerCase()];
    const n=entity[2].toLowerCase()==='x'?parseInt(entity.slice(3,-1),16):Number(entity.slice(2,-1));
    return n>0&&n<=0x10ffff?String.fromCodePoint(n):'';
  });
}
function visibleText(html) {
  return decode(html.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi,' ').replace(/<[^>]*>/g,' ')).replace(/\s+/g,' ').trim();
}
function allowedUrl(value) {
  const u=new URL(value);
  if(u.origin!==ORIGIN || u.username || u.password || u.search || u.hash ||
    !/^\/(robots\.txt|sitemaps\/sitemap-index\.xml|sitemaps\/cars\/listings-\d+\.xml|cars\/listings\/[1-9]\d*)$/.test(u.pathname))
    throw new Error('URL outside the public pilot allowlist');
  return u.href;
}
function xmlLinks(xml,kind) {
  const rule=kind==='maps'?/^https:\/\/keyz\.ai\/sitemaps\/cars\/listings-\d+\.xml$/:/^https:\/\/keyz\.ai\/cars\/listings\/[1-9]\d*$/;
  return [...new Set([...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)].map(m=>decode(m[1])).filter(u=>rule.test(u)))];
}
function robotsPolicy(body) {
  // Fail closed for restrictive/unknown policies; this is deliberately not a general crawler.
  if(!/^user-agent\s*:\s*\*\s*$/im.test(body)||!/^allow\s*:\s*\/\s*$/im.test(body))throw new Error('Robots policy needs review');
  if(body.split(/\r?\n/).some(line=>/^disallow\s*:\s*\S/i.test(line.split('#')[0].trim())))throw new Error('Robots restriction: pilot stopped');
  const crawl=[...body.matchAll(/^crawl-delay\s*:\s*(\d+(?:\.\d+)?)\s*$/gim)].map(m=>Number(m[1])*1000);
  if(crawl.some(n=>n>30000))throw new Error('Robots crawl-delay requires review');
  return Math.max(3000,...crawl);
}
function makeReader({fetchImpl=fetch,wait=delay}={}) {
  let requested=false,spacing=3000;
  return {setSpacing(ms){spacing=ms;},async get(value,kind='html') {
    const url=allowedUrl(value);
    if(requested)await wait(spacing);requested=true;
    const response=await fetchImpl(url,{redirect:'manual',signal:AbortSignal.timeout(20000),headers:{'User-Agent':USER_AGENT,Accept:kind==='html'?'text/html':'text/plain,application/xml,text/xml'}});
    if(!response.ok){await response.body?.cancel();throw new Error('HTTP '+response.status+' — stopped without retry: '+url);}
    const type=response.headers.get('content-type')||'';
    if(kind==='html'&&!/text\/html/i.test(type)){await response.body?.cancel();throw new Error('Unexpected content type');}
    const max=2*1024*1024;
    if(Number(response.headers.get('content-length'))>max){await response.body?.cancel();throw new Error('Public document too large');}
    const reader=response.body.getReader(),chunks=[];let size=0;
    try {while(true){const {done,value:chunk}=await reader.read();if(done)break;size+=chunk.byteLength;if(size>max)throw new Error('Public document too large');chunks.push(chunk);}}
    catch(e){await reader.cancel();throw e;}
    const body=Buffer.concat(chunks).toString('utf8');
    if(/<title[^>]*>\s*(?:Radware|Access denied|Just a moment)|px-captcha|verify (?:that )?you are human|cf-chl-|captcha-container/i.test(body))
      throw new Error('Access challenge — stopped without bypass: '+url);
    return body;
  }};
}
function parseListing(html,url) {
  allowedUrl(url);
  if(!/^\/cars\/listings\//.test(new URL(url).pathname))throw new Error('Individual listing required');
  const docs=[];
  for(const m of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {const d=JSON.parse(m[1]);docs.push(...(Array.isArray(d)?d:(d['@graph']||[d])));}catch{/* No evaluation of source scripts. */}
  }
  const cars=docs.filter(d=>[].concat(d['@type']||[]).includes('Car')&&d.url===url);
  if(cars.length!==1)throw new Error('No unique matching public Car schema');
  const car=cars[0],title=decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||'').replace(/\s+/g,' ').trim();
  const text=visibleText(html),heading=title.split('|')[0].trim();
  const manufacturer=car.brand?.name,model=car.model,year=Number(car.vehicleModelDate);
  if(typeof manufacturer!=='string'||typeof model!=='string')throw new Error('Missing make/model');
  const prefix=year+' '+manufacturer+' '+model;
  if(!heading.startsWith(prefix)||!text.includes(heading))throw new Error('Model differs between document and structured data');
  const trim=heading.slice(prefix.length).trim(),evidence=[{url,excerpt:heading,fields:['manufacturer','model','year',...(trim?['trim']:[])]}];
  const out={sourceUrl:url,manufacturer,model,year,trim,price:null,kilometers:null,hand:null,publishedAt:null,evidence};
  // Only document title amounts matching the explicit ILS offer and KMT reading are accepted.
  const priceText=title.match(/([\d,]+)\s*₪/)?.[0],kmText=title.match(/([\d,]+)\s*ק["״]?מ/)?.[0];
  const amount=s=>Number(s.match(/[\d,]+/)[0].replace(/,/g,''));
  if(priceText&&car.offers?.priceCurrency==='ILS'&&amount(priceText)===Number(car.offers.price)){
    out.price=amount(priceText);evidence.push({url,excerpt:priceText,fields:['price']});
  }
  if(kmText&&car.mileageFromOdometer?.unitCode==='KMT'&&amount(kmText)===Number(car.mileageFromOdometer.value)){
    out.kilometers=amount(kmText);evidence.push({url,excerpt:kmText,fields:['kilometers']});
  }
  if(out.price===null&&out.kilometers===null)throw new Error('No corroborated asking price or odometer reading');
  const facts=text.slice(text.indexOf(heading)).split('תיאור הרכב')[0];
  const handText=facts.match(/יד\s+(?:ראשונה|שנייה|שניה|שלישית|רביעית|חמישית|שישית|שביעית|שמינית|\d{1,2})(?!\d)/)?.[0];
  if(handText){out.hand=handIn(handText);evidence.push({url,excerpt:handText,fields:['hand']});}
  const pub=text.match(/תאריך\s+פרסום\s*:\s*\d{1,2}[./]\d{1,2}[./](?:\d{4}|\d{2})(?!\d)/)?.[0];
  if(pub&&publicationDateIn(pub)){out.publishedAt=publicationDateIn(pub);evidence.push({url,excerpt:pub,fields:['publishedAt']});}
  return normalizeListing(out);
}
async function collectPublicPilot({inbox,limit=5,reader=makeReader(),onProgress=()=>{}}) {
  if(!Number.isInteger(limit)||limit<1||limit>5)throw new Error('Pilot limit must be 1–5 ads');
  await inbox.ready;
  const report={source:'KEYZ',startedAt:new Date().toISOString(),status:'running',sitemap:null,discoveredLinks:0,attempted:0,saved:[],errors:[]};
  await inbox.store.serial(()=>dbRun(inbox.db,'CREATE TABLE IF NOT EXISTS archive_direct_runs (id INTEGER PRIMARY KEY, source TEXT NOT NULL, startedAt TEXT NOT NULL, finishedAt TEXT, status TEXT NOT NULL, report TEXT NOT NULL)'));
  const run=await inbox.store.serial(async()=>{
    const [active]=await dbAll(inbox.db,"SELECT id,status,startedAt FROM archive_direct_runs WHERE source='KEYZ' ORDER BY id DESC LIMIT 1");
    if(active?.status==='running')throw new Error('Another pilot is active or interrupted; review it before starting again');
    if(active&&Date.now()-Date.parse(active.startedAt)<6*3600000)throw new Error('Pilot cooldown: one batch per six hours');
    return dbRun(inbox.db,"INSERT INTO archive_direct_runs(source,startedAt,status,report) VALUES('KEYZ',?,'running',?)",[report.startedAt,JSON.stringify(report)]);
  });
  try {
    reader.setSpacing(robotsPolicy(await reader.get(ORIGIN+'/robots.txt','text')));
    const maps=xmlLinks(await reader.get(ORIGIN+'/sitemaps/sitemap-index.xml','xml'),'maps');
    if(!maps.length)throw new Error('No public vehicle sitemap');
    // Finite trial: one published sitemap, not a complete archive of the source.
    report.sitemap=maps[0];report.availableSitemaps=maps.length;
    const urls=xmlLinks(await reader.get(maps[0],'xml'),'ads');report.discoveredLinks=urls.length;
    if(!urls.length)throw new Error('No individual ad links in public sitemap');
    const existing=new Set((await dbAll(inbox.db,'SELECT DISTINCT sourceUrl FROM archive_listings')).map(r=>r.sourceUrl));
    const selected=[...urls.filter(u=>!existing.has(u)),...urls.filter(u=>existing.has(u))].slice(0,limit);
    for(const url of selected) {
      report.attempted++;
      const html=await reader.get(url); // Any network/challenge error stops this source immediately.
      let item;
      try{item=parseListing(html,url);}catch(e){report.errors.push({url,error:e.message});onProgress({url,skipped:e.message});continue;}
      const [saved]=await inbox.ingest([item],'keyz-public-pilot','direct_public');
      const entry={url,id:saved.id,created:saved.created,manufacturer:item.manufacturer,model:item.model,year:item.year,price:item.price,kilometers:item.kilometers,hand:item.hand,publishedAt:item.publishedAt};
      report.saved.push(entry);onProgress(entry);
    }
    report.status=report.errors.length?'partial':'completed';
  } catch(e){report.status='stopped';report.errors.push({error:e.message});}
  report.finishedAt=new Date().toISOString();
  await inbox.store.serial(()=>dbRun(inbox.db,'UPDATE archive_direct_runs SET status=?,finishedAt=?,report=? WHERE id=?',[report.status,report.finishedAt,JSON.stringify(report),run.id]));
  return report;
}
async function main() {
  const args=process.argv.slice(2),dbFlag=args.indexOf('--db'),limitFlag=args.indexOf('--limit');
  if(dbFlag<0||!args[dbFlag+1]||!path.isAbsolute(args[dbFlag+1]))throw new Error('Use --db with the absolute path of an existing archive database');
  const sqlite3=require('sqlite3');
  const db=await new Promise((resolve,reject)=>{const d=new sqlite3.Database(args[dbFlag+1],sqlite3.OPEN_READWRITE,e=>e?reject(e):resolve(d));});
  db.configure('busyTimeout',5000);
  // Do not construct ArchiveStore here: its startup recovery belongs to the web server.
  const store={db,queue:Promise.resolve(),serial:ArchiveStore.prototype.serial};
  try {
    const report=await collectPublicPilot({inbox:new ListingStore(store),limit:limitFlag<0?5:Number(args[limitFlag+1]),onProgress:value=>console.log(JSON.stringify(value))});
    console.log(JSON.stringify(report));if(report.status==='stopped')process.exitCode=1;
  } finally {await new Promise((resolve,reject)=>db.close(e=>e?reject(e):resolve()));}
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={parseListing,collectPublicPilot,makeReader,robotsPolicy,xmlLinks,allowedUrl};
