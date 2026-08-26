"use client";

import { useEffect, useState } from "react";
import { loadSettings, type DisplayCurrency } from "@/components/SettingsView";

export function useDisplayCurrency(): DisplayCurrency {
  const [currency, setCurrency] = useState<DisplayCurrency>("KRW");

  useEffect(() => {
    const apply = () => {
      try {
        setCurrency(loadSettings().displayCurrency ?? "KRW");
      } catch {
        setCurrency("KRW");
      }
    };
    apply();
    window.addEventListener("storage", apply);
    window.addEventListener("arbSettingsChanged", apply);
    return () => {
      window.removeEventListener("storage", apply);
      window.removeEventListener("arbSettingsChanged", apply);
    };
  }, []);

  return currency;
}

export function formatProfit(amountKrw: number, fxRate: number, currency: DisplayCurrency): string {
  if (currency === "USD") {
    const usd = amountKrw / (fxRate > 0 ? fxRate : 1350);
    return `$${usd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return `${Math.round(amountKrw).toLocaleString()} KRW`;
}

export function formatProfitBoth(amountKrw: number, fxRate: number): { primary: string; secondary: string } {
  const krw = `${Math.round(amountKrw).toLocaleString()} KRW`;
  const usd = `$${(amountKrw / (fxRate > 0 ? fxRate : 1350)).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return { primary: krw, secondary: usd };
}
