"use client";

import { useEffect, useState } from "react";
import { loadSettings } from "@/components/SettingsView";

/**
 * Returns the user-configured polling interval (seconds) and live-updates
 * when settings are saved (same tab or another tab).
 */
export function usePollingInterval(): number {
  const [intervalSec, setIntervalSec] = useState(30);

  useEffect(() => {
    const apply = () => {
      const value = loadSettings().refreshIntervalSec;
      if (value >= 5) setIntervalSec(value);
    };
    apply();
    window.addEventListener("storage", apply);
    window.addEventListener("arbSettingsChanged", apply);
    return () => {
      window.removeEventListener("storage", apply);
      window.removeEventListener("arbSettingsChanged", apply);
    };
  }, []);

  return intervalSec;
}
