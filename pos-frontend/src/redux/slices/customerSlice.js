import { createSlice } from "@reduxjs/toolkit";

const initialState = {
    orderId: "",
    customerName: "",
    customerPhone: "",
    guests: 0,
    table: null,
    sessionId: "",
}


const customerSlice = createSlice({
    name : "customer",
    initialState,
    reducers : {
        setCustomer: (state, action) => {
            const { name, phone, guests } = action.payload;
            state.orderId = `${Date.now()}`;
            state.customerName = name;
            state.customerPhone = phone;
            state.guests = guests;
        },

        removeCustomer: (state) => {
            state.customerName = "";
            state.customerPhone = "";
            state.guests = 0;
            state.table = null;
            state.sessionId = "";
        },

        updateTable: (state, action) => {
            // Always persist capacity/occupancy so the biller flow can
            // validate guest count against the selected table.
            const { tableId, tableNo, capacity, occupancy } = action.payload.table;
            state.table = {
                tableId,
                tableNo,
                capacity: Number(capacity) || 4,
                occupancy: Number(occupancy) || 0,
            };
        },

        updateGuests: (state, action) => {
            // Capacity is validated by the backend — this is a display/state
            // update only. The biller enters the customer count per the EPOS
            // flow before attaching items to the table session.
            state.guests = Number(action.payload) || 0;
        },

        setSessionId: (state, action) => {
            state.sessionId = action.payload || "";
        },

    }
})


export const { setCustomer, removeCustomer, updateTable, updateGuests, setSessionId } = customerSlice.actions;
export default customerSlice.reducer;