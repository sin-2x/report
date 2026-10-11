import React, { useEffect, useMemo, useState } from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConfigProvider, theme } from "antd";
import ruRU from "antd/locale/ru_RU";
import App from "./App";
import "./styles.css";

export type ThemeMode = "dark" | "light";

const queryClient = new QueryClient();
const themeStorageKey = "stock-ui-theme";

function Root() {
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    return (localStorage.getItem(themeStorageKey) as ThemeMode) || "dark";
  });

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode;
    localStorage.setItem(themeStorageKey, themeMode);
  }, [themeMode]);

  const antdTheme = useMemo(
    () => ({
      algorithm: themeMode === "dark" ? theme.darkAlgorithm : theme.defaultAlgorithm,
      token: {
        colorPrimary: "#2563eb",
        colorInfo: "#2563eb",
        colorBgBase: themeMode === "dark" ? "#0f1115" : "#f4f7fb",
        colorTextBase: themeMode === "dark" ? "#f4f7fb" : "#172033",
        colorBorder: themeMode === "dark" ? "#2b313d" : "#d8e0ee",
        borderRadius: 8,
        fontFamily: 'Inter, "Segoe UI", Arial, sans-serif'
      }
    }),
    [themeMode]
  );

  return (
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <ConfigProvider locale={ruRU} theme={antdTheme}>
          <App themeMode={themeMode} onThemeChange={setThemeMode} />
        </ConfigProvider>
      </QueryClientProvider>
    </React.StrictMode>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(<Root />);
