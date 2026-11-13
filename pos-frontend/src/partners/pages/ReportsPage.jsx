import React from "react";
import { Link } from "react-router-dom";
import Reports from "../../pages/Reports";
import { useActiveStore } from "../PartnersApp";
import { StorePicker } from "../components/Filters";

/**
 * One store's Reports (the POS keeps its own too): the
 * POS's own screen, acting as the store picked above it.
 */
const ReportsPage = ({ me }) => {
  const { current, usable, choose } = useActiveStore(me?.stores);
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
      <div className="-mx-4 sm:-mx-7 rounded-2xl overflow-hidden">
        <Reports key={current.storeId} />
      </div>
    </div>
  );
};

export default ReportsPage;
