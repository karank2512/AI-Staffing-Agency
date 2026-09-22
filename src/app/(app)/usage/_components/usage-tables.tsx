import type { ReactNode } from "react";
import Link from "next/link";
import { Bot, Building2, Wrench } from "lucide-react";
import { SimulatedBadge } from "@/components/simulated-badge";
import { WorkerAvatar } from "@/components/worker-avatar";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatNumber, formatPercent, formatTokens, formatUsd, formatUsdPrecise, pluralize } from "@/lib/format";
import type { UsageModelRow, UsageToolRow, UsageWorkerRow } from "@/server/queries/usage";

/** Tables for the /usage breakdowns. Server-safe: every row is plain JSON from `getUsagePage`. */

function EmptyRows({ children }: { children: ReactNode }) {
  return <p className="px-4 py-6 text-sm text-muted-foreground">{children}</p>;
}

function Share({ part, total }: { part: number; total: number }) {
  return <span className="metric text-muted-foreground">{total > 0 ? formatPercent(part / total) : "—"}</span>;
}

export function WorkerCostTable({ rows, totalCostUsd }: { rows: UsageWorkerRow[]; totalCostUsd: number }) {
  return (
    <Card className="py-0">
      {rows.length === 0 ? (
        <EmptyRows>No worker used a model or tool in this window.</EmptyRows>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Worker</TableHead>
              <TableHead className="text-right">Runs</TableHead>
              <TableHead className="text-right">Per run</TableHead>
              <TableHead className="text-right">Cost</TableHead>
              <TableHead className="text-right">Billable</TableHead>
              <TableHead className="text-right">Share</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((w) => (
              <TableRow key={w.workerId ?? "platform"}>
                <TableCell>
                  <span className="flex items-center gap-2.5">
                    {w.workerId === null ? (
                      <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground ring-1 ring-foreground/10 ring-inset">
                        <Building2 className="size-3.5" aria-hidden="true" />
                      </span>
                    ) : (
                      <WorkerAvatar name={w.workerName} color={w.avatarColor ?? "violet"} size="sm" />
                    )}
                    {w.href ? (
                      <Link href={`${w.href}?tab=cost`} className="font-medium hover:underline">
                        {w.workerName}
                      </Link>
                    ) : (
                      <span className={w.workerId === null ? "text-muted-foreground" : "font-medium"}>{w.workerName}</span>
                    )}
                  </span>
                </TableCell>
                <TableCell className="metric text-right">{w.runs > 0 ? formatNumber(w.runs, 0) : "—"}</TableCell>
                <TableCell className="metric text-right">{formatUsdPrecise(w.costPerRunUsd)}</TableCell>
                <TableCell className="metric text-right font-medium">{formatUsd(w.costUsd)}</TableCell>
                <TableCell className="metric text-right">{formatUsd(w.billableUsd)}</TableCell>
                <TableCell className="text-right">
                  <Share part={w.costUsd} total={totalCostUsd} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}

export function ModelCostTable({ rows, totalCostUsd }: { rows: UsageModelRow[]; totalCostUsd: number }) {
  return (
    <Card className="py-0">
      {rows.length === 0 ? (
        <EmptyRows>No model calls in this window.</EmptyRows>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Model</TableHead>
              <TableHead className="text-right">Calls</TableHead>
              <TableHead className="text-right">Tokens in</TableHead>
              <TableHead className="text-right">Tokens out</TableHead>
              <TableHead className="text-right">Cost</TableHead>
              <TableHead className="text-right">Share</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((m) => (
              <TableRow key={`${m.provider}:${m.model}`}>
                <TableCell>
                  <span className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="gap-1 text-chart-1">
                      <Bot />
                      {m.providerLabel}
                    </Badge>
                    <span className="font-mono text-xs font-medium">{m.model}</span>
                    {m.simulated ? <SimulatedBadge /> : null}
                  </span>
                </TableCell>
                <TableCell className="metric text-right">{formatNumber(m.calls, 0)}</TableCell>
                <TableCell className="metric text-right">{formatTokens(m.inputTokens)}</TableCell>
                <TableCell className="metric text-right">{formatTokens(m.outputTokens)}</TableCell>
                <TableCell className="metric text-right font-medium">{formatUsdPrecise(m.costUsd)}</TableCell>
                <TableCell className="text-right">
                  <Share part={m.costUsd} total={totalCostUsd} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}

export function ToolCostTable({ rows, totalCostUsd }: { rows: UsageToolRow[]; totalCostUsd: number }) {
  return (
    <Card className="py-0">
      {rows.length === 0 ? (
        <EmptyRows>No tool calls in this window.</EmptyRows>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tool</TableHead>
              <TableHead className="text-right">Calls</TableHead>
              <TableHead className="text-right">Per call</TableHead>
              <TableHead className="text-right">Cost</TableHead>
              <TableHead className="text-right">Share</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((t) => (
              <TableRow key={t.toolName}>
                <TableCell>
                  <span className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="gap-1 text-chart-2">
                      <Wrench />
                      Tool
                    </Badge>
                    <span className="font-medium">{t.displayName}</span>
                    <span className="font-mono text-[11px] text-muted-foreground">{t.toolName}</span>
                  </span>
                </TableCell>
                <TableCell className="metric text-right">{pluralize(t.calls, "call")}</TableCell>
                <TableCell className="metric text-right">{t.costPerCallUsd === 0 ? "Free" : formatUsdPrecise(t.costPerCallUsd)}</TableCell>
                <TableCell className="metric text-right font-medium">{t.costUsd === 0 ? "—" : formatUsdPrecise(t.costUsd)}</TableCell>
                <TableCell className="text-right">
                  <Share part={t.costUsd} total={totalCostUsd} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}
