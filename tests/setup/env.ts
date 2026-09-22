// Runs before every test file. Guarantees hermetic, deterministic Simulated mode.
process.env.FORCE_SIMULATED = "true";
process.env.EXECUTOR_DISABLED = "true";
for (const key of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY", "TAVILY_API_KEY"]) {
  delete process.env[key];
}
