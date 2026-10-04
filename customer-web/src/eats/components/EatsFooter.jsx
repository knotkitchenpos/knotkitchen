import React from "react";
import { Link } from "react-router-dom";
import { FOCUS } from "../shared";

const LEGAL = [
  ["terms", "Terms of use"],
  ["privacy", "Privacy policy"],
  ["refunds", "Cancellations & refunds"],
  ["grievance", "Grievance redressal"],
];
const LINK = `inline-flex min-h-[44px] items-center hover:text-slate-900 ${FOCUS}`;

/** Platform policies (EatsLegalPage), the way in for restaurants, and who runs it. */
export default function EatsFooter() {
  return (
    <footer className="mt-12 border-t border-slate-200 bg-slate-50">
      <div className="mx-auto max-w-6xl px-4 py-8 text-[14px] text-slate-600">
        <p className="text-[24px] font-extrabold leading-none tracking-tight text-[color:var(--ke-ink)]">
          knot <span className="text-[color:var(--accent)]">eats</span>
        </p>
        <nav aria-label="Knot Eats policies" className="mt-4">
          <ul className="flex flex-wrap gap-x-6">
            {LEGAL.map(([key, label]) => (
              <li key={key}>
                <Link to={`/legal/${key}`} className={LINK}>
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <p>
          <a href="https://knotkitchen.com/#contact" className={`${LINK} font-semibold text-brand`}>
            List your restaurant
          </a>
        </p>
        <p className="mt-2 text-[13px] text-slate-500">Powered by KnotKitchen</p>
      </div>
    </footer>
  );
}
