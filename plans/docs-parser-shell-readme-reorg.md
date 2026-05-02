# Parser And Shell Documentation Reorg

## Goal

Move shell-specific grammar and command details out of the parser documentation so parser docs describe reusable interfaces first.

## Assumptions

- This is a documentation-only change. No parser or runtime behavior changes are planned.
- The parser README should document parser-owned APIs and types.
- The shell README should document shell commands, including parser-backed declaration commands.

## Important Shapes

- `parser/index.ts` is the public parser surface.
- `parser/language.ts` owns `OperatorSetDefinition`, `StatementSetDefinition`, `Language`, and conversion helpers.
- `shell/commands/command.ts`, `shell/commands/statement.ts`, and `shell/commands/language-object.ts` own the shell command surfaces that should be documented in the shell README.

## Tasks

- [x] 1. Review the current top-level, parser, and shell README ownership boundaries.
- [x] 2. Rewrite the parser README around parser entry points, AST nodes, and language composition helpers.
- [x] 3. Move shell-specific declaration grammar and named-language command docs into the shell README.
- [x] 4. Trim the top-level README to a project overview plus links to the module-specific docs.
- [x] 5. Validate cross-links and terminology after the reorganization.
