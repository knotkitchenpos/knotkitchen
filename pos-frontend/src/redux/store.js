import { configureStore, combineReducers } from "@reduxjs/toolkit";
import { persistReducer, persistStore, FLUSH, REHYDRATE, PAUSE, PERSIST, PURGE, REGISTER } from "redux-persist";
import storage from "redux-persist/lib/storage";
import customerSlice from "./slices/customerSlice"
import cartSlice from "./slices/cartSlice";
import userSlice from "./slices/userSlice";
import themeSlice from "./slices/themeSlice";
import orderTypeSlice from "./slices/orderTypeSlice";

const persistConfig = {
    key: "root",
    storage,
    whitelist: ["user"]
};

const rootReducer = combineReducers({
    customer: customerSlice,
    cart : cartSlice,
    user : userSlice,
    theme: themeSlice,
    orderType: orderTypeSlice
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
    devTools: import.meta.env.NODE_ENV !== "production",
});

export const persistor = persistStore(store);

export default store;