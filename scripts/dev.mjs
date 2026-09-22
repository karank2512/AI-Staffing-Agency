#!/usr/bin/env node
/**
 * Local development runner: starts the Next.js web server AND the run worker, the same two processes that run
 * in production. Runs are executed by the worker, never inside the web server — that keeps the web bundle free
 * of Node-only modules (the Edge runtime compiles instrumentation.ts too) and makes local behaviour match a
 * real deployment.
 *
 *   npm run dev                  → web + worker
 *   EXECUTOR_MODE=off npm run dev → web only (no runs are executed)
 *   npm run dev:web / npm run worker → either half on its own
 */
import { spawn } from "node:child_process";

const withWorker = process.env.EXECUTOR_MODE !== "off" && process.env.EXECUTOR_DISABLED !== "true";
const children = [];
let shuttingDown = false;

function start(name, command, args, color) {
  const child = spawn(command, args, { stdio: ["inherit", "pipe", "pipe"], env: process.env });
  const tag = `\x1b[${color}m[${name}]\x1b[0m `;
  const pipe = (stream, out) => {
    let buffer = "";
    stream.on("data", (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) out.write(line.length > 0 ? `${tag}${line}\n` : "\n");
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    process.stdout.write(`${tag}exited (${signal ?? code}) — stopping everything\n`);
    shutdown(typeof code === "number" ? code : 1);
  });
  children.push(child);
  return child;
}

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) child.kill("SIGTERM");
  // Give the worker its graceful-shutdown window before forcing the issue.
  setTimeout(() => {
    for (const child of children) child.kill("SIGKILL");
    process.exit(code);
  }, 5000).unref();
  let remaining = children.length;
  for (const child of children) child.on("exit", () => --remaining === 0 && process.exit(code));
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

start("web", "npx", ["next", "dev", ...process.argv.slice(2)], "36");
if (withWorker) start("worker", "npx", ["tsx", "src/worker.ts"], "35");
else process.stdout.write("\x1b[90m[dev] worker disabled (EXECUTOR_MODE=off) — queued runs will not execute\x1b[0m\n");
