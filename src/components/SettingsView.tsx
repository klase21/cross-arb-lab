"use client";

import { useState, useEffect } from "react";

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
      new Notification("Arb Scanner — 테스트 알림", { body: "알림이 정상적으로 동작합니다.", tag: "arb-test" });
    }
    if (s.telegramEnabled && s.telegramBotToken && s.telegramChatId) {
      fetch(`https://api.telegram.org/bot${s.telegramBotToken}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: s.telegramChatId, text: "Arb Scanner — 텔레그램 테스트 알림이 정상 동작합니다." }),
      }).catch(() => {});
    }
  };

  return (
    <div className="max-w-2xl">
      <section className="rounded-xl border border-zinc-800 p-6 mb-6">
        <h2 className="text-base font-semibold mb-4">Live Data</h2>
        <div>
          <label className="block text-sm text-zinc-400 mb-1">Refresh interval: <strong>{s.refreshIntervalSec}s</strong></label>
          <input type="range" min={10} max={120} step={5} value={s.refreshIntervalSec} onChange={e => update({ refreshIntervalSec: Number(e.target.value) })} className="w-full accent-emerald-500" />
          <p className="text-xs text-zinc-600 mt-1">Applies to CEX-to-CEX, Kimchi, CEX→DEX→CEX, DEX Arbitrage and DEX Compare views.</p>
        </div>
      </section>

      <section className="rounded-xl border border-zinc-800 p-6 mb-6">
        <h2 className="text-base font-semibold mb-1">알림</h2>
        <p className="text-xs text-zinc-500 mb-4">임계값을 넘은 기회가 감지되면 브라우저 알림(및 선택 시 텔레그램)으로 알려줍니다. 각 코인별 쿨다운이 적용되어 스팸을 방지합니다.</p>

        <label className="flex items-center justify-between gap-4 py-2 cursor-pointer select-none">
          <div><p className="text-sm">알림 활성화</p><p className="text-xs text-zinc-600">브라우저 알림을 사용합니다</p></div>
          <button onClick={() => update({ notifyEnabled: !s.notifyEnabled })} className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${s.notifyEnabled ? "bg-emerald-600" : "bg-zinc-700"}`}>
            <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${s.notifyEnabled ? "translate-x-[18px]" : "translate-x-1"}`} />
          </button>
        </label>

        <div className="mt-3 flex items-center gap-2 text-xs">
          {permission === "unsupported" ? (
            <span className="text-zinc-500">이 브라우저는 알림을 지원하지 않습니다.</span>
          ) : permission === "granted" ? (
            <span className="text-emerald-400">✓ 알림 권한 허용됨</span>
          ) : (
            <button onClick={requestPermission} className="px-3 py-1.5 rounded-lg border border-zinc-700 hover:border-emerald-500 text-zinc-300">알림 권한 요청</button>
          )}
          <button onClick={sendTestNotification} className="px-3 py-1.5 rounded-lg border border-zinc-700 hover:border-zinc-500 text-zinc-400">테스트 알림 보내기</button>
        </div>

        <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-zinc-500 mb-1">김치 프리미엄 ≥ <strong>{s.kimchiThresholdPct.toFixed(1)}%</strong></label>
            <input type="range" min={0} max={10} step={0.1} value={s.kimchiThresholdPct} onChange={e => update({ kimchiThresholdPct: Number(e.target.value) })} className="w-full accent-emerald-500" />
          </div>
          <div>
            <label className="block text-xs text-zinc-500 mb-1">라운드트립 수익 ≥ <strong>{s.roundTripThresholdPct.toFixed(1)}%</strong></label>
            <input type="range" min={0} max={10} step={0.1} value={s.roundTripThresholdPct} onChange={e => update({ roundTripThresholdPct: Number(e.target.value) })} className="w-full accent-emerald-500" />
          </div>
          <div>
            <label className="block text-xs text-zinc-500 mb-1">DEX 차익 ≥ <strong>{s.dexThresholdPct.toFixed(1)}%</strong></label>
            <input type="range" min={0} max={5} step={0.1} value={s.dexThresholdPct} onChange={e => update({ dexThresholdPct: Number(e.target.value) })} className="w-full accent-emerald-500" />
          </div>
          <div>
            <label className="block text-xs text-zinc-500 mb-1">CEX 차익 ≥ <strong>{s.cexThresholdPct.toFixed(1)}%</strong></label>
            <input type="range" min={0} max={5} step={0.1} value={s.cexThresholdPct} onChange={e => update({ cexThresholdPct: Number(e.target.value) })} className="w-full accent-emerald-500" />
          </div>
        </div>
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-zinc-500 mb-1">하이브리드 ≥ <strong>{s.hybridThresholdPct.toFixed(1)}%</strong></label>
            <input type="range" min={0} max={5} step={0.1} value={s.hybridThresholdPct} onChange={e => update({ hybridThresholdPct: Number(e.target.value) })} className="w-full accent-emerald-500" />
          </div>
          <div>
            <label className="block text-xs text-zinc-500 mb-1">코인별 쿨다운: <strong>{s.notifyCooldownMin}분</strong></label>
            <input type="range" min={1} max={60} step={1} value={s.notifyCooldownMin} onChange={e => update({ notifyCooldownMin: Number(e.target.value) })} className="w-full accent-emerald-500" />
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-zinc-800 p-6 mb-6">
        <h2 className="text-base font-semibold mb-1">텔레그램 (선택)</h2>
        <p className="text-xs text-zinc-500 mb-4">@BotFather에서 봇을 만들고, 봇과 대화 후 chat_id를 입력하세요.</p>
        <label className="flex items-center justify-between gap-4 py-2 cursor-pointer select-none mb-3">
          <p className="text-sm">텔레그램 알림 사용</p>
          <button onClick={() => update({ telegramEnabled: !s.telegramEnabled })} className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${s.telegramEnabled ? "bg-emerald-600" : "bg-zinc-700"}`}>
            <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${s.telegramEnabled ? "translate-x-[18px]" : "translate-x-1"}`} />
          </button>
        </label>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Bot Token</label>
            <input type="password" placeholder="123456:ABC-..." value={s.telegramBotToken} onChange={e => update({ telegramBotToken: e.target.value })} className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-emerald-500" />
          </div>
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Chat ID</label>
            <input type="text" placeholder="123456789" value={s.telegramChatId} onChange={e => update({ telegramChatId: e.target.value })} className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-emerald-500" />
          </div>
        </div>
      </section>

      <button onClick={onSave} className={"w-full py-3 rounded-xl font-medium transition-colors " + (saved ? "bg-emerald-500 text-white" : "bg-emerald-600 hover:bg-emerald-500")}>
        {saved ? "✓ Saved!" : "Save Settings"}
      </button>
    </div>
  );
}
