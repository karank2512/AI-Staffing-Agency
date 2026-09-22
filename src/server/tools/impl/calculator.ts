import { AppError } from "@/server/errors";
import { defineTool, quote } from "../define";
import { CalculatorError, evaluateExpression } from "./calculator-parser";

export const calculatorTool = defineTool("calculator", {
  displayName: "Calculator",
  description:
    "Evaluate an arithmetic expression exactly. Supports + - * / % ^, parentheses, decimals, scientific notation (1.5e6), the constants pi and e, and the functions min, max, abs, round(x, digits), floor, ceil, sqrt, log (base 10) and ln. Use it for every calculation instead of doing math in your head.",
  humanDescription: "Does arithmetic precisely (percentages, totals, averages) so numbers in deliverables are never guessed.",
  category: "compute",
  sideEffect: "none",
  defaultRequiresApproval: false,
  costPerCallUsd: 0,
  humanize: (input) => `Calculated ${quote(input.expression, 60)}`,
  describeForApproval: (input) => ({ title: `Calculate ${quote(input.expression, 60)}` }),
  async execute(input) {
    try {
      return { output: { result: evaluateExpression(input.expression) }, simulated: false };
    } catch (e) {
      if (e instanceof CalculatorError) throw new AppError("TOOL_ERROR", `Could not evaluate the expression: ${e.message}`);
      throw e;
    }
  },
});
