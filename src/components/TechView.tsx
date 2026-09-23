"use client";

import type { ReactNode } from "react";
import TaView from "@/components/TaView";
import FuturesView from "@/components/FuturesView";
import { useLang } from "@/lib/i18n";

function Section({ titleKey, descKey, children }: { titleKey: string; descKey: string; children: ReactNode }) {
  const { t } = useLang();
  return (
    <section className="mb-10">
      <h2 className="text-base font-bold tracking-tight">{t(titleKey)}</h2>
      <p className="text-xs text-zinc-500 mt-0.5 mb-4">{t(descKey)}</p>
      {children}
    </section>
  );
}

export default function TechView() {
  return (
    <div>
      <Section titleKey="tab.ta.title" descKey="tab.ta.desc">
        <TaView />
      </Section>
      <Section titleKey="tab.futures.title" descKey="tab.futures.desc">
        <FuturesView />
      </Section>
    </div>
  );
}
