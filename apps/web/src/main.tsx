import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/contexts/theme-context";
import { applyDensity, readStoredDensity } from "@/lib/density";
import "@/i18n";
import { router } from "@/router";
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "@/styles/globals.css";

/**
 * Web entry point. Composition order matters:
 * i18n (side-effect, before any component renders text) → theme (applies the `dark`
 * class) → react-query (local API: one retry, no window-focus refetch) → router, with
 * the shared toast host mounted last. Fonts load before globals.css so the Inter /
 * JetBrains Mono @font-face rules are ready for the first paint.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
});

const container = document.getElementById("root");
if (container === null) {
  throw new Error("Root container #root is missing from index.html");
}

// Sync the density attribute after hydration; index.html already applied it before the
// first paint (to avoid a size flash) — this keeps state in sync for in-app changes.
applyDensity(readStoredDensity());

createRoot(container).render(
  <StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
        <Toaster />
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
);
