import React from "react";
import InventoryView from "../../components/settings/InventoryView";
import StoreScreen from "../components/StoreScreen";

/** Inventory Management, the POS's own screen, for the store picked above it. */
const InventoryPage = ({ me }) => (
  <StoreScreen me={me} title="Inventory Management">
    <div className="px-4 sm:px-5">
      <InventoryView />
    </div>
  </StoreScreen>
);

export default InventoryPage;
