import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { SnackbarProvider } from "notistack";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "../index.css";
import "./rider.css";
import RiderApp from "./RiderApp";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true, staleTime: 15_000 } },
});

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <SnackbarProvider maxSnack={2} anchorOrigin={{ vertical: "top", horizontal: "center" }} autoHideDuration={3500} preventDuplicate>
        <BrowserRouter basename="/rider">
          <RiderApp />
        </BrowserRouter>
      </SnackbarProvider>
    </QueryClientProvider>
  </React.StrictMode>
);
