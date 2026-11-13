import React from "react";
import Reports from "../../pages/Reports";
import StoreScreen from "../components/StoreScreen";

/** One store's Reports (the POS keeps its own too). */
const ReportsPage = ({ me }) => (
  <StoreScreen me={me} title="Reports">
    <Reports />
  </StoreScreen>
);

export default ReportsPage;
