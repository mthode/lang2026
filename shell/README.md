# Shell language

This directory defines shell parsing and command execution.

Expression evaluation and function-body statement execution live in `lang/`. For full function-language semantics, see [../lang/README.md](../lang/README.md).

## Top-level shell statements

Supported statement kinds:

1. Assignment statement
2. Command statement

### 1. Assignment statement

Syntax:

- `IDENTIFIER = EXPRESSION`

Examples:

- `x = 10`
- `eval x * 2`

### 2. Command statement

Syntax:

- `COMMAND_NAME ARGUMENTS...`

Examples:

- `echo hello`
- `if 1 then { echo yes }`

If a command name is not a built-in and not user-defined via `cmd`, execution falls back to the OS command runner in the Node runtime.

## Commands vs expression functions

Commands and expression functions are separate namespaces and call sites:

- Commands run as statements: `echo hi`, `cmd greet name { ... }`
- Functions run in expressions: `eval add(3, 4)`

Cross-calls are rejected:

- Calling a function as a command fails.
- Calling a command as a function fails.

## Built-in commands

### `cd`

Change current working directory.

Syntax:

- `cd PATH`

### `eval`

Evaluate one expression and return a numeric result as text.

Examples:

- `eval 1 + 2 * 3`
- `eval -(10 / 2)`

### `echo`

Print arguments as a single line.

### `if`

Shell command conditional.

Syntax:

- `if EXPRESSION then { COMMANDS }`
- `if EXPRESSION then { COMMANDS } else { COMMANDS }`

### `while`

Shell command loop.

Syntax:

- `while EXPRESSION do { COMMANDS }`

Special variable:

- `$loop` in condition and body interpolation

### `for`

Shell command counted loop.

Syntax:

- `for ITERATOR from START_EXPR to END_EXPR do { COMMANDS }`
- `for ITERATOR from START_EXPR to END_EXPR step STEP_EXPR do { COMMANDS }`

Special variable:

- `$ITERATOR` in body interpolation

### `cmd`

Define a user command.

Syntax:

- `cmd [--evaluate OPERATOR_SET]? [QUALIFIER? ...] COMMAND_NAME ARG_DECLS BLOCK_SECTION*`

Block sections may be:

- an implicit body: `{ COMMANDS } [:: LANGUAGE]`
- a named body block: `body { COMMANDS } [:: LANGUAGE]`

The parser can represent more than one block, but the executable shell runtime currently requires exactly one required implementation block named `body`.

Argument declaration forms:

- `_`: required unnamed positional argument
- `name`: required named positional argument
- `_?` or `name?`: optional positional argument
- `(keyword ARG_DECLS)`: required keyed clause
- `(keyword ARG_DECLS)+`: required repeatable keyed clause
- `[keyword ARG_DECLS]`: optional keyed clause
- `[keyword ARG_DECLS]*`: optional repeatable keyed clause
- `(keyword {})` or `[keyword {}]`: keyed clause that consumes an invocation block
- `...`: vararg unnamed positional arguments
- `... destination`: vararg with trailing required named arguments

Additional command features:

- `qualifier?` before the command name declares a boolean flag consumed from the front of an invocation
- `--evaluate NAME` selects the named operator set used to parse value-bearing invocation arguments
- `} :: NAME` selects the named language used to parse and execute the command body

Examples:

- `cmd greet name { echo hello $name }`
- `cmd verbose? build target { echo verbose=$verbose target=$target }`
- `cmd send _ (to _) { echo send $1 to $to }`
- `cmd --evaluate math_ops calc value { eval $value }`

During invocation parsing, clause keywords still delimit clauses even when `--evaluate` is active.

### `stmt`

Register a parser-level statement shape.

Syntax:

- `stmt [--evaluate OPERATOR_SET]? [QUALIFIER? ...] STATEMENT_NAME ARG_DECLS BLOCK_SECTION*`

`stmt` uses the same declaration surface as `cmd`, but block bodies must be empty shape-only placeholders.

Examples:

- `stmt choose condition (then {}) [else {}]`
- `stmt --evaluate math_ops calc value body {} :: mini_lang`

`stmt` is parse-only today. It does not create an executable shell command. Registered statements can be included in `statements` sets and then used by named `language` objects.

### `operators`

Register a named parser operator set.

Syntax:

- `operators NAME { OPERATOR_DEFINITIONS }`

Operator definition forms:

- `prefix OP precedence N`
- `infix OP precedence N`
- `infix OP precedence N left`
- `infix OP precedence N right`

Separators inside the body may be whitespace, `,`, or `;`.

Example:

- `operators math_ops { infix + precedence 7 left; infix * precedence 8 left }`

### `statements`

Register a named statement set for parser scopes.

Syntax:

- `statements NAME { STATEMENT_NAMES... }`

Entries may refer to built-in shell statements or parse-only statements previously registered with `stmt`.

Example:

- `statements mini_shell { echo if choose }`

### `language`

Register a named parser language by combining one statement set and one operator set.

Syntax:

- `language NAME statements STATEMENT_SET operators OPERATOR_SET`

Example:

- `language mini_lang statements mini_shell operators math_ops`

### `func`

Define an expression function.

Syntax:

- `func FUNCTION_NAME ( PARAMS ) { FUNCTION_STATEMENTS }`

Examples:

- `func add ( a, b ) { a + b }`
- `eval add(3, 4)`

For complete function-statement semantics, see [../lang/README.md](../lang/README.md).

## Expressions and functions in shell

Shell statements can use expressions for assignment, `eval`, conditionals, loop ranges, and any command declaration that opts into expression parsing with `--evaluate`.

`func` defines expression functions, but the function language itself is documented in [../lang/README.md](../lang/README.md).

## Runtime notes

### Prompt

Terminal prompt includes current directory, for example `/home/user/project> `.

### External OS commands

When command lookup misses shell built-ins and user `cmd` definitions, execution is delegated to OS commands in the Node runtime.

In the browser runtime this throws:

- `OS commands are not available on the web`
