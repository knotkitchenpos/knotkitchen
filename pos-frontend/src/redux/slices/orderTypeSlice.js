import { createSlice } from "@reduxjs/toolkit";

const initialState = {
  orderType: "Collection",
};

const orderTypeSlice = createSlice({
  name: "orderType",
  initialState,
  reducers: {
    setOrderType: (state, action) => {
      state.orderType = action.payload;
    },
  },
});

export const { setOrderType } = orderTypeSlice.actions;
export default orderTypeSlice.reducer;