import { useEffect, useState } from "react";
import { isReachable } from "../utils/connectivity";

/** Whether the server can be reached right now (utils/connectivity), kept current. */
const useReachable = () => {
  const [online, setOnline] = useState(isReachable);
  useEffect(() => {
    const on = (e) => setOnline(Boolean(e.detail?.online));
    window.addEventListener("kk:connectivity", on);
    setOnline(isReachable());
    return () => window.removeEventListener("kk:connectivity", on);
  }, []);
  return online;
};

export default useReachable;
