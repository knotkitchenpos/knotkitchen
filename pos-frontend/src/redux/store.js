import { configureStore, combineReducers } from "@reduxjs/toolkit";
import { persistReducer, persistStore, FLUSH, REHYDRATE, PAUSE, PERSIST, PURGE, REGISTER } from "redux-persist";
import storage from "redux-persist/lib/storage";
import customerSlice from "./slices/customerSlice"
import cartSlice from "./slices/cartSlice";
import userSlice from "./slices/userSlice";
import orderTypeSlice from "./slices/orderTypeSlice";
import heldOrdersSlice from "./slices/heldOrdersSlice";
import discountSlice from "./slices/discountSlice";

const persistConfig = {
    key: "root",
    storage,
    // `discount` is deliberately NOT persisted: a cart-level discount is
    // scoped to the customer currently at the till and must reset when the
    // POS reloads (otherwise a refresh mid-shift could silently reapply an
    // old 40% discount to the next customer).
    whitelist: ["user", "heldOrders"]
};

const rootReducer = combineReducers({
    customer: customerSlice,
    cart : cartSlice,
    user : userSlice,
    orderType: orderTypeSlice,
    heldOrders: heldOrdersSlice,
    discount: discountSlice,
});

const persistedReducer = persistReducer(persistConfig, rootReducer);

const store = configureStore({
    reducer: persistedReducer,
    middleware: (getDefaultMiddleware) =>
        getDefaultMiddleware({
            serializableCheck: {
                ignoredActions: [FLUSH, REHYDRATE, PAUSE, PERSIST, PURGE, REGISTER],
            },
        }),
    devTools: import.meta.env.DEV,
});

export const persistor = persistStore(store);

export default store;