import React from "react";
import ManageMenu from "../../components/dashboard/ManageMenu";
import StoreScreen from "../components/StoreScreen";

/** Manage Menu, the POS's own screen, for the store picked above it. */
const MenuPage = ({ me }) => (
  <StoreScreen me={me} fill title="Manage Menu">
    <ManageMenu />
  </StoreScreen>
);

export default MenuPage;
