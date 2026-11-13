import React from "react";
import { useSelector } from "react-redux";
import { Link } from "react-router-dom";
import Billing from "../../pages/Billing";
import { useActiveStore } from "../PartnersApp";
import { StorePicker } from "../components/Filters";

/**
 * Billing & Subscription, moved here from the POS (owner, 2026-11-13): the
 * POS's own screen, acting as the store picked above it.
 */
const BillingPage = ({ me }) => {
  const { current, usable, choose } = useActiveStore(me?.stores);
  // The POS screen reads the store's Owner from redux: only once it is this store's.
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
      <StorePicker usable={usable} current={current} onChoose={choose} />
      <div className="-mx-4 sm:-mx-5 rounded-2xl overflow-hidden">
        {ready ? <Billing key={current.storeId} /> : null}
      </div>
    </div>
  );
};

export default BillingPage;
