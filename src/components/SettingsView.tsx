"use client";

import { useState, useEffect } from "react";
import { useLang } from "@/lib/i18n";

export interface AppSettings {
  refreshIntervalSec: number; // polling interval for all live views
  notifyEnabled: boolean;
  kimchiThresholdPct: number;      // kimchi premium % to trigger alert
  roundTripThresholdPct: number;   // round-trip net profit % to trigger alert
  dexThresholdPct: number;         // DEX arbitrage net spread %
  cexThresholdPct: number;         // CEX-to-CEX net spread %
  hybridThresholdPct: number;      // CEX→DEX→CEX net spread %
  notifyCooldownMin: number;       // per-coin cooldown
  telegramEnabled: boolean;
  telegramBotToken: string;
  telegramChatId: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  refreshIntervalSec: 30,
  notifyEnabled: false,
  kimchiThresholdPct: 2,
  roundTripThresholdPct: 0.8,
  dexThresholdPct: 1,
  cexThresholdPct: 0.8,
  hybridThresholdPct: 0.8,
  notifyCooldownMin: 10,
  telegramEnabled: false,
  telegramBotToken: "",
  telegramChatId: "",
};

export function loadSettings(): AppSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = localStorage.getItem("arbSettings");
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {}
  return DEFAULT_SETTINGS;
}

export function saveSettings(s: AppSettings) {
  localStorage.setItem("arbSettings", JSON.stringify(s));
  window.dispatchEvent(new Event("arbSettingsChanged"));
}

export default function SettingsView() {
  const { t } = useLang();
  const [s, setS] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [saved, setSaved] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("default");

  useEffect(() => {
    setS(loadSettings());
    if (typeof window !== "undefined" && "Notification" in window) {
      setPermission(Notification.permission);
    } else {
      setPermission("unsupported");
    }
  }, []);

  const update = (patch: Partial<AppSettings>) => setS(prev => ({ ...prev, ...patch }));

  const onSave = () => { saveSettings(s); setSaved(true); setTimeout(() => setSaved(false), 1500); };

  const requestPermission = async () => {
    if (!("Notification" in window)) return;
    const result = await Notification.requestPermission();
    setPermission(result);
  };

  const sendTestNotification = () => {
    if (Notification.permission === "granted") {
      new Notification(t("settings.testTitle"), { body: t("settings.testBody"), tag: "arb-test" });
    }
    if (s.telegramEnabled && s.telegramBotToken && s.telegramChatId) {
      fetch(`https://api.telegram.org/bot${s.telegramBotToken}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: s.telegramChatId, text: t("settings.testTelegram") }),
      }).catch(() => {});
    }
  };

  return (
    <div className="max-w-2xl">
      <section className="rounded-xl border border-zinc-800 p-6 mb-6">
        <h2 className="text-base font-semibold mb-4">{t("settings.liveData")}</h2>
        <div>
          <label className="block text-sm text-zinc-400 mb-1">{t("settings.refreshInterval")}: <strong>{s.refreshIntervalSec}s</strong></label>
          <input type="range" min={10} max={120} step={5} value={s.refreshIntervalSec} onChange={e => update({ refreshIntervalSec: Number(e.target.value) })} className="w-full accent-emerald-500" />
          <p className="text-xs text-zinc-600 mt-1">{t("settings.refreshIntervalDesc")}</p>
        </div>
      </section>

      <section className="rounded-xl border border-zinc-800 p-6 mb-6">
        <h2 className="text-base font-semibold mb-1">{t("settings.alerts")}</h2>
        <p className="text-xs text-zinc-500 mb-4">{t("settings.alertsDesc")}</p>

        <label className="flex items-center justify-between gap-4 py-2 cursor-pointer select-none">
          <div><p className="text-sm">{t("settings.enableAlerts")}</p><p className="text-xs text-zinc-600">{t("settings.enableAlertsDesc")}</p></div>
          <button onClick={() => update({ notifyEnabled: !s.notifyEnabled })} className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${s.notifyEnabled ? "bg-emerald-600" : "bg-zinc-700"}`}>
            <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${s.notifyEnabled ? "translate-x-[18px]" : "translate-x-1"}`} />
          </button>
        </label>

        <div className="mt-3 flex items-center gap-2 text-xs">
          {permission === "unsupported" ? (
            <span className="text-zinc-500">{t("settings.permissionUnsupported")}</span>
          ) : permission === "granted" ? (
            <span className="text-emerald-400">{t("settings.permissionGranted")}</span>
          ) : (
            <button onClick={requestPermission} className="px-3 py-1.5 rounded-lg border border-zinc-700 hover:border-emerald-500 text-zinc-300">{t("settings.requestPermission")}</button>
          )}
          <button onClick={sendTestNotification} className="px-3 py-1.5 rounded-lg border border-zinc-700 hover:border-zinc-500 text-zinc-400">{t("settings.testNotification")}</button>
        </div>

        <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-zinc-500 mb-1">{t("settings.kimchiThreshold")} <strong>{s.kimchiThresholdPct.toFixed(1)}%</strong></label>
            <input type="range" min={0} max={10} step={0.1} value={s.kimchiThresholdPct} onChange={e => update({ kimchiThresholdPct: Number(e.target.value) })} className="w-full accent-emerald-500" />
          </div>
          <div>
            <label className="block text-xs text-zinc-500 mb-1">{t("settings.roundTripThreshold")} <strong>{s.roundTripThresholdPct.toFixed(1)}%</strong></label>
            <input type="range" min={0} max={10} step={0.1} value={s.roundTripThresholdPct} onChange={e => update({ roundTripThresholdPct: Number(e.target.value) })} className="w-full accent-emerald-500" />
          </div>
          <div>
            <label className="block text-xs text-zinc-500 mb-1">{t("settings.dexThreshold")} <strong>{s.dexThresholdPct.toFixed(1)}%</strong></label>
            <input type="range" min={0} max={5} step={0.1} value={s.dexThresholdPct} onChange={e => update({ dexThresholdPct: Number(e.target.value) })} className="w-full accent-emerald-500" />
          </div>
          <div>
            <label className="block text-xs text-zinc-500 mb-1">{t("settings.cexThreshold")} <strong>{s.cexThresholdPct.toFixed(1)}%</strong></label>
            <input type="range" min={0} max={5} step={0.1} value={s.cexThresholdPct} onChange={e => update({ cexThresholdPct: Number(e.target.value) })} className="w-full accent-emerald-500" />
          </div>
        </div>
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-zinc-500 mb-1">{t("settings.hybridThreshold")} <strong>{s.hybridThresholdPct.toFixed(1)}%</strong></label>
            <input type="range" min={0} max={5} step={0.1} value={s.hybridThresholdPct} onChange={e => update({ hybridThresholdPct: Number(e.target.value) })} className="w-full accent-emerald-500" />
          </div>
          <div>
            <label className="block text-xs text-zinc-500 mb-1">{t("settings.cooldown")} <strong>{s.notifyCooldownMin}{t("common.minute")}</strong></label>
            <input type="range" min={1} max={60} step={1} value={s.notifyCooldownMin} onChange={e => update({ notifyCooldownMin: Number(e.target.value) })} className="w-full accent-emerald-500" />
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-zinc-800 p-6 mb-6">
        <h2 className="text-base font-semibold mb-1">{t("settings.telegram")}</h2>
        <p className="text-xs text-zinc-500 mb-4">{t("settings.telegramDesc")}</p>
        <label className="flex items-center justify-between gap-4 py-2 cursor-pointer select-none mb-3">
          <p className="text-sm">{t("settings.telegramEnable")}</p>
          <button onClick={() => update({ telegramEnabled: !s.telegramEnabled })} className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${s.telegramEnabled ? "bg-emerald-600" : "bg-zinc-700"}`}>
            <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${s.telegramEnabled ? "translate-x-[18px]" : "translate-x-1"}`} />
          </button>
        </label>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-zinc-500 mb-1">{t("settings.botToken")}</label>
            <input type="password" placeholder="123456:ABC-..." value={s.telegramBotToken} onChange={e => update({ telegramBotToken: e.target.value })} className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-emerald-500" />
          </div>
          <div>
            <label className="block text-xs text-zinc-500 mb-1">{t("settings.chatId")}</label>
            <input type="text" placeholder="123456789" value={s.telegramChatId} onChange={e => update({ telegramChatId: e.target.value })} className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-emerald-500" />
          </div>
        </div>
      </section>

      <button onClick={onSave} className={"w-full py-3 rounded-xl font-medium transition-colors " + (saved ? "bg-emerald-500 text-white" : "bg-emerald-600 hover:bg-emerald-500")}>
        {saved ? t("settings.saved") : t("settings.save")}
      </button>
    </div>
  );
}
