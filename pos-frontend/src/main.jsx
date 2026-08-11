import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.jsx";
import { Provider } from "react-redux";
import store, { persistor } from "./redux/store.js";
import { PersistGate } from "redux-persist/integration/react";
import { SnackbarProvider } from "notistack";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime : 30000,
    }
  }
})

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <Provider store={store}>
      <PersistGate loading={null} persistor={persistor}>
        <SnackbarProvider autoHideDuration={3000}>
          <QueryClientProvider client={queryClient} >
            <App />
          </QueryClientProvider>
        </SnackbarProvider>
      </PersistGate>
    </Provider>
  </StrictMode>
);
