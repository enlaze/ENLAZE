"use client";

import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from "react";
import { createClient } from "@/lib/supabase-browser";

type ThemeMode = "light" | "dark" | "system";

interface ThemeContextValue {
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => Promise<void>;
  isDark: boolean;
  isLoading: boolean;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "system",
  setTheme: async () => {},
  isDark: false,
  isLoading: true,
});

export function useTheme() {
  return useContext(ThemeContext);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>("system");
  const [isDark, setIsDark] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const supabase = createClient();

  // Detect system preference
  const getSystemPreference = useCallback((): boolean => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  }, []);

  // Determine if dark mode should be active
  const determineDarkMode = useCallback((mode: ThemeMode): boolean => {
    if (mode === "light") return false;
    if (mode === "dark") return true;
    // mode === "system"
    return getSystemPreference();
  }, [getSystemPreference]);

  // Apply theme to DOM
  const applyTheme = useCallback((mode: ThemeMode) => {
    const isDarkMode = determineDarkMode(mode);
    setIsDark(isDarkMode);

    if (typeof document !== "undefined") {
      const html = document.documentElement;
      if (isDarkMode) {
        html.classList.add("dark");
        html.setAttribute("data-theme", "dark");
      } else {
        html.classList.remove("dark");
        html.setAttribute("data-theme", "light");
      }
    }
  }, [determineDarkMode]);

  // Load theme preference from Supabase and localStorage
  const loadTheme = useCallback(async () => {
    try {
      setIsLoading(true);

      // Try to get user's saved preference from Supabase
      const { data: { user } } = await supabase.auth.getUser();

      let savedTheme: ThemeMode = "system";

      if (user?.user_metadata?.theme_preference) {
        savedTheme = user.user_metadata.theme_preference as ThemeMode;
      } else {
        // Fall back to localStorage
        const stored = localStorage.getItem("theme-preference");
        if (stored === "light" || stored === "dark" || stored === "system") {
          savedTheme = stored as ThemeMode;
        }
      }

      setThemeState(savedTheme);
      applyTheme(savedTheme);
    } catch (error) {
      console.error("Error loading theme:", error);
      // Fall back to system preference
      applyTheme("system");
    } finally {
      setIsLoading(false);
    }
  }, [supabase.auth, applyTheme]);

  // Initial load and system preference listener setup
  useEffect(() => {
    loadTheme();

    // Listen for system theme changes
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => {
      // Only apply if using system preference
      if (theme === "system") {
        applyTheme("system");
      }
    };

    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, [loadTheme, theme, applyTheme]);

  // Set theme and persist
  const setTheme = useCallback(async (newTheme: ThemeMode) => {
    setThemeState(newTheme);
    applyTheme(newTheme);

    // Save to localStorage as backup
    localStorage.setItem("theme-preference", newTheme);

    // Try to save to Supabase user metadata
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase.auth.updateUser({
          data: {
            ...user.user_metadata,
            theme_preference: newTheme,
          },
        });
      }
    } catch (error) {
      console.error("Error saving theme to Supabase:", error);
      // Still persisted in localStorage, so it's OK
    }
  }, [supabase.auth, applyTheme]);

  return (
    <ThemeContext.Provider
      value={{
        theme,
        setTheme,
        isDark,
        isLoading,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}
