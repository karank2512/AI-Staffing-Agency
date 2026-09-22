import type { SettingsProviders, SettingsTierRoute } from "@/server/queries/settings";
import { Mono, SettingsGroup, SettingsRow, SettingsValue, StatusLine } from "./settings-list";

const TIER: Record<SettingsTierRoute["tier"], { label: string; hint: string }> = {
  fast: { label: "Fast", hint: "Scoping questions, classification and quick extraction." },
  standard: { label: "Standard", hint: "Collecting, analysis, evaluation and performance reviews." },
  reasoning: { label: "Reasoning", hint: "Replacement plans and the other hard calls." },
};

export interface ProvidersSectionProps {
  providers: SettingsProviders;
  /** OWNER: env var names and the rest of the operator detail. Null for everyone else (audit INF-19). */
  operator: boolean;
}

/**
 * Which models the workforce thinks with. Read-only everywhere: provider keys live in the server's
 * environment, never in the database, so this page reports rather than configures.
 */
export function ProvidersSection({ providers, operator }: ProvidersSectionProps) {
  const live = providers.mode === "live";

  return (
    <div className="space-y-10">
      <SettingsGroup title="Mode">
        <SettingsRow
          label={live ? "Workers think with real models" : "Workers think with the built-in simulator"}
          hint={
            live
              ? "At least one provider has a key, so every run costs real money."
              : "No provider has a key, so answers come from the deterministic simulator. Everything else — runs, deliverables, reviews, costs — works end to end."
          }
        >
          <StatusLine tone={live ? "success" : "idle"}>{live ? "Live" : "Simulated"}</StatusLine>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup
        title="Providers"
        footer={
          operator
            ? "Keys are read from the server's environment at boot. Add one and restart to go live; the first available provider serves every tier unless a tier override says otherwise."
            : "Model keys are configured on the server by your platform operator."
        }
      >
        {providers.providers.map((provider) => (
          <SettingsRow key={provider.id} label={provider.label} hint={provider.envVar ? <Mono>{provider.envVar}</Mono> : undefined}>
            <StatusLine tone={provider.available ? "success" : "idle"}>
              {provider.available ? (provider.envVar === null ? "Built in" : "Key set") : "No key"}
            </StatusLine>
          </SettingsRow>
        ))}
      </SettingsGroup>

      <SettingsGroup
        title="Tier routing"
        description="Every model call names a tier; this is where each one lands today."
        footer={
          operator ? (
            <>
              Override a single tier with <Mono>MODEL_TIER_STANDARD=anthropic:claude-sonnet-5</Mono>, or rehearse
              without spending by setting <Mono>FORCE_SIMULATED=true</Mono> while the keys stay in place.
            </>
          ) : undefined
        }
      >
        {providers.tiers.map((tier) => (
          <SettingsRow key={tier.tier} label={TIER[tier.tier].label} hint={TIER[tier.tier].hint}>
            <span className="flex flex-wrap items-center gap-2">
              <SettingsValue>{tier.providerLabel}</SettingsValue>
              <Mono>{tier.model}</Mono>
            </span>
          </SettingsRow>
        ))}
      </SettingsGroup>

      {providers.forceSimulated && operator ? (
        <p className="text-footnote max-w-[62ch] text-pretty text-muted-foreground px-1">
          <Mono>FORCE_SIMULATED</Mono> is set, so any keys above are ignored on purpose — useful for demos and
          tests. Unset it to use them.
        </p>
      ) : null}
    </div>
  );
}
