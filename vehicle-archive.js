'use strict';
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { ArchiveStore, ArchiveError, plateNumber, dbRun, dbAll } = require('./archive-store');
const { discover } = require('./archive-search');

function mountVehicleArchive(app, { sqlite3, dbPath, inventoryDb, requireAdmin, multer, directory = __dirname, search = discover, listingSearch }) {
  const archivePath = process.env.VEHICLE_ARCHIVE_DB_PATH || path.join(path.dirname(path.resolve(dbPath)), 'vehicle-archive.db');
  const mediaDir = path.join(path.dirname(archivePath), 'vehicle-archive-media');
  fs.mkdirSync(mediaDir, { recursive:true });
  const archiveDb = new sqlite3.Database(archivePath);
  const store = new ArchiveStore(archiveDb);
  store.ready.catch(err => console.error('Vehicle archive initialization failed:', err.message));
  const json = fn => async (req,res) => {
    try { await store.ready; await fn(req,res); }
    catch (e) {
      if (!e.status) console.error('Vehicle archive:', e.message);
      res.status(e.status || 500).json({error:e.status ? e.message : 'ארכיון הרכב אינו זמין כרגע'});
    }
  };
  const sameOrigin = (req,res,next) => {
    if (req.headers.origin) {
      try { if (new URL(req.headers.origin).host !== req.get('host')) return res.status(403).json({error:'מקור הבקשה אינו מורשה'}); }
      catch { return res.status(403).json({error:'מקור הבקשה אינו תקין'}); }
    }
    next();
  };
  const actor = req => req.auth?.user || 'admin';
  const credentials = () => ({apiKey:process.env.OPENAI_API_KEY,model:process.env.ARCHIVE_SEARCH_MODEL || 'gpt-5.5'});
  const status = () => ({searchConfigured:!!credentials().apiKey, discoveryMode:'indexed_only', collectionScope:'saved_inventory_and_requested_plates'});
  const listings = require('./listing-inbox').mountListingInbox(app, {store,requireAdmin,json,sameOrigin,actor,credentials,directory,search:listingSearch});
  app.get('/vehicle-history', requireAdmin, (req,res) => res.sendFile(path.join(directory,'vehicle-history.html')));
  app.get('/api/vehicle-archive/status',requireAdmin,json(async (req,res) => {
    const [counts] = await dbAll(archiveDb,'SELECT COUNT(*) AS observations, COUNT(DISTINCT plate) AS vehicles FROM archive_events');
    res.json({...status(),...counts});
  }));
  app.get('/api/vehicle-archive/:plate',requireAdmin,json(async (req,res) => {
    res.json({...await store.history(plateNumber(req.params.plate)),...status()});
  }));
  app.post('/api/vehicle-archive/import',requireAdmin,sameOrigin,json(async (req,res) => {
    const result = await store.ingest(req.body.records,actor(req));
    res.json({success:true,created:result.filter(r=>r.created).length,unchanged:result.filter(r=>!r.created).length,records:result});
  }));
  app.post('/api/vehicle-archive/:plate/search',requireAdmin,sameOrigin,json(async (req,res) => {
    const plate = plateNumber(req.params.plate), config = credentials();
    if (!config.apiKey) throw new ArchiveError('חיפוש אוטומטי עדיין לא מחובר. יש להגדיר מפתח לשירות החיפוש בשרת.',503);
    const now = new Date().toISOString();
    const runId = await store.serial(async () => {
      const [busy] = await dbAll(archiveDb,"SELECT id FROM archive_search_runs WHERE status='running' LIMIT 1");
      if (busy) throw new ArchiveError('כבר מתבצע חיפוש. נסה שוב אחרי שיושלם.',429);
      const [recent] = await dbAll(archiveDb,'SELECT startedAt,status FROM archive_search_runs WHERE plate=? ORDER BY id DESC LIMIT 1',[plate]);
      const wait = recent?.status === 'completed' ? 6*3600000 : 60000;
      if (recent && Date.now()-Date.parse(recent.startedAt)<wait) throw new ArchiveError('בוצע חיפוש לאחרונה. התוצאות נשמרו בתיק הרכב; ניתן לרענן בהמשך.',429);
      const [usage] = await dbAll(archiveDb,'SELECT COUNT(*) AS n FROM archive_search_runs WHERE startedAt>=?',[new Date(Date.now()-86400000).toISOString()]);
      if (usage.n>=10) throw new ArchiveError('הגעת למכסת הפיילוט: 10 חיפושים ב־24 שעות.',429);
      return (await dbRun(archiveDb,"INSERT INTO archive_search_runs(plate,startedAt,status) VALUES(?,?,'running')",[plate,now])).id;
    });
    try {
      const candidates = await search(plate,config);
      await store.serial(async () => {
        await dbRun(archiveDb,'BEGIN IMMEDIATE');
        try {
          for (const c of candidates) await dbRun(archiveDb,'INSERT OR IGNORE INTO archive_candidates(plate,sourceUrl,data,foundAt) VALUES(?,?,?,?)',[plate,c.sourceUrl,JSON.stringify(c),now]);
          await dbRun(archiveDb,"UPDATE archive_search_runs SET status='completed',count=?,finishedAt=? WHERE id=?",[candidates.length,new Date().toISOString(),runId]);
          await dbRun(archiveDb,'COMMIT');
        } catch (e) { await dbRun(archiveDb,'ROLLBACK'); throw e; }
      });
      res.json({success:true,count:candidates.length,...await store.history(plate)});
    } catch (e) {
      await store.serial(()=>dbRun(archiveDb,"UPDATE archive_search_runs SET status='failed',finishedAt=? WHERE id=?",[new Date().toISOString(),runId]));
      throw e;
    }
  }));
  app.post('/api/vehicle-archive/candidates/:id/review',requireAdmin,sameOrigin,json(async (req,res) => {
    if (!/^[1-9]\d*$/.test(req.params.id)) throw new ArchiveError('מזהה לא תקין');
    if (!['confirm','reject'].includes(req.body.action)) throw new ArchiveError('פעולה לא תקינה');
    const [c] = await dbAll(archiveDb,'SELECT * FROM archive_candidates WHERE id=?',[req.params.id]);
    if (!c) throw new ArchiveError('התוצאה לא נמצאה',404);
    if (c.status !== 'pending') throw new ArchiveError('התוצאה כבר נבדקה',409);
    let eventId = null;
    if (req.body.action === 'confirm') {
      const data = JSON.parse(c.data);
      // Approval confirms the user inspected the evidence; the original excerpt remains.
      data.identityMethod = 'user_confirmed_search';
      if (req.body.evidenceDate !== undefined) {
        data.evidenceDate = req.body.evidenceDate;
        data.dateKind = req.body.dateKind || 'unknown';
      }
      eventId = (await store.ingest([data],actor(req),true))[0].id;
    }
    await store.serial(()=>dbRun(archiveDb,"UPDATE archive_candidates SET status=?,eventId=? WHERE id=? AND status='pending'",[eventId?'confirmed':'rejected',eventId,c.id]));
    res.json({success:true,eventId});
  }));
  const upload = multer({storage:multer.memoryStorage(),limits:{fileSize:8*1024*1024,files:1}}).single('image');
  app.post('/api/vehicle-archive/events/:id/images',requireAdmin,sameOrigin,(req,res,next)=>upload(req,res,e=>e?res.status(400).json({error:'יש לבחור תמונה אחת בגודל של עד 8MB'}):next()),json(async(req,res)=>{
    const [event] = await dbAll(archiveDb,'SELECT id FROM archive_events WHERE id=?',[req.params.id]);
    if (!event) throw new ArchiveError('התיעוד לא נמצא',404);
    const b=req.file?.buffer;
    let ext,mime;
    if (b?.length>12 && b[0]===255 && b[1]===216 && b[2]===255) { ext='jpg';mime='image/jpeg'; }
    else if (b?.length>12 && b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) { ext='png';mime='image/png'; }
    else if(b?.length>12 && b.toString('ascii',0,4)==='RIFF' && b.toString('ascii',8,12)==='WEBP') { ext='webp';mime='image/webp'; }
    else throw new ArchiveError('נתמכות תמונות JPEG, PNG או WebP בלבד');
    const name=crypto.randomUUID()+'.'+ext;
    await store.serial(async()=>{
      const [count]=await dbAll(archiveDb,'SELECT COUNT(*) AS n FROM archive_media WHERE eventId=?',[event.id]);
      if(count.n>=20)throw new ArchiveError('ניתן לצרף עד 20 תמונות לתיעוד');
      await fs.promises.writeFile(path.join(mediaDir,name),b,{flag:'wx'});
      try { await dbRun(archiveDb,'INSERT INTO archive_media(eventId,storedName,mime,size,addedAt) VALUES(?,?,?,?,?)',[event.id,name,mime,b.length,new Date().toISOString()]); }
      catch(e) { await fs.promises.unlink(path.join(mediaDir,name)); throw e; }
    });
    res.json({success:true});
  }));
  app.get('/api/vehicle-archive/images/:id',requireAdmin,json(async(req,res)=>{
    const [m]=await dbAll(archiveDb,'SELECT * FROM archive_media WHERE id=?',[req.params.id]);
    if(!m)throw new ArchiveError('התמונה לא נמצאה',404);
    res.set({'Content-Type':m.mime,'X-Content-Type-Options':'nosniff','Cache-Control':'private, max-age=3600','Content-Security-Policy':"default-src 'none'; sandbox"});
    res.sendFile(path.join(mediaDir,m.storedName));
  }));

  async function recordGovernment(plate,data) {
    if (data.kilometers == null) return;
    let date=null;
    if (/^\d{4}-\d{2}-\d{2}/.test(data.lastTestDate || '')) date=data.lastTestDate.slice(0,10);
    else { const m=/^(\d{2})\/(\d{2})\/(\d{4})$/.exec(data.lastTestDate || ''); if(m)date=m[3]+'-'+m[2]+'-'+m[1]; }
    return store.ingest([{plate,source:'government',sourceId:'last-test',sourceLabel:'משרד התחבורה — נתון שנצפה בבדיקת רכב',evidenceDate:date,dateKind:date?'test':'unknown',kilometers:data.kilometers,manufacturer:data.manufacturer,model:data.model,year:data.year,mileageKind:'test',identityMethod:'government_plate'}],'system',true);
  }
  // Import existing local evidence in bounded batches; no sample fallback records.
  async function syncLocalEvidence() {
    const cars=await dbAll(inventoryDb,'SELECT id,vin,manufacturer,model,year,currentKm FROM cars WHERE currentKm IS NOT NULL');
    const now=new Date().toISOString().slice(0,10);
    for(const car of cars){
      try {
        const [last]=await dbAll(archiveDb,'SELECT data FROM archive_events WHERE plate=? AND listingKey=? ORDER BY id DESC LIMIT 1',[plateNumber(car.vin),crypto.createHash('sha256').update(plateNumber(car.vin)+'|inventory|car:'+car.id).digest('hex')]);
        if(last && JSON.parse(last.data).kilometers===Number(car.currentKm))continue;
        await store.ingest([{plate:car.vin,source:'inventory',sourceId:'car:'+car.id,sourceLabel:'המלאי שלך — תאריך התצפית במערכת',evidenceDate:now,dateKind:'observed',kilometers:car.currentKm,manufacturer:car.manufacturer,model:car.model,year:car.year,identityMethod:'inventory_plate'}],'system',true);
      } catch(e){ console.error('Archive inventory record skipped:',e.message); }
    }
    const rows=await dbAll(inventoryDb,'SELECT id,vin,kilometers,lastTestDate FROM km_history ORDER BY id');
    for(const row of rows){
      try {
        const input={plate:row.vin,source:'government',sourceId:'saved-test:'+row.id,sourceLabel:'משרד התחבורה — תיעוד קודם שנשמר במערכת',kilometers:row.kilometers,evidenceDate:null,dateKind:'unknown',identityMethod:'existing_government_snapshot'};
        if(/^\d{4}-\d{2}-\d{2}/.test(row.lastTestDate || '')){input.evidenceDate=row.lastTestDate.slice(0,10);input.dateKind='test';}
        await store.ingest([input],'system',true);
      }catch(e){console.error('Archive existing record skipped:',e.message);}
    }
  }
  const initial=setTimeout(()=>syncLocalEvidence().catch(e=>console.error('Archive local sync:',e.message)),5000);
  initial.unref();
  let syncing=false;
  const periodic=setInterval(async()=>{if(syncing)return;syncing=true;try{await syncLocalEvidence();}catch(e){console.error('Archive local sync:',e.message);}finally{syncing=false;}},3600000);
  periodic.unref();
  return { store, listings, recordGovernment, syncLocalEvidence, close:async()=>{clearTimeout(initial);clearInterval(periodic);await store.queue.catch(()=>{});await new Promise((resolve,reject)=>archiveDb.close(e=>e?reject(e):resolve()));} };
}
module.exports = { mountVehicleArchive };
