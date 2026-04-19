# lang2026

A TypeScript project for a line-based command language with:

- `scanner/` tokenization
- `parser/` line + expression parsing to AST
- `lang/` expression and function-statement evaluation
- `repl/` shared REPL engine
- `shell/` script execution runtime
- `terminal/` node terminal integration
- `browser/` browser integration
- `test/` scanner/parser tests

## Custom Language Declarations

The shell can now declare named language objects and attach them to user-defined commands.

Minimal first-release forms:

```text
opset math_ops {
	infix + precedence 7 left
}

cmdset eval_only {
	eval
}

stmtset eval_stmt commands eval_only operators shell_ops

cmd --evaluate math_ops calc value {
	eval $value
} :: eval_stmt

calc 1 + 2
```

Current constraints:

- `opset` supports `prefix` and `infix` entries only.
- `cmdset` supports direct command membership only.
- `stmtset` references one named command set and one named operator set.
- `cmd --evaluate Name` selects the operator set used to parse invocation arguments.
- `} :: Name` selects the statement set used to parse and execute the command body.

## Quick start

1. Install dependencies: `npm install`
2. Typecheck: `npm run typecheck`
3. Run tests: `npm test`
4. Build: `npm run build`

## Run a script file

- `npm run run:script -- path/to/script.lang`

Example:

- `npm run run:script -- examples/demo.lang`
