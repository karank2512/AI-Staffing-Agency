// Runs before every test file. Guarantees hermetic, deterministic Simulated mode.
process.env.FORCE_SIMULATED = "true";
process.env.EXECUTOR_DISABLED = "true";
process.env.EXECUTOR_MODE = "off";
// The shared limiter would otherwise lock the anonymous "unknown" IP after a few dozen sign-in tests.
// Rate-limit tests opt back in by deleting this inside the test.
process.env.RATE_LIMIT_DISABLED = "true";
for (const key of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY", "TAVILY_API_KEY"]) {
  delete process.env[key];
}
