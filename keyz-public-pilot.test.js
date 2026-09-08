'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),sqlite3=require('sqlite3');
const {ArchiveStore,dbAll}=require('./archive-store');
const {ListingStore,normalizeListing,publicationDateIn}=require('./listing-store');
const {parseListing,collectPublicPilot,makeReader,robotsPolicy,allowedUrl}=require('./keyz-public-pilot');
const url='https://keyz.ai/cars/listings/999';
// Synthetic document only: tests never contact a source or touch the real archive.
function fixture({price=30000,km=100000,date='תאריך פרסום: 11.5.26',offer=price}={}) {
 const schema={'@type':['Product','Car'],url,brand:{name:'Test'},model:'Car',vehicleModelDate:'2010',offers:{price:offer,priceCurrency:'ILS'},mileageFromOdometer:{value:km,unitCode:'KMT'}};
 return '<title>2010 Test Car Basic | '+km+' ק&quot;מ | '+price+' ₪</title><h1>2010 Test Car Basic</h1><p>יד שניה</p><p>תיאור הרכב</p><p>הלוואה 999 ₪</p><p>מועד טסט 06/2026</p><p>'+date+'</p><script type="application/ld+json">'+JSON.stringify(schema)+'</script>';
}
test('public parser corroborates facts, separates publication/test dates and ignores finance',()=>{
 const r=parseListing(fixture(),url);
 assert.deepEqual([r.manufacturer,r.model,r.trim,r.year,r.price,r.kilometers,r.hand,r.publishedAt],['Test','Car','Basic',2010,30000,100000,2,'2026-05-11']);
 assert.equal('plate' in r,false);assert.equal('description' in r,false);
 assert.equal(parseListing(fixture({date:'מועד טסט 06/2026'}),url).publishedAt,null);
 assert.equal(parseListing(fixture({date:'תאריך פרסום: 31.2.26'}),url).publishedAt,null);
 assert.equal(parseListing(fixture({offer:999}),url).price,null);
 assert.equal(publicationDateIn('תאריך פרסום: 1.1.2016'),'2016-01-01');
 assert.throws(()=>parseListing(fixture().replace('2010 Test Car Basic','2011 Test Car Basic'),url));
 assert.throws(()=>normalizeListing({...r,sourceUrl:'https://keyz.ai/cars/listings/888'}));
 assert.throws(()=>allowedUrl('https://keyz.ai/api/cars'));
 assert.throws(()=>allowedUrl('https://keyz.ai@127.0.0.1/cars/listings/999'));
 assert.throws(()=>robotsPolicy('User-agent: *\nAllow: /\nDisallow: /cars'));
});
test('reader stops on HTTP blocks, redirects and 200 challenges without retry',async()=>{
 for(const response of [new Response('Blocked',{status:403}),new Response('Blocked',{status:429}),new Response('',{status:302,headers:{location:'http://localhost/'}}),new Response('<title>Radware Page</title>',{headers:{'content-type':'text/html'}})]) {
  let calls=0;const reader=makeReader({wait:async()=>{},fetchImpl:async(u,options)=>{calls++;assert.equal(options.redirect,'manual');assert.equal(options.headers['User-Agent'],'NewCarSourceCheck/0.1');assert.equal(options.headers.Cookie,undefined);return response;}});
  await assert.rejects(reader.get(url));assert.equal(calls,1);
 }
});
test('finite sitemap trial saves real-shaped observations, logs stop and does not contact further ads',async()=>{
 const db=new sqlite3.Database(':memory:'),store=new ArchiveStore(db),inbox=new ListingStore(store);let requests=[];
 const reader={setSpacing:()=>{},get:async(u)=>{
  requests.push(u);
  if(u.endsWith('/robots.txt'))return 'User-agent: *\nAllow: /';
  if(u.endsWith('/sitemap-index.xml'))return '<loc>https://keyz.ai/sitemaps/cars/listings-0.xml</loc><loc>https://evil.example/list.xml</loc>';
  if(u.endsWith('/listings-0.xml'))return '<loc>'+url+'</loc><loc>https://keyz.ai/cars/listings/998</loc><loc>https://keyz.ai/cars/listings/997</loc>';
  if(u===url)return fixture();throw new Error('HTTP 429');
 }};
 try {
  const result=await collectPublicPilot({inbox,reader,limit:3});
  assert.equal(result.status,'stopped');assert.equal(result.saved.length,1);assert.equal(result.discoveredLinks,3);
  assert.equal(requests.length,5);assert.equal(requests.some(u=>u.endsWith('/997')),false);
  const data=await inbox.list();assert.equal(data.listings.length,1);assert.equal(data.listings[0].method,'direct_public');assert.equal(data.listings[0].verifiedPlate,null);
  const versions=await inbox.ingest([parseListing(fixture({price:28000}),url)],'test','direct_public');
  assert.equal(versions[0].created,true);assert.equal((await inbox.list()).listings[0].versions,2);
  const [run]=await dbAll(db,'SELECT status FROM archive_direct_runs');assert.equal(run.status,'stopped');
  await assert.rejects(collectPublicPilot({inbox,reader}),/cooldown/);
 }finally{await new Promise(resolve=>db.close(resolve));}
});
