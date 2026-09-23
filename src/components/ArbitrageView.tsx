"use client";

import type { ReactNode } from "react";
import KimchiView from "@/components/KimchiView";
import DexArbitrageView from "@/components/DexArbitrageView";
import CexCexView from "@/components/CexCexView";
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

export default function ArbitrageView() {
  return (
    <div>
      <Section titleKey="tab.kimchi.title" descKey="tab.kimchi.desc">
        <KimchiView />
      </Section>
      <Section titleKey="tab.arbitrage.title" descKey="tab.arbitrage.desc">
        <DexArbitrageView />
      </Section>
      <Section titleKey="tab.cex.title" descKey="tab.cex.desc">
        <CexCexView />
      </Section>
    </div>
  );
}
