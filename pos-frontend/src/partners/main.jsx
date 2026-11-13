import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { SnackbarProvider } from "notistack";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "../index.css";
import userReducer from "../redux/slices/userSlice";
import PartnersApp from "./PartnersApp";

// Only what the reused POS screens read (Billing reads state.user); nothing
// persisted, unlike the POS's store.
const store = configureStore({ reducer: { user: userReducer } });

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 30_000 } },
});

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Provider store={store}>
      <QueryClientProvider client={queryClient}>
        <SnackbarProvider maxSnack={3} anchorOrigin={{ vertical: "top", horizontal: "center" }} autoHideDuration={4000}>
          <BrowserRouter basename="/partners">
            <PartnersApp />
          </BrowserRouter>
        </SnackbarProvider>
      </QueryClientProvider>
    </Provider>
  </React.StrictMode>
);
