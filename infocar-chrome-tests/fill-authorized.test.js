'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const fill=require('../infocar-chrome/fill-authorized');
const profile={firstName:'Test',lastName:'Person',taxId:'123456782',address:'Test Street 1'};
function fixture(){
  const writes=[],events=[];
  class Input{
    constructor(name,placeholder){this.name=name;this.placeholder=placeholder;this._value='';this.isConnected=true;this.nodeType=1;this.hidden=false;this.type='text';this.style={display:'block',visibility:'visible',opacity:'1'};}
    get value(){return this._value;}set value(v){this._value=v;writes.push(this.name);}
    getAttribute(k){return k==='placeholder'?this.placeholder:null;}
    getClientRects(){return this.noRect?[]:[{}];}
    matches(){return !!this.disabledAncestor;}
    closest(){return this.inert?{}:null;}
    dispatchEvent(e){events.push([this.name,e.type,e.bubbles]);return true;}
  }
  const names=['ShemPrtiMorshe string','ShemMishpachaMorshe string','tzOfMorshe veNumber','KtovetMorshe string'];
  const placeholders=['שם פרטי של המורשה','שם משפחה של המורשה','תעודת זהות של המורשה','כתובת של המורשה'];
  const inputs=names.map((name,i)=>new Input(name,placeholders[i]));
  const modal=new Input('modal','');modal.querySelectorAll=selector=>inputs.filter(i=>selector==='input[name="'+i.name+'"]');modal.contains=input=>inputs.includes(input);inputs.forEach(i=>i.parentElement=modal);
  const untouched={carNum:'7654321',ownerId:'unchanged',checkbox:false,buttonClicks:0};let modals=[modal];
  const win={};win.top=win;
  const sandbox={window:win,location:{origin:'https://tviot.slika-ins.co.il',pathname:'/start/5'},HTMLInputElement:Input,Event:class Event{constructor(type,opts){this.type=type;this.bubbles=opts.bubbles;}},getComputedStyle:n=>n.style,document:{querySelectorAll:s=>s==='#modal3'?modals:[]}};
  const run=(p=profile)=>JSON.parse(JSON.stringify(vm.runInNewContext('('+fill.toString()+')('+JSON.stringify(p)+')',sandbox)));
  return {inputs,modal,untouched,writes,events,sandbox,run,setModals:m=>{modals=m;}};
}
test('fills exactly four mapped fields, propagates Angular input/change, never targets duplicate carNum or approvals',()=>{
  const f=fixture(),before={...f.untouched};const out=f.run();assert.deepEqual(out,{ok:true,filled:4,changed:4});
  assert.deepEqual(f.inputs.map(i=>i.value),Object.values(profile));assert.equal(f.events.length,8);assert(f.events.every(e=>e[2]));assert.deepEqual(f.untouched,before);
  assert.equal(JSON.stringify(out).includes(profile.taxId),false);assert.equal(f.run().changed,0);
});
test('preflight failures never partially fill other fields',async t=>{
  for(const [label,change,code] of [
    ['missing modal',f=>f.setModals([]),'MODAL_NOT_FOUND'],
    ['duplicate modal',f=>f.setModals([f.modal,f.modal]),'MODAL_NOT_FOUND'],
    ['hidden modal',f=>{f.modal.hidden=true;},'MODAL_NOT_VISIBLE'],
    ['changed last field',f=>{f.inputs[3].placeholder='different';},'FIELD_MISMATCH'],
    ['duplicate field',f=>{f.inputs.push(f.inputs[3]);},'FIELD_MISMATCH'],
    ['missing field',f=>{f.inputs.pop();},'FIELD_MISMATCH'],
    ['disabled last field',f=>{f.inputs[3].disabled=true;},'FIELD_NOT_EDITABLE'],
    ['read-only last field',f=>{f.inputs[3].readOnly=true;},'FIELD_NOT_EDITABLE'],
    ['hidden last field',f=>{f.inputs[3].noRect=true;},'FIELD_NOT_EDITABLE'],
    ['inert ancestor',f=>{f.inputs[3].inert=true;},'FIELD_NOT_EDITABLE'],
    ['nonempty conflict',f=>{f.inputs[3]._value='Other address';},'CONFLICT']
  ])await t.test(label,()=>{const f=fixture();change(f);assert.equal(f.run().code,code);assert.equal(f.writes.length,0);});
});
test('rejects other sites, paths, frames and unsafe profiles without writes',()=>{
  for(const [key,value] of [['origin','https://example.com'],['pathname','/start/1'],['pathname','/process-payment']]){const f=fixture();f.sandbox.location[key]=value;assert.equal(f.run().ok,false);assert.equal(f.writes.length,0);}
  const framed=fixture();framed.sandbox.window.top={};assert.equal(framed.run().ok,false);
  for(const p of [null,{...profile,taxId:'123456789'},{...profile,taxId:'000000000'},{...profile,firstName:'<script>'},{...profile,address:'x\n'},{...profile,extra:'x'},{...profile,firstName:''}]){const f=fixture();assert.equal(f.run(p).code,'INVALID_PROFILE');assert.equal(f.writes.length,0);}
});
test('extension manifest has no persistent site/clipboard/cookie privileges or automatic scripts',()=>{
  const dir=path.join(__dirname,'../infocar-chrome'),m=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'),'utf8'));
  assert.equal(m.manifest_version,3);assert.deepEqual(m.permissions.sort(),['activeTab','scripting','storage']);
  for(const key of ['host_permissions','content_scripts','externally_connectable','web_accessible_resources','background'])assert.equal(key in m,false);
  for(const name of ['popup.js','fill-authorized.js','profile.js'])if(fs.existsSync(path.join(dir,name)))new vm.Script(fs.readFileSync(path.join(dir,name),'utf8'));
  const js=fs.readFileSync(path.join(dir,'fill-authorized.js'),'utf8');assert.doesNotMatch(js,/\.click\(|\.submit\(|\.requestSubmit\(|\.checked\s*=/);
});
test('stops if a page event changes the modal during filling and never reports success on detached fields',()=>{
  const f=fixture();f.inputs[0].dispatchEvent=()=>{f.modal.hidden=true;};
  assert.equal(f.run().code,'WRITE_FAILED');assert.equal(f.writes.length,1);
});
