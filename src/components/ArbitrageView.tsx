"use client";

import type { ReactNode } from "react";
import KimchiView from "@/components/KimchiView";
import DexArbitrageView from "@/components/DexArbitrageView";
import CexCexView from "@/components/CexCexView";
import { useLang } from "@/lib/i18n";

function Section({ titleKey, children }: { titleKey: string; children: ReactNode }) {
  const { t } = useLang();
  return (
    <section className="mb-10">
      <h2 className="text-base font-bold tracking-tight mb-4">{t(titleKey)}</h2>
      {children}
    </section>
  );
}

export default function ArbitrageView() {
  return (
    <div>
      <Section titleKey="tab.kimchi.title">
        <KimchiView />
      </Section>
      <Section titleKey="tab.arbitrage.title">
        <DexArbitrageView />
      </Section>
      <Section titleKey="tab.cex.title">
        <CexCexView />
      </Section>
    </div>
  );
}
