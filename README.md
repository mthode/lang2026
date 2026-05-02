# lang2026

A TypeScript project for building line-based languages and runtimes in TypeScript.

The current repository includes:

- `scanner/` tokenization
- `parser/` line + expression parsing to AST
- `lang/` expression and function-statement evaluation
- `repl/` shared REPL engine
- `shell/` shell-style script execution runtime
- `terminal/` node terminal integration
- `browser/` browser integration
- `test/` scanner/parser tests

## Documentation

- [parser/README.md](parser/README.md): reusable parser interfaces, AST shapes, and language composition helpers
- [shell/README.md](shell/README.md): shell runtime behavior and built-in command syntax
- [lang/README.md](lang/README.md): expression runtime and function-body semantics

## Quick start

1. Install dependencies: `npm install`
2. Typecheck: `npm run typecheck`
3. Run tests: `npm test`
4. Build: `npm run build`

## Run a script file

- `npm run run:script -- path/to/script.lang`

Example:

- `npm run run:script -- examples/demo.lang`
