import React from "react";
import { Link } from "react-router-dom";
import { useSelector } from "react-redux";
import { useActiveStore } from "../PartnersApp";
import { StorePicker } from "./Filters";

/**
 * One of the POS's own screens (Billing, Reports, Manage Menu, Inventory,
 * Manage Staff, Help & Support), acting as the store picked above it. The
 * screen is drawn only once redux holds that store's Owner (the POS screens
 * read it), and drawn afresh on a switch so nothing of one store shows under
 * another's name. `fill`: the screen scrolls inside a fixed-height frame, as
 * in the POS (Manage Menu).
 */
const StoreScreen = ({ me, children, fill = false, title }) => {
  const { current, usable, choose } = useActiveStore(me?.stores);
  const ready = useSelector((s) => s.user.storeId) === current?.storeId;
  if (!current) {
    return (
      <div className="bg-white border border-[#E2E8F0] rounded-2xl p-8 text-center">
        <p className="text-[15px] font-bold">No store to show.</p>
        <p className="text-[13px] text-[#64748B] mt-1">
          Confirm your stores&apos; links on the <Link to="/stores" className="underline font-bold">Stores</Link> page.
        </p>
      </div>
    );
  }
  return (
    <div>
      {title && <h1 className="sr-only">{title}</h1>}
      <StorePicker usable={usable} current={current} onChoose={choose} />
      {ready ? (
        <div
          key={current.storeId}
          className={
            fill
              ? "bg-white border border-[#E2E8F0] rounded-2xl overflow-hidden h-[calc(100dvh-236px)] lg:h-[calc(100dvh-170px)] min-h-[480px]"
              : "-mx-4 sm:-mx-5 rounded-2xl overflow-hidden"
          }
        >
          {children}
        </div>
      ) : null}
    </div>
  );
};

export default StoreScreen;
