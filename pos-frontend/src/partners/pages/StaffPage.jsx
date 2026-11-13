import React from "react";
import ManageStaffView from "../../components/settings/ManageStaffView";
import StoreScreen from "../components/StoreScreen";

/** Manage Staff, the POS's own screen, for the store picked above it. */
const StaffPage = ({ me }) => (
  <StoreScreen me={me} title="Manage Staff">
    <div className="px-4 sm:px-5">
      <ManageStaffView />
    </div>
  </StoreScreen>
);

export default StaffPage;
