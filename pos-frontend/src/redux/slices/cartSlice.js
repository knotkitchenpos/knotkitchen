import { createSlice } from "@reduxjs/toolkit";

const initialState = [];

const cartSlice = createSlice({
    name : "cart",
    initialState,
    reducers : {
        addItems : (state, action) => {
            const newItem = action.payload;
            const existing = state.find(item => item.menuItemId === newItem.menuItemId);
            if (existing) {
                existing.quantity += newItem.quantity;
                existing.price = existing.pricePerQuantity * existing.quantity;
            } else {
                state.push(newItem);
            }
        },

        removeItem: (state, action) => {
            return state.filter(item => item.id != action.payload);
        },

        removeAllItems: (state) => {
            return [];
        },

        updateQuantity: (state, action) => {
            const { id, quantity } = action.payload;
            const item = state.find(item => item.id === id);
            if (item && quantity > 0) {
                item.quantity = quantity;
                item.price = item.pricePerQuantity * quantity;
            }
        },

        updateItemNote: (state, action) => {
            const { id, note } = action.payload;
            const item = state.find(item => item.id === id);
            if (item) {
                item.note = note;
            }
        }
    }
})

export const getTotalPrice = (state) => state.cart.reduce((total, item) => total + item.price, 0);
export const { addItems, removeItem, removeAllItems, updateQuantity, updateItemNote } = cartSlice.actions;
export default cartSlice.reducer;