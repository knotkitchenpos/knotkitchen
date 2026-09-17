import { axiosWrapper } from "./axiosWrapper";

export const markOrderAsSeen = (id) => axiosWrapper.put("/api/marketplace/" + id + "/seen");
