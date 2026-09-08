# תוסף Chrome למילוי מורשה ב־Infocar

התקנה מקומית של תוסף MV3, בתיקיית `infocar-chrome`. לא פורסם בחנות ולא הותקן אוטומטית בדפדפן. מדריך מפורט זמין ב־`/infocar-chrome` ב־NewCar, לבעלים הראשי בלבד.

## הרצה

1. ב־Chrome: `chrome://extensions`, מצב מפתח, Load unpacked, בחירת `C:\Users\matanatedgi\NewCar\infocar-chrome`.
2. פתח את NewCar המעודכן ב־Chrome והתחבר כבעלים. לחץ על התוסף ועל טעינת פרטים מ־NewCar, בדוק חלוקת שם פרטי/משפחה, ואשר שמירה. חלוקת שם בן שתי מילים מוצעת לפי סדר משפחה–פרטי וטעונה אישור מפורש; שם ארוך יותר דורש הזנה ידנית.
3. בחלונית פרטי המורשה הפתוחה ב־https://tviot.slika-ins.co.il/start/5 לחץ בתוסף על מילוי ארבעת השדות.

## גבולות

- ממלא רק שם פרטי, שם משפחה, ת״ז וכתובת של המורשה בחלונית `#modal3`. שמות השדות/placeholder נבדקו מול הממשק הציבורי והתמונה. לשם המשפחה יש id כפול `carNum`, ולכן לא משתמשים בו לזיהוי.
- בדיקת כל היעדים לפני כתיבה. אין דריסת ערכים שונים. שינוי מבנה, מקור, מסלול או שדות חסומים עוצר את הפעולה. אירועי input/change מיועדים לעדכון טופס Angular, לא לקריאה לממשק עסקה.
- אין סימון checkbox, לחיצה, submit, יצירת עסקה, תשלום או טיפול ב־CAPTCHA/אימות. אין שינוי מספר רכב או תעודת הזהות של בעל הרכב. פרטי חשבונית אינם ממולאים בשלב זה.
- ההרשאות הן activeTab, scripting, storage בלבד. אין host_permissions, content_scripts קבועים, רכיב רקע או קוד מרוחק.
- הייבוא קורא רק `/api/me` ואז `/api/infocar/invoice-profile` באותו מקור, ורק אם הוא חשבון הבעלים הראשי. מותרים דף car-reception.html באתר NewCar הידוע או localhost/127.0.0.1. אין שליחת נתונים בתוך URL, לוח העתקה או קובץ.
- אין מידע אישי בקובצי התוסף או ב־ZIP. השמירה מתבצעת רק אחרי פעולה מפורשת; local במחשב או session בזיכרון, בלי Chrome Sync. גישת תוכן אתר לאחסון חסומה דרך TRUSTED_CONTEXTS. אחסון local אינו מוצפן בשכבת התוסף, ולכן אינו מתאים לפרופיל משותף.
- מחיקה בתוסף מוחקת ממנו את הפרופיל בלבד. שינוי הפרופיל ב־NewCar מחייב ייבוא ושמירה חוזרים בתוסף.

## בדיקות ומצב

בדיקות Node של הפונקציות המוזרקות משתמשות ב־VM ובטופס DOM מדומה, ללא נתונים אמיתיים או אינטרנט. בדיקות השרת הקיימות נשמרו. אין לראות בבדיקות אלו הוכחה להתקנה או לביצוע דוח באתר החי.

לא בוצעה פריסה לשרת החי, התקנה בחשבון Chrome או עסקת תשלום. כדי להשתמש במסלולי ההורדה והייבוא החדשים יש להפעיל מחדש את שרת NewCar המקומי. ההרחבה ידנית עובדת גם בלי ייבוא מ־NewCar.

מקורות פיתוח: https://developer.chrome.com/docs/extensions/develop/concepts/activeTab ; https://developer.chrome.com/docs/extensions/reference/api/scripting ; https://developer.chrome.com/docs/extensions/reference/api/storage ; https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world
