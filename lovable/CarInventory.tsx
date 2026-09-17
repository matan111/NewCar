import { useEffect, useMemo, useState } from "react";

/**
 * קטלוג הרכבים של ניו קאר חדרה.
 *
 * מושך ישירות ממערכת ניהול המלאי. אין סנכרון ואין עותק מקומי:
 * רכב שנמכר או שטרם הגיע לא מוחזר מה-API, ולכן פשוט לא מוצג כאן.
 * כל שינוי במערכת מופיע באתר בטעינת העמוד הבאה.
 */

const API = "https://newcar-production.up.railway.app";
const WHATSAPP = "972543034757";

type Car = {
  id: number;
  plate: string;
  manufacturer: string;
  model: string;
  year: number | null;
  color: string;
  kilometers: number | null;
  transmission: "manual" | "automatic";
  engine: string | number;
  trimLevel: string;
  hands: number | null;
  usage: string;
  price: number | null;
  testValidUntil: string;
  images: string[];
};

const USAGE_LABELS: Record<string, string> = {
  private: "פרטי",
  lease: "ליסינג",
  lease_zero: 'ליסינג 0 ק"מ',
  rental: "השכרה",
  company: "חברה",
  taxi: "מונית",
};

const BUDGETS = [25000, 50000, 75000, 100000, 150000, 200000];

const shekel = (n: number) => "₪" + n.toLocaleString("he-IL");

export default function CarInventory() {
  const [cars, setCars] = useState<Car[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const [brand, setBrand] = useState("");
  const [budget, setBudget] = useState<number | "">("");

  useEffect(() => {
    let alive = true;
    fetch(`${API}/api/public/cars`)
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then((d) => alive && setCars(d.cars || []))
      .catch(() => alive && setError(true))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  const brands = useMemo(
    () => [...new Set(cars.map((c) => c.manufacturer).filter(Boolean))].sort((a, b) => a.localeCompare(b, "he")),
    [cars]
  );

  const shown = useMemo(
    () =>
      cars.filter((c) => {
        if (brand && c.manufacturer !== brand) return false;
        // רכב בלי מחיר לא נפסל על ידי סינון תקציב - הוא פשוט לא ידוע
        if (budget !== "" && c.price && c.price > Number(budget)) return false;
        return true;
      }),
    [cars, brand, budget]
  );

  const waLink = (c: Car) =>
    `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(
      `היי, מעניין אותי ה${c.manufacturer} ${c.model} ${c.year ?? ""}`
    )}`;

  if (loading) {
    return <div dir="rtl" className="py-20 text-center text-slate-400">טוען מלאי...</div>;
  }

  if (error) {
    return (
      <div dir="rtl" className="py-20 text-center">
        <p className="text-slate-600">לא הצלחנו לטעון את המלאי כרגע.</p>
        <a href={`https://wa.me/${WHATSAPP}`} className="mt-3 inline-block text-amber-600 underline">
          דברו איתנו בוואטסאפ
        </a>
      </div>
    );
  }

  return (
    <section dir="rtl" className="mx-auto max-w-6xl px-4 py-14">
      <header className="mb-8 text-center">
        <h2 className="text-3xl font-bold text-slate-900">קטלוג הרכבים שלנו</h2>
        <p className="mt-2 text-slate-500">{cars.length} רכבים במלאי</p>
      </header>

      <div className="mb-8 flex flex-wrap justify-center gap-3">
        <select
          value={brand}
          onChange={(e) => setBrand(e.target.value)}
          className="rounded-lg border border-slate-300 px-4 py-2.5 outline-none focus:border-amber-500"
        >
          <option value="">כל היצרנים</option>
          {brands.map((b) => (
            <option key={b} value={b}>{b}</option>
          ))}
        </select>

        <select
          value={budget}
          onChange={(e) => setBudget(e.target.value === "" ? "" : Number(e.target.value))}
          className="rounded-lg border border-slate-300 px-4 py-2.5 outline-none focus:border-amber-500"
        >
          <option value="">כל התקציבים</option>
          {BUDGETS.map((b) => (
            <option key={b} value={b}>עד {shekel(b)}</option>
          ))}
        </select>

        {(brand || budget !== "") && (
          <button
            onClick={() => { setBrand(""); setBudget(""); }}
            className="rounded-lg px-4 py-2.5 text-slate-500 hover:text-slate-800"
          >
            נקה סינון
          </button>
        )}
      </div>

      {shown.length === 0 ? (
        <p className="py-16 text-center text-slate-400">לא נמצאו רכבים מתאימים.</p>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((car) => (
            <article
              key={car.id}
              className="group overflow-hidden rounded-xl border border-slate-200 bg-white transition hover:shadow-lg"
            >
              <div className="aspect-[4/3] overflow-hidden bg-slate-100">
                {car.images?.length ? (
                  <img
                    src={API + car.images[0]}
                    alt={`${car.manufacturer} ${car.model}`}
                    className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-slate-300">
                    אין תמונה
                  </div>
                )}
              </div>

              <div className="p-5">
                <h3 className="text-lg font-bold text-slate-900">
                  {car.manufacturer} {car.model}
                </h3>
                <p className="mt-1 text-sm text-slate-500">
                  {[
                    car.year,
                    car.kilometers ? car.kilometers.toLocaleString("he-IL") + ' ק"מ' : null,
                    car.hands ? `יד ${car.hands}` : null,
                    USAGE_LABELS[car.usage],
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>

                <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-4">
                  <span className="text-xl font-bold text-amber-600">
                    {car.price ? shekel(car.price) : "לפרטים"}
                  </span>
                  <a
                    href={waLink(car)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700"
                  >
                    לפרטים
                  </a>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
