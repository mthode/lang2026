# Parser Reference

This directory contains the parser used by the shell language. It has one primary job:

1. Parse ordinary statements such as commands and assignments.

The scanner tokenizes input first. The parser then builds structured statement nodes from parser-owned language configuration.

## Public API

Use these entry points depending on the layer you are working in:

- `createParser(config)` parses normal shell lines and scripts.

Named-language resolution helpers are also exported for the shell runtime:

- `resolveNamedOperatorSet(registry, name)`
- `resolveNamedStatementSet(registry, name)`
- `resolveNamedLanguage(registry, name)`

## Statement Definitions

Parser statement shapes are represented by `StatementDefinition` in `statement.ts`. Named statement sets and languages consume that type directly.

`StatementDefinition` currently models:

- positional and named arguments
- raw or expression-valued arguments
- optional and vararg parts
- nested block parts
- qualifiers
- keyed clauses, including nested and repeated clauses
- invocation-time block clauses
- block language metadata
- vararg trailing named arguments
- selected expression operators for statement arguments
- strict statement-set membership through `StatementSetDefinition`

Shell-facing declaration helpers for `cmd` and `stmt` live in `shell/declaration.ts` and `shell/invocation.ts`. Those helpers are not a second parser-owned statement model; shell code adapts `stmt` declarations into `StatementDefinition` before they can enter statement sets or languages.

## Command Declarations

Command declaration parsing is shell-owned. The notes below describe shell helper behavior, not parser-owned APIs.

User-defined commands are declared with `cmd`:

```text
cmd [--evaluate operatorSet]? [qualifier? ...] commandName argDecls [blockSection ...]
```

Block sections may be:

- an implicit compatibility body: `{ ... } [:: language]`
- a named block: `blockName { ... } [:: language]`

The parser can represent zero, one, or many declared blocks. The shell currently narrows executable `cmd` declarations to exactly one required block named `body`.

### Terminology

- `_` means one unnamed positional argument.
- `name` means one named positional argument.
- `_?` and `name?` make that positional argument optional.
- `...` means a vararg slot for zero or more unnamed positional arguments.
- A keyed clause is a keyword-led nested argument group such as `(to _)` or `[mode name]*`.
- `{}` inside a keyed clause declares that the clause consumes a nested block at invocation time.
- A qualifier is a boolean flag declared before the command name, such as `verbose?`.

### Grammar

The declaration grammar is:

```ebnf
CommandDefn      ::= "cmd" ArgExprSpec? QualifierDecl* CommandName ArgDecls BlockSection*
ArgExprSpec      ::= "--" "evaluate" OperatorSetName
BlockSection     ::= Body BodyStmtSpec?
                   | BlockName Body BodyStmtSpec?
Body             ::= "{" CommandText "}"
BodyStmtSpec     ::= "::" LanguageName

ArgDecls         ::= ArgDecl* OptionalArgDecl* KeyedDecl* ("..." NamedArgDecl*)? BlockMarker?
BlockMarker      ::= "{}"

ArgDecl          ::= "_"
                   | NamedArgDecl

NamedArgDecl     ::= ArgumentName

OptionalArgDecl  ::= "_" "?"
                   | ArgumentName "?"

KeyedDecl        ::= "(" Keyword ArgDecls ")" "+"?
                   | "[" Keyword ArgDecls "]" "*"?

QualifierDecl    ::= Keyword "?"
```

Additional declaration metadata captured by the parser:

- `argumentOperatorSetName` stores the optional operator set named by `--evaluate`.
- `blocks` stores declared statement blocks. An unnamed trailing body desugars to a block named `body`.

### Declaration Forms

- Required positional unnamed: `_`
- Required positional named: `name`
- Optional positional unnamed: `_?`
- Optional positional named: `name?`
- Required keyed clause: `(keyword argDecls)`
- Required keyed clause, repeatable: `(keyword argDecls)+`
- Optional keyed clause: `[keyword argDecls]`
- Optional keyed clause, repeatable: `[keyword argDecls]*`
- Required keyed block clause: `(keyword {})`
- Optional keyed block clause: `[keyword {}]`
- Vararg unnamed positional: `...`
- Vararg with trailing required named args: `... destination`

### Ordering Rules

Inside a single clause, declarations are ordered as:

1. Required positional arguments
2. Optional positional arguments
3. Keyed clauses
4. Optional vararg `...` followed by trailing required named arguments

This ordering is enforced by the declaration parser. For example, required positional arguments cannot appear after optional or keyed declarations, and keyed clauses cannot appear after a vararg.

### Qualifiers

Qualifiers are boolean flags declared before the command name:

```text
cmd verbose? build target { echo verbose=$verbose target=$target }
```

During invocation parsing, qualifiers are read from the front of the command. If present they are `true`; if absent they are `false`.

### Keyed Clauses

Keyed clauses define nested argument groups:

- `()` means the clause is required.
- `()+` means the clause is required and repeatable.
- `[]` means the clause is optional.
- `[]*` means the clause is optional and repeatable.

Examples:

```text
cmd send _ (to _) { echo send $1 to $to }
cmd add (item _)+ { echo $item }
cmd config [mode name]* { echo configured }
cmd if condition (then {}) [else {}]
cmd match [case value {}]*
```

Keyed block clauses bind nested blocks from invocation source instead of from declaration source:

```text
if ready then { echo yes } else { echo no }
match case 1 + 2 { echo one } case 3 + 4 { echo two }
```

When a keyed block clause also declares ordinary arguments, the following `{ ... }` block is treated as the block payload boundary and is not consumed as part of the final argument expression.

### Varargs And Trailing Named Arguments

`...` captures zero or more unnamed positional values in the current clause. If trailing named arguments are declared after the vararg, the parser assigns the final values in that clause to those names.

Example:

```text
cmd cp _ ... destination { echo copy $args to $destination }
cp a b c out
```

This produces one unnamed positional argument for the first `_`, then collects `b` and `c` into `varArgs`, and binds `destination = out`.

## Declaration Validation Rules

The declaration parser builds the structure. `validateDeclaration` then enforces additional rules:

- Keywords are case-sensitive.
- Duplicate keyed clause keywords anywhere in one command declaration are invalid.
- Qualifier keywords may not collide with existing command names.
- Qualifier keywords may not collide with keyed clause keywords in the same declaration.
- Invocation-time block clause names may not collide with declared statement block names.
- Nested keyed clauses cannot contain `...` when an ancestor clause has trailing required named arguments after its own `...`.

The scanner emits `...` as a single operator token, but string literals containing `...` remain ordinary strings.

## Invocation Semantics

Given a declaration, invocation parsing is deterministic and left-to-right.

If the declaration carries `argumentOperatorSetName`, invocation parsing can also reduce one value-bearing slot from multiple tokens into a parsed expression node using the selected operator set. Clause keywords still terminate that parse when they are valid clause transitions, and trailing required values still reserve enough input to bind correctly.

### Segments

Invocations are parsed as top-level whitespace-delimited segments. Nested structures such as `{ ... }`, `( ... )`, and `[ ... ]` remain grouped as one segment while parsing the invocation.

### Keyword Recognition

Only a single unquoted identifier segment can be treated as a qualifier, command name, or keyed-clause keyword. Quoted strings are always values.

Example:

```text
cmd send _ (to _) { echo to=$to msg=$1 }
send "to" to admin
```

Here `"to"` is a value, not a clause keyword.

### Recursive Clause Parsing

Each clause consumes segments until one of these happens:

- The next segment starts one of its child keyed clauses.
- The next segment no longer fits in the current clause, so control returns to the parent clause.
- The token stream ends.

This allows nested clause structures such as:

```text
cmd move (from _ (within _)) (to _) { echo move }
```

### Vararg Greediness

Within a clause, `...` collects all remaining non-keyword values for that clause. If the clause declares trailing named arguments after the vararg, the parser reserves the final values for those names when the clause is finalized.

The vararg in one clause does not consume a child clause keyword. A recognized child keyword always starts that child clause instead.

### Post-Parse Validation

`parseInvocation` builds structure first. `validateInvocation` then checks semantic constraints such as:

- Required positional arguments are present.
- Required keyed clauses appear at least once.
- Single-occurrence clauses are not repeated.
- Nested required clauses are also satisfied.
- Bound block sections are declared by either statement blocks or invocation-time block clauses.
- Block-bearing clause occurrences have exactly one bound nested block each.
- Declared statement block cardinality is respected.

This separation keeps the parsing logic simple while still enforcing declaration semantics.

## Parsed Data Structures

The declaration parser produces `StatementDeclaration`:

```ts
interface PositionalArgDecl {
	kind: "named" | "unnamed";
	name?: string;
	optional: boolean;
}

interface VarargDecl {
	trailingNamedArgs: string[];
}

interface BlockMarkerDecl {
	kind: "block";
}

interface KeyedClauseDecl {
	keyword: string;
	required: boolean;
	allowMultiple: boolean;
	argDecls: ArgDeclGroup;
}

interface QualifierDecl {
	keyword: string;
}

interface ArgDeclGroup {
	positional: PositionalArgDecl[];
	keyedClauses: KeyedClauseDecl[];
	vararg?: VarargDecl;
	block?: BlockMarkerDecl;
}

interface StatementDeclaration {
	name: string;
	argumentOperatorSetName?: string;
	qualifiers: QualifierDecl[];
	argDecls: ArgDeclGroup;
	blocks: StatementBlock[];
	globalKeywords: Set<string>;
}
```

Invocation parsing returns `ParsedStatement`:

```ts
interface ParsedArguments {
	clauseName: string;
	namedArgs: Record<string, ArgumentValue>;
	varArgs: ArgumentValue[];
	clauses: Record<string, ParsedArguments[]>;
}

interface ParsedStatement {
	statementName: string;
	qualifiers: Record<string, boolean>;
	arguments: ParsedArguments;
	blocks: Record<string, NestedBlockNode[]>;
}
```

`ArgumentValue` reuses parser value types: `ExpressionNode | string | NestedBlockNode`.

`parseInvocation` accepts optional parser-owned invocation settings:

```ts
interface InvocationParseOptions {
	expressionConfig?: ExpressionParserConfig;
}
```

Use `expressionConfig` when a declaration's arguments should be parsed with a selected operator set. Invocation-bound block sections such as `(then {})` are parsed structurally and do not carry execution-time language metadata.

## Examples

```text
cmd noop { echo ok }
cmd greet name { echo hello $name }
cmd cp _ ... destination { echo copy $args to $destination }
cmd verbose? cp _ [mode name]* ... destination { echo copy }
cmd send _ (to _) { echo send $1 to $to }
cmd if condition (then {}) [else {}]
cmd move (from _ (within _)) (to _) { echo move }
cmd --evaluate math_ops calc value { eval $value } :: eval_lang
```

## Runtime Flow

The normal flow for user-defined commands is:

1. Scan source.
2. Parse the declaration with `parseStatementDeclaration(...)`.
3. Validate it with `validateDeclaration(...)`.
4. Store the resulting `StatementDeclaration`.
5. Parse an invocation with `parseInvocation(...)`.
6. Validate the invocation with `validateInvocation(...)`.
7. Map parsed values into the execution environment and run the stored body.

Built-in shell commands use the same `NamedStatementNode` shape as other parsed statements. Shell-specific command handlers decide how to execute that parser-generic structure.
