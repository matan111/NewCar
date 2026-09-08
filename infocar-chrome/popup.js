'use strict';
const el=id=>document.getElementById(id),form=el('profile');
const KEY='authorizedProfileV1';
let saved=null,busy=false,storageReady=false;
const errors={WRONG_PAGE:'פתח את מסלול המורשה ב־Infocar ואת חלונית פרטי המורשה.',WRONG_ORIGIN:'יש לפתוח את האתר הרשמי של Infocar.',FRAME_NOT_ALLOWED:'המילוי זמין רק בדף הראשי, לא במסגרת.',INVALID_PROFILE:'יש לבדוק ולשמור מחדש את הפרטים בתוסף.',MODAL_NOT_FOUND:'פתח קודם את חלונית פרטי המורשה ב־Infocar.',MODAL_NOT_VISIBLE:'חלונית פרטי המורשה אינה פתוחה.',FIELD_MISMATCH:'מבנה הטופס השתנה או אינו תואם. לא בוצע מילוי.',FIELD_NOT_EDITABLE:'אחד השדות אינו גלוי או ניתן לעריכה. לא בוצע מילוי.',CONFLICT:'כבר מופיעים בטופס פרטים שונים. בדוק או נקה אותם בעצמך לפני מילוי.',WRITE_FAILED:'לא ניתן היה להשלים את המילוי. בדוק את ארבעת השדות לפני המשך.',NOT_OWNER:'התחבר ל־NewCar בחשבון הבעלים הראשי.',NO_PROFILE:'לא נשמרו פרטי חשבונית ב־NewCar. שמור אותם בעוזר הסליקה או מלא בתוסף.',FETCH_FAILED:'לא ניתן לטעון את הפרטים. ודא ש־NewCar מעודכן ומחובר בחשבון הבעלים.'};
function message(text,error=false){el('status').textContent=text;el('status').className=error?'error':'';}
async function tab(){const [active]=await chrome.tabs.query({active:true,currentWindow:true});if(!active||!Number.isInteger(active.id))throw new Error('אין לשונית פעילה');return active;}
async function controls(){
  let url='';try{url=(await tab()).url||'';}catch{}
  const from=NewCarProfile.isNewCarUrl(url),to=NewCarProfile.isInfocarUrl(url);
  el('import').disabled=busy||!storageReady||!from;el('fill').disabled=busy||!saved||!storageReady||!to;
  el('context').textContent=from?'NewCar פתוח — אפשר לטעון את הפרטים השמורים.':to?'Infocar פתוח — המילוי פועל רק בחלונית המורשה.':'פתח את NewCar לטעינה ראשונית, או Infocar למילוי.';
  form.querySelector('button').disabled=busy||!storageReady;el('forget').disabled=busy||!storageReady;
}
function setForm(p){for(const k of ['firstName','lastName','taxId','address'])form.elements.namedItem(k).value=p?.[k]||'';el('reviewed').checked=false;}
function summary(){el('summary').textContent=saved?[saved.firstName,saved.lastName,'· ת״ז מסתיימת ב־'+saved.taxId.slice(-3)].join(' '):'אין עדיין פרטים שמורים.';}
async function action(fn){if(busy||!storageReady)return;busy=true;await controls();try{await fn();}catch{message('הפעולה לא הושלמה. לא אושרה הזמנה ולא בוצע תשלום.',true);}finally{busy=false;await controls();}}
el('import').onclick=()=>action(async()=>{
  const active=await tab();if(!NewCarProfile.isNewCarUrl(active.url)){message('פתח את דף בדיקת הרכב ב־NewCar.',true);return;}
  const [entry]=await chrome.scripting.executeScript({target:{tabId:active.id,frameIds:[0]},world:'ISOLATED',func:NewCarProfile.readFromNewCar});
  const result=entry?.result;if(!result?.ok){message(errors[result?.code]||errors.FETCH_FAILED,true);return;}
  const names=NewCarProfile.suggestNames(result.invoice.name);
  setForm({...names,taxId:result.invoice.taxId,address:result.invoice.address});
  el('importedName').textContent='השם שנשמר לחשבונית: '+result.invoice.name+'. בדוק את החלוקה לשם פרטי ומשפחה לפני השמירה.';
  el('settings').open=true;message('הפרטים נטענו לבדיקה בלבד. בדוק ושמור כדי להשתמש בהם כמורשה.');
});
form.onsubmit=event=>{event.preventDefault();if(!form.reportValidity())return;action(async()=>{
  let p;try{p=NewCarProfile.normalize(Object.fromEntries(new FormData(form)));}catch{message(errors.INVALID_PROFILE,true);return;}
  // User explicitly chooses persistent local or in-memory session storage. Never Chrome Sync.
  if(el('remember').checked){await chrome.storage.local.set({[KEY]:p});await chrome.storage.session.remove(KEY);}
  else{await chrome.storage.session.set({[KEY]:p});await chrome.storage.local.remove(KEY);}
  saved=p;summary();el('settings').open=false;message('הפרטים נשמרו. ב־Infocar פתח את חלונית המורשה ולחץ על מילוי.');
});};
el('fill').onclick=()=>action(async()=>{
  if(!saved)return;const active=await tab();if(!NewCarProfile.isInfocarUrl(active.url)){message(errors.WRONG_PAGE,true);return;}
  const [entry]=await chrome.scripting.executeScript({target:{tabId:active.id,frameIds:[0]},world:'ISOLATED',func:NewCarFillAuthorized,args:[saved]});
  const result=entry?.result;
  if(result?.ok)message('ארבעת שדות המורשה מולאו. בדוק אותם; ההצהרה וכפתור האישור נשארו ללא שינוי.');
  else message(errors[result?.code]||'הטופס אינו תואם. לא אושרה בקשה; בדוק את השדות.',true);
});
el('forget').onclick=()=>action(async()=>{await chrome.storage.local.remove(KEY);await chrome.storage.session.remove(KEY);saved=null;setForm(null);el('importedName').textContent='';summary();message('הפרטים נמחקו מהתוסף. הפרופיל ב־NewCar לא השתנה.');});
(async()=>{
  try{
    await chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
    await chrome.storage.session.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
    storageReady=true;
    const permanent=(await chrome.storage.local.get(KEY))[KEY],temporary=(await chrome.storage.session.get(KEY))[KEY];
    if(permanent||temporary){try{saved=NewCarProfile.normalize(permanent||temporary);setForm(saved);el('remember').checked=!!permanent;}catch{message('הפרטים השמורים אינם תקינים. יש לשמור מחדש.',true);}}
    summary();await controls();
  }catch{storageReady=false;message('האחסון המוגן של התוסף אינו זמין. עדכן Chrome ונסה שוב.',true);await controls();}
})();
