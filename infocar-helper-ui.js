(function () {
  'use strict';
  const labels={name:'שם על החשבונית',taxId:'תעודת זהות / מספר עוסק',address:'כתובת לחשבונית',email:'אימייל לקבלת החשבונית והדוח',phone:'טלפון'};
  const routes={buyer:'https://tviot.slika-ins.co.il/start/5',owner:'https://tviot.slika-ins.co.il/start/1',otherCard:'https://tviot.slika-ins.co.il/start/2',company:'https://tviot.slika-ins.co.il/start/3'};
  const digits=value=>String(value||'').replace(/[\s-]/g,'');
  async function api(method,profile) {
    const response=await fetch('/api/infocar/invoice-profile',{method,credentials:'same-origin',cache:'no-store',headers:method==='PUT'?{'Content-Type':'application/json'}:{},...(profile?{body:JSON.stringify(profile)}:{})});
    const result=await response.json();
    if(!response.ok)throw new Error(result.error||'לא ניתן לטעון את הפרטים');
    return result;
  }
  function init(container,plateInput) {
    if(!container||!plateInput||container.dataset.initialized)return;
    container.dataset.initialized='yes';container.hidden=false;
    container.innerHTML='<style>'+ 
      '.ic-helper{margin:22px 0;border:1px solid #b9d0e8;border-radius:14px;padding:18px;background:#f6faff;color:#16304a}.ic-helper h3{margin:0 0 8px}.ic-helper p{font-size:14px;line-height:1.7;margin:8px 0}.ic-helper .ic-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:14px 0}.ic-helper label{font-size:14px;display:block}.ic-helper input,.ic-helper select{width:100%;padding:10px;border:1px solid #b9c9d9;border-radius:8px;font:inherit;background:white}.ic-helper button,.ic-helper a{font:inherit}.ic-helper .ic-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:10px 0}.ic-helper .ic-copy{padding:6px 11px;border:1px solid #b9c9d9;border-radius:8px;background:white;cursor:pointer}.ic-helper .ic-value{flex:1;min-width:150px;overflow-wrap:anywhere}.ic-helper .ic-warning{background:#fff4db;border-radius:8px;padding:10px}.ic-helper .ic-message{white-space:pre-wrap;font-size:14px}.ic-helper details{margin:14px 0}.ic-helper summary{cursor:pointer;font-weight:bold}.ic-helper [hidden]{display:none!important}@media(max-width:550px){.ic-helper .ic-grid{grid-template-columns:1fr}.ic-helper .ic-row>a{width:100%;text-align:center}}'+
      '</style><section class="ic-helper" aria-label="עוזר דוח סליקה">'+
      '<h3>דוח סליקה · Infocar</h3><p>פרטי החשבונית נשמרים פעם אחת בחשבון הבעלים. בכל רכב משתנים מספר הרכב, פרטי בעליו והאישורים הנדרשים באתר הסליקה.</p>'+
      '<button type="button" class="btn btn-secondary" data-ic="toggle">פתיחת עוזר הסליקה</button>'+
      '<div data-ic="body" hidden><div class="ic-grid"><label>הרכב שנבדק<input data-ic="plate" readonly dir="ltr" aria-label="מספר הרכב לדוח סליקה"></label><label>המסלול שמתאים לבקשה<select data-ic="route"><option value="buyer">רכב שאני קונה — מורשה מטעם הבעלים</option><option value="owner">הרכב שלי וכרטיס האשראי על שמי</option><option value="otherCard">הרכב שלי וכרטיס האשראי לא על שמי</option><option value="company">בעל הרכב הוא תאגיד</option></select></label></div>'+
      '<div class="ic-warning"><p>תוסף Chrome נפרד ממלא בלחיצה את ארבעת פרטי המורשה, לאחר התקנה וטעינת פרטיך. הוא אינו ממלא את החשבונית, מסמן הצהרות או מבצע הזמנה ותשלום.</p><p>הפרטים שלך אינם תחליף לתעודת הזהות של בעל הרכב, ייפוי כוח או אישורו.</p><a href="/infocar-chrome" target="_blank" rel="noopener noreferrer">התקנת מילוי פרטי המורשה ב־Chrome והוראות שימוש ↗</a></div>'+
      '<div class="ic-row"><a class="btn btn-primary" data-ic="open" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">העתקת מספר הרכב ופתיחת Infocar ↗</a></div>'+
      '<h4>הפרטים הקבועים לחשבונית</h4><div data-ic="saved"></div>'+
      '<details data-ic="settings"><summary>עריכת הפרטים הקבועים</summary><form data-ic="form" autocomplete="off"><div class="ic-grid"></div><button class="btn btn-secondary" type="submit">שמירת פרטי החשבונית</button></form></details>'+
      '<p>אימות זהות, אישור תנאים ותשלום מתבצעים באתר Infocar על ידך. לא נשמרים כאן פרטי אשראי, סיסמאות או קודי אימות.</p><p data-ic="status" class="ic-message" role="status" aria-live="polite"></p></div></section>';
    const el=name=>container.querySelector('[data-ic="'+name+'"]');
    let profile=null,loading=false,saving=false,epoch=0;
    const status=(message,error=false)=>{el('status').textContent=message;el('status').style.color=error?'#9b2525':'#245b39';};
    function syncPlate(){el('plate').value=digits(plateInput.value);}
    function syncRoute(){el('open').href=routes[el('route').value]||routes.buyer;}
    const grid=el('form').querySelector('.ic-grid');
    for(const [key,label] of Object.entries(labels)) {
      const wrap=document.createElement('label');wrap.textContent=label;
      const input=document.createElement('input');input.name=key;input.autocomplete='off';
      input.type=key==='email'?'email':key==='phone'?'tel':'text';
      input.maxLength=({name:120,taxId:9,address:250,email:254,phone:30})[key];
      if(key==='taxId'){input.inputMode='numeric';input.pattern='[0-9]{9}';input.dir='ltr';}
      if(key==='name'||key==='address')input.required=true;
      if(key==='phone'||key==='email')input.placeholder='לא חובה — ניתן להשלים פעם אחת';
      wrap.appendChild(input);grid.appendChild(wrap);
    }
    async function copy(value) {
      if(!value){status('אין ערך להעתקה.',true);return;}
      try {await navigator.clipboard.writeText(value);status('הפרט הועתק. אפשר להדביק בשדה המתאים ב־Infocar.');}
      catch {status('הדפדפן לא אישר העתקה. אפשר לסמן את הערך המוצג ולהעתיק ידנית.',true);}
    }
    function render(result) {
      profile=result.profile;el('saved').replaceChildren();
      for(const [key,label] of Object.entries(labels)) {
        const input=el('form').elements.namedItem(key);input.value=profile[key]||'';
        if(!profile[key])continue;
        const row=document.createElement('div');row.className='ic-row';
        const value=document.createElement('span');value.className='ic-value';
        value.textContent=label+': '+(key==='taxId'?'••••••'+profile[key].slice(-3):profile[key]);
        const button=document.createElement('button');button.type='button';button.className='ic-copy';button.textContent='העתקה';button.setAttribute('aria-label','העתקת '+label);button.onclick=()=>copy(profile[key]);
        row.append(value,button);el('saved').appendChild(row);
      }
      if(!result.configured){el('settings').open=true;status('יש לשמור פעם אחת את פרטי החשבונית.');}
    }
    el('toggle').onclick=async()=>{
      el('body').hidden=!el('body').hidden;el('toggle').textContent=el('body').hidden?'פתיחת עוזר הסליקה':'סגירת עוזר הסליקה';syncPlate();
      if(el('body').hidden||profile||loading)return;
      loading=true;const requestEpoch=epoch;status('טוען את פרטי החשבונית השמורים…');
      try{const result=await api('GET');if(requestEpoch!==epoch)return;render(result);if(result.configured)status('הפרטים השמורים מוכנים להעתקה.');}
      catch(e){status(e.message,true);}finally{loading=false;}
    };
    el('form').onsubmit=async event=>{
      event.preventDefault();if(saving||!el('form').reportValidity())return;
      const next=Object.fromEntries(new FormData(el('form')));saving=true;const button=el('form').querySelector('button');button.disabled=true;
      try{render(await api('PUT',next));el('settings').open=false;status('פרטי החשבונית נשמרו לחשבון הבעלים.');}
      catch(e){status(e.message,true);}finally{saving=false;button.disabled=false;}
    };
    el('open').onclick=event=>{
      syncPlate();syncRoute();const plate=digits(plateInput.value);
      if(!/^[0-9]{7,8}$/.test(plate)){event.preventDefault();status('יש להזין מספר רכב תקין בשדה בדיקת הרכב.',true);return;}
      // Clipboard only, on an explicit click. No private details in URL, referrer or window name.
      copy(plate);
    };
    el('route').onchange=syncRoute;
    plateInput.addEventListener('input',syncPlate);plateInput.addEventListener('change',syncPlate);
    document.getElementById('checkVinBtn')?.addEventListener('click',syncPlate);
    window.addEventListener('pagehide',()=>{epoch++;profile=null;el('saved').replaceChildren();el('form').reset();el('body').hidden=true;});
    syncPlate();syncRoute();
  }
  window.NewCarInfocar={init};
})();
