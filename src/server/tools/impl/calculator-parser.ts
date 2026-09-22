/**
 * Safe arithmetic for the `calculator` tool: a hand-written tokenizer + recursive-descent parser that evaluates
 * as it parses. There is no `eval`, no `Function`, and identifiers are looked up in closed Maps — so
 * "process.exit()", "constructor" or "1;2" are syntax errors, never code.
 *
 * Grammar (highest precedence last):
 *   expr    := term (('+' | '-') term)*
 *   term    := unary (('*' | '/' | '%') unary)*
 *   unary   := ('-' | '+') unary | power
 *   power   := primary ('^' unary)?            right-associative; -2^2 = -(2^2)
 *   primary := number | constant | name '(' expr (',' expr)* ')' | '(' expr ')'
 */

export class CalculatorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CalculatorError";
  }
}

export const MAX_EXPRESSION_LENGTH = 500;
const MAX_DEPTH = 40;
const MAX_TOKENS = 400;

type Token =
  | { kind: "number"; value: number; pos: number }
  | { kind: "name"; value: string; pos: number }
  | { kind: "op"; value: "+" | "-" | "*" | "/" | "%" | "^" | "(" | ")" | ","; pos: number }
  | { kind: "end"; pos: number };

const CONSTANTS = new Map<string, number>([
  ["pi", Math.PI],
  ["e", Math.E],
]);

type Fn = { minArgs: number; maxArgs: number; apply: (args: number[]) => number };

const FUNCTIONS = new Map<string, Fn>([
  ["min", { minArgs: 1, maxArgs: 50, apply: (a) => Math.min(...a) }],
  ["max", { minArgs: 1, maxArgs: 50, apply: (a) => Math.max(...a) }],
  ["abs", { minArgs: 1, maxArgs: 1, apply: ([x]) => Math.abs(x) }],
  ["round", { minArgs: 1, maxArgs: 2, apply: ([x, digits = 0]) => roundTo(x, digits) }],
  ["floor", { minArgs: 1, maxArgs: 1, apply: ([x]) => Math.floor(x) }],
  ["ceil", { minArgs: 1, maxArgs: 1, apply: ([x]) => Math.ceil(x) }],
  ["sqrt", { minArgs: 1, maxArgs: 1, apply: ([x]) => Math.sqrt(x) }],
  ["log", { minArgs: 1, maxArgs: 1, apply: ([x]) => Math.log10(x) }],
  ["ln", { minArgs: 1, maxArgs: 1, apply: ([x]) => Math.log(x) }],
]);

function roundTo(x: number, digits: number): number {
  const d = Math.trunc(digits);
  if (d < 0 || d > 15) throw new CalculatorError("round() accepts 0 to 15 decimal places");
  const factor = 10 ** d;
  return Math.round(x * factor) / factor;
}

const NUMBER_RE = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/;
const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*/;

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i++;
      continue;
    }
    const rest = src.slice(i);
    const num = NUMBER_RE.exec(rest);
    if (num) {
      const value = Number(num[0]);
      if (!Number.isFinite(value)) throw new CalculatorError(`Number "${num[0]}" is out of range`);
      tokens.push({ kind: "number", value, pos: i });
      i += num[0].length;
    } else {
      const name = NAME_RE.exec(rest);
      if (name) {
        tokens.push({ kind: "name", value: name[0].toLowerCase(), pos: i });
        i += name[0].length;
      } else if ("+-*/%^(),".includes(ch)) {
        tokens.push({ kind: "op", value: ch as Extract<Token, { kind: "op" }>["value"], pos: i });
        i++;
      } else {
        throw new CalculatorError(`Unexpected character "${ch}" at position ${i + 1}`);
      }
    }
    if (tokens.length > MAX_TOKENS) throw new CalculatorError("Expression has too many terms");
  }
  tokens.push({ kind: "end", pos: src.length });
  return tokens;
}

class Parser {
  private index = 0;
  private depth = 0;

  constructor(private readonly tokens: Token[]) {}

  parse(): number {
    const value = this.expr();
    const t = this.peek();
    if (t.kind !== "end") throw new CalculatorError(`Unexpected ${describe(t)} at position ${t.pos + 1}`);
    return value;
  }

  private peek(): Token {
    return this.tokens[this.index];
  }

  private next(): Token {
    return this.tokens[this.index++];
  }

  private isOp(value: string): boolean {
    const t = this.peek();
    return t.kind === "op" && t.value === value;
  }

  private expect(value: "(" | ")"): void {
    if (!this.isOp(value)) {
      const t = this.peek();
      throw new CalculatorError(`Expected "${value}" but found ${describe(t)} at position ${t.pos + 1}`);
    }
    this.index++;
  }

  private enter(): void {
    if (++this.depth > MAX_DEPTH) throw new CalculatorError("Expression is nested too deeply");
  }

  private leave(): void {
    this.depth--;
  }

  private expr(): number {
    this.enter();
    let value = this.term();
    while (this.isOp("+") || this.isOp("-")) {
      const op = this.next() as Extract<Token, { kind: "op" }>;
      const rhs = this.term();
      value = op.value === "+" ? value + rhs : value - rhs;
    }
    this.leave();
    return value;
  }

  private term(): number {
    let value = this.unary();
    while (this.isOp("*") || this.isOp("/") || this.isOp("%")) {
      const op = this.next() as Extract<Token, { kind: "op" }>;
      const rhs = this.unary();
      if (op.value === "*") value *= rhs;
      else if (op.value === "/") {
        if (rhs === 0) throw new CalculatorError("Division by zero");
        value /= rhs;
      } else {
        if (rhs === 0) throw new CalculatorError("Modulo by zero");
        value %= rhs;
      }
    }
    return value;
  }

  private unary(): number {
    if (this.isOp("-")) {
      this.next();
      this.enter();
      const v = -this.unary();
      this.leave();
      return v;
    }
    if (this.isOp("+")) {
      this.next();
      this.enter();
      const v = this.unary();
      this.leave();
      return v;
    }
    return this.power();
  }

  private power(): number {
    const base = this.primary();
    if (this.isOp("^")) {
      this.next();
      const exponent = this.unary();
      return base ** exponent;
    }
    return base;
  }

  private primary(): number {
    const t = this.next();
    if (t.kind === "number") return t.value;
    if (t.kind === "op" && t.value === "(") {
      const value = this.expr();
      this.expect(")");
      return value;
    }
    if (t.kind === "name") {
      if (this.isOp("(")) return this.call(t.value, t.pos);
      const constant = CONSTANTS.get(t.value);
      if (constant !== undefined) return constant;
      if (FUNCTIONS.has(t.value)) throw new CalculatorError(`"${t.value}" is a function — call it like ${t.value}(…)`);
      throw new CalculatorError(`Unknown identifier "${t.value}" at position ${t.pos + 1}`);
    }
    if (t.kind === "end") throw new CalculatorError("Unexpected end of expression");
    throw new CalculatorError(`Unexpected "${t.value}" at position ${t.pos + 1}`);
  }

  private call(name: string, pos: number): number {
    const fn = FUNCTIONS.get(name);
    if (!fn) throw new CalculatorError(`Unknown function "${name}" at position ${pos + 1}`);
    this.expect("(");
    const args: number[] = [];
    if (!this.isOp(")")) {
      args.push(this.expr());
      while (this.isOp(",")) {
        this.next();
        args.push(this.expr());
      }
    }
    this.expect(")");
    if (args.length < fn.minArgs || args.length > fn.maxArgs) {
      const expected = fn.minArgs === fn.maxArgs ? `${fn.minArgs}` : `${fn.minArgs} to ${fn.maxArgs}`;
      throw new CalculatorError(`${name}() expects ${expected} argument${fn.maxArgs === 1 ? "" : "s"}, got ${args.length}`);
    }
    return fn.apply(args);
  }
}

function describe(t: Token): string {
  if (t.kind === "end") return "end of expression";
  if (t.kind === "number") return `number ${t.value}`;
  return `"${t.value}"`;
}

/** Float noise like 0.1 + 0.2 = 0.30000000000000004 reads as a bug; 15 significant digits is what a calculator shows. */
function tidy(value: number): number {
  if (Number.isInteger(value) || Math.abs(value) >= 1e15) return value;
  return Number(value.toPrecision(15));
}

/** Evaluate an arithmetic expression. Throws `CalculatorError` with a human-readable message on any problem. */
export function evaluateExpression(expression: string): number {
  const src = expression.trim();
  if (src.length === 0) throw new CalculatorError("Expression is empty");
  if (src.length > MAX_EXPRESSION_LENGTH) throw new CalculatorError(`Expression is longer than ${MAX_EXPRESSION_LENGTH} characters`);
  const result = new Parser(tokenize(src)).parse();
  if (!Number.isFinite(result)) throw new CalculatorError("Result is not a finite number");
  return tidy(result);
}
