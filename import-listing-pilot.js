'use strict';
// Explicit one-time import; never starts a crawler or touches the inventory database.
const fs=require('fs'),path=require('path'),sqlite3=require('sqlite3');
const {ArchiveStore,dbAll}=require('./archive-store');
const {ListingStore,listingUrl}=require('./listing-store');
async function importPilot(inbox) {
  await inbox.ready;
  const pilot=JSON.parse(fs.readFileSync(path.join(__dirname,'listing-pilot.json'),'utf8'));
  const fresh=[];
  for(const row of pilot.listings) {
    const [exists]=await dbAll(inbox.db,'SELECT id FROM archive_listings WHERE sourceUrl=? LIMIT 1',[listingUrl(row.sourceUrl)]);
    // Re-running a frozen pilot is not a new internet observation.
    if(!exists)fresh.push(row);
  }
  return inbox.ingest(fresh,'reviewed-internet-pilot','agent_pilot');
}
if(require.main===module) {
  (async()=>{
    const index=process.argv.indexOf('--db'),file=index>=0?process.argv[index+1]:null;
    if(!file || !path.isAbsolute(file))throw new Error('Provide an explicit absolute archive database path with --db.');
    const db=new sqlite3.Database(file),store=new ArchiveStore(db),inbox=new ListingStore(store);
    try{const result=await importPilot(inbox);console.log(JSON.stringify({created:result.filter(r=>r.created).length,source:'Yad2 reviewed one-time pilot',database:file}));}
    finally{await store.queue;await new Promise((resolve,reject)=>db.close(e=>e?reject(e):resolve()));}
  })().catch(e=>{console.error(e.message);process.exitCode=1;});
}
module.exports={importPilot};
