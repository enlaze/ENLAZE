"use client";

import { ThemeProvider } from "@/lib/theme-context";

export function ClientThemeProvider({ children }: { children: React.ReactNode }) {
  return <ThemeProvider>{children}</ThemeProvider>;
}
