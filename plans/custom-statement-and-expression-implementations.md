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

Custom statements differ from `cmd` in one essential way: their implementation
receives parsed values without automatically evaluating expressions or executing
blocks. The implementation decides whether, when, and how often each expression
is evaluated or block is executed. Expressions retain the operator-set identity
under which they were parsed, and blocks retain their inherited or explicitly
selected language.

This must support control-flow behavior such as the following pseudocode. The
angle-bracketed operations stand for value-producing shell commands executed in
a nested command position; they are placeholders rather than source syntax:

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

`stmt` declaration names are globally unique. A declaration, including its one
inline or primitive implementation, comes into scope only through a `Language`
that explicitly selects it. Selecting the same declaration in multiple
languages shares that implementation. The first implementation does not support
per-language statement overrides or alternative same-name declarations. Outside
a selecting language, the declaration has no effect; the language's ordinary
unknown-statement policy may still handle the source.

All built-in statement and operator signatures must be declared by a startup
script before TypeScript binds host handlers. Syntax selection is independent
from implementation availability. A statement declared without the `implement`
suffix is unresolved: it may later receive either one TypeScript binding or one
matching language implementation. Repeating the same canonical `stmt` signature
with an `implement` suffix completes an unresolved statement rather than
redeclaring its syntax. For operators, omitting `body` continues to declare a
primitive eligible for a TypeScript binding as specified by D5. A selected
declaration may remain parse-only while it has no binding. Missing bindings are
reported only when runtime dispatch attempts to execute the statement or
evaluate the operator. Language implementations and TypeScript primitive
bindings remain mutually exclusive.
Runtime code must dispatch a parsed node; it must not recognize constructs with
string prefix checks, manually split their arguments, or maintain a private
grammar.

Literals, identifiers, and grouping remain parser fundamentals. Every other
expression form is an operator. In particular, the familiar `target(arguments)`
form is a call operator whose right side is zero or one expression AST; it is not
a parser-owned function-call node. Multiple logical arguments are represented
inside that one AST by the selected binary comma operator. A language may omit
the call or comma operator or give either a different meaning. Every selected
operator must have a declared syntax definition; it needs a runtime binding only
when evaluation reaches it.

Call selection determines statement-expression boundaries. If the active
operator set selects a matching call operator, `foo (1)` is one expression: a
call operator with `foo` as its target and `1` as its argument AST. If it does
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

A `stmt` without its `implement` suffix is an unresolved syntax declaration. A
language may select it while unresolved. It can later be completed exactly once
by either:

- a TypeScript primitive statement binding; or
- another `stmt` declaration with the same canonical signature and an inline
  `implement` suffix.

The completing language declaration must reproduce the existing signature
exactly, including parts, qualifiers, expression operator selection, and block
language metadata. A mismatch is a conflicting redeclaration. Repeating an
unresolved declaration without completing it, completing it more than once, or
combining a TypeScript binding with an inline implementation is an error. Until
completion, the statement remains parseable and produces an unimplemented-
statement error only if execution reaches it. A previously undeclared `stmt`
with an `implement` suffix still declares and implements the statement
atomically.

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
    # target and arguments are unevaluated handles
    # arguments is "" for an empty call or one expression AST otherwise
  }
}
```

The exact declaration shape for call operators is shared by all languages that
select one. A non-empty call has two operands: `target` and one `arguments`
expression AST. A call with empty delimiters has no argument AST and binds the
handler's `arguments` parameter to `""`. For `f(1, 2)`, the one argument AST is
the binary comma expression `1, 2`; for `f(1)`, it is the expression `1`.
`f(1,)` is rejected because the binary comma operator has no right operand, and
`f(1 1)` is rejected because whitespace is not a call-argument separator. The
implementation receives unevaluated handles and explicitly evaluates any handle
it needs. The runtime supplies the empty string as `context` for a top-level
operator evaluation. A `call` declaration must use exactly one
supported matched delimiter pair: `(` and `)`, `{` and `}`, or `[` and `]`.
The opening delimiter is the call operator's canonical symbol and the closing
delimiter is derived from its matched pair. Other opening or closing tokens, and
mismatched pairs, are rejected. Whitespace between the target and opening
delimiter does not prevent a selected call operator from applying.

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
runtime commands are ordinary built-in statements selected by shell. The same
declarations, parsing rules, and implementations apply when they are invoked at
the top level or nested inside `$()`. Their shell syntax and argument handling
are defined by D9.

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
    return $ (evaluate context left) + $ (evaluate context right)
  }
}
```

An omitted body declares a primitive operator eligible for a matching TypeScript
evaluator binding. A language may select it while it is unbound; language code
cannot attach or replace the binding, and evaluation fails only if it reaches
the unbound operator:

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
one `arguments` expression operand. Every operand parameter is deferred: prefix
and infix operands are `ExpressionNode` values, while a call receives a target
`ExpressionNode` and either one argument `ExpressionNode` or `""` for an empty
call. A comma-separated argument sequence remains one expression node rooted at
binary comma operators.
The implementation must invoke `evaluate` explicitly for every operand it wants
to evaluate, which permits short-circuiting, skipping, and repeated evaluation.
Quoting symbols such as `"&&"` lets the generic expression argument parser
represent the symbol without treating a bare operator as an incomplete
expression.

## Runtime Semantics

### Parsing precedes evaluation

Every argument declared with `valueKind: "expression"` is parsed into one
`ExpressionNode` while the statement invocation is parsed. In a `stmt` context,
the implementation receives that node without evaluation or an environment
wrapper. In a `cmd` context, the parsed AST is instead evaluated greedily before
the command implementation runs.

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
5. invoke the handler with unevaluated expression and block nodes.

Only shell's `evaluate` operator computes the comparison. The
declared `execute context` statement runs only the selected block.

Expression boundaries continue to be determined by the statement declaration:

- declared clause keywords delimit a preceding expression;
- a following required positional value forces the parser to reserve input for
  that value;
- a declared block begins only after expression parsing has stopped; if the
  parser already has a left value and the active operator set selects the
  opening delimiter as a call operator, that delimiter continues the expression
  instead, and the statement syntax must provide another boundary for its block;
- the active operator set determines which token sequence is a valid expression.

If the parser cannot unambiguously divide adjacent positional expressions, the
declaration or invocation syntax must provide a boundary; the handler must never
receive an arbitrary list of whitespace-separated tokens and reconstruct the
expression itself.

### Deferred values

Custom implementations receive the existing parsed node values rather than
interpolated strings:

- expression arguments: `ExpressionNode`
- blocks: `NestedBlockNode`
- repeated arguments or blocks: opaque, ordered, readonly repeated bindings
- qualifiers: booleans
- raw arguments: strings

Every absent optional single argument, clause, or block is bound to the empty
string, `""`. A repeated part always binds an opaque repeated binding and uses an
empty binding when it has no occurrences. This binding is not a general-purpose
list value and cannot be constructed, returned by an operator, or passed as
`context`. `present` does not evaluate nodes: it returns false for the
absent-value empty string and for an empty repeated binding, and true for a node
or any other supplied value.

`ExpressionNode` and `NestedBlockNode` do not contain or capture an execution
environment. The implementation retains a reference to the exact environment in
which it was declared, and `evaluate` and `execute` use that environment.
Each expression node retains immutable internal metadata identifying the
operator set under which it was parsed so deferred evaluation uses the same
operator meanings without an environment-carrying wrapper. This metadata is not
an additional public AST node kind or an inspectable structural field.
`NestedBlockNode` also carries the inherited or explicitly selected language
metadata needed when it is executed.

Parser nodes bound to language code are opaque handler values. Their structure is
exposed only through the immutable `SyntaxValue` returned by `syntax`; language
code cannot mutate either the parser node or the normalized syntax value.

### Context parameter

Every `stmt` implementation body and every operator implementation body —
including a call operator implementation — declares exactly one required `context`
parameter. It is an ordinary named handler parameter, declared before the
handler body and distinct from every source-level statement part or expression
parameter.

- `context` holds a single scalar `RuntimeValue` chosen by the caller. Structured
  context is represented as a string, conventionally JSON. The runtime imposes
  no JSON schema, parsing, validation, or built-in mutation operation.
- A statement or operator invoked directly from ordinary source receives
  the empty string, `""`, as its `context` parameter. Ordinary source syntax
  does not change or expose this runtime-supplied argument.
- A handler invoking a child handler must supply the child's `context`
  explicitly. It may pass its own `context` unchanged or pass any other runtime
  value. Context is never inherited implicitly.
- The initial handler runtime commands make this explicit: `$ (evaluate context
  expression)` evaluates an expression node with an explicit context, and
  `execute context block` executes a block. Other handler runtime commands
  likewise receive their context explicitly whether invoked at the top level or
  inside `$()`.
- The runtime never inspects, validates, or interprets a `context` value. It
  flows through handler execution exactly like any other `RuntimeValue`.

This single explicit parameter is the only mechanism this plan provides for
carrying implementation-defined data between handler invocations. There is no
separate prescribed storage, registry, collection, or mutation primitive. The
first implementation guarantees only that a handler can pass its scalar context
unchanged or construct and pass a replacement scalar value to a nested
invocation. It does not guarantee persistent accumulation across independent
top-level invocations. Implementations encode structured state as JSON text and
may delegate composition to an external utility such as `jq` through a
host-provided command/value bridge; defining such a bridge is outside this plan.

### AST inspection

Statement implementations may inspect an expression argument without evaluating
it. The `syntax` command converts the opaque `ExpressionNode` binding into an
immutable, normalized `SyntaxValue`. This conversion does not evaluate the
expression and the result contains no environment reference.

With no selector arguments, `syntax` returns that complete `SyntaxValue`.
Optionally, an `at` clause followed by one or more zero-based operand indexes
selects a nested component and returns its original opaque `ExpressionNode`
binding instead:

```text
$ (syntax context expression)
$ (syntax context expression at 0)
$ (syntax context expression at 0 1)
```

The path is interpreted one index at a time against the `operands` arrays in the
normalized value that the no-selector form would return. Each index must be a
non-negative decimal integer literal. An `at` clause without an index, an
out-of-range index, or a path that attempts to descend through a non-operator
value is a descriptive runtime error. The selected expression node retains its
operator-set metadata and may be passed to `evaluate` or back to `syntax`.
This opaque expression-node binding is the functional handle for that
subcomponent. Selecting it does not evaluate it or attach an environment.

```ts
type SyntaxValue =
  | { kind: "identifier"; name: string }
  | { kind: "number"; value: number; raw: string }
  | { kind: "string"; value: string; raw: string }
  | {
      kind: "operator";
      fixity: "prefix" | "infix" | "call";
      symbol: string;
      operands: readonly SyntaxValue[];
    };
```

For a call, `symbol` is its opening delimiter. A non-empty call parser AST has
the target plus one argument expression, and multiple logical arguments form a
binary comma-expression AST. The current normalized call representation
flattens that top-level comma spine as `[target, ...arguments]` in source order.
An empty call has only the target operand. A configured exact head such as `$`
is normalized as the identifier-like target value with that name.

The first handler runtime exposes inspection through ordinary host-backed shell
statements. `syntax` accepts the opaque expression node and either returns the
complete `SyntaxValue` or a selected evaluable expression-node binding; `kind`,
`field`, and `children` inspect a `SyntaxValue`. `children` returns an opaque,
readonly repeated binding of child `SyntaxValue` values rather than a
general-purpose list. These statements may run directly at the top level or as
the nested statement evaluated by `$()`.

A `SyntaxValue`, including a child returned by `field` or `children`, remains
detached inspection data and cannot be passed to `evaluate`. Only the optional
`syntax ... at ...` result recovers an evaluable original expression-node
binding. Invalid field access must produce a descriptive runtime error. A later
pattern matching feature may make AST traversal more convenient, but is not
required initially.

An implementation can inspect an unevaluated type expression without resolving
it: it applies `syntax` to the `name` or `type` node and then uses `kind`,
`field`, or `children` on the result. If the implementation must retain or pass
the inspected structure as context, it encodes that structure as JSON text.
Neither `String` nor a language-defined list operator is resolved merely by
inspecting the node.

AST inspection is initially limited to expression arguments. Inspecting a block
as a parsed statement tree would require choosing its language and parsing it,
which is a separate macro/reflection feature. A `NestedBlockNode` remains
executable and opaque in this plan.

### Handler runtime commands

Shell must provide a small set of ordinary runtime-owned statements used by
implementation bodies:

- `context` — the single value passed to this handler invocation (see "Context parameter")
- `evaluate` — a command that evaluates an expression node using the
  explicitly supplied context for any child handler invocation
- `syntax` — a command that converts an expression node to an immutable
  `SyntaxValue` without evaluating it, or returns the original nested
  expression-node binding selected by an optional zero-based `at` operand path
- `kind`, `field`, and `children` — commands that inspect a
  `SyntaxValue` and receive an explicit context argument
- `execute context block` — execute a required block with the explicitly
  supplied context; it exposes no result to shell code in the first implementation
- `present` — a command that tests whether an optional argument, clause, or block was supplied
- `return expression` — evaluate and return a value from an operator implementation
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

`evaluate`, `present`, `syntax`, `kind`, `field`, and `children` must be
declared as host-backed statements in shell's startup declarations. They use the
same statement definitions and dispatch whether executed at the top level or
inside `$()`. `$` is the host-backed head-restricted call operator that parses
and executes one ordinary nested shell statement.

`present` receives an already-bound handler value without evaluating an
`ExpressionNode`. It returns false for the empty-string default of an absent
optional single part and for an empty repeated binding; otherwise it returns
true.

These are ordinary shell statements with runtime-owned implementations and typed
arguments. Their specialized value types do not create a separate command
namespace. In particular, `execute` must consume a `NestedBlockNode`; it must
not reconstruct source through string interpolation.

### Statement results

The runtime uses this internal execution result:

```ts
type StatementResult = {
  output?: string[];
  value?: HandlerExpressionValue;
};
```

Shell source execution consumes `output`. At the top level, an unused `value` is
discarded after normal output handling. Inside `$()`, the nested statement's
`value` is required and becomes the value of the enclosing `$` expression;
output continues through the normal surrounding output collection path.
`execute` does not return its block's `output`, `value`, or any other result to
the command that invoked it in the first implementation.

The implementation must add a TODO comment next to the internal
`StatementResult` production or `execute` result-discard boundary. The comment
must state that a future feature should expose a defined form of block execution
result to language code; it must not imply that an external return exists now.

### Expression results

Custom operator handlers must return a `RuntimeValue` on the path executed for
each invocation. `return expression` is legal only while executing an operator
implementation. It evaluates its expression once using the current handler
context, then unwinds nested lexical control flow in that implementation to the
nearest operator-handler boundary.

An explicit `execute` establishes a separate execution boundary. A `return`
encountered in the caller-supplied block run by `execute` is an error and never
escapes into the statement or operator handler that invoked `execute`. Likewise,
using `return` in a statement implementation is an error. The runtime does not
perform static control-flow analysis: if the executed operator-handler path
reaches the end without `return`, that invocation fails with a missing-return
error.

The returned value may be any scalar `RuntimeValue`: number, string, or boolean.
JSON text is an ordinary string. AST nodes, `SyntaxValue`, nested blocks, and
repeated bindings are handler-only values and cannot be returned from a custom
operator. Existing expression consumers may still impose narrower type
requirements; for example, an arithmetic primitive rejects a non-numeric
operand.

### Scope and lifetime

- A custom statement or operator implementation retains a reference to the exact
  execution environment in which its implementation was declared. It does not
  copy, snapshot, wrap, or compose that environment.
- Invocation arguments and blocks contain syntax and language metadata only.
  They do not capture the caller's environment.
- The implementation body runs with full access to its declaration environment.
  Its declared parameters are temporary invocation bindings, not a child
  execution environment.
- `evaluate` evaluates its `ExpressionNode` in the implementation's declaration
  environment, using the node's retained operator-set identity, and passes the
  supplied `context` to any custom operator handler it invokes.
- `execute` executes its `NestedBlockNode` in the implementation's declaration
  environment. Invocation and `execute` do not automatically create a child
  scope. A statement such as `for` may deliberately establish temporary local
  bindings or another scope for a body it executes, but that behavior belongs
  to that statement's implementation.
- `execute` uses the block's declared language when present; otherwise it inherits the invocation language.
- Shell source execution starts in the startup-declared `shell` language.
- `shell` is always available for explicit selection in a post-startup `stmt`
  signature; `{ shell }` selects that language only for the annotated block.
- Registry references are resolved when the implementation is declared.
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
  environment: ShellEnvironment;
}

type OperatorBindingKey =
  | {
      operatorSetName: string;
      fixity: "prefix" | "infix";
      symbol: string;
    }
  | {
      operatorSetName: string;
      fixity: "call";
      openingDelimiter: "(" | "{" | "[";
      exactHead?: string;
    };

interface OperatorHandlerImplementation {
  key: OperatorBindingKey;
  contextParameter: "context";
  parameters: string[];
  body: StatementNode[];
  shellLanguage: Language;
  environment: ShellEnvironment;
}

interface PrimitiveOperatorBinding {
  key: OperatorBindingKey;
  evaluate: HostOperatorEvaluator;
}

interface PrimitiveStatementBinding {
  statementName: string;
  execute: HostStatementExecutor;
}

type StatementBindingState =
  | { kind: "unresolved" }
  | { kind: "language"; implementation: StatementImplementation }
  | { kind: "primitive"; binding: PrimitiveStatementBinding };

type RuntimeValue = number | string | boolean;

type SingleHandlerBinding =
  | RuntimeValue
  | ExpressionNode
  | SyntaxValue
  | NestedBlockNode;

type RepeatedHandlerBinding = readonly SingleHandlerBinding[];

type HandlerBinding =
  | SingleHandlerBinding
  | RepeatedHandlerBinding;

type HandlerExpressionValue = SingleHandlerBinding;
```

`RepeatedHandlerBinding` exists only to bind a repeated part declared by
statement syntax. It is not a `RuntimeValue`: handler code cannot construct one,
store one in `context`, or return one from an operator. Likewise,
`ExpressionNode`, `SyntaxValue`, and `NestedBlockNode` are handler bindings
rather than ordinary expression results. The handler expression evaluator uses
`HandlerExpressionValue` internally so host-backed commands can pass syntax values
between `syntax`, `kind`, `field`, and `children`. Custom operator `return`,
ordinary expression consumers, and `context` accept only scalar `RuntimeValue`
values.

`Language` should continue to describe parsing and statement scope. Runtime
behavior belongs to the globally named declaration's implementation entry in an
execution environment rather than parser-owned `StatementDefinition`. A
language selects that declaration but does not create or override its
implementation. The runtime registry stores the declaration and its
`StatementBindingState` separately. Completing a declaration changes only the
binding state after structural equality with the existing canonical
`StatementDefinition` has been validated.

Dispatch becomes:

1. Handle assignments.
2. Resolve the one implementation bound to the active language's selected
  statement declaration.
3. If the selected declaration has no implementation or primitive binding,
   report an unimplemented-statement error.
4. Resolve a user `cmd`.
5. Use the host's unknown-statement policy, such as shell OS-command fallback.

Decision: a selected statement declaration has zero or one implementation. A
bodyless declaration begins unresolved. It may be completed exactly once by a
matching declaration with an inline `implement` suffix or by a TypeScript
primitive binding. Those completion forms are mutually exclusive. Registering a
second implementation, repeating an unresolved declaration without completing
it, or completing it with a mismatched signature is an error. Runtime dispatch
resolves the binding when the statement is used and reports an unimplemented-
statement error if it is still unresolved. Language construction does not
require every selected declaration to be implemented. Globally unique
declarations and explicit language selection prevent ambient custom declarations
from overriding shell built-ins, and dispatch has no custom-versus-primitive
precedence rule.

## Important Design Decisions

### D1. Handler implementation language

Decision: every statement implementation body and operator implementation body
is parsed and executed in the startup-declared `shell` language. There is no
dedicated handler language and no separate handler parser.

This is consequential because handler capabilities now extend shell itself.
Shell must gain the declared statements, operators, typed-value handling, and
nested command notation needed to implement handlers without string interpolation.
Those limitations are addressed by later tasks; they must not be worked around
by introducing a second implementation language or a private parser.

### D2. Association between syntax and implementation

Decision: keep statement syntax and an optional language implementation on the
one `stmt` declaration surface. The `implement context body { shell } { ... }`
suffix stores the implementation body together with a complete statement shape.
The parser declaration and runtime implementation remain separate registry
entries despite their shared declaration surface.

Omitting the suffix creates an unresolved declaration rather than permanently
classifying the statement as a TypeScript primitive. A later `stmt` with the
same canonical shape and an `implement` suffix completes it. This is the only
language-level late-completion form; it is not a second association statement
because the completing declaration must repeat and validate the entire shape. A
new `stmt` that already has the suffix still declares and implements atomically.

Only the startup statements actually implemented by TypeScript receive primitive
bindings. Other startup signatures, including `expr` and `raw`, may stay
unresolved until matching nonprimitive declarations are processed. Each globally
named declaration owns at most one inline shell implementation or TypeScript
primitive binding. A language brings that declaration and implementation into
scope by selecting it; selecting it in multiple languages does not clone or
override the implementation. Language construction permits unresolved
statements so syntax can be selected independently of runtime availability.

### D3. Evaluation is determined by statement context

Decision: do not introduce separate eager and deferred expression declaration
forms. Expression syntax is parsed independently of evaluation policy. The
statement receiving an expression determines when it is evaluated.

- `cmd` is greedy. It evaluates every expression-valued invocation argument
  before executing the command body. The body receives runtime values rather
  than expression nodes.
- `stmt` is deferred. It parses every expression-valued invocation argument into
  an `ExpressionNode`, binds that node directly, and performs no automatic
  evaluation.
- A statement implementation evaluates a bound expression only through shell's
  declared `evaluate` operator. It may evaluate the node
  zero, one, or multiple times with contexts of its choosing.
- Shell's declared `syntax` operator converts a parsed expression node to
  detached inspection data without evaluating it. `kind`, `field`, and
  `children` inspect that data.
- Every custom expression operation, including a call operation, runs only while
  an expression evaluator is evaluating an AST containing that operator.
- A custom operator receives unevaluated operand nodes and decides which
  operands to pass to `evaluate`, in what order, and how many times.

The runtime must not attach an eager/deferred strategy to an expression
declaration. Evaluation policy belongs to the consuming statement definition
and execution context.

### D4. Block execution result

Decision: ordinary statement execution produces `StatementResult` internally.
At the top level, shell consumes output and discards an unused value. Inside
`$()`, the same statement dispatcher runs and `$()` consumes the required value.
This value capture applies to one nested statement; it does not expose the
aggregate result of an executed block.

`execute` therefore continues to discard the nested block's result in the first
implementation. Add a TODO comment at that result-discard boundary to track
exposing a defined block-result form in a future feature.

### D5. Operator binding

Decision: operator definitions use direct evaluator bodies. A body is optional:

```text
operators logic_ops {
  infix "++" precedence 7 associativity left parameters context left right body {
    return $ (evaluate context left) + $ (evaluate context right)
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
target, and one possibly absent argument-expression operand. A `call` with no
`head` parses generic `target ( expression )` syntax as a binary operation whose
second operand is that one expression. Empty delimiters omit the second operand.
Multiple logical arguments require the selected binary comma operator and remain
one comma-expression AST. A `call head symbol` restricts that syntax to the
declared token.
Parenthesized calls therefore are not a parser fundamental, and each language
can select generic calls, selected head calls, neither, or both. Grouping remains
a parser fundamental. The parser configuration
retains the optional head, delimiters, precedence, and operand/list rules; the
runtime companion stores the parsed implementation body, its resolved shell
language, and a reference to its declaration environment. Only the matched
pairs `()`, `{}`, and `[]` are valid call delimiters;
a `call` declaration must reject every other or mismatched pair. The opening
delimiter is the call operator symbol used for parsing and runtime lookup; the
closing delimiter is implied by the supported matched pair. An optional exact
head is added to the lookup key only to distinguish a head-restricted call from
a generic call using the same opening delimiter.

Custom operator bodies receive unevaluated operand nodes. Prefix and infix
parameters are `ExpressionNode` values. Call parameters are a target
`ExpressionNode` and either one argument `ExpressionNode` or `""` when the call
is empty. The body chooses evaluation order and invokes `evaluate` explicitly,
including for ordinary arithmetic implementations. Evaluation uses the
operator implementation's declaration environment. Host primitive evaluators
own their evaluation policy through the same evaluator context rather than
relying on the parser to evaluate operands.

The expression parser consults the active operator set before consuming a call
delimiter. It must not contain an identifier-specific call loop. Parser state
determines the delimiter's role: while expecting a value, `(` starts grouping;
after a left value has been parsed, a selected opening delimiter is a postfix
call operator. For example, the `(` in `2 + (` begins the right-hand grouped
value, while the `(` in `$ (` continues the `$` value as a call. A generic call
operator applies after any valid target; a head-restricted call applies only to
its configured value and takes priority over a generic call for that value. If
no matching call operator is selected, the delimiter is not an expression
continuation and the statement argument parser applies ordinary
positional-boundary rules.

An operator declaration without `body` is a primitive. TypeScript may establish
its `PrimitiveOperatorBinding` after the startup script has declared the
operator set. Prefix and infix host bindings are keyed by operator set, fixity,
and symbol. Call bindings are keyed by operator set, opening delimiter, and
optional exact head. A supplied binding must match the declaration's arity and
cannot be replaced or inferred by language code. Selecting an unbound primitive
is allowed; evaluating an expression that reaches it reports an unimplemented-
operator error.

Direct bodies remove the synthetic expression-operation name, the `func` indirection,
and the separate name-to-operator binding. They make operators self-contained,
but duplicate bodies when behavior should be shared and couple declaration of
parser syntax to parsing a handler body. A later reusable handler-body feature
remains separate rather than being an implicit side effect of declaring an
operator.
Both custom and primitive bindings remain runtime state outside
`OperatorSetDefinition`; neither may mutate the global evaluator.

### D6. Startup declarations and host binding

Decision: startup declarations are the authoritative source of every built-in
statement and operator signature. Initialization and normal processing have
three ordered phases:

1. Read and register the startup signatures. Statement signatures without an
   inline implementation remain unresolved. This phase declares the `shell`
   operator set, the complete initial `stmt` inventory, and the named `shell`
   language that selects those declarations.
2. Bind the subset of unresolved statement declarations and bodyless operator
   declarations implemented as TypeScript primitives. After this phase, the
   primitive shell surface required to process normal declarations is
   executable.
3. Process nonprimitive declarations and user source in order. A matching
   `stmt ... implement ...` declaration can complete an unresolved statement,
   including `expr` or `raw`, before later source uses it. Using a selected
   declaration before it is completed reports an unimplemented-statement error.

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
references. TypeScript binding code uses stable keys: globally unique statement
name for primitive statements; operator set, fixity, and symbol for prefix and
infix operators; and operator set, opening delimiter, and optional exact head
for call operators. Registering a binding validates that its key resolves to a
compatible unresolved declaration selected by `shell`. Initialization fails for
a binding whose declaration is missing, duplicate, incompatible, or already
implemented by a language body. An unresolved statement or unbound operator may
remain after primitive binding and fails only if runtime execution reaches it
before a permitted completion occurs.

A minimal TypeScript bootstrap seed is permitted solely to parse the declaration
language required by the startup script, including `stmt`, `operators`, and
`language`. It is not a second user-visible grammar. Once startup
declarations have been executed, the resulting declarations are authoritative;
the seed must not supply executable built-ins or signatures not declared by the
script.

### D7. AST representation

This is consequential because exposing parser objects directly would make the
language API depend on internal TypeScript classes.

Decision: expression arguments remain opaque parser-node bindings. The declared
`syntax` converts one to immutable normalized `SyntaxValue` data;
`kind`, `field`, and `children` inspect that normalized value. An optional
zero-based `at` operand path makes `syntax` return the selected original
expression-node binding when an implementation needs an evaluable subcomponent.

The AST inspection API is not subject to the goal of avoiding new language data
structures. Implementations need access to the parser's existing structural
data, and `syntax` is the preferred public API for exposing it. With no `at`
selector, `syntax` must provide the complete normalized structure for every
supported `ExpressionNode` variant, including every semantically relevant field
and child relationship. The only initially omitted information is source
location metadata, as explicitly decided below.

- `SyntaxValue` is a handler-only capability, not a general-purpose record or
  list value.
- Parser nodes and `SyntaxValue` values cannot be mutated through the handler
  API.
- Neither parser nodes nor `SyntaxValue` values contain an environment
  reference. An implementation retains its declaration environment separately
  and uses it only when evaluating or executing a supplied parser node.
- AST nodes, syntax values, nested blocks, and repeated bindings are
  handler-only capabilities, not general-purpose runtime data structures.
- The runtime does not define a persistent-storage or mutation primitive.
  Scalar context values can be passed or replaced for nested calls, but
  persistence across independent top-level invocations is not guaranteed.

Decision: the first `SyntaxValue` version exposes neither offsets nor line and
column locations. It retains the existing literal `raw` spelling where
specified. The public type must remain extensible so a later feature can add an
optional source span without changing existing fields. A future `source`
inspection command is deferred until that feature exists.

### D8. Context parameter for stmt and operator handlers

Decision: every `stmt` implementation and every operator implementation
declares exactly one explicit
`context` parameter, distinct from its source-level parts or operand
parameters. Top-level invocation passes `""`; nested handler invocation always
supplies an explicit value. See "Context parameter" for its runtime behavior.

This replaces a previously prescribed storage primitive. Earlier drafts of this
plan specified a dedicated `store`/`using`/`append` mechanism with a declared
schema and atomic validate-before-write semantics. That mechanism is removed.
`context` is the channel for passing an implementation-defined scalar value into
a handler invocation. Structured state uses JSON text. The core runtime supports
passing the value or replacing it for a nested invocation, but supplies no
mutation or persistence facility. External composition, for example through
`jq`, depends on a host-provided command/value bridge and is outside this plan.

### D9. Nested command notation

This is consequential because shell commands such as `evaluate`, `present`,
`syntax`, `kind`, `field`, and `children` must be usable in an expression
without creating a second command namespace or grammar.

Decision: shell omits the generic `()` call operator and selects an optional
head-restricted `()` call headed by `$`. `$ ( ... )` parses and executes exactly
one ordinary shell statement in a nested, value-consuming position. The nested
statement uses the same `shell` language, `StatementDefinition`, implementation,
and normal dispatch path as the identical statement at the top level. There is
no `$()`-specific statement set, separate command registry, or private command
grammar.

When used inside `$()`, the nested statement must produce an internal
`StatementResult.value`; `$()` yields that typed value to the enclosing
expression. A statement that completes without a value produces a descriptive
no-value error in this position. At the top level, the same value-producing
statement executes normally and its unused value is discarded after ordinary
output handling. Most values are scalar `RuntimeValue` values; `syntax`,
`field`, and `children` may instead produce handler-only syntax bindings, and
`syntax at` may produce an expression-node binding.

The notation must satisfy all of these requirements:

- shell does not select a generic `()` call operator;
- every statement selected by `shell` can be parsed and dispatched both at the
  top level and inside `$()`;
- it can pass an explicit `context` plus one or more operands without relying
  on whitespace splitting outside the expression parser;
- it can accept unevaluated `ExpressionNode` and `NestedBlockNode` values where
  required;
- `$` resolves through the selected operator set, and its nested statement
  resolves through the ordinary shell statement dispatcher rather than a
  source-prefix special case.

#### `$()` nested statements

The core parser continues to support a generic call operator: when a language
selects a generic `()` call operator, any valid expression target followed by
`()` is one call expression. Thus a language selecting that operator parses
`foo (1)` as `target ( arguments )`; a language omitting it parses the same
tokens as separate positional expressions where the statement shape permits.
This behavior is determined solely by the active operator set.

Shell's aversion is only to its own generic call syntax. The selected `$` head
call applies only after `$`, so ordinary source remains positional while a
nested statement has an explicit expression boundary:

```text
$ (evaluate context condition)
$ (present context optionalBlock)
$ (field context $ (syntax context node) "name")
$ (evaluate context $ (syntax context arguments at 0 1))
```

When shell omits the generic parenthesized call continuation, ordinary source
remains positional:

```text
foo (1)                 # two expressions where the statement shape permits
evaluate (context value) # two expressions unless `evaluate` is also a call head
```

Suggested initial built-in handler runtime commands are:

```text
evaluate context expression                 # evaluates an ExpressionNode
syntax context expression [at indexes...]   # returns SyntaxValue or a selected ExpressionNode
present context optionalValue    # tests optional argument, clause, or block presence
kind context syntaxValue         # returns the normalized syntax kind
field context syntaxValue name   # returns a validated structural field
children context syntaxValue     # returns readonly child syntax bindings
```

For example, a handler can select a branch while keeping the AST node as an
opaque handler binding:

```text
if $ (evaluate context condition) then {
  execute context then
}
```

`execute`, `emit`, and `return` use the same ordinary statement model.
`execute` and `emit` do not produce a value, so placing either directly inside
`$()` produces the ordinary no-value error after it executes. `return` retains
its operator-handler control-flow restrictions. A future `source` command is
deferred with source-span exposure.

The parser impact is moderate rather than fundamental:

1. Extend a call-operator definition with an optional exact head matcher and
  an operand mode. The generic mode has zero or one argument-expression operand;
  multiple logical arguments form one binary comma-expression AST. The `$`
  head-call mode has one parsed nested-statement operand. Its command name and
  arguments are parsed by the ordinary shell statement parser. The opening
  delimiter is the operator symbol; its matching close is implied.
2. When parsing an expression continuation after a left value, consume an
  opening delimiter only if a matching generic or exact-head call operator is
  selected. When the parser is expecting a primary, treat a configured exact
  head such as `$` as an identifier-like value only when a
  one-significant-token lookahead finds
  that head call's opening delimiter. Whitespace does not affect that lookahead.
  The normal continuation step then consumes the opening delimiter as the call
  operator. In all other value positions, an opening `(` retains its grouping
  role.
3. If neither applicable operator is selected, do not consume the delimiter.
  Consequently, `foo (1)` stops after `foo`, and the existing uniform
  positional-boundary rule divides it into two statement arguments when the
  declaration permits.
4. Execute the parsed `$()` statement through the ordinary shell statement
  dispatcher. The dispatcher binds its typed arguments in the same way at the
  top level and in nested execution; `$()` only changes how the resulting
  `StatementResult.value` is consumed.

This is simpler than a generic shell call because it avoids callable runtime
values and keeps handler-binding conversion inside built-in commands. It does
add parser configuration and tests for head matching, nested `$()` calls, and
nested-statement value capture. The expression AST must preserve `$` as the call target
value and the opening delimiter as the call operator symbol rather than treating
`$` as a standalone prefix expression. The scanner already emits `$` as an
operator token, so no scanner change is needed.

Generic and head-restricted calls coexist as separately declared call-operator
forms. Generic calls remain available to every language through an operator-set
entry. Shell selects its `$` head call; a language may omit it. A language
selecting both forms with the same opening delimiter gives the exact head call
priority for its matching value; all other targets use the generic call. The
opening delimiter alone identifies the generic call. The pair of exact head and
opening delimiter identifies a head-restricted call. Duplicate declarations for
either key are rejected.

### D10. Block language syntax and command restriction

Decision: replace `{} :: languageName` in statement signatures with
`{ languageName }`. Interpret that form only while parsing `stmt` shape
declarations.

Decision: remove custom body-language annotations from `cmd`. Command bodies are
always executable content in the fixed shell command-body language. Programs
that require custom block parsing must use a `stmt` declaration with an inline
implementation suffix.

### D11. Structured data scope

Decision: do not add general-purpose list or record runtime values in this
feature. `RuntimeValue` is limited to numbers, strings, and booleans. AST nodes,
`SyntaxValue`, nested blocks, and readonly repeated bindings are narrowly typed
handler capabilities rather than ordinary values and cannot be returned by
custom operators or stored in `context`.

Implementations represent structured state as JSON text. The core runtime treats
that JSON as an ordinary string and does not parse, validate, query, or mutate
it. An implementation may use an external utility such as `jq` when a
host-provided command/value bridge is available. General-purpose data structures
remain a separate roadmap feature.

## Implementation Plan

### 1. Specify runtime values and handler behavior

- [x] 1.1 Decide D1: implementation bodies are always written in the startup-declared `shell` language; do not introduce a dedicated handler language.
- [x] 1.2 Decide D2: use one complete `stmt` declaration surface for syntax and optional implementation; permit an exact matching declaration with `implement` to complete an unresolved signature, while retaining separate parser and runtime registries.
- [x] 1.3 Decide D3: evaluation policy belongs to statement context; `cmd` is greedy and `stmt` is deferred.
- [x] 1.4 Decide D7 AST exposure and source metadata: convert opaque expression-node bindings to immutable normalized `SyntaxValue` data, expose no offsets, line numbers, or columns initially, and defer optional source spans.
- [ ] 1.5 Define scalar `RuntimeValue`, handler-only `HandlerBinding` and `HandlerExpressionValue`, opaque `ExpressionNode` and `NestedBlockNode` bindings, immutable `SyntaxValue`, immutable internal expression operator-set metadata, and internal-only `StatementResult`; specify top-level value discard and `$()` value consumption, and add the required future block-result TODO comment at the `execute` discard boundary.
- [ ] 1.6 Use the decided environment and scope model: implementations retain and directly use their declaration environment; nodes capture no environment; parameter bindings do not compose an environment; invocation and block execution add no automatic child scope. Complete the remaining recursion-limit, output-collection, and error-wrapping specifications.
- [ ] 1.7 Document the exact behavior of every initial handler runtime command, including its top-level and `$()` result handling.
- [ ] 1.8 Specify the parse-now/evaluate-later contract and expression-boundary errors as public semantics.
- [ ] 1.9 Define a parser-change checklist based on the canonical common `stmt` model and apply it to every later task.
- [x] 1.10 Decide D6: register startup signatures, bind the TypeScript primitive subset, then process nonprimitive declarations and user source in order.
- [x] 1.11 Decide D8: give every `stmt` and operator handler a single `context` binding instead of a prescribed storage primitive.
- [x] 1.12 Decide D9: shell uses the `$()` head call to execute one ordinary shell statement through the same parser and dispatcher used at the top level, then consumes its value.
- [x] 1.13 Decide the generic call argument grammar: delimiters contain zero or one expression AST; multiple logical arguments use the selected binary comma operator, trailing commas and whitespace-separated values are rejected, and call `SyntaxValue` currently flattens the top-level comma spine after the target.
- [x] 1.14 Decide statement scope: `stmt` names are globally unique and each declaration owns one implementation shared by every language that selects it; selection scopes availability, and per-language overrides are not supported.
- [x] 1.15 Decide `return` semantics: it is legal only in operator implementations, unwinds nested lexical control flow to the nearest operator-handler boundary, cannot cross an explicit `execute` boundary, and produces a runtime missing-return error when the executed operator path falls through.
- [x] 1.16 Decide D11 structured data scope: `RuntimeValue` remains scalar, JSON strings are the structured interchange format, AST/syntax/block/repeated bindings remain handler-only, and general-purpose list and record values are deferred to the project's data-structure roadmap.
- [x] 1.17 Decide nested expression access: `syntax` returns the complete detached `SyntaxValue` by default, while an optional zero-based `at` operand path returns the corresponding original evaluable expression-node binding.

### 2. Separate runtime dispatch from shell command dispatch

- [ ] 2.1 Introduce a reusable statement execution context instead of extending parser types with handlers.
- [ ] 2.2 Add a custom statement implementation registry to `ShellEnvironment`, including unresolved, TypeScript-bound, and language-bound declaration states.
- [ ] 2.3 Associate each implementation with its globally named statement declaration; languages scope availability by selecting that declaration and cannot override its implementation.
- [ ] 2.4 Refactor built-in dispatch behind the same statement-executor boundary and bind it only after startup declarations are available.
- [ ] 2.5 Preserve OS fallback only for languages whose runtime policy explicitly enables it.
- [ ] 2.6 Add tests proving selected and unselected declarations may remain unresolved, matching language declarations or TypeScript bindings complete them exactly once, use before completion fails at runtime, and duplicate or conflicting completions fail.

### 3. Declare and parse implementation bodies in shell

- [ ] 3.1 Define shell `StatementDefinition` entries for `if`, `while`, `execute`, `return`, `emit`, and the handler runtime commands, including `syntax context expression [at indexes...]`; select those same statements for top-level and `$()` execution.
- [ ] 3.2 Define shell's `$` head-restricted call operator so its operand is parsed as one ordinary shell statement and dispatched through the normal statement executor; do not add a separate nested-command registry.
- [ ] 3.3 Extend shell with typed-value handling and the declared handler runtime commands required by implementation bodies; do not introduce a dedicated handler language.
- [ ] 3.4 Extend the bootstrap `stmt` parser to recognize the reserved `implement context body { shell } { ... }` suffix, then parse every suffix body with the generic statement parser and resolved shell language.
- [ ] 3.5 Treat a `stmt` without the inline implementation suffix as unresolved; permit any language to select it, allow one matching TypeScript or language completion, and report an error only if execution reaches it first.
- [ ] 3.6 Store parsed inline implementation nodes and source locations separately from `StatementDefinition`.
- [ ] 3.7 Reject malformed inline implementation suffixes, duplicate `implement` suffixes, reserved-keyword signature collisions, repeated unresolved declarations, signature-mismatched completions, and second or conflicting implementations; accept one exact matching implementation completion.
- [ ] 3.8 Add parser and shell tests proving every implementation construct resolves through a language declaration.
- [ ] 3.9 Replace source-prefix dispatch in function and handler bodies with generic `StatementNode` dispatch.
- [ ] 3.10 Parse entries inside `operators` bodies with an operator-definition `Language`, replacing manual token interpretation.
- [ ] 3.11 Audit `cmd`, `func`, `operators`, `language`, and `stmt` raw-tail parsing; remove or migrate `func` to the call-operator model and enrich `StatementDefinition` where necessary.
- [ ] 3.12 Document the minimal bootstrap exceptions needed to parse declaration syntax itself; bootstrap code may construct declarations, but may not introduce a second user-visible grammar.
- [ ] 3.13 Parse `{}` and `{ languageName }` as inherited and explicit block-language metadata only in `stmt` signatures.
- [ ] 3.14 Remove `:: languageName` parsing from statement declarations and reject it with a migration-oriented error.
- [ ] 3.15 Remove custom body-language capture from `cmd`; ensure every command body uses the fixed shell command-body language.
- [ ] 3.16 For every parser file modified in this phase, remove specialized parsing from the touched path or document a bounded temporary exception and follow-up removal task.
- [ ] 3.17 Define and parse `prefix`, `infix`, generic `call`, and optional head-restricted `call head symbol` declarations, including the generic zero-or-one expression operand, comma-expression argument representation, the `$` nested-statement operand mode, opening-delimiter operator identity, the supported `()`, `{}`, and `[]` matched pairs, head precedence over generic calls, duplicate-key rejection, and body arity validation.
- [ ] 3.18 Remove the hard-coded identifier-call loop from the expression parser; make call continuation depend exclusively on parser state, the selected opening delimiter, and one-significant-token lookahead for an exact head such as `$`.
- [ ] 3.19 Make every positional statement-argument parser path use the same selected-call boundary rule: without an applicable generic or head-restricted call operator, `foo (1)` can bind two expression arguments; with an applicable operator, it binds one call expression.
- [ ] 3.20 Keep `language` selection to declared statements and an operator set; do not add a separate expression-form registry.
- [ ] 3.21 Create the authoritative startup declaration script: declare `shell_ops`, every built-in shell statement and operator signature, the `$` head-restricted call operator, and the named `shell` language selecting that complete inventory without a generic call operator.
- [ ] 3.22 Implement the three-phase bootstrap: register startup signatures and `shell` with the minimal declaration seed, bind TypeScript primitives, then process nonprimitive declarations and user source in order; discard seed-only definitions once the primitive declaration surface is executable.
- [ ] 3.23 Replace TypeScript-constructed built-in statement and operator signatures with declarations produced by the startup script and selected by `shell`.
- [ ] 3.24 Bind TypeScript primitive statement handlers and primitive operator evaluators by validated declaration keys after signature registration and before nonprimitive or user source processing.
- [ ] 3.25 Bind TypeScript primitive statements only to matching unresolved `stmt` declarations, and primitive operators only to matching body-less declarations.
- [ ] 3.26 Reject duplicate, incompatible, declaration-less, or already language-completed primitive bindings during registration; permit unresolved statements and unbound operators and report them only when used before completion.
- [ ] 3.27 Add tests proving startup signatures parse first, `shell` is registered before implementation declarations, TypeScript bindings occur before nonprimitive and user source, and no TypeScript handler can execute without a declared signature.

### 4. Build the handler runtime

- [ ] 4.1 Use ordinary `StatementNode[]` as the parsed handler-body representation.
- [ ] 4.2 Implement temporary handler invocation bindings over the declaration environment without composing a child environment or converting values to source strings.
- [ ] 4.3 Implement `evaluate`, `syntax`, AST inspection, `present`, `execute`, `emit`, and operator-only `return`, including control-flow unwinding and the explicit `execute` boundary.
- [ ] 4.4 Reuse or generalize existing `if`, `while`, and `for` evaluation logic.
- [ ] 4.5 Enforce operator return contracts at runtime, reject `return` in statement implementations or executed invocation blocks, implement top-level statement-value discard and `$()` value consumption, keep `execute` from exposing its block result, and add the required future block-result TODO comment at that discard boundary.
- [ ] 4.6 Add recursion and loop guards.
- [ ] 4.7 Add source-aware error traces spanning invocation, implementation, and nested block execution.
- [ ] 4.8 Bind the declared `context` parameter for every `stmt` and operator handler invocation: use `""` at the top level and require an explicit value for nested handler invocation (D8).

### 5. Execute custom statements

- [ ] 5.1 Convert parsed `NamedStatementNode` arguments, clauses, qualifiers, and blocks into typed handler bindings.
- [ ] 5.2 Resolve the active language's selected declaration, then dispatch only through the one implementation owned by that declaration.
- [ ] 5.3 Ensure unselected blocks are never parsed or executed beyond the existing opaque nested-block representation.
- [ ] 5.4 Ensure repeated `evaluate` and `execute` calls repeat observable work.
- [ ] 5.5 Verify block-language inheritance and explicit block language annotations.
- [ ] 5.6 Add end-to-end custom `if`, `unless`, `while`, and multi-block examples.
- [ ] 5.7 Verify multi-token expressions are parsed as one argument up to declared clause and block boundaries.

### 6. Add scoped AST reflection

- [ ] 6.1 Keep offsets, line numbers, and columns out of the initial `SyntaxValue`; preserve an extensible optional source-span shape for future work.
- [ ] 6.2 Implement complete recursive, immutable `ExpressionNode` to `SyntaxValue` conversion for every node variant, semantically relevant field, and child relationship, plus the corresponding normalized-operand traversal used by `syntax ... at ...`; do not store parser-node references in the returned `SyntaxValue`.
- [ ] 6.3 Implement `syntax` operand-path selection plus `kind`, `field`, and `children` over `SyntaxValue` with consistent validation errors; keep ordinary child syntax detached and non-evaluable, require literal non-negative path indexes, and defer `source` until source spans are exposed.
- [ ] 6.4 Keep runtime values scalar and verify JSON strings pass unchanged through `context`, `evaluate`, `return`, and `emit`; do not add list or record construction, inspection, or mutation.
- [ ] 6.5 Implement explicit `context` parameters for `stmt` and operator handlers, including empty-string top-level invocation and explicit nested values.
- [ ] 6.6 Ensure handler runtime commands pass the context supplied in their syntax to child handler invocations.
- [ ] 6.7 Add end-to-end example handlers that inspect every expression-node variant and its semantically relevant fields, including identifiers, literals, operators, calls, comma trees, and nested expressions through `syntax`, without asserting any particular storage mechanism.
- [ ] 6.8 Verify retained `SyntaxValue` data contains no environment reference and cannot mutate parser ASTs.

### 7. Integrate expression operators

- [ ] 7.1 Remove `func` as a separate expression implementation mechanism; provide migration or replacement guidance through the call-operator model.
- [ ] 7.2 Extend expression evaluation to resolve custom prefix, infix, and call operators through one runtime dispatch path.
- [ ] 7.3 Ensure every operator implementation runs only when its containing expression is evaluated by its consuming context.
- [ ] 7.4 Require the executed path of every custom operator invocation to return a scalar `RuntimeValue`; reject handler-only AST, syntax, block, or repeated bindings and runtime fallthrough without static reachability analysis, and preserve consumer-specific type validation.
- [ ] 7.5 Add tests covering greedy command arguments, deferred statement arguments, explicit repeated statement evaluation, and call-operator execution during evaluation.

### 8. Bind custom operators

- [x] 8.1 Decide D5: use direct operator implementation bodies; an omitted body declares a primitive eligible for a TypeScript binding.
- [ ] 8.2 Define the selected `prefix`, `infix`, generic `call`, and head-restricted `call` statement forms; require their optional parameter-and-body group to be all-or-nothing; validate prefix arity one, infix arity two, generic target-plus-optional-expression arity, `$` nested-statement operand handling, and only the `()`, `{}`, and `[]` call-delimiter pairs.
- [ ] 8.3 Store parsed handler bodies and primitive host bindings outside `OperatorSetDefinition` or in a runtime companion object; permit unbound selected primitives and reject them only when evaluation reaches them.
- [ ] 8.4 Dispatch prefix, infix, and call evaluation through the active operator-set runtime binding.
- [ ] 8.5 Retain current built-in arithmetic behavior through explicit TypeScript primitive bindings.
- [ ] 8.6 Add precedence, associativity, empty and comma-expression call parsing, custom-body evaluation, primitive evaluation, runtime-only missing-binding errors, and cross-language isolation tests.

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
- An omitted optional block binds `""`, can be guarded with `present`, and is
  rejected by `execute`; `present` does not evaluate a supplied handle.
- A block with an explicit language executes in that language.
- The startup script registers `shell` as the default shell-execution language
  and selects every built-in statement and operator used by shell execution.
- `shell` omits the parenthesized call operator, while another language can
  select it and parse `target ( expression )` as a call operator with one
  argument-expression AST.
- `f()` is valid and binds the call handler's `arguments` parameter to `""`.
- With a selected binary comma operator, `f(1, 2)` has one argument-expression
  AST rooted at comma; `f(1,)` is rejected for a missing right operand and
  `f(1 1)` is rejected because whitespace does not separate call arguments.
- Matched delimiters recursively contain nested calls: `f(g(1, 2), 3)` has an
  outer comma-expression argument whose left operand is the complete nested
  `g(1, 2)` call.
- With no selected `()` call operator, a two-positional-argument statement
  parses `foo (1)` as identifier `foo` followed by grouped expression `1`.
- With a selected `()` call operator, the same statement shape parses `foo (1)`
  as one call-operator expression and reports the absent second argument.
- A shell operator set that omits generic `()` calls but selects `call head "$" "(" ")"` parses `$ (evaluate context value)` as a call expression and still parses `foo (1)` as two positional expressions where permitted.
- A language selecting both a generic `()` call and a `$` head call gives the `$` head call priority for `$ (value)` and uses the generic call for `foo (1)`.
- While expecting a value, `(` groups an expression, including after an infix
  operator as in `2 + (1)`; after a parsed left value, a selected `(` is the call
  operator.
- A configured `$` head is accepted as an identifier-like target value only
  when one-significant-token lookahead finds its selected opening delimiter;
  whitespace before the delimiter does not change the result.
- `evaluate`, `syntax`, `present`, `kind`, `field`, and `children` resolve through
  the same declared shell statements at the top level and inside `$()`.
- `$ (evaluate context expression)`, `$ (syntax context expression [at
  indexes...])`, and other nested forms parse one ordinary shell statement and
  dispatch it through the normal shell statement executor.
- Any statement selected by `shell` is accepted syntactically inside `$()`; if
  its execution produces no `StatementResult.value`, `$()` reports a
  descriptive no-value error.
- A one-positional-argument statement without a selected `()` call operator
  rejects `foo (1)` because `(1)` is an extra argument.
- A call declaration accepts only `()`, `{}`, or `[]` as its matched delimiter
  pair and rejects mismatched or other brackets.
- A post-startup declaration using `body { shell }` resolves `shell` and runs
  only that block in the shell language.
- A new `stmt` declaration with an inline implementation registers its signature
  and implementation atomically.
- A `stmt` without the suffix remains unresolved and can be completed exactly
  once by either a TypeScript primitive binding or an exact matching `stmt`
  declaration with an inline implementation.
- A language completion with a different signature, a repeated unresolved
  declaration, or a second TypeScript or language completion is rejected.
- `implement` is rejected as a statement-signature part name and a declaration
  with more than one implementation suffix is rejected.
- An unselected unresolved `stmt` remains registered but has no effect outside a
  language that selects it.
- An executable language may select an unresolved `stmt`; invoking it before a
  TypeScript or language completion reports an unimplemented-statement error.
- A statement declaration rejects an inline implementation when it already has a
  TypeScript primitive binding, and rejects a primitive binding when it already
  has an inline implementation.
- `cmd` evaluates every expression-valued argument before its implementation body runs.
- `stmt` evaluates no expression-valued argument before its implementation body runs.
- A custom statement can skip evaluation of an argument.
- A custom statement can evaluate one argument more than once.
- A custom implementation sees live changes made to the same environment after
  its declaration; declaration does not snapshot or clone environment state.
- Retaining or passing an expression or block node does not retain another
  environment.
- Invoking a custom implementation and calling `execute` add no automatic child
  environment or body scope. A control-flow implementation that deliberately
  establishes temporary body bindings is responsible for restoring them.
- A custom operator, including a call operator, runs only when its containing
  expression is evaluated.
- Custom prefix, infix, and call handlers receive unevaluated operand nodes;
  operands run only when the handler explicitly passes them to `evaluate`, in
  the order and number of times chosen by the handler.
- An operator `return` unwinds nested lexical `if`, `while`, and `for` control
  flow to the nearest operator-handler boundary.
- `return` in a statement implementation or a caller block run by explicit
  `execute` is rejected and cannot escape through the `execute` boundary.
- A custom operator invocation whose executed path falls through reports a
  runtime missing-return error without requiring static reachability analysis;
  consumers retain responsibility for numeric or other type requirements.
- A custom operator may return a number, string, or boolean. Returning an AST
  node, `SyntaxValue`, nested block, or repeated binding is rejected.
- Structured handler context is passed as JSON text. The runtime treats it as an
  ordinary string and does not add JSON parsing or collection operations.
- `execute` exposes no `StatementResult`, output, or value to shell code, while
  the runtime retains the result internally and marks the future exposure point
  with a TODO comment.
- `syntax` does not evaluate its expression-node operand.
- `syntax context expression` returns the complete detached `SyntaxValue`.
- The default `syntax` result exposes every semantically relevant field and
  child relationship of every supported expression-node variant; source
  locations are the only intentionally deferred AST metadata.
- For a left-associated comma AST for `f(1, 2, 3)`, `syntax context arguments
  at 0 1` returns the original node for `2`; passing that result to `evaluate`
  evaluates only `2`.
- `syntax ... at ...` rejects a missing index, negative or non-integer index,
  out-of-range index, and descent through a non-operator value without
  evaluating the source expression.
- A retained `SyntaxValue` is immutable, contains no environment reference, and
  cannot mutate parser ASTs.
- Invalid syntax-field access produces a descriptive error; `SyntaxValue`
  exposes no offset, line, or column in the first implementation.
- A `stmt` or operator handler declares and receives a single `context` parameter distinct from its source-level parts or operand parameters.
- A top-level statement or operator invocation passes `""` as its handler's `context` parameter without changing source syntax.
- A nested handler operator or `execute` invocation passes its child's context explicitly; it does not inherit the caller's context.
- Built-in and custom handler statements produce the same parsed node shape for the same declared signature.
- Every built-in statement and operator obtains its signature from the startup
  script before its TypeScript handler is bound.
- Startup fails if a supplied TypeScript primitive statement or
  primitive-operator handler has no matching declaration or conflicts with a
  language implementation. An unresolved statement or unbound operator does not
  fail startup; it reports an error only if execution or evaluation reaches it
  before a permitted completion.
- Startup registers signatures first, binds the TypeScript primitive subset
  second, and only then processes matching nonprimitive completions such as
  `expr` and `raw` followed by user source.
- Handler control flow and operator-definition entries execute without source-prefix or manual token dispatch.
- Every statement parser path changed by this work is driven by a common `stmt` declaration; no changed path introduces statement-specific grammar.
- A syntax capability missing from `stmt` is implemented in the shared declaration model before it is consumed by a built-in or custom statement.
- `stmt action body { custom_lang }` records `custom_lang` as block metadata.
- `{ custom_lang }` in an invocation remains ordinary block content rather than an annotation.
- `cmd` rejects both legacy `:: languageName` annotations and any attempt to treat body content as a language annotation.
- A statement declaration is unavailable in a language that does not select it;
  languages selecting the same declaration share its one implementation and
  cannot override it.
- Runtime errors report invocation and implementation source locations.

## Non-Goals For The First Implementation

- arbitrary host objects exposed to language code
- asynchronous handlers
- continuations, resumable blocks, or macros that rewrite ASTs
- mutation of parser ASTs
- parsing or inspecting block bodies as statement ASTs
- implicit overriding of built-in shell statements
- general-purpose list or record values and collection operations
- built-in JSON parsing, validation, querying, or mutation
- serialization or persistence of declaration environments
- custom `cmd` body languages
