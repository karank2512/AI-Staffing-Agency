import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ChevronRight, Inbox } from "lucide-react";
import { CopyButton } from "@/components/copy-button";
import { DataTable } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { JsonView } from "@/components/json-view";
import { LiveDot } from "@/components/live-dot";
import { PageHeader } from "@/components/page-header";
import { ScoreMetric, ScoreRing } from "@/components/score-ring";
import { Section } from "@/components/section";
import { SimulatedBadge } from "@/components/simulated-badge";
import { Sparkline } from "@/components/sparkline";
import { Stat, StatStrip } from "@/components/stat-card";
import { StatusBadge } from "@/components/status-badge";
import { WorkerAvatar } from "@/components/worker-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { config } from "@/server/config";
import { DialogDemo } from "./_components/dialog-demo";

export const metadata: Metadata = { title: "Style guide", robots: { index: false, follow: false } };

const TYPE_SCALE = [
  ["text-display-xl", "Describe the job."],
  ["text-display", "Three steps from idea to output."],
  ["text-headline", "See exactly who you're hiring."],
  ["text-title-1", "Workforce"],
  ["text-title-2", "Recent activity"],
  ["text-title-3", "Alex"],
  ["text-body-lg", "Tell us what needs doing in plain English."],
  ["text-body", "Every deliverable is reviewed, scored and yours to keep."],
  ["text-body-app", "App base text — 15px, the single biggest premium cue."],
  ["text-callout", "Dense rows, table cells and form help."],
  ["text-footnote", "Metadata, timestamps and nav links."],
  ["text-caption", "Chart axes, legal and tiny labels."],
] as const;

const SWATCHES = [
  ["--primary", "bg-primary"],
  ["--foreground", "bg-foreground"],
  ["--muted-foreground", "bg-muted-foreground"],
  ["--text-tertiary", "bg-tertiary"],
  ["--surface-secondary", "bg-canvas"],
  ["--secondary", "bg-secondary"],
  ["--border", "bg-border"],
  ["--success", "bg-success"],
  ["--warning", "bg-warning"],
  ["--danger", "bg-danger"],
  ["--info", "bg-info"],
] as const;

const SAMPLE_ROWS = [
  { rank: 1, company: "Ridgeline GPU", hq: "Denver, CO", amount_usd: 210_000_000, source_url: "https://news.example/a" },
  { rank: 2, company: "Latchkey AI", hq: "San Francisco, CA", amount_usd: 72_000_000, source_url: "https://news.example/b" },
];

/**
 * A living reference for the design system: every token and primitive on one page, so a change to `globals.css`
 * or a primitive is visible before it reaches a product page. Development only — 404 in production.
 */
export default function StyleguidePage() {
  if (config.isProduction) notFound();

  return (
    <div className="min-h-dvh bg-canvas">
      <main className="text-body-app mx-auto w-full max-w-(--container-app) px-4 pt-10 pb-24 sm:px-6">
        <PageHeader
          title="Style guide"
          description="Quiet confidence — the tokens, type scale and primitives every page inherits. Development only."
          actions={
            <>
              <Button variant="secondary">Secondary</Button>
              <Button>Primary action</Button>
            </>
          }
        />

        <div className="space-y-14">
          <Section title="Type scale" description="Hierarchy comes from size and weight — never from boxes or colour.">
            <Card>
              <CardContent className="space-y-6">
                {TYPE_SCALE.map(([utility, sample]) => (
                  <div key={utility} className="flex flex-col gap-1 border-b border-border pb-6 last:border-0 last:pb-0">
                    <code className="font-mono text-caption text-tertiary">{utility}</code>
                    <p className={utility}>{sample}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          </Section>

          <Section title="Colour" description="One accent. Status colour only ever appears as a dot or short text.">
            <Card>
              <CardContent className="grid grid-cols-2 gap-5 sm:grid-cols-4 lg:grid-cols-6">
                {SWATCHES.map(([token, className]) => (
                  <div key={token} className="space-y-2">
                    <div className={`h-14 rounded-lg ${className} shadow-[inset_0_0_0_0.5px_var(--hairline)]`} />
                    <code className="block font-mono text-caption text-muted-foreground">{token}</code>
                  </div>
                ))}
              </CardContent>
            </Card>
          </Section>

          <Section title="Buttons" description="Pills. One primary per view; gray for secondary; blue text for tertiary.">
            <Card>
              <CardContent className="space-y-7">
                <div className="flex flex-wrap items-center gap-3">
                  <Button>Primary</Button>
                  <Button variant="secondary">Secondary</Button>
                  <Button variant="outline">Outline</Button>
                  <Button variant="ghost">Ghost</Button>
                  <Button variant="destructive">Retire worker</Button>
                  <Button variant="link">
                    View all <ChevronRight data-icon="inline-end" />
                  </Button>
                  <Button disabled>Disabled</Button>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <Button size="xs">Extra small</Button>
                  <Button size="sm">Small</Button>
                  <Button size="default">Default</Button>
                  <Button size="lg">Large</Button>
                  <Button size="xl">Extra large</Button>
                </div>
              </CardContent>
            </Card>
          </Section>

          <Section title="Forms" description="44px controls, 12px radius, 16px text on phones so iOS never zooms.">
            <Card>
              <CardContent className="grid gap-6 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="sg-name">Worker name</Label>
                  <Input id="sg-name" placeholder="Alex" />
                  <p className="text-footnote text-muted-foreground">How your team will refer to them.</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="sg-invalid">Work email</Label>
                  <Input id="sg-invalid" aria-invalid defaultValue="not-an-email" />
                  <p className="text-footnote text-danger">Enter a valid email address.</p>
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="sg-brief">The brief</Label>
                  <Textarea
                    id="sg-brief"
                    placeholder="Every Monday, summarize what our three main competitors shipped last week and email it to the product team."
                  />
                </div>
                <div className="flex items-center gap-6">
                  <label className="flex items-center gap-2.5 text-[15px]">
                    <Checkbox defaultChecked /> Keep me signed in
                  </label>
                  <label className="flex items-center gap-2.5 text-[15px]">
                    <Switch defaultChecked /> Can search the web
                  </label>
                </div>
                <div className="flex items-center gap-4">
                  <Tabs defaultValue="all">
                    <TabsList>
                      <TabsTrigger value="all">All</TabsTrigger>
                      <TabsTrigger value="active">Active</TabsTrigger>
                      <TabsTrigger value="closed">Closed</TabsTrigger>
                    </TabsList>
                  </Tabs>
                </div>
              </CardContent>
            </Card>
          </Section>

          <Section title="Status and identity" description="One status per object: a 7px dot and a word.">
            <Card>
              <CardContent className="space-y-7">
                <div className="flex flex-wrap items-center gap-6">
                  <StatusBadge kind="run" status="RUNNING" />
                  <StatusBadge kind="run" status="SUCCEEDED" />
                  <StatusBadge kind="run" status="WAITING_FOR_APPROVAL" />
                  <StatusBadge kind="run" status="FAILED" />
                  <StatusBadge kind="worker" status="PAUSED" emphasis="dot" />
                  <StatusBadge kind="job" status="DRAFT" />
                  <LiveDot />
                  <SimulatedBadge />
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <Badge variant="warning">Needs review</Badge>
                  <Badge variant="success">Accepted</Badge>
                  <Badge variant="danger">Failed</Badge>
                  <Badge variant="neutral">Draft</Badge>
                  <Badge variant="secondary">Version 3</Badge>
                </div>
                <div className="flex flex-wrap items-end gap-6">
                  <WorkerAvatar name="Maya Chen" color="sky" size="xs" />
                  <WorkerAvatar name="Theo Park" color="emerald" size="sm" />
                  <WorkerAvatar name="Priya Rao" color="amber" size="md" />
                  <WorkerAvatar name="Alex Rivera" color="violet" size="lg" />
                  <WorkerAvatar name="Dana Ruiz" color="teal" size="xl" />
                  <ScoreRing score={88} />
                  <ScoreRing score={71} />
                  <ScoreRing score={54} />
                  <ScoreRing score={null} />
                  <ScoreMetric score={88} />
                  <Sparkline values={[3, 5, 4, 8, 7, 11, 9]} />
                </div>
              </CardContent>
            </Card>
          </Section>

          <Section title="Stat strip" description="Four KPIs in one card, divided by hairlines. No corner icons.">
            <StatStrip>
              <Stat label="Active workers" value="6" hint="Everyone is on the job" />
              <Stat label="Runs today" value="14" trend={{ direction: "up", label: "4 more than yesterday" }} />
              <Stat label="Waiting for review" value="2" hint="Oldest 3 hours ago" />
              <Stat
                label="Spend this month"
                value="$38.20"
                trend={{ direction: "up", label: "12% vs last month", tone: "negative", values: [4, 6, 5, 9, 8, 12, 11] }}
              />
            </StatStrip>
          </Section>

          <Section
            title="Tables"
            description="Hairline rows inside a card with no padding of its own."
            actions={
              <Button variant="link">
                View all <ChevronRight data-icon="inline-end" />
              </Button>
            }
          >
            <Card className="py-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Worker</TableHead>
                    <TableHead>Job</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Score</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell className="font-medium">Maya</TableCell>
                    <TableCell className="text-muted-foreground">Weekly competitor digest</TableCell>
                    <TableCell>
                      <StatusBadge kind="run" status="SUCCEEDED" />
                    </TableCell>
                    <TableCell className="metric text-right">88</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell className="font-medium">Theo</TableCell>
                    <TableCell className="text-muted-foreground">Support inbox triage</TableCell>
                    <TableCell>
                      <StatusBadge kind="run" status="WAITING_FOR_APPROVAL" />
                    </TableCell>
                    <TableCell className="metric text-right">81</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </Card>
          </Section>

          <Section title="Worker-produced records" description="DataTable formats whatever a worker returns.">
            <DataTable rows={SAMPLE_ROWS} />
          </Section>

          <Section title="Cards, empty states and dialogs">
            <div className="grid gap-6 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle>Schedule</CardTitle>
                  <CardDescription>Every Monday at 9:00, next in 3 days.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="rounded-lg bg-muted p-4 text-footnote text-muted-foreground">
                    Inset panel: a flat #f5f5f7 fill, never a nested bordered box.
                  </div>
                  <Progress value={62} />
                  <Progress />
                  <div className="flex items-center gap-3">
                    <CopyButton value="run_8f21c0" />
                    <span className="font-mono text-footnote text-muted-foreground">run_8f21c0</span>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent>
                  <EmptyState
                    icon={Inbox}
                    title="No deliverables yet"
                    description="Maya's first run is still in progress. You'll find the report here when it lands."
                    action={<Button size="lg">View the run</Button>}
                  />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Loading</CardTitle>
                  <CardDescription>Skeletons mirror the layout. No shimmer, no spinner.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Skeleton className="h-8 w-48" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-3/5" />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Confirmation and debug</CardTitle>
                  <CardDescription>The solid red pill exists only on a final confirm.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <DialogDemo />
                  <JsonView label="Checkpoint" value={{ step: 4, of: 7, tool: "web_search", cost_usd: 0.0031 }} />
                </CardContent>
              </Card>
            </div>
          </Section>
        </div>
      </main>
    </div>
  );
}
