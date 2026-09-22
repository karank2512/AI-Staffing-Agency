import { Check, Cpu, Minus } from "lucide-react";
import { SimulatedBadge } from "@/components/simulated-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TONE_CLASSES } from "@/lib/status";
import { cn } from "@/lib/utils";
import type { SettingsProviders } from "@/server/queries/settings";

const TIER_LABEL: Record<SettingsProviders["tiers"][number]["tier"], { label: string; hint: string }> = {
  fast: { label: "Fast", hint: "Classification, scoping questions, quick extraction" },
  standard: { label: "Standard", hint: "Collecting, analysis, evaluation, reviews" },
  reasoning: { label: "Reasoning", hint: "Replacement plans and other hard calls" },
};

function Code({ children }: { children: string }) {
  return <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px] text-foreground">{children}</code>;
}

/** Model providers are env-only in Phase 1: this card shows what the server sees, and how to change it. */
export function ProvidersCard({ providers }: { providers: SettingsProviders }) {
  const live = providers.mode === "live";
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <Cpu className="size-4 text-muted-foreground" aria-hidden="true" />
          AI providers
          {live ? (
            <Badge variant="outline" className={cn("gap-1", TONE_CLASSES.success.badge)}>
              <span className={cn("size-1.5 rounded-full", TONE_CLASSES.success.dot)} aria-hidden="true" />
              Live
            </Badge>
          ) : (
            <SimulatedBadge />
          )}
        </CardTitle>
        <CardDescription>
          {live
            ? "At least one model provider has a key, so workers think with real models."
            : "No model provider has a key, so workers think with the built-in deterministic simulator. Everything still runs end to end."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <ul className="divide-y rounded-lg border">
          {providers.providers.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
              <div className="flex min-w-0 items-center gap-2.5">
                <span
                  className={cn(
                    "inline-flex size-5 shrink-0 items-center justify-center rounded-full",
                    p.available ? TONE_CLASSES.success.soft : "bg-muted text-muted-foreground",
                  )}
                  aria-hidden="true"
                >
                  {p.available ? <Check className="size-3" /> : <Minus className="size-3" />}
                </span>
                <span className="truncate font-medium">{p.label}</span>
                {p.envVar === null ? <span className="text-xs text-muted-foreground">always available</span> : null}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {p.envVar ? <Code>{p.envVar}</Code> : null}
                <span className={cn("w-20 text-right text-xs font-medium", p.available ? TONE_CLASSES.success.text : "text-muted-foreground")}>
                  {p.available ? "Available" : p.envVar ? "No key" : "Fallback"}
                </span>
              </div>
            </li>
          ))}
        </ul>

        <div>
          <p className="eyebrow mb-2">Tier routing</p>
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tier</TableHead>
                  <TableHead>Used for</TableHead>
                  <TableHead>Routes to</TableHead>
                  <TableHead className="text-right">Override</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {providers.tiers.map((t) => (
                  <TableRow key={t.tier}>
                    <TableCell className="font-medium">{TIER_LABEL[t.tier].label}</TableCell>
                    <TableCell className="text-muted-foreground">{TIER_LABEL[t.tier].hint}</TableCell>
                    <TableCell>
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="text-muted-foreground">{t.providerLabel}</span>
                        <span className="font-mono text-xs">{t.model}</span>
                        {t.simulated ? <SimulatedBadge /> : null}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      {/* Env var names are operator config: null for everyone but the owner (audit INF-19). */}
                      {t.overrideEnvVar ? <Code>{t.overrideEnvVar}</Code> : <span className="text-xs text-muted-foreground">—</span>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>

        <div className="space-y-2 rounded-lg border bg-muted/40 p-3 text-sm">
          <p className="font-medium">Set keys in <Code>.env</Code> and restart to go live.</p>
          <p className="text-pretty text-muted-foreground">
            Provider keys are read from the server&apos;s environment, never stored in the database. Add <Code>ANTHROPIC_API_KEY</Code>,{" "}
            <Code>OPENAI_API_KEY</Code> or <Code>GOOGLE_GENERATIVE_AI_API_KEY</Code>, restart the server, and this card flips to Live. The
            first available provider (Anthropic → OpenAI → Google) serves every tier unless an override like{" "}
            <Code>MODEL_TIER_STANDARD=anthropic:claude-sonnet-5</Code> says otherwise.
          </p>
          {providers.forceSimulated ? (
            <p className="text-pretty text-amber-900">
              <Code>FORCE_SIMULATED</Code> is set, so keys are ignored on purpose — useful for demos and tests. Unset it to use the keys above.
            </p>
          ) : (
            <p className="text-pretty text-muted-foreground">
              To rehearse without spending, set <Code>FORCE_SIMULATED=true</Code>: keys stay in place but every call runs on the simulator.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
