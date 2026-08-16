import { createSlice } from "@reduxjs/toolkit";

const heldOrdersSlice = createSlice({
  name: "heldOrders",
  initialState: [],
  reducers: {
    addHeldOrder: (state, action) => {
      state.unshift(action.payload);
    },
    removeHeldOrder: (state, action) =>
      state.filter((order) => order.id !== action.payload),
  },
});

export const { addHeldOrder, removeHeldOrder } = heldOrdersSlice.actions;
export default heldOrdersSlice.reducer;