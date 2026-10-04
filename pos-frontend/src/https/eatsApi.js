import { axiosWrapper } from "./axiosWrapper";

/** Knot Eats (eats.<base>): this store's listing, and the public config for the map key. */
export const getKnotEats = () => axiosWrapper.get("/api/website/knot-eats");
export const setKnotEatsEnabled = (enabled) => axiosWrapper.put("/api/website/knot-eats", { enabled });
export const getEatsConfig = () => axiosWrapper.get("/api/eats/config");
