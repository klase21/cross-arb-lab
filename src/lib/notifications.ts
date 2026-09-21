import { loadSettings } from "@/components/SettingsView";

const lastSent = new Map<string, number>();

function shouldNotify(key: string, cooldownMin: number): boolean {
  const previous = lastSent.get(key);
  if (previous === undefined) return true;
  return Date.now() - previous >= cooldownMin * 60 * 1000;
}

function markSent(key: string) {
  lastSent.set(key, Date.now());
}

export function notifyBrowser(title: string, body: string, tag: string) {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  try {
    new Notification(title, { body, tag, icon: "/favicon.ico" });
  } catch {}
}

export async function notifyTelegram(text: string) {
  const settings = loadSettings();
  if (!settings.telegramEnabled || !settings.telegramBotToken || !settings.telegramChatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${settings.telegramBotToken}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: settings.telegramChatId, text, parse_mode: "HTML" }),
    });
  } catch {}
}

export function notifyKimchi(coin: string, premiumPct: number, roundTripPct?: number) {
  const settings = loadSettings();
  if (!settings.notifyEnabled) return;
  const cooldown = settings.notifyCooldownMin;
  const key = `kimchi:${coin}`;
  if (!shouldNotify(key, cooldown)) return;

  const premiumHit = premiumPct >= settings.kimchiThresholdPct;
  const tripHit = roundTripPct !== undefined && roundTripPct >= settings.roundTripThresholdPct;
  if (!premiumHit && !tripHit) return;

  markSent(key);
  const parts = [`${coin} 김치프리미엄 ${premiumPct >= 0 ? "+" : ""}${premiumPct.toFixed(2)}%`];
  if (tripHit) parts.push(`라운드트립 ${roundTripPct >= 0 ? "+" : ""}${roundTripPct.toFixed(2)}%`);
  const body = parts.join(" · ");
  notifyBrowser(`Kimchi Alert — ${coin}`, body, key);
  notifyTelegram(`<b>Kimchi Alert — ${coin}</b>\n${body}`);
}

export function notifyFutFunding(base: string, spreadApr: number, longVenue: string, shortVenue: string) {
  const settings = loadSettings();
  if (!settings.notifyEnabled) return;
  if (Math.abs(spreadApr) < settings.futFundingAprPct) return;
  const key = `futfund:${base}`;
  if (!shouldNotify(key, settings.notifyCooldownMin)) return;
  markSent(key);
  const body = `$${base} 펀딩 스프레드 ${spreadApr >= 0 ? "+" : ""}${spreadApr.toFixed(1)}%/yr · L ${longVenue} / S ${shortVenue}`;
  notifyBrowser(`Funding Arb — ${base}`, body, key);
  void notifyTelegram(`<b>Funding Arb — ${base}</b>\n${body}`);
}

export function notifyFutSqueeze(base: string, side: string, score: number) {
  const settings = loadSettings();
  if (!settings.notifyEnabled) return;
  if (score < settings.futSqueezeScore) return;
  const key = `futsqz:${base}`;
  if (!shouldNotify(key, settings.notifyCooldownMin)) return;
  markSent(key);
  const body = `$${base} ${side} 과밀 · 스퀴즈 위험 ${score}`;
  notifyBrowser(`Squeeze Risk — ${base}`, body, key);
  void notifyTelegram(`<b>Squeeze Risk — ${base}</b>\n${body}`);
}

export function notifyCex(coin: string, buyCex: string, sellCex: string, netPct: number, type: "cex" | "dex" | "hybrid") {
  const settings = loadSettings();
  if (!settings.notifyEnabled) return;
  const threshold = type === "cex" ? settings.cexThresholdPct : type === "dex" ? settings.dexThresholdPct : settings.hybridThresholdPct;
  if (netPct < threshold) return;
  const key = `${type}:${coin}:${buyCex}:${sellCex}`;
  const cooldown = settings.notifyCooldownMin;
  if (!shouldNotify(key, cooldown)) return;
  markSent(key);
  const label = type === "cex" ? "CEX-to-CEX" : type === "dex" ? "DEX Arbitrage" : "Hybrid";
  const title = `${label} — ${coin}`;
  const body = `${buyCex} → ${sellCex}  Net +${netPct.toFixed(3)}%`;
  notifyBrowser(title, body, key);
  notifyTelegram(`<b>${title}</b>\n${body}`);
}
