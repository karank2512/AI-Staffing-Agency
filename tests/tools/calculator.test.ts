import { describe, expect, it } from "vitest";
import { CalculatorError, evaluateExpression } from "@/server/tools/impl/calculator-parser";
import { calculatorTool } from "@/server/tools/impl/calculator";
import { makeCtx } from "./helpers";

describe("calculator parser: valid expressions", () => {
  const cases: Array<[string, number]> = [
    ["1 + 2", 3],
    ["2 * 3 + 4", 10],
    ["2 + 3 * 4", 14],
    ["(2 + 3) * 4", 20],
    ["10 / 4", 2.5],
    ["10 % 3", 1],
    ["2 ^ 10", 1024],
    ["2 ^ 3 ^ 2", 512], // right-associative
    ["-2 ^ 2", -4], // unary minus binds looser than ^
    ["(-2) ^ 2", 4],
    ["2 ^ -1", 0.5],
    ["--3", 3],
    ["-(3 + 4)", -7],
    ["+5", 5],
    ["1.5e3 + 1", 1501],
    ["2.5E-1", 0.25],
    [".5 + .5", 1],
    ["0.1 + 0.2", 0.3],
    ["pi", Math.PI],
    ["PI * 2", Math.PI * 2],
    ["e", Math.E],
    ["min(3, 1, 2)", 1],
    ["max(3, 1, 2)", 3],
    ["abs(-7.5)", 7.5],
    ["round(2.5)", 3],
    ["round(3.14159, 2)", 3.14],
    ["floor(2.9)", 2],
    ["ceil(2.1)", 3],
    ["sqrt(16)", 4],
    ["log(1000)", 3],
    ["ln(e)", 1],
    ["SQRT(9) + Max(1, 2)", 5],
    ["(1200 * 0.18) / 12", 18],
    ["round(1234567 * 1.08, 2)", 1333332.36],
    ["  7  ", 7],
    ["((((1))))", 1],
  ];
  it.each(cases)("%s = %d", (expression, expected) => {
    expect(evaluateExpression(expression)).toBeCloseTo(expected, 10);
  });
});

describe("calculator parser: rejected expressions", () => {
  const cases: Array<[string, RegExp]> = [
    ["process.exit()", /Unknown identifier "process"|Unexpected character "\."/],
    ["constructor", /Unknown identifier "constructor"/],
    ["__proto__", /Unknown identifier "__proto__"/],
    ["1;2", /Unexpected character ";"/],
    ["1 + ", /Unexpected end of expression/],
    ["+", /Unexpected end of expression/],
    ["()", /Unexpected "\)"/],
    ["2 (3)", /Unexpected "\("/],
    ["1 2", /Unexpected number 2/],
    ["(1 + 2", /Expected "\)"/],
    ["1 + 2)", /Unexpected "\)"/],
    ["x + 1", /Unknown identifier "x"/],
    ["foo(1)", /Unknown function "foo"/],
    ["sqrt", /"sqrt" is a function/],
    ["sqrt(1, 2)", /sqrt\(\) expects 1 argument, got 2/],
    ["min()", /min\(\) expects 1 to 50 arguments, got 0/],
    ["round(1, 2, 3)", /round\(\) expects 1 to 2 arguments, got 3/],
    ["1 / 0", /Division by zero/],
    ["1 % 0", /Modulo by zero/],
    ["sqrt(-1)", /not a finite number/],
    ["log(0)", /not a finite number/],
    ["10 ^ 400", /not a finite number/],
    ["1e999", /out of range/],
    ["Math.max(1, 2)", /Unknown identifier "math"|Unexpected character "\."/],
    ["require('fs')", /Unknown identifier "require"|Unexpected character/],
    ["1 && 2", /Unexpected character "&"/],
    ["`1`", /Unexpected character "`"/],
    ["1 = 1", /Unexpected character "="/],
    ["[1]", /Unexpected character "\["/],
    ["", /empty/],
    ["   ", /empty/],
  ];
  it.each(cases)("rejects %s", (expression, message) => {
    expect(() => evaluateExpression(expression)).toThrow(CalculatorError);
    expect(() => evaluateExpression(expression)).toThrow(message);
  });

  it("guards nesting depth and length", () => {
    expect(() => evaluateExpression(`${"(".repeat(60)}1${")".repeat(60)}`)).toThrow(/nested too deeply/);
    expect(() => evaluateExpression(`${"-".repeat(60)}1`)).toThrow(/nested too deeply/);
    expect(() => evaluateExpression(`1${" + 1".repeat(200)}`)).toThrow(/longer than 500 characters/);
  });

  it("never evaluates code — identifiers only resolve through the closed tables", () => {
    for (const expression of ["toString", "valueOf", "hasOwnProperty", "prototype", "globalThis", "this"]) {
      expect(() => evaluateExpression(expression)).toThrow(/Unknown identifier/);
    }
  });
});

describe("calculator tool", () => {
  it("returns the numeric result in simulated and live contexts alike", async () => {
    const result = await calculatorTool.execute({ expression: "round((1200 * 0.18) / 12, 2)" }, makeCtx());
    expect(result).toEqual({ output: { result: 18 }, simulated: false });
  });

  it("wraps parser errors as a TOOL_ERROR with the parser's message", async () => {
    await expect(calculatorTool.execute({ expression: "1;2" }, makeCtx())).rejects.toMatchObject({
      code: "TOOL_ERROR",
      message: expect.stringContaining('Unexpected character ";"'),
    });
  });

  it("humanizes with the expression", () => {
    expect(calculatorTool.humanize({ expression: "1 + 1" })).toBe("Calculated “1 + 1”");
  });
});
