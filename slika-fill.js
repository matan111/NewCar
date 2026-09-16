// קוד מילוי הטפסים של INFOCAR ודף התשלום.
// נטען על ידי הכפתור שבסרגל המועדפים, ולכן אפשר לעדכן אותו כאן
// בלי שהמשתמש יתקין את הכפתור מחדש.
(function () {
  var API = window.__NC_SLIKA_API__;
  if (!API) { alert("חסרה כתובת השרת"); return; }
  var run = async function () {
        try {
          const res = await fetch(API);
          if (!res.ok) { alert('לא ניתן לטעון את הפרטים מהמערכת'); return; }
          const d = await res.json();

          const allInputs = () => {
            const list = Array.from(document.querySelectorAll('input'));
            Array.from(document.querySelectorAll('iframe')).forEach(fr => {
              try {
                const idoc = fr.contentDocument;
                if (idoc) list.push.apply(list, Array.from(idoc.querySelectorAll('input')));
              } catch (e) { /* מקור אחר - אין גישה, וזה תקין */ }
            });
            return list;
          };

          const banner = (title, body, ok) => {
            const old = document.getElementById('ncFillBanner');
            if (old) old.remove();
            const el = document.createElement('div');
            el.id = 'ncFillBanner';
            el.setAttribute('style',
              'position:fixed;top:0;left:0;right:0;z-index:2147483647;' +
              'background:' + (ok ? '#1e7a3c' : '#a33') + ';color:#fff;' +
              'font:14px/1.6 Arial,sans-serif;padding:12px 16px;direction:rtl;text-align:right;' +
              'box-shadow:0 2px 10px rgba(0,0,0,.3)');
            el.innerHTML = '<b>' + title + '</b><br>' + body +
              '<span style="float:left;cursor:pointer;font-size:20px;line-height:1">&times;</span>';
            el.querySelector('span').onclick = () => el.remove();
            document.body.appendChild(el);
            setTimeout(() => { const b = document.getElementById('ncFillBanner'); if (b) b.remove(); }, 20000);
          };

          const put = (el, v) => {
            if (!el || !v) return false;
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            setter.call(el, v);
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
          };

          const findField = (words) => allInputs().find(el => {
            if (el.type === 'hidden' || el.disabled) return false;
            const hay = ((el.placeholder || '') + ' ' + (el.name || '') + ' ' +
                         (el.id || '') + ' ' + (el.getAttribute('aria-label') || '')).toLowerCase();
            if (/card|cvv|כרטיס|תוקף/i.test(hay)) return false;   // לעולם לא שדות כרטיס
            return words.every(w => hay.includes(w.toLowerCase()));
          });

          // ---- מסלול בעל הרכב (start/1): מספר רכב בלבד + בעלים ראשי + הצהרות ----
          const primeYes = document.getElementById('radioPrimeOwnerYes');
          if (primeYes) {
            const done = [], missing = [];
            (put(document.getElementById('carNum'), d.plate) ? done : missing).push('מספר רכב');

            // "האם הינך הבעלים הראשי ברישיון" - לפי מה שסומן במערכת
            const primeNo = document.getElementById('radioPrimeOwnerNo');
            const target = (d.primeOwner === 0) ? primeNo : primeYes;
            if (target && !target.checked) { target.click(); done.push('בעלים ראשי: ' + (d.primeOwner === 0 ? 'לא' : 'כן')); }

            let decl = '';
            if (d.authorized) {
              const tick = (id) => { const el = document.getElementById(id); if (el && !el.checked) el.click(); };
              tick('cbTerms'); tick('cbTakanon');
              decl = ' · ההצהרות סומנו לפי אישורך';
            } else {
              decl = ' · לא אישרת במערכת, ההצהרות לא סומנו';
            }

            banner('סליקה — מסלול בעל הרכב',
              'מולאו: ' + (done.join(', ') || 'כלום') +
              (missing.length ? ' · לא נמצאו: ' + missing.join(', ') : '') + decl,
              done.length > 0);
            return;
          }

          // ---- ענף א': טופס INFOCAR. מזוהה חד-משמעית לפי שדה מספר הרכב ----
          const carNumEl = document.getElementById('carNum');
          if (carNumEl) {
            const done = [], missing = [];
            const mark = (ok, name) => (ok ? done : missing).push(name);

            mark(put(carNumEl, d.plate), 'מספר רכב');
            mark(put(document.getElementById('tzOfOwner'), d.ownerId), 'ת.ז בעלים');

            const fixDate = (v) => {
              const digits = String(v || '').replace(/[^0-9]/g, '');
              if (digits.length === 8) return digits.slice(0,2) + ' / ' + digits.slice(2,4) + ' / ' + digits.slice(4);
              return v;
            };
            mark(put(document.getElementById('ownerDate'), fixDate(d.ownerDate)), 'תאריך בעלות');
            mark(put(document.getElementById('ShemPrtiMorshe'), d.firstName), 'שם פרטי');
            // שם המשפחה נבחר לפי name: אצלם ה-id שלו כפול ושווה ל-carNum
            mark(put(document.querySelector('[name^="ShemMishpachaMorshe"]'), d.lastName), 'שם משפחה');
            mark(put(document.getElementById('tzOfMorshe'), d.idNumber), 'ת.ז מורשה');
            mark(put(document.getElementById('KtovetMorshe'), d.address), 'כתובת');

            let decl = '';
            if (d.authorized) {
              const tick = (id) => { const el = document.getElementById(id); if (el && !el.checked) el.click(); };
              tick('cbTerms'); tick('cbTakanon'); tick('cbAprrovedByMorshe');
              decl = ' · ההצהרות סומנו לפי אישורך';
            } else {
              decl = ' · לא אישרת הרשאה במערכת, ההצהרות לא סומנו';
            }

            banner('טופס INFOCAR',
              'מולאו: ' + (done.join(', ') || 'כלום') +
              (missing.length ? ' · לא נמצאו: ' + missing.join(', ') : '') + decl,
              done.length > 0);
            return;
          }

          // ---- ענף ב': דף התשלום ----
          const invoiceLast = findField(['שם', 'משפחה']);
          if (invoiceLast) {
            const done = [], missing = [];
            (put(invoiceLast, d.lastName) ? done : missing).push('שם משפחה');
            (put(findField(['שם', 'פרטי']), d.firstName) ? done : missing).push('שם פרטי');
            (put(findField(['דואר']) || findField(['mail']), d.email) ? done : missing).push('מייל');
            (put(findField(['טלפון']) || findField(['phone']), d.phone) ? done : missing).push('טלפון');
            banner('פרטי חשבונית',
              'מולאו: ' + (done.join(', ') || 'כלום') +
              (missing.length ? ' · לא נמצאו: ' + missing.join(', ') : '') +
              ' · פרטי הכרטיס נשארים לך.', done.length > 0);
            return;
          }

          banner('הדף הזה לא מזוהה',
            'נמצאו ' + allInputs().length + ' שדות. כתובת: ' + location.hostname +
            ' · צלם ושלח.', false);
          return;

        } catch (e) { alert('שגיאה: ' + e.message); }
      };
  run();
})();
