import React, { useEffect } from "react";
import ManageMenu from "../components/dashboard/ManageMenu";

const ManageMenuPage = () => {
  useEffect(() => {
    document.title = "KnotKitchen | Manage Menu";
  }, []);

  return (
    <div className="h-full w-full overflow-hidden bg-white">
      <ManageMenu />
    </div>
  );
};

export default ManageMenuPage;
