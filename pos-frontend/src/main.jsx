import React, { StrictMode, Component } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.jsx";
import { Provider } from "react-redux";
import store, { persistor } from "./redux/store.js";
import { PersistGate } from "redux-persist/integration/react";
import { SnackbarProvider } from "notistack";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { registerServiceWorker } from "./pwa/registerServiceWorker";
import FullScreenLoader from "./components/shared/FullScreenLoader";

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, where: "" };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("Uncaught error in POS Application:", error, errorInfo);
    // Put the component stack on the SCREEN, not only in the console.
    // "Cannot read properties of null" says nothing about where it happened,
    // and asking someone mid-service to open DevTools and scroll a console
    // is not a reasonable way to find out. The first few frames name the
    // component that actually threw.
    const stack = String(errorInfo?.componentStack || "")
      .split(String.fromCharCode(10))
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 6)
      .join(String.fromCharCode(10));
    this.setState({ where: stack });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-[#080F1F] p-4 text-white">
          <div className="max-w-md w-full rounded-2xl bg-[#111B2E] border border-[#26344B] p-6 shadow-2xl text-center space-y-4">
            <div className="w-12 h-12 rounded-full bg-red-500/20 text-red-400 flex items-center justify-center mx-auto text-xl font-bold">
              ⚠️
            </div>
            <h2 className="text-xl font-bold text-white">Application Error</h2>
            <p className="text-sm text-[#AEB8CA]">
              An unexpected error occurred while running KnotKitchen POS.
            </p>
            <div className="p-3 rounded-xl bg-[#0D1526] border border-[#26344B] text-left text-xs font-mono text-red-300 overflow-x-auto max-h-32">
              {this.state.error?.toString() || "Unknown error"}
            </div>
            {this.state.where ? (
              <details className="text-left">
                <summary className="text-[11px] text-[#7C8AA3] cursor-pointer select-none">
                  Where this happened
                </summary>
                <pre className="mt-2 p-3 rounded-xl bg-[#0D1526] border border-[#26344B] text-[10.5px] font-mono text-[#AEB8CA] overflow-x-auto max-h-40 whitespace-pre-wrap">
                  {this.state.where}
                </pre>
              </details>
            ) : null}
            <button
              onClick={() => window.location.reload()}
              className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-[#FF6A00] to-[#FF4D00] text-white font-semibold shadow-lg hover:opacity-90 transition-opacity"
            >
              Reload Application
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30000,
      // A PIN refusal is not retried: each retry would open the PIN popup
      // again after the staff member closed it (https/axiosWrapper.js).
      retry: (count, err) => err?.response?.data?.code !== "PIN_REQUIRED" && count < 3,

      /**
       * Belt and braces behind the socket.
       *
       * hooks/useRealtimeSync turns server events into cache invalidations,
       * and that is what makes the POS live. These two cover the case it
       * cannot: a socket that never connects at all, because a proxy or a
       * corporate network blocks websockets. Then a till still catches up
       * whenever the tab is refocused or the network returns, instead of
       * showing yesterday's orders until somebody reloads.
       *
       * Neither polls, so an idle till costs nothing.
       */
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
    },
  },
});

registerServiceWorker();

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <ErrorBoundary>
      <Provider store={store}>
        <PersistGate loading={<FullScreenLoader />} persistor={persistor}>
          <SnackbarProvider autoHideDuration={3000}>
            <QueryClientProvider client={queryClient}>
              <App />
            </QueryClientProvider>
          </SnackbarProvider>
        </PersistGate>
      </Provider>
    </ErrorBoundary>
  </StrictMode>
);
