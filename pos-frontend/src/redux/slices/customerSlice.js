import { createSlice } from "@reduxjs/toolkit";

const initialState = {
    customerName: "",
    customerPhone: "",
    // B2B bill (optional): the buyer's business name and GSTIN.
    customerCompany: "",
    customerGstin: "",
    guests: 0,
    table: null,
    sessionId: "",
}


const customerSlice = createSlice({
    name : "customer",
    initialState,
    reducers : {
        setCustomer: (state, action) => {
            const { name, phone, guests, company, gstin } = action.payload;
            state.customerName = name;
            state.customerPhone = phone;
            state.guests = guests;
            if (company !== undefined) state.customerCompany = company;
            if (gstin !== undefined) state.customerGstin = gstin;
        },

        removeCustomer: (state) => {
            state.customerName = "";
            state.customerPhone = "";
            state.customerCompany = "";
            state.customerGstin = "";
            state.guests = 0;
            state.table = null;
            state.sessionId = "";
        },

        updateTable: (state, action) => {
            // Always persist capacity/occupancy so the biller flow can
            // validate guest count against the selected table.
            const { table = {}, guests } = action.payload;
            const { tableId, tableNo, displayId, capacity, occupancy, activeSessionId, session } = table;
            state.table = {
                tableId,
                tableNo,
                // So the cart says "GF-2", not "Table 3".
                displayId,
                capacity: Number(capacity) || 4,
                occupancy: Number(occupancy) || 0,
            };
            // A new table brings its own order, or none. The cart used to keep
            // the last table's order id, so Finish added GF-2's items to GF-1.
            state.sessionId = activeSessionId || session?._id || "";
            // The head count given when seating, so the Select Table popup opens with it.
            if (guests) state.guests = Math.max(1, Number(guests) || 1);
        },

        setSessionId: (state, action) => {
            state.sessionId = action.payload || "";
        },

    }
})


/**
 * An Indian mobile as typed or pasted, kept to its 10 digits: "+91 98300 12345"
 * and "098300 12345" both become "9830012345" (the server's otpService.indianMobile).
 * A plain maxLength of 10 cut a pasted "919830012345" to the wrong "9198300123".
 */
export const mobileDigits = (raw) => {
    let d = String(raw || "").replace(/\D/g, "");
    if (d.length > 10) d = d.replace(/^(91|0)/, "");
    return d.slice(0, 10);
};

export const { setCustomer, removeCustomer, updateTable, setSessionId } = customerSlice.actions;
export default customerSlice.reducer;