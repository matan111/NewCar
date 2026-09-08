'use strict';
const path=require('path'),crypto=require('crypto');
const {ArchiveError,dbAll,dbRun}=require('./archive-store');
const {ListingStore,criteria}=require('./listing-store');
const {collectListings}=require('./listing-search');

function mountListingInbox(app,{store,requireAdmin,json,sameOrigin,actor,credentials,directory,search=collectListings}) {
  const listings=new ListingStore(store);
  listings.ready.catch(e=>console.error('Listing inbox initialization failed:',e.message));
  app.get('/vehicle-listings',requireAdmin,(req,res)=>res.sendFile(path.join(directory,'vehicle-listings.html')));
  app.get('/api/vehicle-listings',requireAdmin,json(async(req,res)=>{
    const query=Object.keys(req.query).length?criteria(req.query):null;
    res.json({...await listings.list(query),searchConfigured:!!credentials().apiKey,query});
  }));
  app.get('/api/vehicle-listings/:id/versions',requireAdmin,json(async(req,res)=>{
    if(!/^[1-9]\d*$/.test(req.params.id))throw new ArchiveError('מזהה לא תקין');
    res.json({versions:await listings.versions(req.params.id)});
  }));
  app.post('/api/vehicle-listings/:id/link',requireAdmin,sameOrigin,json(async(req,res)=>{
    if(!/^[1-9]\d*$/.test(req.params.id))throw new ArchiveError('מזהה לא תקין');
    res.json({success:true,...await listings.link(req.params.id,req.body,actor(req))});
  }));
  app.post('/api/vehicle-listings/collect',requireAdmin,sameOrigin,json(async(req,res)=>{
    const query=criteria(req.body),config=credentials();
    if(!config.apiKey)throw new ArchiveError('חיבור החיפוש טרם הופעל. יש להגדיר מפתח שירות בסודות השרת.',503);
    await listings.ready;
    const queryKey='model:'+crypto.createHash('sha256').update(JSON.stringify(query).normalize('NFKC').toLowerCase()).digest('hex');
    const runId=await store.serial(async()=>{
      const [busy]=await dbAll(store.db,"SELECT id FROM archive_search_runs WHERE status='running' LIMIT 1");
      if(busy)throw new ArchiveError('כבר מתבצע חיפוש. המתן לסיום לפני חיפוש נוסף.',429);
      const [last]=await dbAll(store.db,'SELECT startedAt,status FROM archive_search_runs WHERE plate=? ORDER BY id DESC LIMIT 1',[queryKey]);
      if(last && Date.now()-Date.parse(last.startedAt)<(last.status==='completed'?6*3600000:60000))
        throw new ArchiveError('החיפוש בוצע לאחרונה. המודעות כבר נשמרו; אפשר לאסוף שוב בהמשך.',429);
      const [usage]=await dbAll(store.db,'SELECT COUNT(*) AS n FROM archive_search_runs WHERE startedAt>=?',[new Date(Date.now()-86400000).toISOString()]);
      if(usage.n>=10)throw new ArchiveError('מכסת הפיילוט היא 10 חיפושים ב־24 שעות, כולל חיפושים לפי מספר רכב.',429);
      return (await dbRun(store.db,"INSERT INTO archive_search_runs(plate,startedAt,status) VALUES(?,?,'running')",[queryKey,new Date().toISOString()])).id;
    });
    try {
      const found=await search(query,config);
      const result=await listings.ingest(found,actor(req));
      await store.serial(()=>dbRun(store.db,"UPDATE archive_search_runs SET status='completed',count=?,finishedAt=? WHERE id=?",[result.length,new Date().toISOString(),runId]));
      res.json({success:true,found:found.length,created:result.filter(r=>r.created).length,...await listings.list(query),query,searchConfigured:true});
    } catch(e) {
      await store.serial(()=>dbRun(store.db,"UPDATE archive_search_runs SET status='failed',finishedAt=? WHERE id=?",[new Date().toISOString(),runId]));
      throw e;
    }
  }));
  return listings;
}
module.exports={mountListingInbox};
