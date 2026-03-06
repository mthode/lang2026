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

## Quick start

1. Install dependencies: `npm install`
2. Typecheck: `npm run typecheck`
3. Run tests: `npm test`
4. Build: `npm run build`

## Run a script file

- `npm run run:script -- path/to/script.lang`

Example:

- `npm run run:script -- examples/demo.lang`
