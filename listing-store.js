'use strict';
const crypto = require('crypto');
const { ArchiveError, sourceUrl, evidenceDate, plateNumber, normalize, dbAll, dbRun } = require('./archive-store');

const fields = ['manufacturer','model','year','trim','price','kilometers','hand','publishedAt'];
function shortText(value, required = false) {
  if (value == null && !required) return '';
  if (typeof value !== 'string' || value.length > 120 || /[\x00-\x1f]/.test(value) || (required && !value.trim()))
    throw new ArchiveError('יש להזין יצרן ודגם תקינים');
  return value.trim().normalize('NFKC');
}
function criteria(input) {
  if (!input || typeof input !== 'object') throw new ArchiveError('חסרים פרטי החיפוש');
  const year = Number(input.year);
  if (!Number.isInteger(year) || year < 1900 || year > new Date().getFullYear()+1) throw new ArchiveError('שנת ייצור לא תקינה');
  return {manufacturer:shortText(input.manufacturer,true),model:shortText(input.model,true),year,trim:shortText(input.trim)};
}
function evidenceUrl(value) {
  const u = new URL(sourceUrl(value));
  if (u.hostname === 'keyz.ai' && /^\/cars\/listings\/[1-9]\d*\/?$/.test(u.pathname)) {
    u.pathname=u.pathname.replace(/\/$/,'');u.search='';return u.href;
  }
  if (u.hostname !== 'www.yad2.co.il' || !/^\/vehicles\/(item\/[a-zA-Z0-9]+\/?|cars)$/.test(u.pathname))
    throw new ArchiveError('נדרש מקור מודעת רכב ביד2 או KEYZ');
  if (u.pathname === '/vehicles/cars') {
    // Preserve filters: a different feed is not the same piece of evidence.
    const original = new URL(value);
    u.search = original.search;
    u.searchParams.sort();
  }
  return u.href;
}
function listingUrl(value) {
  const url = evidenceUrl(value);
  if (!/^\/(vehicles\/item|cars\/listings)\//.test(new URL(url).pathname)) throw new ArchiveError('נדרש קישור למודעה בודדת');
  return url;
}
function publicationDateIn(excerpt) {
  const m=excerpt.match(/(?:תאריך\s+פרסום|פורסם|published)\s*:?\s*(\d{1,2})[./](\d{1,2})[./](\d{4}|\d{2})(?!\d)/i);
  if(!m)return null;
  const year=m[3].length===2?'20'+m[3]:m[3];
  try{return evidenceDate(year+'-'+m[2].padStart(2,'0')+'-'+m[1].padStart(2,'0'));}catch{return null;}
}
const handWords={'ראשונה':1,'שניה':2,'שנייה':2,'שלישית':3,'רביעית':4,'חמישית':5,'שישית':6,'שביעית':7,'שמינית':8};
function handIn(excerpt) {
  const m=excerpt.match(/יד\s+(ראשונה|שנייה|שניה|שלישית|רביעית|חמישית|שישית|שביעית|שמינית|\d{1,2})(?!\d)/);
  return m?(handWords[m[1]]??Number(m[1])):null;
}
function normalizeListing(input) {
  if (!input || typeof input !== 'object') throw new ArchiveError('מודעה לא תקינה');
  const out = {sourceUrl:listingUrl(input.sourceUrl),...criteria(input)};
  for (const [key,max] of [['price',100000000],['kilometers',5000000],['hand',30]]) {
    const value=input[key];
    if (value != null && (!Number.isInteger(value) || value < (key==='kilometers'?0:1) || value > max))
      throw new ArchiveError('נתון מספרי לא תקין במודעה');
    out[key]=value??null;
  }
  out.publishedAt=evidenceDate(input.publishedAt);
  if (!Array.isArray(input.evidence) || !input.evidence.length || input.evidence.length>6) throw new ArchiveError('חסרות אסמכתאות למודעה');
  let words=0;
  out.evidence=input.evidence.map(e=>{
    if (!e || typeof e.excerpt!=='string' || e.excerpt.length>500 || !e.excerpt.trim() || !Array.isArray(e.fields) || !e.fields.length || e.fields.some(f=>!fields.includes(f)))
      throw new ArchiveError('אסמכתא לא תקינה');
    const excerpt=e.excerpt.trim();
    if(new URL(out.sourceUrl).hostname==='keyz.ai' && evidenceUrl(e.url)!==out.sourceUrl)
      throw new ArchiveError('האסמכתא צריכה להגיע מאותה מודעת KEYZ');
    words+=excerpt.split(/\s+/).length;
    return {url:evidenceUrl(e.url),excerpt,fields:[...new Set(e.fields)].sort()};
  });
  if (words>25) throw new ArchiveError('יש לשמור רק קטעי מקור קצרים, עד 25 מילים למודעה');
  const proof=field=>out.evidence.filter(e=>e.fields.includes(field));
  for (const key of fields) {
    if (out[key]==null || out[key]==='') continue;
    const snippets=proof(key);
    if (!snippets.length) throw new ArchiveError('חסרה אסמכתא לשדה '+key);
    if (['manufacturer','model','trim'].includes(key) && !snippets.some(e=>identity(e.excerpt).includes(identity(out[key]))))
      throw new ArchiveError('פרטי הדגם אינם מופיעים באסמכתא');
    if (['year','price','kilometers','hand'].includes(key)) {
      const numeric=new RegExp('(?<!\\d)'+out[key]+'(?!\\d)');
      if (!snippets.some(e=>numeric.test(e.excerpt.replace(/(?<=\d)[,\s](?=\d)/g,'')) || (key==='hand' && handIn(e.excerpt)===out.hand))) throw new ArchiveError('מספר אינו מופיע באסמכתא');
    }
    if (key==='price' && !snippets.some(e=>/₪|ש["״]?ח|מחיר/.test(e.excerpt) && !/מימון|הלוואה|חודשי|תשלומ/.test(e.excerpt)))
      throw new ArchiveError('אין אסמכתא למחיר פרסום מלא');
    if (key==='kilometers' && !snippets.some(e=>/ק["״]?מ|קילומטר/.test(e.excerpt) && !/טסט/.test(e.excerpt)))
      throw new ArchiveError('אין אסמכתא לק״מ מוצהר במודעה');
    if (key==='publishedAt' && !snippets.some(e=>(e.excerpt.includes(out.publishedAt) && /פורסם|פרסום|published/i.test(e.excerpt)) || publicationDateIn(e.excerpt)===out.publishedAt))
      throw new ArchiveError('אין אסמכתא לתאריך פרסום; יש להשאיר ריק');
  }
  return out;
}
const identity=value=>value.normalize('NFKC').toLocaleLowerCase().replace(/[\s\-־"'״׳]/g,'');
function matches(row,query) {
  return row.year===query.year && identity(row.manufacturer)===identity(query.manufacturer) &&
    identity(row.model)===identity(query.model) && (!query.trim || identity(row.trim)===identity(query.trim));
}

class ListingStore {
  constructor(store) {
    this.store=store; this.db=store.db;
    this.ready=store.serial(async()=>{
      await dbRun(this.db,'CREATE TABLE IF NOT EXISTS archive_listings ('+
        'id INTEGER PRIMARY KEY, sourceUrl TEXT NOT NULL, contentHash TEXT NOT NULL,'+
        'data TEXT NOT NULL, firstSeenAt TEXT NOT NULL, lastSeenAt TEXT NOT NULL,'+
        'method TEXT NOT NULL, actor TEXT NOT NULL, verifiedPlate TEXT, eventId INTEGER)');
      await dbRun(this.db,'CREATE INDEX IF NOT EXISTS archive_listing_inbox_url ON archive_listings(sourceUrl,id)');
    });
  }
  async ingest(inputs,actor,method='indexed_search') {
    if (!['indexed_search','agent_pilot','direct_public'].includes(method)) throw new ArchiveError('שיטת איסוף לא תקינה');
    if (!Array.isArray(inputs) || inputs.length>100) throw new ArchiveError('עד 100 מודעות באצווה');
    const rows=inputs.map(normalizeListing);
    await this.ready;
    return this.store.serial(async()=>{
      await dbRun(this.db,'BEGIN IMMEDIATE');
      const result=[];
      try {
        for(const data of rows) {
          const encoded=JSON.stringify(data), hash=crypto.createHash('sha256').update(encoded).digest('hex'), now=new Date().toISOString();
          const [last]=await dbAll(this.db,'SELECT id,contentHash FROM archive_listings WHERE sourceUrl=? ORDER BY id DESC LIMIT 1',[data.sourceUrl]);
          if(last?.contentHash===hash) {
            await dbRun(this.db,'UPDATE archive_listings SET lastSeenAt=? WHERE id=?',[now,last.id]);
            result.push({id:last.id,created:false});
          } else {
            const r=await dbRun(this.db,'INSERT INTO archive_listings(sourceUrl,contentHash,data,firstSeenAt,lastSeenAt,method,actor) VALUES(?,?,?,?,?,?,?)',[data.sourceUrl,hash,encoded,now,now,method,actor]);
            result.push({id:r.id,created:true});
          }
        }
        await dbRun(this.db,'COMMIT'); return result;
      } catch(e) {await dbRun(this.db,'ROLLBACK');throw e;}
    });
  }
  async list(query=null) {
    await this.ready;
    const conditions=['l.id=(SELECT MAX(v.id) FROM archive_listings v WHERE v.sourceUrl=l.sourceUrl)'], params=[];
    if(query) {
      conditions.push("json_extract(l.data,'$.year')=?");params.push(query.year);
      for(const key of ['manufacturer','model','trim']) {
        if(!query[key])continue;
        let expression="json_extract(l.data,'$."+key+"')";
        for(const character of [' ','-','־','"',"'",'״','׳'])
          expression="replace("+expression+",'"+character.replace(/'/g,"''")+"','')";
        conditions.push('lower('+expression+')=?');params.push(identity(query[key]));
      }
    }
    // Apply the size limit to distinct ads, not to their historic versions.
    const rows=await dbAll(this.db,'SELECT l.*,(SELECT COUNT(*) FROM archive_listings v WHERE v.sourceUrl=l.sourceUrl) AS versions '+
      'FROM archive_listings l WHERE '+conditions.join(' AND ')+' ORDER BY l.id DESC LIMIT 1000',params);
    let listings=rows.map(r=>({id:r.id,...JSON.parse(r.data),firstSeenAt:r.firstSeenAt,lastSeenAt:r.lastSeenAt,method:r.method,verifiedPlate:r.verifiedPlate,eventId:r.eventId,versions:r.versions}));
    const prices=listings.filter(r=>r.price!=null).map(r=>r.price).sort((a,b)=>a-b), n=prices.length;
    // A sample of saved asking prices, not a market valuation or sold price.
    const statistics=query?{count:n,average:n?Math.round(prices.reduce((a,b)=>a+b,0)/n):null,median:n?Math.round((prices[Math.floor((n-1)/2)]+prices[Math.floor(n/2)])/2):null,smallSample:n<5,mixedTrims:!query.trim}:null;
    return {listings,statistics,limited:rows.length===1000,scope:'saved_ads',liveAvailability:'unknown'};
  }
  async versions(id) {
    await this.ready;
    const [row]=await dbAll(this.db,'SELECT sourceUrl FROM archive_listings WHERE id=?',[id]);
    if(!row) throw new ArchiveError('המודעה לא נמצאה',404);
    return (await dbAll(this.db,'SELECT * FROM archive_listings WHERE sourceUrl=? ORDER BY id DESC LIMIT 100',[row.sourceUrl]))
      .map(r=>({id:r.id,...JSON.parse(r.data),firstSeenAt:r.firstSeenAt,lastSeenAt:r.lastSeenAt,verifiedPlate:r.verifiedPlate,eventId:r.eventId}));
  }
  async link(id,input,actor) {
    await this.ready;
    const plate=plateNumber(input.plate);
    if(input.confirmed!==true || typeof input.identityNote!=='string' || input.identityNote.trim().length<8 || input.identityNote.length>500)
      throw new ArchiveError('יש לאשר את פרטי המודעה ולציין היכן אומת מספר הרישוי');
    return this.store.serial(async()=>{
      await dbRun(this.db,'BEGIN IMMEDIATE');
      try {
        const [row]=await dbAll(this.db,'SELECT * FROM archive_listings WHERE id=?',[id]);
        if(!row) throw new ArchiveError('המודעה לא נמצאה',404);
        if(row.verifiedPlate) throw new ArchiveError('גרסת המודעה כבר שויכה לרכב',409);
        const data=JSON.parse(row.data);
        const label=new URL(data.sourceUrl).hostname==='keyz.ai'?'KEYZ':'יד2';
        const event=normalize({...data,plate,source:'web_reviewed',sourceLabel:label+' — שיוך שאושר ידנית',
          evidenceDate:data.publishedAt,dateKind:data.publishedAt?'published':'unknown',identityMethod:'user_verified_listing',
          description:'אימות שיוך: '+input.identityNote.trim()+'\n'+data.evidence.map(e=>e.excerpt+'\n'+e.url).join('\n')},true);
        const encoded=JSON.stringify(event),hash=crypto.createHash('sha256').update(encoded).digest('hex');
        const key=crypto.createHash('sha256').update(plate+'|web_reviewed|'+data.sourceUrl).digest('hex');
        // Linking today is not a new publication; preserve collection timestamps.
        const r=await dbRun(this.db,'INSERT INTO archive_events(plate,listingKey,contentHash,firstSeenAt,lastSeenAt,createdBy,data) VALUES(?,?,?,?,?,?,?)',[plate,key,hash,row.firstSeenAt,row.lastSeenAt,actor,encoded]);
        await dbRun(this.db,'UPDATE archive_listings SET verifiedPlate=?,eventId=? WHERE id=?',[plate,r.id,id]);
        await dbRun(this.db,'COMMIT'); return {eventId:r.id,plate};
      } catch(e) {await dbRun(this.db,'ROLLBACK');throw e;}
    });
  }
}
module.exports={ListingStore,normalizeListing,criteria,evidenceUrl,listingUrl,matches,publicationDateIn,handIn};
