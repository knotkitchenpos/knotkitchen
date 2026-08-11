import { axiosWrapper } from "./axiosWrapper";

export const addMarketplaceOrder = (data) => axiosWrapper.post("/api/marketplace/manual", data);

export const markOrderAsSeen = (id) => axiosWrapper.put("/api/marketplace/" + id + "/seen");
