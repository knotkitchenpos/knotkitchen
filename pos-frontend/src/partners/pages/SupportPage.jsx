import React from "react";
import Support from "../../pages/Support";
import StoreScreen from "../components/StoreScreen";

/** Help & Support, the POS's own screen: a request to KnotKitchen about the store picked above it. */
const SupportPage = ({ me }) => (
  <StoreScreen me={me} title="Help & Support">
    <Support />
  </StoreScreen>
);

export default SupportPage;
