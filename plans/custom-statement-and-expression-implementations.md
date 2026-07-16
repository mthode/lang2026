# Custom Statement And Expression Implementations

## Status

Proposed design and implementation plan. No implementation work has started.

## Goal

Allow language code to implement:

- statement forms declared with `stmt`
- expression operators, including language-defined call operators, with implementations declared in language code
- declarations and other forms that inspect parsed expression syntax; what an
  implementation does with that syntax, including whether and how it retains
  it, is entirely up to the implementation

Custom statements differ from `cmd` in one essential way: their implementation receives parsed values without automatically evaluating expressions or executing blocks. The implementation decides whether, when, how often, and in which language each value is evaluated.

This must support control-flow behavior such as the following pseudocode. The
angle-bracketed operations stand for shell's still-to-be-chosen intrinsic
operator notation; they are not source syntax:

```text
stmt if condition (then {}) [else {}] implement context body { shell } {
  if <evaluate context condition> then {
    execute context then
  } else {
    if <present context else> then {
      execute context else
    }
  }
}
```

Only the selected block is executed. A loop can evaluate the same condition and execute the same body repeatedly.

## Current State

- `stmt` registers a `StatementDefinition` used by the parser. It rejects content-bearing declaration blocks and has no execution registry.
- Built-in shell statements are dispatched through the TypeScript `commandExecutors` map, while their `StatementDefinition` values are constructed directly in TypeScript.
- Unknown statements fall through to user commands and then OS commands.
- `cmd` stores an implementation body, eagerly renders argument values into text, and executes the resulting body. It currently accepts a `:: languageName` body-language annotation, but it cannot retain expression ASTs or selectively execute invocation blocks.
- `func` implements custom numeric expression calls, but evaluates all call arguments before entering the function body.
- The expression parser currently recognizes `identifier(...)` directly in
  `parsePrimary`, independently of `ExpressionParserConfig`. Consequently, a
  selected operator set cannot disable or redefine calls.
- Statement argument splitting is not yet call-aware on every parsing path:
  some paths can split `foo (1)` at whitespace, while others pass the complete
  token sequence to the expression parser. The latter currently becomes a
  hard-coded call expression rather than two arguments.
- `Language` describes parser behavior, but does not currently pair statement or operator syntax with runtime implementations.
- several built-ins, including `cmd`, `func`, `operators`, `language`, and `stmt`,
  currently accept a raw declaration tail and run a command-specific secondary
  parser; function bodies also recognize control flow with source-prefix checks.
  Those paths do not yet meet the uniform representation requirement.

## Uniform Language Representation

All executable constructs introduced by this plan must be represented by the
existing language model:

- statement syntax is described by `StatementDefinition` values created through
  the `stmt` declaration surface;
- expression syntax is described by prefix, infix, and call operator definitions
  created through the `operators` declaration surface;
- a `Language` selects the statements and operators that are legal in a body;
- built-in and custom implementations differ only in where their runtime handler
  comes from, not in how their syntax is parsed.

All built-in statement and operator signatures must be declared by a startup
script before TypeScript binds host handlers. Statements and operators follow
the same binding rule: a declaration selected by an executable language must
resolve either to a language implementation body or to a TypeScript primitive
binding. For operators, omitting `body` declares a primitive; for statements,
omitting the `implement` suffix declares a primitive. A
declaration that is not selected by an executable language may remain parse-only.
Runtime code must dispatch a parsed node; it must not recognize constructs with
string prefix checks, manually split their arguments, or maintain a private
grammar.

Literals, identifiers, and grouping remain parser fundamentals. Every other
expression form is an operator. In particular, the familiar `target(arguments)`
form is a call operator whose right operand is one list value; it is not a
parser-owned function-call node. A language may omit that operator or give it a
different meaning. Every selected operator must have a declared runtime binding.

Call selection determines statement-expression boundaries. If the active
operator set selects a matching call operator, `foo (1)` is one expression: a
call operator with `foo` as its target and `(1)` as its list operand. If it does
not select that call operator, the expression parser must stop after `foo`; a
statement shape with two positional expression arguments then parses `foo (1)`
as `foo` and grouped expression `(1)`. A shape with only one expression argument
must reject the remaining `(1)` as an extra argument. This rule applies equally
to every statement parsing path; whitespace is not an independent call rule.

### Parser modification rule

The common `stmt` declaration model is the canonical representation of statement
syntax. This is a cross-cutting implementation rule for every task in this plan:

1. Before modifying a statement parser path, identify the corresponding
   `StatementDefinition` and common `stmt` signature.
2. Parse the statement through the generic statement parser rather than adding
   command-name checks, source-prefix checks, raw-tail splitting, or another
   statement-specific parser.
3. If the common model cannot represent the required syntax, extend
   `StatementDefinition`, the `stmt` declaration format, and the generic parser
   first. Do not work around the limitation in the consuming statement.
4. When a touched area already contains specialized parsing, pull that area
   toward the common model as part of the change. The refactor should cover the
   modified path and its directly shared helpers; unrelated parser rewrites are
   not required.
5. Built-in and custom statements with the same declaration must produce the
   same `NamedStatementNode` shape.
6. Any temporary exception must be recorded in this plan with its removal task
   and must not create new user-visible syntax.

Code review for each parser task must explicitly verify these rules.

## Proposed Syntax

### Statement declaration with optional implementation

`stmt` declares statement syntax and, optionally, its implementation in one
declaration. The `implement context body { shell }` suffix is metadata of the
`stmt` declaration, not part of the declared statement's invocation shape:

```text
stmt choose condition (then {}) [else {}] implement context body { shell } {
  if <evaluate context condition> then {
    execute context then
  } else {
    if <present context else> then {
      execute context else
    }
  }
}
```

`context` is the required, explicit parameter passed to the statement handler.
The `shell` annotation selects the implementation body's language. All statement
and operator implementation bodies are written in the startup-declared shell
language. `stmt` needs bootstrap-specific parsing to distinguish its signature
blocks, the `implement` suffix, and the final executable body; this is a bounded
exception required to bootstrap the common declaration model, not a second
user-visible statement grammar. `implement` is reserved as the declaration-only
suffix keyword and cannot be declared as a statement-signature part name.

An implementation can still execute an invocation block in its declared language:

```text
stmt render model body { template_lang } implement context body { shell } {
  execute context body
}
```

A `stmt` without its `implement` suffix is a primitive and
must receive a TypeScript statement binding before an executable language may
select it. It may remain parse-only when no executable language selects it.

### Expression operator implementation

Use the `operators` declaration surface for every custom expression operation.
The existing `func` declaration is a migration target rather than a new runtime
abstraction: it must be re-expressed as a declaration of the language's call
operator, or removed. A call operator may use the conventional syntax
`target(arguments)`, but that syntax is selected by the language and has no
special status in the parser.

```text
operators math {
  call "(" ")" precedence 10 parameters context target arguments body {
    # evaluate or dispatch target and arguments according to this language
  }
}
```

The exact declaration shape for call operators, including how an argument list
is represented and parsed, must be shared by all languages that select it. It
has two operands: `target` and one `arguments` list operand. The runtime supplies
the empty string as `context` for a top-level operator evaluation. A `call`
declaration must use exactly one supported matched delimiter pair: `(` and `)`,
`{` and `}`, or `[` and `]`. Other opening or closing tokens, and mismatched
pairs, are rejected. Whitespace between the target and opening delimiter does
not prevent a selected call operator from applying.

### Block language declarations and `cmd`

Block languages are declared only inside `stmt` signatures:

```text
stmt render model body {}                    # inherit the active/default language
stmt render model body { template_lang }     # use template_lang
stmt choose condition (then { shell }) [else { shell }]
```

In this declaration context, an empty shape block means language inheritance and
a single identifier means an explicit language. This interpretation is never
applied to an invocation or implementation block, where all brace contents are
program text.

`cmd` no longer supports body-language customization. A command implementation
body always executes with the shell's fixed command-body language:

```text
cmd greet name { echo hello $name }
```

The old form is rejected:

```text
cmd greet name { echo hello $name } :: template_lang
```

This is an intentional breaking change. It removes the only content-bearing
declaration context in which `{ languageName }` would be ambiguous. Custom
body-language behavior belongs to a `stmt` declaration with its optional
implementation suffix.

### Built-in shell language

The primary language for command execution is named `shell`. It is declared by
the startup script, is the default language for shell source execution, and is
registered in the language registry before normal user source is processed.
`shell` is not a TypeScript-only alias: it is an ordinary named `Language` with
a startup-declared statement set and operator set. Like other shell languages,
it does not select the parenthesized call operator.

The startup script declares the shell operator set and every built-in signature,
then declares the `shell` language that selects them. Illustrative shape:

```text
operators shell_ops {
  prefix "-" precedence 9
  infix "+" precedence 7 associativity left
}

stmt echo extras...
stmt eval expression
stmt if condition then {} [else {}]

language shell operators shell_ops {
  statements { cd cmd echo eval expr for if language operators raw stmt while }
}
```

The exact startup inventory must include every built-in command and operator,
not only the examples above. The initial `shell` command inventory is `cd`,
`cmd`, `echo`, `eval`, `expr`, `for`, `if`, `language`,
`operators`, `raw`, `stmt`, and `while`; the startup script must declare each
signature before listing it in `shell`. It must also declare every host operator
selected by shell for implementation bodies.

`language` selects statement declarations and an operator set. Handler
intrinsics are declared as built-in `$()` subcommands selected by shell. Their
shell syntax and argument handling are defined by D9.

Because `shell` is registered before user `stmt` declarations execute, it may be
named as an explicit block language in any statement signature:

```text
stmt run_shell body { shell }
stmt choose condition (then { shell }) [else { shell }]
```

`{ shell }` has the normal explicit-block-language meaning. It does not grant
ambient shell fallback to another language and does not alter the fixed
command-body language of `cmd`.

### Operator implementation

An operator definition declares both parsing behavior and, when present, its
evaluator body. The direct body removes the `func` indirection:

```text
operators logic_ops {
  infix "++" precedence 7 associativity left parameters context left right body {
    return left + right
  }
}
```

An omitted body declares a primitive operator. It must receive a matching
TypeScript evaluator binding before an executable language may select its
operator set; language code cannot attach or replace the binding:

```text
operators arithmetic_ops {
  prefix "-" precedence 9
  infix "+" precedence 7 associativity left
}
```

Entries inside `operators` must also be parsed as ordinary declared statements in
an operator-definition language. For example, that language can contain:

```text
stmt prefix symbol (precedence value) [parameters context operand body { shell }]
stmt infix symbol (precedence value) [associativity direction] [parameters context left right body { shell }]
stmt call [head symbol] open close (precedence value) [parameters context target arguments body { shell }]
```

The optional parameter-and-body group is all-or-nothing: a body is a custom
implementation and requires parameters; no body is a primitive declaration and
does not name parameters. A prefix custom implementation declares `context` and
one operand parameter; an infix custom implementation declares `context` and
two operand parameters. A call implementation declares `context`, `target`, and
one `arguments` list operand. Quoting symbols such as `"&&"` lets the generic
expression argument parser represent the symbol without treating a bare operator
as an incomplete expression.

## Runtime Semantics

### Parsing precedes evaluation

Every argument declared with `valueKind: "expression"` is parsed into one
`ExpressionNode` while the statement invocation is parsed. In a `stmt` context,
the resulting AST is wrapped in an `ExpressionHandle` for the implementation.
The implementation receives that handle without the AST having been evaluated.
In a `cmd` context, the parsed AST is instead evaluated greedily before the
command implementation runs.

For example:

```text
stmt choose condition (then {}) [else {}] implement context body { shell } {
  if <evaluate context condition> then {
    execute context then
  } else {
    if <present context else> then {
      execute context else
    }
  }
}

choose 3 == 4 then { echo equal } else { echo different }
```

The invocation parser must:

1. recognize `condition` as one expression-valued argument;
2. consume `3 == 4` as that argument, stopping at the declared `then` clause;
3. parse it into a binary `ExpressionNode` for `==`;
4. parse both blocks into opaque `NestedBlockNode` values;
5. invoke the handler with unevaluated expression and block handles.

Only shell's `evaluate` operator computes the comparison. The
declared `execute context` statement runs only the selected block.

Expression boundaries continue to be determined by the statement declaration:

- declared clause keywords delimit a preceding expression;
- a following required positional value forces the parser to reserve input for
  that value;
- a declared block begins a block part rather than becoming expression input;
- the active operator set determines which token sequence is a valid expression.

If the parser cannot unambiguously divide adjacent positional expressions, the
declaration or invocation syntax must provide a boundary; the handler must never
receive an arbitrary list of whitespace-separated tokens and reconstruct the
expression itself.

### Deferred values

Custom implementations receive typed handles rather than interpolated strings:

- expression arguments: `ExpressionHandle`
- blocks: `BlockHandle`
- repeated arguments or blocks: ordered lists of handles
- qualifiers: booleans
- raw arguments: strings

An expression handle contains the parsed `ExpressionNode` and the lexical runtime context needed to evaluate it. A block handle contains the `NestedBlockNode`, its selected `Language`, and the lexical runtime context needed to execute it.

Handles must not expose mutable parser ASTs directly to language code.

### Context parameter

Every `stmt` implementation body and every operator implementation body —
including a call operator implementation — declares exactly one required `context`
parameter. It is an ordinary named handler parameter, declared before the
handler body and distinct from every source-level statement part or expression
parameter.

- `context` holds a single ordinary `RuntimeValue` chosen by the caller. The
  runtime imposes no schema, structure, or built-in mutation operation on it.
- A statement or operator invoked directly from ordinary source receives
  the empty string, `""`, as its `context` parameter. Ordinary source syntax
  does not change or expose this runtime-supplied argument.
- A handler invoking a child handler must supply the child's `context`
  explicitly. It may pass its own `context` unchanged or pass any other runtime
  value. Context is never inherited implicitly.
- The initial handler intrinsics make this explicit: `$ (evaluate context
  expression)` evaluates an expression handle with an explicit context, and
  `execute context block` executes a block. Other intrinsic subcommands
  likewise receive their context explicitly.
- The runtime never inspects, validates, or interprets a `context` value. It
  flows through handler execution exactly like any other `RuntimeValue`.

This single explicit parameter is the only mechanism this plan provides for
carrying implementation-defined data between handler invocations. There is no
separate prescribed storage, registry, or mutation primitive: an implementation
that needs to retain or accumulate data across invocations builds its own
convention on top of `context` and ordinary runtime values.

### AST inspection

Statement implementations may inspect an expression argument without evaluating
it. The runtime should not expose the parser's mutable TypeScript class instances
directly. Instead, the selected handler notation for `syntax` converts an
`ExpressionHandle` into an
immutable, language-level `SyntaxValue`.

The distinction is important:

- `ExpressionHandle` combines parsed syntax with captured evaluation context and
  can be passed to shell's `evaluate` operator;
- `SyntaxValue` is detached structural data suitable for inspection, comparison,
  and retention across invocations;
- converting to `SyntaxValue` does not evaluate the expression;
- a retained `SyntaxValue` does not retain the caller's environment;
- Shell's `evaluate` operator does not accept a detached
  `SyntaxValue` in the first implementation.

The normalized syntax representation should be stable even if parser classes are
refactored:

```ts
type SyntaxValue =
  | { kind: "identifier"; name: string }
  | { kind: "number"; value: number; raw: string }
  | { kind: "string"; value: string; raw: string }
  | {
      kind: "operator";
      fixity: "prefix" | "infix" | "call";
      symbol: string;
      operands: SyntaxValue[];
    };
```

The first handler runtime exposes inspection through shell's host-backed `$()`
intrinsic subcommands. The operations are `syntax`, `kind`, `field`, and
`children`; each receives its context explicitly through the selected
subcommand signature.

Invalid field access must produce a descriptive runtime error. A later pattern
matching feature may make AST traversal more convenient, but is not required for
the first implementation.

Supporting declaration-oriented handlers also benefits from structured runtime
data such as strings, numbers, booleans, and immutable lists and records, in
addition to `SyntaxValue`. The runtime does not prescribe how an implementation
stores or accumulates this data; that is an ordinary implementation choice,
made available through the `context` parameter described above.

An implementation can inspect an unevaluated type expression without resolving
it: it applies the selected `syntax` operator to its explicit context and the
`name` or `type` handle, then passes the resulting `SyntaxValue` to its selected
record-construction operator. Neither `String` nor a language-defined list
operator is resolved in that process. Whether and how an emitted record is
collected, retained, or otherwise used is left entirely to the surrounding
implementation and its `context`.

AST inspection is initially limited to expression arguments. Inspecting a block
as a parsed statement tree would require choosing its language and parsing it,
which is a separate macro/reflection feature. A `BlockHandle` remains executable
and opaque in this plan.

### Handler intrinsics

Shell must provide a small set of runtime-owned intrinsics for implementation bodies:

- `context` — the single value passed to this handler invocation (see "Context parameter")
- `evaluate` — a `$()` subcommand that evaluates an expression handle using the
  explicitly supplied context for any child handler invocation
- `syntax` — a `$()` subcommand that detaches immutable syntax data from an expression handle
- `kind`, `field`, and `children` — `$()` subcommands that inspect detached
  syntax data and receive an explicit context argument
- `execute context block` — execute a required block with the explicitly
  supplied context; it exposes no result to shell code in the first implementation
- `present` — a `$()` subcommand that tests whether an optional argument, clause, or block was supplied
- `return expression` — return a value from an expression implementation
- `emit expression` — append statement output
- ordinary declared control-flow statements needed to write handlers

Every executable handler construct must have a `StatementDefinition` in shell.
A representative bootstrap surface is:

```text
stmt if condition then {} [else {}]
stmt while condition do {}
stmt execute context block
stmt return value
stmt emit value
```

`evaluate`, `present`, `syntax`, `kind`, `field`, `children`, and `record` must
be declared as host-backed intrinsic subcommands in shell's startup
declarations. `$` is the host-backed head-restricted call operator that parses
and dispatches those declared subcommands.

These constructs are capabilities of the handler runtime, not ordinary shell
commands. In particular, `execute` must consume a `BlockHandle`; it must not
reconstruct source through string interpolation.

### Statement results

The runtime uses this internal execution result:

```ts
type StatementResult = {
  output?: string[];
  value?: RuntimeValue;
};
```

Shell source execution consumes `output`. `execute` does not return `output`,
`value`, or any other result to shell code in the first implementation. The
runtime may use `value` internally, but no language-visible return channel is
defined yet. This keeps the execution boundary structured without prematurely
choosing shell syntax or semantics for result consumption.

The implementation must add a TODO comment next to the internal
`StatementResult` production or `execute` result-discard boundary. The comment
must state that a future feature should expose a defined form of block execution
result to language code; it must not imply that an external return exists now.

### Expression results

Custom operator handlers must return a `RuntimeValue` on every reachable path.
The return value is not restricted to numbers: it may be any supported runtime
value, including strings, booleans, lists, records, `SyntaxValue`, expression
handles, or block handles. Existing expression consumers may still impose their
own type requirements; for example, an arithmetic primitive rejects a
non-numeric operand. This allows handler intrinsics to produce structured values
without introducing a separate expression-result channel.

### Scope and lifetime

- Invocation arguments and blocks capture the caller's environment.
- Implementation-local variables live in a child scope.
- `evaluate` uses the expression handle's captured lexical
  context plus documented handler-local bindings, and passes the supplied
  `context` to any operator handler it invokes.
- `execute` uses the block's declared language when present; otherwise it inherits the invocation language.
- Shell source execution starts in the startup-declared `shell` language.
- `shell` is always available for explicit selection in a post-startup `stmt`
  signature; `{ shell }` selects that language only for the annotated block.
- Registry references are resolved when the declaration is created, matching current command language capture behavior.
- Recursive custom statements and expressions are allowed, with a configurable recursion-depth guard.
- Errors include both the invocation location and implementation location.

## Runtime Model

Add separate syntax and implementation registries:

```ts
interface StatementImplementation {
  declaration: StatementDefinition;
  contextParameter: "context";
  body: StatementNode[];
  shellLanguage: Language;
}

interface OperatorHandlerImplementation {
  operatorSetName: string;
  fixity: "prefix" | "infix" | "call";
  symbol: string;
  contextParameter: "context";
  parameters: string[];
  body: StatementNode[];
  shellLanguage: Language;
}

interface PrimitiveOperatorBinding {
  operatorSetName: string;
  fixity: "prefix" | "infix" | "call";
  symbol: string;
  evaluate: HostOperatorEvaluator;
}

interface PrimitiveStatementBinding {
  languageName: string;
  statementName: string;
  execute: HostStatementExecutor;
}

type RuntimeValue =
  | number
  | string
  | boolean
  | RuntimeValue[]
  | { [name: string]: RuntimeValue }
  | SyntaxValue
  | ExpressionHandle
  | BlockHandle;
```

`Language` should continue to describe parsing. Runtime behavior belongs to an execution environment or runtime-language binding rather than parser-owned `StatementDefinition`.

Dispatch becomes:

1. Handle assignments.
2. Resolve the one implementation bound to the active language's selected
  statement declaration.
3. Resolve a user `cmd`.
4. Use the host's unknown-statement policy, such as shell OS-command fallback.

Decision: a selected statement declaration has exactly one implementation.
An inline `implement` suffix and a TypeScript primitive binding are mutually
exclusive. Registering either implementation when the same declaration already
has the other is an error; initialization likewise rejects duplicate bindings.
Language construction resolves that one binding, so ambient custom declarations
cannot override shell built-ins globally and dispatch has no custom-versus-
primitive precedence rule.

## Important Design Decisions

### D1. Handler implementation language

Decision: every statement implementation body and operator implementation body
is parsed and executed in the startup-declared `shell` language. There is no
dedicated handler language and no separate handler parser.

This is consequential because handler capabilities now extend shell itself.
Shell must gain the declared statements, operators, typed-value handling, and
intrinsic notation needed to implement handlers without string interpolation.
Those limitations are addressed by later tasks; they must not be worked around
by introducing a second implementation language or a private parser.

### D2. Association between syntax and implementation

Decision: merge statement syntax declaration and optional language implementation
into one `stmt` declaration. The `implement context body { shell } { ... }`
suffix stores the implementation body at the same time as the statement shape.
The parser declaration and runtime implementation remain separate registry
entries despite their shared source statement. This preserves a parse-only or
primitive `stmt` simply by omitting the suffix.

All core startup statements are expected to omit the suffix and receive
TypeScript primitive bindings. The bootstrap treatment of `stmt` itself remains
special in either design because it defines the common declaration model. The
merged form does not create a materially different bootstrap problem and avoids
a second association statement. Languages resolve each selected declaration to
either its inline shell implementation or a TypeScript primitive binding at
language-construction time.

### D3. Evaluation is determined by statement context

Decision: do not introduce separate eager and deferred expression declaration
forms. Expression syntax is parsed independently of evaluation policy. The
statement receiving an expression determines when it is evaluated.

- `cmd` is greedy. It evaluates every expression-valued invocation argument
  before executing the command body. The body receives runtime values rather
  than expression handles.
- `stmt` is deferred. It parses every expression-valued invocation argument into
  an `ExpressionNode`, binds it as an `ExpressionHandle`, and performs no
  automatic evaluation.
- A statement implementation evaluates a bound expression only through shell's
  declared `evaluate` operator. It may evaluate the handle
  zero, one, or multiple times with contexts of its choosing.
- Shell's declared `syntax` operator inspects parsed expression
  syntax without evaluating it.
- Every custom expression operation, including a call operation, runs only while
  an expression evaluator is evaluating an AST containing that operator.

The runtime must not attach an eager/deferred strategy to an expression
declaration. Evaluation policy belongs to the consuming statement definition
and execution context.

### D4. Block execution result

Decision: execution produces `StatementResult` internally, but no statement,
including `execute`, returns a result to language code in the first
implementation. Shell consumes collected output only at its top-level execution
boundary. Add a TODO comment at the internal result boundary to track exposing a
defined result form in a future feature.

### D5. Operator binding

Decision: operator definitions use direct evaluator bodies. A body is optional:

```text
operators logic_ops {
  infix "++" precedence 7 associativity left parameters context left right body {
    return left + right
  }
}
```

The corresponding declared statement shapes are:

```text
stmt prefix symbol (precedence value) [parameters context operand body { shell }]
stmt infix symbol (precedence value) [associativity direction] [parameters context left right body { shell }]
stmt call [head symbol] open close (precedence value) [parameters context target arguments body { shell }]
```

`prefix` requires `context` plus exactly one operand parameter; `infix` requires
`context` plus exactly two operand parameters; `call` requires `context`, a
target, and one argument-list operand. A `call` with no `head` parses generic
`target ( params )` syntax as a binary operation whose second operand is that
one list. A `call head symbol` restricts that syntax to the declared token.
Parentheses are therefore not a parser fundamental and each language can select
generic calls, selected head calls, neither, or both. The parser configuration
retains the optional head, delimiters, precedence, and operand/list rules; the
runtime companion stores the parsed implementation body and its captured shell
language. Only the matched pairs `()`, `{}`, and `[]` are valid call delimiters;
a `call` declaration must reject every other or mismatched pair.

The expression parser consults the active operator set before consuming a call
delimiter. It must not contain an identifier-specific call loop. A generic call
operator applies after any valid target; a head-restricted call applies only to
its configured token and takes priority over a generic call for that token. If
no matching call operator is selected, the delimiter is not an expression
continuation and the statement argument parser applies ordinary
positional-boundary rules.

An operator declaration without `body` is a primitive. TypeScript establishes
its `PrimitiveOperatorBinding` after the startup script has declared the
operator set. The host binding is keyed by operator set, fixity, and symbol,
must match the declaration's arity, and cannot be supplied, replaced, or
inferred by language code. Creating an executable language must reject any
selected primitive operator that lacks its host binding.

Direct bodies remove the synthetic expression-operation name, the `func` indirection,
and the separate name-to-operator binding. They make operators self-contained,
but duplicate bodies when behavior should be shared and couple declaration of
parser syntax to parsing a handler body. A later reusable handler-body feature
remains separate rather than being an implicit side effect of declaring an
operator.
Both custom and primitive bindings remain runtime state outside
`OperatorSetDefinition`; neither may mutate the global evaluator.

### D6. Startup declarations and host binding

Decision: a startup script is the authoritative source of every built-in
statement and operator signature. Initialization has two
strict phases:

1. Parse and execute the startup script first. It declares the `shell` operator
  set and all built-in `stmt` signatures, then the named `shell`
   language that selects those declarations. `shell` is registered before any
   user declaration can resolve an explicit block language.
2. Have TypeScript bind primitive statement handlers and primitive operator
  evaluators to the declarations selected by `shell`.

For example, the startup script may declare:

```text
operators shell_ops {
  prefix "-" precedence 9
  infix "+" precedence 7 associativity left
}
stmt echo extras...
stmt eval expression
language shell operators shell_ops {
  statements { echo eval }
}
```

The startup script contains declarations, not TypeScript implementation
references. TypeScript binding code uses stable keys: language and statement
name for primitive statements; and operator set, fixity, and symbol for
primitive operators. Binding validates that each key resolves to a compatible
declaration selected by `shell`. Initialization fails for a missing, duplicate,
incompatible, or unbound built-in declaration. A startup declaration with a
language implementation body must not also receive a TypeScript binding.

A minimal TypeScript bootstrap seed is permitted solely to parse the declaration
language required by the startup script, including `stmt`, `operators`, and
`language`. It is not a second user-visible grammar. Once startup
declarations have been executed, the resulting declarations are authoritative;
the seed must not supply executable built-ins or signatures not declared by the
script.

### D7. AST representation

This is consequential because exposing parser objects directly would make the
language API depend on internal TypeScript classes, while storing expression
handles would retain caller environments.

Decision: expose immutable normalized `SyntaxValue` data through
shell's declared `syntax` operator, rather than exposing parser
AST classes or expression handles to language code.

- `SyntaxValue`, records, and lists are deeply immutable from language code.
- A `SyntaxValue` retained by an implementation does not retain the caller's
  evaluation environment.
- The runtime does not define a persistent-storage primitive. An
  implementation that needs to retain data across invocations does so using
  ordinary runtime values reachable through its `context` parameter (see D8);
  the shape, mutability convention, and validation strategy of that data are
  entirely up to the implementation.

Decision: the first `SyntaxValue` version exposes neither offsets nor line and
column locations. It retains only the structural fields above, including the
existing literal `raw` spelling where specified. The conversion and public type
must remain extensible so a later feature can add an optional source span without
changing the meaning of existing fields. A future `source` inspection intrinsic
is deferred until that feature exists.

### D8. Context parameter for stmt and operator handlers

Decision: every `stmt` implementation and every operator implementation
declares exactly one explicit
`context` parameter, distinct from its source-level parts or operand
parameters. Top-level invocation passes `""`; nested handler invocation always
supplies an explicit value. See "Context parameter" for its runtime behavior.

This replaces a previously prescribed storage primitive. Earlier drafts of this
plan specified a dedicated `store`/`using`/`append` mechanism with a declared
schema and atomic validate-before-write semantics. That mechanism is removed:
the runtime does not prescribe how an implementation stores, accumulates, or
mutates data. `context` is the one general-purpose channel for passing
implementation-defined values into a handler invocation; what an implementation
does with that value, including whether it treats it as read-only, an
accumulator, or a handle to an external resource, is entirely up to the
implementation.

### D9. Handler intrinsic notation

This is consequential because shell must invoke `evaluate`,
`syntax`, `present`, `kind`, `field`, `children`, and `record` without
assuming a parser-owned call form, while `shell` deliberately does not select
the parenthesized call operator.

Decision: shell omits the generic `()` call operator and selects an optional
head-restricted `()` call headed by `$`. `$ ( ... )` evaluates one built-in
intrinsic subcommand and yields that subcommand's runtime value to the enclosing
expression. The contents are parsed through ordinary declared
`StatementDefinition` command signatures, not through a private `$` grammar.
The `$` operator receives one opaque parsed subcommand operand and dispatches it
through the shell intrinsic-command registry. Shell source and handler code do
not expose the operand's internal AST or handle representation.

The notation must satisfy all of these requirements:

- shell does not select a generic `()` call operator;
- it can pass an explicit `context` plus one or more operands without relying
  on whitespace splitting outside the expression parser;
- it can accept unevaluated `ExpressionHandle` and `BlockHandle` values where
  required;
- it has an unambiguous representation for record keys and values; and
- `$` resolves through the selected operator set, and its subcommand resolves
  through a declared built-in `StatementDefinition`, rather than a source-prefix
  special case.

#### `$()` intrinsic subcommands

The core parser continues to support a generic call operator: when a language
selects a generic `()` call operator, any valid expression target followed by
`()` is one call expression. Thus a language selecting that operator parses
`foo (1)` as `target ( arguments )`; a language omitting it parses the same
tokens as separate positional expressions where the statement shape permits.
This behavior is determined solely by the active operator set.

Shell's aversion is only to its own generic call syntax. The selected `$` head
call applies only after `$`, so ordinary source remains positional while a
subcommand has an explicit expression boundary:

```text
$ (evaluate context condition)
$ (present context optionalBlock)
$ (field context syntaxValue "name")
```

When shell omits the generic parenthesized call continuation, ordinary source
remains positional:

```text
foo (1)                 # two expressions where the statement shape permits
evaluate (context value) # two expressions unless `evaluate` is also a call head
```

Suggested initial built-in intrinsic subcommands are:

```text
evaluate context expression      # evaluates an ExpressionHandle
syntax context expression        # converts an ExpressionHandle to SyntaxValue
present context optionalValue    # tests optional argument, clause, or block presence
kind context syntaxValue         # returns the syntax kind
field context syntaxValue name   # returns a validated named structural field
children context syntaxValue     # returns ordered child syntax values
record context key value ...     # creates an immutable record from key/value pairs
```

For example, a handler can select a branch without exposing expression handles
to ordinary shell source:

```text
if $ (evaluate context condition) then {
  execute context then
}
```

`execute`, `emit`, and `return` remain ordinary declared statements because
they have statement/control-flow behavior; they are not `$()` value-producing
subcommands in the first implementation. A future `source` subcommand is
deferred with source-span exposure.

The parser impact is moderate rather than fundamental:

1. Extend a call-operator definition with an optional exact head matcher and
  an operand mode. The generic mode has one expression-list operand; the `$`
  head-call mode has one parsed subcommand operand. The latter's command name
  and arguments must be parsed by the ordinary shell statement parser.
2. When parsing an expression continuation, consume matching delimiters after
  every valid target only if a generic call operator is selected. When parsing
  an expression primary, additionally recognize a configured head only when
  it is immediately followed, ignoring whitespace, by that head call's
  configured opening delimiter.
3. If neither applicable operator is selected, do not consume the delimiter.
  Consequently, `foo (1)` stops after `foo`, and the existing uniform
  positional-boundary rule divides it into two statement arguments when the
  declaration permits.
4. Resolve a `$` subcommand against a fixed intrinsic-command registry whose
  entries are declared by the startup script. The registry converts the
  subcommand's opaque parsed arguments into the needed internal handles; it
  must not expose those representations as ordinary shell values.

This is simpler than a generic shell call because it avoids callable runtime
values and keeps argument-handle conversion inside built-in commands. It does
add parser configuration and tests for head matching, nested `$()` calls, and
subcommand dispatch. The expression AST must preserve `$` as the declared
operator symbol rather than treating it as a standalone prefix expression. The
scanner already emits `$` as an operator token, so no scanner change is needed.

Generic and head-restricted calls coexist as separately declared call-operator
forms. Generic calls remain available to every language through an operator-set
entry. Shell selects its `$` head call; a language may omit it. A language
selecting both forms with the same delimiter must give the exact head call
priority for its matching head; all other targets use the generic call. Duplicate
declarations for the same head and delimiter pair are rejected.

### D10. Block language syntax and command restriction

Decision: replace `{} :: languageName` in statement signatures with
`{ languageName }`. Interpret that form only while parsing `stmt` shape
declarations.

Decision: remove custom body-language annotations from `cmd`. Command bodies are
always executable content in the fixed shell command-body language. Programs
that require custom block parsing must use a `stmt` declaration with an inline
implementation suffix.

## Implementation Plan

### 1. Specify runtime values and handler behavior

- [x] 1.1 Decide D1: implementation bodies are always written in the startup-declared `shell` language; do not introduce a dedicated handler language.
- [x] 1.2 Decide D2: merge statement declaration and optional implementation in `stmt`; retain separate parser and runtime registries.
- [x] 1.3 Decide D3: evaluation policy belongs to statement context; `cmd` is greedy and `stmt` is deferred.
- [x] 1.4 Decide D7 source metadata: expose no offsets, line numbers, or columns in the first `SyntaxValue` version; defer optional source spans.
- [ ] 1.5 Define `RuntimeValue`, `ExpressionHandle`, `BlockHandle`, `SyntaxValue`, and internal-only `StatementResult`; add the required future-result TODO comment at the result-discard boundary.
- [ ] 1.6 Define lexical capture, mutation visibility, recursion limits, output collection, and error wrapping.
- [ ] 1.7 Document the exact behavior of every initial handler intrinsic.
- [ ] 1.8 Specify the parse-now/evaluate-later contract and expression-boundary errors as public semantics.
- [ ] 1.9 Define a parser-change checklist based on the canonical common `stmt` model and apply it to every later task.
- [x] 1.10 Decide D6: declare all built-in statement and operator signatures in a startup script before TypeScript binds their handlers.
- [x] 1.11 Decide D8: give every `stmt` and operator handler a single `context` binding instead of a prescribed storage primitive.
- [x] 1.12 Decide D9: shell uses the `$()` head call to execute declared built-in intrinsic subcommands with opaque internal arguments.

### 2. Separate runtime dispatch from shell command dispatch

- [ ] 2.1 Introduce a reusable statement execution context instead of extending parser types with handlers.
- [ ] 2.2 Add a custom statement implementation registry to `ShellEnvironment`.
- [ ] 2.3 Associate implementations with resolved `Language` instances or runtime-language bindings.
- [ ] 2.4 Refactor built-in dispatch behind the same statement-executor boundary and bind it only after startup declarations are available.
- [ ] 2.5 Preserve OS fallback only for languages whose runtime policy explicitly enables it.
- [ ] 2.6 Add tests proving unselected declarations remain parse-only, every declaration selected by an executable language has exactly one language body or TypeScript primitive binding, and duplicate or conflicting bindings fail.

### 3. Declare and parse implementation bodies in shell

- [ ] 3.1 Define shell `StatementDefinition` entries for `if`, `while`, `execute`, `return`, `emit`, and the built-in `$()` intrinsic subcommands.
- [ ] 3.2 Define shell's `$` head-restricted call operator and the typed intrinsic-command registry required by implementation bodies through the same declaration model exposed by `operators` and `stmt`.
- [ ] 3.3 Extend shell with typed-value handling and the declared intrinsics required by implementation bodies; do not introduce a dedicated handler language.
- [ ] 3.4 Extend the bootstrap `stmt` parser to recognize the reserved `implement context body { shell } { ... }` suffix, then parse every suffix body with the generic statement parser and resolved shell language.
- [ ] 3.5 Treat a `stmt` without the inline implementation suffix as a primitive statement; permit it to remain parse-only only while no executable language selects it.
- [ ] 3.6 Store parsed inline implementation nodes and source locations separately from `StatementDefinition`.
- [ ] 3.7 Reject malformed inline implementation suffixes, duplicate `implement` suffixes, reserved-keyword signature collisions, and duplicate statement declarations.
- [ ] 3.8 Add parser and shell tests proving every implementation construct resolves through a language declaration.
- [ ] 3.9 Replace source-prefix dispatch in function and handler bodies with generic `StatementNode` dispatch.
- [ ] 3.10 Parse entries inside `operators` bodies with an operator-definition `Language`, replacing manual token interpretation.
- [ ] 3.11 Audit `cmd`, `func`, `operators`, `language`, and `stmt` raw-tail parsing; remove or migrate `func` to the call-operator model and enrich `StatementDefinition` where necessary.
- [ ] 3.12 Document the minimal bootstrap exceptions needed to parse declaration syntax itself; bootstrap code may construct declarations, but may not introduce a second user-visible grammar.
- [ ] 3.13 Parse `{}` and `{ languageName }` as inherited and explicit block-language metadata only in `stmt` signatures.
- [ ] 3.14 Remove `:: languageName` parsing from statement declarations and reject it with a migration-oriented error.
- [ ] 3.15 Remove custom body-language capture from `cmd`; ensure every command body uses the fixed shell command-body language.
- [ ] 3.16 For every parser file modified in this phase, remove specialized parsing from the touched path or document a bounded temporary exception and follow-up removal task.
- [ ] 3.17 Define and parse `prefix`, `infix`, generic `call`, and optional head-restricted `call head symbol` declarations, including generic expression-list and `$` subcommand operand modes, the supported `()`, `{}`, and `[]` delimiter pairs, head precedence over generic calls, duplicate-head rejection, and body arity validation.
- [ ] 3.18 Remove the hard-coded identifier-call loop from the expression parser and make generic and optional head-restricted call continuation depend exclusively on the selected operator set.
- [ ] 3.19 Make every positional statement-argument parser path use the same selected-call boundary rule: without an applicable generic or head-restricted call operator, `foo (1)` can bind two expression arguments; with an applicable operator, it binds one call expression.
- [ ] 3.20 Keep `language` selection to declared statements and an operator set; do not add a separate expression-form registry.
- [ ] 3.21 Create the authoritative startup declaration script: declare `shell_ops`, every built-in shell statement and operator signature, the `$` head-restricted call operator, and the named `shell` language selecting that complete inventory without a generic call operator.
- [ ] 3.22 Implement the two-phase bootstrap: parse and execute startup declarations with the minimal declaration seed, register `shell`, then discard seed-only definitions.
- [ ] 3.23 Replace TypeScript-constructed built-in statement and operator signatures with declarations produced by the startup script and selected by `shell`.
- [ ] 3.24 Bind TypeScript primitive statement handlers and primitive operator evaluators by validated declaration keys after startup processing.
- [ ] 3.25 Bind TypeScript primitive statements only to matching `stmt` declarations without the implementation suffix, and primitive operators only to matching body-less declarations.
- [ ] 3.26 Reject a missing, duplicate, incompatible, or unbound primitive statement or operator before creating an executable shell language.
- [ ] 3.27 Add tests proving built-ins parse from startup declarations, `shell` is registered before user declarations, bindings occur only afterward, and no TypeScript handler can execute without a declared signature.

### 4. Build the handler runtime

- [ ] 4.1 Use ordinary `StatementNode[]` as the parsed handler-body representation.
- [ ] 4.2 Implement handler-local scopes without converting values to source strings.
- [ ] 4.3 Implement `evaluate`, `syntax`, AST inspection, `present`, `execute`, `emit`, and `return`.
- [ ] 4.4 Reuse or generalize existing `if`, `while`, and `for` evaluation logic.
- [ ] 4.5 Enforce expression-return contracts and ensure statements, including `execute`, expose no result to language code; add the required future-result TODO comment at the internal result boundary.
- [ ] 4.6 Add recursion and loop guards.
- [ ] 4.7 Add source-aware error traces spanning invocation, implementation, and nested block execution.
- [ ] 4.8 Bind the declared `context` parameter for every `stmt` and operator handler invocation: use `""` at the top level and require an explicit value for nested handler invocation (D8).

### 5. Execute custom statements

- [ ] 5.1 Convert parsed `NamedStatementNode` arguments, clauses, qualifiers, and blocks into typed handler bindings.
- [ ] 5.2 Dispatch only through the implementation resolved for the active language.
- [ ] 5.3 Ensure unselected blocks are never parsed or executed beyond the existing opaque nested-block representation.
- [ ] 5.4 Ensure repeated `evaluate` and `execute` calls repeat observable work.
- [ ] 5.5 Verify block-language inheritance and explicit block language annotations.
- [ ] 5.6 Add end-to-end custom `if`, `unless`, `while`, and multi-block examples.
- [ ] 5.7 Verify multi-token expressions are parsed as one argument up to declared clause and block boundaries.

### 6. Add AST reflection and structured declaration data

- [ ] 6.1 Keep offsets, line numbers, and columns out of the initial normalized syntax representation; preserve an extensible optional source-span shape for future work.
- [ ] 6.2 Implement recursive, immutable `ExpressionNode` to `SyntaxValue` conversion.
- [ ] 6.3 Implement `kind`, `field`, and `children` with consistent validation errors; defer `source` until source spans are exposed.
- [ ] 6.4 Add handler-runtime strings, booleans, lists, and records without widening ordinary expression results accidentally.
- [ ] 6.5 Implement explicit `context` parameters for `stmt` and operator handlers, including empty-string top-level invocation and explicit nested values.
- [ ] 6.6 Ensure handler intrinsics pass the context supplied in their syntax to child handler invocations.
- [ ] 6.7 Add end-to-end example handlers that inspect identifiers, literals, operators, calls, and nested expressions through `syntax`, without asserting any particular storage mechanism.
- [ ] 6.8 Verify a retained `SyntaxValue` does not retain caller environments and cannot mutate parser ASTs.

### 7. Integrate expression operators

- [ ] 7.1 Remove `func` as a separate expression implementation mechanism; provide migration or replacement guidance through the call-operator model.
- [ ] 7.2 Extend expression evaluation to resolve custom prefix, infix, and call operators through one runtime dispatch path.
- [ ] 7.3 Ensure every operator implementation runs only when its containing expression is evaluated by its consuming context.
- [ ] 7.4 Require a `RuntimeValue` return on every reachable custom operator implementation path; reject a missing return and preserve consumer-specific type validation.
- [ ] 7.5 Add tests covering greedy command arguments, deferred statement arguments, explicit repeated statement evaluation, and call-operator execution during evaluation.

### 8. Bind custom operators

- [x] 8.1 Decide D5: use direct operator implementation bodies; an omitted body declares a TypeScript-bound primitive.
- [ ] 8.2 Define the selected `prefix`, `infix`, generic `call`, and head-restricted `call` statement forms; require their optional parameter-and-body group to be all-or-nothing; validate prefix arity one, infix arity two, generic target-plus-list arity, `$` subcommand operand handling, and only the `()`, `{}`, and `[]` call-delimiter pairs.
- [ ] 8.3 Store parsed handler bodies and primitive host bindings outside `OperatorSetDefinition` or in a runtime companion object; use the same executable-language validation as primitive statements and reject an unbound primitive.
- [ ] 8.4 Dispatch prefix, infix, and call evaluation through the active operator-set runtime binding.
- [ ] 8.5 Retain current built-in arithmetic behavior through explicit TypeScript primitive bindings.
- [ ] 8.6 Add precedence, associativity, call-list parsing, custom-body evaluation, primitive evaluation, missing primitive binding, and cross-language isolation tests.

### 9. Integrate and document

- [ ] 9.1 Update shell and language documentation with `stmt` and operator implementation syntax, including languages that omit the call operator.
- [ ] 9.2 Document the evaluation-context difference among `cmd`, `stmt`, and expression operators.
- [ ] 9.3 Add examples showing greedy command evaluation, selective statement evaluation, and AST-backed declaration data.
- [ ] 9.4 Run type checking, the complete test suite, and browser build verification.

## Required Test Cases

- A custom `if` executes exactly one branch.
- `choose 3 == 4 then { ... } else { ... }` binds one parsed condition expression, not three raw arguments.
- A custom `unless` reverses branch selection without evaluating both blocks.
- A custom loop re-evaluates its condition for every iteration.
- An omitted optional block can be guarded with `present`; executing an absent block is rejected.
- A block with an explicit language executes in that language.
- The startup script registers `shell` as the default shell-execution language
  and selects every built-in statement and operator used by shell execution.
- `shell` omits the parenthesized call operator, while another language can
  select it and parse `target ( params )` as a binary operator with one list
  operand.
- With no selected `()` call operator, a two-positional-argument statement
  parses `foo (1)` as identifier `foo` followed by grouped expression `1`.
- With a selected `()` call operator, the same statement shape parses `foo (1)`
  as one call-operator expression and reports the absent second argument.
- A shell operator set that omits generic `()` calls but selects `call head "$" "(" ")"` parses `$ (evaluate context value)` as a call expression and still parses `foo (1)` as two positional expressions where permitted.
- A language selecting both a generic `()` call and a `$` head call gives the `$` head call priority for `$ (value)` and uses the generic call for `foo (1)`.
- `$ (evaluate context expression)`, `$ (syntax context expression)`, `$ (present context optionalValue)`, `$ (kind context syntaxValue)`, `$ (field context syntaxValue "name")`, `$ (children context syntaxValue)`, and `$ (record context key value ...)` resolve through declared built-in intrinsic subcommand signatures without exposing their internal argument handles.
- A one-positional-argument statement without a selected `()` call operator
  rejects `foo (1)` because `(1)` is an extra argument.
- A call declaration accepts only `()`, `{}`, or `[]` as its matched delimiter
  pair and rejects mismatched or other brackets.
- A post-startup declaration using `body { shell }` resolves `shell` and runs
  only that block in the shell language.
- A merged `stmt` declaration stores its signature and inline shell
  implementation, while a `stmt` without the suffix remains eligible for a
  TypeScript primitive binding or parse-only use.
- `implement` is rejected as a statement-signature part name and a declaration
  with more than one implementation suffix is rejected.
- An unselected `stmt` without the implementation suffix remains parseable but not executable.
- An executable language rejects a selected `stmt` without the implementation suffix when it
  lacks a matching TypeScript primitive statement binding.
- A statement declaration rejects an inline implementation when it already has a
  TypeScript primitive binding, and rejects a primitive binding when it already
  has an inline implementation.
- `cmd` evaluates every expression-valued argument before its implementation body runs.
- `stmt` evaluates no expression-valued argument before its implementation body runs.
- A custom statement can skip evaluation of an argument.
- A custom statement can evaluate one argument more than once.
- A custom operator, including a call operator, runs only when its containing
  expression is evaluated.
- Every reachable custom operator-handler path returns a `RuntimeValue`; a
  missing return is rejected, while consumers retain responsibility for any
  numeric or other type requirement.
- `execute` exposes no `StatementResult`, output, or value to shell code, while
  the runtime retains the result internally and marks the future exposure point
  with a TODO comment.
- The selected `syntax` operator does not evaluate its expression-handle operand.
- A retained `SyntaxValue` preserves nested operator structure, including a call
  operator's target and argument-list operands.
- A retained `SyntaxValue` is immutable and does not retain the caller's evaluation environment.
- Invalid syntax-field access produces a descriptive error; `SyntaxValue` exposes no offset, line, or column in the first implementation.
- A `stmt` or operator handler declares and receives a single `context` parameter distinct from its source-level parts or operand parameters.
- A top-level statement or operator invocation passes `""` as its handler's `context` parameter without changing source syntax.
- A nested handler operator or `execute` invocation passes its child's context explicitly; it does not inherit the caller's context.
- Built-in and custom handler statements produce the same parsed node shape for the same declared signature.
- Every built-in statement and operator obtains its signature from the startup
  script before its TypeScript handler is bound.
- Startup fails if a TypeScript primitive statement or primitive-operator
  handler has no matching declaration, if a selected `stmt` without the implementation suffix
  has no matching TypeScript handler, or if a selected body-less operator has no
  matching TypeScript evaluator.
- Handler control flow and operator-definition entries execute without source-prefix or manual token dispatch.
- Every statement parser path changed by this work is driven by a common `stmt` declaration; no changed path introduces statement-specific grammar.
- A syntax capability missing from `stmt` is implemented in the shared declaration model before it is consumed by a built-in or custom statement.
- `stmt action body { custom_lang }` records `custom_lang` as block metadata.
- `{ custom_lang }` in an invocation remains ordinary block content rather than an annotation.
- `cmd` rejects both legacy `:: languageName` annotations and any attempt to treat body content as a language annotation.
- The same statement or operator name can have different implementations in isolated languages.
- Runtime errors report invocation and implementation source locations.

## Non-Goals For The First Implementation

- arbitrary host objects exposed to language code
- asynchronous handlers
- continuations, resumable blocks, or macros that rewrite ASTs
- mutation of parser ASTs
- parsing or inspecting block bodies as statement ASTs
- implicit overriding of built-in shell statements
- returning general-purpose list, record, or syntax values from ordinary expressions
- serialization or persistence of captured handler environments
- custom `cmd` body languages
