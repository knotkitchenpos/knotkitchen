import { createSlice } from "@reduxjs/toolkit";

const initialState = {
    _id: "",
    name: "",
    address: "",
    email : "",
    phone: "",
    role: "",
    // Tenant identifiers — needed to subscribe to this restaurant's realtime
    // room. They are display/routing hints only: the backend always re-derives
    // the tenant from the session and never trusts these values.
    restaurantId: "",
    storeId: "",
    isAuth: false
}


const userSlice = createSlice({
    name: "user",
    initialState,
    reducers: {
        setUser: (state, action) => {
            const { _id, name, address, phone, email, role, restaurantId, storeId } = action.payload;
            state._id = _id;
            state.name = name;
            state.address = address;
            state.phone = phone;
            state.email = email;
            state.role = role;
            state.restaurantId = restaurantId || "";
            state.storeId = storeId || "";
            state.isAuth = true;
        },

        removeUser: (state) => {
            state._id = "";
            state.address = "";
            state.email = "";
            state.name = "";
            state.phone = "";
            state.role = "";
            state.restaurantId = "";
            state.storeId = "";
            state.isAuth = false;
        }

    }
})

export const { setUser, removeUser } = userSlice.actions;
export default userSlice.reducer;