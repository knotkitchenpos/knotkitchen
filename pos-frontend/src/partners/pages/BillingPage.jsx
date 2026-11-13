import React from "react";
import Billing from "../../pages/Billing";
import StoreScreen from "../components/StoreScreen";

/** Billing & Subscription, moved here from the POS (owner, 2026-11-13). */
const BillingPage = ({ me }) => (
  <StoreScreen me={me} title="Billing">
    <Billing />
  </StoreScreen>
);

export default BillingPage;
