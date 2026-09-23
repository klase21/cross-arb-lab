"use client";

import { useState } from "react";
import TaView from "@/components/TaView";
import FuturesView from "@/components/FuturesView";
import { useLang } from "@/lib/i18n";

type TechSub = "futures" | "ta";

// Investing.com style: one page, sub-tabs switch the table below.
export default function TechView() {
  const { t } = useLang();
  const [sub, setSub] = useState<TechSub>("futures");
  const pill = (active: boolean) =>
    `px-4 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${active ? "bg-emerald-600 text-white" : "bg-zinc-900 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"}`;
  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5 mb-1">
        <button onClick={() => setSub("futures")} className={pill(sub === "futures")}>{t("tab.futures.title")}</button>
        <button onClick={() => setSub("ta")} className={pill(sub === "ta")}>{t("tab.ta.title")}</button>
      </div>
      <p className="text-xs text-zinc-500 mt-0.5 mb-4">{t(sub === "futures" ? "tab.futures.desc" : "tab.ta.desc")}</p>
      {sub === "futures" ? <FuturesView /> : <TaView />}
    </div>
  );
}
