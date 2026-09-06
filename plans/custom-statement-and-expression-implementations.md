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

This must support control-flow behavior such as the following shell handler:

```text
language control operators control_ops {
stmt choose condition (then {}) [else {}] implement context body { shell } {
  conditionResult = $ (evaluate context condition)
  if $ (value-kind context conditionResult) != "execution-result" then {
    return $ (result --error "evaluate returned an unexpected value")
  }

  conditionKind = $ (result-kind context conditionResult)
  if conditionKind == "error" then {
    return $ (result --error $ (result-error context conditionResult))
  }
  if conditionKind != "expression" then {
    return $ (result --error "evaluate returned an unexpected result")
  }

  conditionValue = $ (result-value context conditionResult)
  if $ (value-kind context conditionValue) != "boolean" then {
    return $ (result --error "condition did not evaluate to a boolean")
  }

  selectedResult = $ (result --complete)
  if conditionValue then {
    selectedResult = $ (execute context then)
  } else {
    if $ (present context else) then {
      selectedResult = $ (execute context else)
    }
  }

  if $ (value-kind context selectedResult) != "execution-result" then {
    return $ (result --error "execute returned an unexpected value")
  }

  selectedKind = $ (result-kind context selectedResult)
  if selectedKind == "complete" then {
    return $ (result --complete)
  }
  if selectedKind == "return" then {
    return $ (result --return $ (result-value context selectedResult))
  }
  if selectedKind == "break" then {
    return $ (result --break)
  }
  if selectedKind == "continue" then {
    return $ (result --continue)
  }
  if selectedKind == "error" then {
    return $ (result --error $ (result-error context selectedResult))
  }
  return $ (result --error "execute returned an unexpected result")
}
}
```

Only the selected block is executed. The implementation narrows every opaque
result before using it and explicitly reconstructs the selected block's outcome.
A loop can use the same pattern while evaluating its condition and executing its
body repeatedly.

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
- a `Language` owns the statement declarations and selects the operators that
  are legal in a body;
- built-in and custom implementations differ only in where their runtime handler
  comes from, not in how their syntax is parsed.

Statement names are unique only within their owning language. A declaration's
syntax, language implementation or TypeScript primitive binding, and declaration
scope all belong to that language entry. Two languages may declare the same
local statement name with different syntax and implementations; neither entry
overrides or completes the other. Runtime and primitive-binding keys therefore
use the qualified pair `(languageName, statementName)` rather than a globally
unique statement name. If the source name matches no declaration owned by the
active language, that language's reserved `__fallback__` statement is considered
instead.

All built-in statement and operator signatures must be declared by a startup
script before TypeScript binds host handlers. Syntax selection is independent
from implementation availability. A language-scoped statement declared without
an implementation is unresolved: it may later receive either one TypeScript
binding or one matching language implementation in that same language. For
operators, omitting `body` continues to declare a primitive eligible for a
TypeScript binding as specified by D5. A declaration may remain parse-only while
it has no binding. Missing bindings are reported only when runtime dispatch
attempts to execute the statement or evaluate the operator. Language
implementations and TypeScript primitive bindings remain mutually exclusive for
one qualified declaration.
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

### Declaration surface notation

The `stmt` and `operators` declaration examples throughout this document use a
shared, informal notation for describing a statement's parts. This notation
only appears in this planning document to describe shapes; it is not new
source syntax a shell program writes, and it is not a second user-visible
grammar. Each symbol maps directly onto `StatementDefinition`'s existing parts,
qualifiers, and option model:

- `name` — a required positional part. `condition` in
  `stmt choose condition (then {}) [else {}]` is a required expression-valued
  argument named `condition`.
- `(name ...)` — a required clause: a keyword-introduced group that must
  appear exactly once, containing the parts listed inside it. `(then {})` is a
  required `then` clause containing one block part.
- `[name ...]` — an optional clause, argument, or block; everything inside
  `[]` is entirely absent or entirely present together. `[else {}]` is an
  optional `else` clause; `[associativity direction]` is an optional
  associativity qualifier plus its direction value.
- `name...` — a repeated (zero-or-more) part of that kind, bound to an opaque
  repeated binding. `extras...` in `stmt echo extras...` is repeated raw
  arguments.
- `--name` — a flag-only qualifier option, bound to a boolean. `[--count]` in
  `stmt child [--count] context [ordinal] syntaxValue` is an optional
  flag-only qualifier.
- `--name value` — a value-bearing option, distinct from a flag-only
  qualifier. `--error message` in the `result` constructor's options is a
  value-bearing option whose value narrows to a string.
- `head` (in `stmt call [head symbol] open close ...`) — an optional
  exact-match token that restricts a generic declaration (here, a call
  operator) to one specific spelling; omitting it declares the generic,
  unrestricted form.
- `{}` and `{ languageName }` — a block part; empty braces mean an inherited
  or default language and a bare identifier names an explicit block language,
  as described under "Block language declarations and `cmd`" below. This is
  the one place `{}` denotes a shape rather than literal program text.
- A bare identifier immediately after `stmt`, `cmd`, `prefix`, `infix`, or
  `call` (for example `choose`, `echo`, or the operator's `symbol`) is the
  declaration's name or symbol, not a declared part.

Each of these maps onto exactly one `StatementDefinition` concept: a required
or optional positional part, a required or optional named clause, a repeated
part, a flag-only or value-bearing qualifier option, or a block part with
optional language metadata. The declaration surface still needs the bounded
bootstrap exception described elsewhere in this document to parse `operators`,
`language`, and `stmt`/`cmd` entries; this legend documents the shape that
bootstrap parser must recognize, so it can be reviewed before task 3.4
implements it.

### Language-scoped statement declaration with optional implementation

`stmt` declares statement syntax and, optionally, its implementation inside one
owning language. The `implement context body { shell }` suffix is metadata of the
`stmt` declaration, not part of the declared statement's invocation shape.
Declarations are placed directly inside `language`:

```text
language control operators control_ops {
  stmt choose condition (then {}) [else {}] implement context body { shell } { ... }
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

An implementation can still execute an invocation block in its declared
language. The signature records that language independently of the shell
implementation body:

```text
language rendering operators rendering_ops {
  stmt render model body { template_lang }
}
```

An inline implementation of `render` captures `$ (execute context body)` and
uses the same narrowing and explicit result-reconstruction pattern shown by the
canonical `choose` example; it must not discard the returned outcome.

A language-scoped `stmt` without its `implement` suffix is an unresolved syntax
declaration. It can later be completed exactly once within that same language by
either:

- a TypeScript primitive statement binding; or
- another `stmt` declaration with the same canonical signature and an inline
  `implement` suffix.

The completion must identify the same owning language and reproduce the existing
signature exactly, including parts, qualifiers, expression operator selection,
and block language metadata. A mismatch is a conflicting redeclaration in that
language. The same local name in another language is unrelated. Repeating an
unresolved declaration without completing it, completing it more than once, or
combining a TypeScript binding with an inline implementation is an error. Until
completion, the statement remains parseable and produces an unimplemented-
statement error only if execution reaches it. A previously undeclared local
`stmt` with an `implement` suffix still declares and implements that language's
statement atomically.

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

Block languages are declared only inside `stmt` signatures owned by a language:

```text
language rendering operators rendering_ops {
  stmt render model body {}                    # inherit the active/default language
  stmt render-template model body { template_lang }
  stmt choose condition (then { shell }) [else { shell }]
}
```

In this declaration context, an empty shape block means language inheritance and
a single identifier means an explicit language. This interpretation is never
applied to an invocation or implementation block, where all brace contents are
program text.

`cmd` is a command-form statement declaration in its owning language. All
commands use the shared built-in command handler, which greedily evaluates their
declared expression arguments and executes the stored body in shell's fixed
command-body language:

```text
language application operators application_ops {
  cmd greet name { echo hello $name }
}
```

The old form is rejected:

```text
language application operators application_ops {
  cmd greet name { echo hello $name } :: template_lang
}
```

This is an intentional breaking change. It removes the only content-bearing
declaration context in which `{ languageName }` would be ambiguous. A `cmd`
creates a normal local statement entry in the language namespace, so exact-name
dispatch finds it before `__fallback__`. Custom body-language behavior belongs
to a `stmt` declaration with its optional implementation suffix.

### Built-in shell language

The primary language for command execution is named `shell`. It is declared by
the startup script, is the default language for shell source execution, and is
registered in the language registry before normal user source is processed.
`shell` is not a TypeScript-only alias: it is an ordinary named `Language` with
a startup-declared statement set and operator set. Like other shell languages,
it does not select the parenthesized call operator.

The startup script declares the shell operator set, then declares the `shell`
language containing every built-in signature. Illustrative shape:

```text
operators shell_ops {
  prefix "-" precedence 9
  infix "+" precedence 7 associativity left
}

language shell operators shell_ops {
  stmt echo extras...
  stmt eval expression
  stmt if condition then {} [else {}]
  stmt __fallback__ command arguments...
  # remaining built-in statement declarations
}
```

The exact startup inventory must include every built-in command and operator,
not only the examples above. Under D14, the initial `shell`
runtime statement inventory includes `cd`, `echo`, `eval`, `expr`, `for`, `if`,
`language`, `operators`, `raw`, and `while`, plus the handler-runtime statements
defined later. `stmt` and `cmd` are declaration entries parsed inside a
`language` or `extend language` body rather than unqualified shell runtime
statements. The startup script must declare each runtime signature in `shell`.
If shell provides OS-command behavior,
it does so by declaring and completing `shell.__fallback__`; OS execution is not an
ambient dispatcher feature. The startup script must also declare every host
operator selected by shell for implementation bodies.

`language` owns statement declarations and selects an operator set. Handler
runtime commands are ordinary built-in statements declared by shell. The same
declarations, parsing rules, and implementations apply when they are invoked at
the top level or nested inside `$()`. Their shell syntax and argument handling
are defined by D9.

Because `shell` is registered before later language-owned `stmt` declarations
are processed, it may be named as an explicit block language in any statement
signature:

```text
language application operators application_ops {
  stmt run_shell body { shell }
  stmt choose condition (then { shell }) [else { shell }]
}
```

`{ shell }` has the normal explicit-block-language meaning. It selects shell's
own `__fallback__` behavior because the block is parsed and executed as shell;
it does not grant that fallback to another language or alter the fixed
command-body language of `cmd`.

### Operator implementation

An operator definition declares both parsing behavior and, when present, its
evaluator body. The direct body removes the `func` indirection:

```text
operators logic_ops {
  infix "++" precedence 7 associativity left parameters context left right body {
    return $ (result-value context $ (evaluate context left)) + $ (result-value context $ (evaluate context right))
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
`ExpressionNode` while the statement invocation is parsed. In a `cmd` context,
the shared command handler evaluates that node greedily as the first step of
handling the invocation, before the stored command body runs. In a `stmt`
context there is no such automatic step: the invoked handler — whether a
language-implemented body or a TypeScript primitive — receives the node
without evaluation or an environment wrapper, and decides for itself whether,
when, and how often to evaluate it as part of running.

For example:

Using the canonical `choose` implementation from the Goal section:

```text
choose 3 == 4 then { echo equal } else { echo different }
```

The invocation parser must:

1. recognize `condition` as one expression-valued argument;
2. consume `3 == 4` as that argument, stopping at the declared `then` clause;
3. parse it into a binary `ExpressionNode` for `==`;
4. parse both blocks into opaque `NestedBlockNode` values;
5. invoke the handler with unevaluated expression and block nodes.

Only shell's declared `evaluate` statement computes the comparison. The
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
list value and cannot be constructed or passed as `context`, but it can flow as
an opaque `ShellValue` through statement and expression results. `present` does
not evaluate nodes: it returns false for the
absent-value empty string and for an empty repeated binding, and true for a node
or any other supplied value.

Accepted limitation: for an optional raw-valueKind argument, a caller who
explicitly supplies the empty string as that argument's value is
indistinguishable from omitting it, since both bind to `""`; `present`
reports `false` for either. Expression- and block-kind parts do not share this
limitation, since their supplied value is always a node object, never
literally `""`. A future revision may give raw arguments a distinct absent
marker; until then, a statement with an optional raw argument should treat an
explicit empty string the same as an absent one.

`ExpressionNode` and `NestedBlockNode` do not contain or capture an execution
environment. The implementation retains a reference to the exact scope in which
it was declared. Each invocation creates a fresh scope whose parent is that
declaration scope; `evaluate` and `execute` are explicit boundaries that use the
declaration scope without exposing the intermediate handler invocation scope.
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

- `context` holds a single `ScalarValue` chosen by the caller. Structured
  context is represented as a string, conventionally JSON. The runtime imposes
  no JSON schema, parsing, validation, or built-in mutation operation.
- A statement or operator invoked directly from ordinary source receives
  the empty string, `""`, as its `context` parameter. Ordinary source syntax
  does not change or expose this runtime-supplied argument.
- A handler invoking a child handler must supply the child's `context`
  explicitly. It may pass its own `context` unchanged or pass any other
  `ScalarValue`. Context is never inherited implicitly.
- The initial handler runtime commands make this explicit: `$ (evaluate context
  expression)` returns an `ExecutionResult` for evaluation with an explicit
  context, and `$ (execute context block)` returns an `ExecutionResult` for
  block execution. Other handler runtime commands
  likewise receive their context explicitly whether invoked at the top level or
  inside `$()`.
- Command-argument lookup occurs before those boundaries. In `$ (evaluate
  context condition)`, handler lookup first obtains the `context` value and the
  opaque expression node bound to the handler parameter `condition`; `evaluate`
  then evaluates the contents of that node without the handler invocation scope.
  If the node itself is the identifier `condition`, it resolves a
  declaration-scope `condition`, not the handler parameter.
- The runtime never inspects, validates, or interprets a `context` value. It
  flows through handler execution as an opaque `ScalarValue`.

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

Statement implementations may inspect an expression or statement argument
without evaluating or executing it. The `syntax` command converts an opaque
`ExpressionNode` or `StatementNode` binding into an immutable, normalized
`SyntaxValue`. This conversion does not evaluate the expression, execute the
statement, or retain an environment reference.

With no selector arguments, `syntax` returns that complete `SyntaxValue`.
Optionally, an `at` clause followed by one or more zero-based child indexes
selects a nested component and returns its original opaque `ExpressionNode`,
`StatementNode`, or `NestedBlockNode` binding instead:

```text
$ (syntax context expression)
$ (syntax context expression at 0)
$ (syntax context expression at 0 1)
```

The path is interpreted one index at a time against the same ordered child
relationships exposed by `child`. Each index must be a non-negative decimal
integer literal. An `at` clause without an index, an out-of-range index, a path
that attempts to descend through a leaf, or a path ending on a normalized-only
metadata wrapper is a descriptive runtime error. An expression-node result may
be passed to `evaluate`; a nested-block result may be passed to `execute`; and
any returned node handle may be passed back to `syntax`. A statement-node result
is inspectable but is not accepted by `evaluate`. Selecting a handle does not
evaluate it, execute it, or attach an environment.

```ts
type ExpressionSyntaxValue =
  | { kind: "identifier"; name: string }
  | { kind: "number"; value: number; raw: string }
  | { kind: "string"; value: string; raw: string }
  | {
      kind: "operator";
      fixity: "prefix" | "infix" | "call";
      symbol: string;
      operands: readonly SyntaxValue[];
    };

type StatementSyntaxValue =
  | { kind: "statement"; name: string; raw: string; children: readonly SyntaxValue[] }
  | { kind: "assignment"; name: string; raw: string; children: readonly [SyntaxValue] }
  | {
      kind: "argument" | "block";
      name: string;
      ordinal: number;
      valueKind: "expression" | "raw" | "nested-block";
      children: readonly [SyntaxValue];
    }
  | { kind: "qualifier"; name: string; enabled: boolean }
  | { kind: "clause"; name: string; ordinal: number; children: readonly SyntaxValue[] }
  | { kind: "raw"; value: string }
  | { kind: "nested-block"; content: string };

type SyntaxValue = ExpressionSyntaxValue | StatementSyntaxValue;
```

For a call, `symbol` is its opening delimiter. A non-empty call parser AST has
the target plus one argument expression, and multiple logical arguments form a
binary comma-expression AST. The current normalized call representation
flattens that top-level comma spine as `[target, ...arguments]` in source order.
An empty call has only the target operand.

`$ (...)` is represented in the parser by an ordinary `PrefixExpressionNode`
whose operator is `$` and whose operand, produced by grouping's statement
fallback, is a `GroupedStatementExpressionNode` wrapping exactly one
`StatementNode`. Ordinary calls remain expression-only and do not widen their
argument type to accept statements; a `GroupedStatementExpressionNode` is
unrelated to the call-operator model and can only appear as a plain grouped
primary. Normalizing a prefix operator whose operand is a
`GroupedStatementExpressionNode` recurses into the wrapped `StatementNode`, so
that operand position in the produced `SyntaxValue` is a `StatementSyntaxValue`
rather than an `ExpressionSyntaxValue`.

For example, inspecting `$ (evaluate context condition)` without executing it
produces this outer structure:

```ts
{
  kind: "operator",
  fixity: "prefix",
  symbol: "$",
  operands: [
    {
      kind: "statement",
      name: "evaluate",
      raw: "evaluate context condition",
      children: [/* normalized context and expression argument wrappers */]
    }
  ]
}
```

`syntax context statementCall at 0` returns the original opaque
`NamedStatementNode` represented by that one operand rather than a fabricated
expression node.

For a named statement, normalized children preserve its qualifiers, arguments,
blocks, and clauses. Argument and block wrappers retain their declared name,
zero-based occurrence ordinal, and value kind; clause wrappers retain their
name and occurrence ordinal and recursively contain their arguments, blocks,
and nested clauses. Repeated occurrences retain source order, while distinct
parts retain declaration order. Assignment syntax contains its value expression
as its only child. Raw arguments and nested blocks become detached `raw` and
`nested-block` syntax leaves. The existing statement `raw` spelling and nested
block `content` are semantically relevant fields and are retained. These arrays
are internal immutable syntax structure, not constructible shell lists; shell
code traverses them only through `child`.

The first handler runtime exposes inspection through ordinary host-backed shell
statements. `syntax` accepts an opaque expression or statement node and either
returns the complete `SyntaxValue` or a selected opaque node handle; `kind`,
`field`, and `child` inspect a `SyntaxValue`. `child` has two forms:

```text
$ (child context 0 $ (syntax context expression))
$ (child --count context $ (syntax context expression))
```

`child context ordinal syntaxValue` returns one child `SyntaxValue` directly
from its parent. For operators it traverses `operands`; for statement-related
kinds it traverses `children`. `ordinal` is a zero-based non-negative integer, and a
non-integer, negative, or out-of-range ordinal is a descriptive runtime error.
`child --count context syntaxValue` returns the parent's child count as a
non-negative number: zero for leaf kinds, and the length of `operands` or
`children` for a composite kind. For a call this count includes the target at
ordinal zero followed by the call's normalized operands. `--count` rejects an
ordinal, while omitting `--count` requires one. Neither form returns a
collection or repeated binding.
Both forms narrow the parent to `SyntaxValue`. These statements may run directly
at the top level or as the nested statement evaluated by `$()`.

`field context syntaxValue name` narrows `name` to a string and supports exactly
this initial field matrix:

| `SyntaxValue.kind` | Valid fields and returned value kinds |
| --- | --- |
| `identifier` | `name` -> string |
| `number` | `value` -> number; `raw` -> string |
| `string` | `value` -> string; `raw` -> string |
| `operator` | `fixity` -> string; `symbol` -> string |
| `statement`, `assignment` | `name` -> string; `raw` -> string |
| `argument`, `block` | `name` -> string; `ordinal` -> number; `valueKind` -> string |
| `qualifier` | `name` -> string; `enabled` -> boolean |
| `clause` | `name` -> string; `ordinal` -> number |
| `raw` | `value` -> string |
| `nested-block` | `content` -> string |

`kind` and child cardinality are intentionally not duplicated as fields; callers
use `kind` and `child --count`. Asking for a field not listed for the supplied
syntax kind, including `operands`, returns a short descriptive error. Every
successful `field` call returns one scalar `ShellValue` and never evaluates the
inspected syntax.

A `SyntaxValue`, including a value returned by `child`, remains detached
inspection data and cannot be passed to `evaluate` or `execute`. Only the
optional `syntax ... at ...` result recovers an original parser-node handle.
Invalid field access must produce a descriptive runtime error. A later pattern
matching feature may make AST traversal more convenient, but is not required
initially.

An implementation can inspect an unevaluated type expression without resolving
it: it applies `syntax` to the `name` or `type` node and then uses `kind`,
`field`, or `child` on the result. If the implementation must retain or pass
the inspected structure as context, it encodes that structure as JSON text.
Neither `String` nor a language-defined list operator is resolved merely by
inspecting the node.

AST inspection is initially limited to expression arguments. Inspecting a block
as a parsed statement tree would require choosing its language and parsing it,
which is a separate macro/reflection feature. A `NestedBlockNode` remains
executable and opaque in this plan.

### Handler runtime commands

Every implementation body receives the immutable `context` invocation binding
described above. Shell must also provide a small set of ordinary runtime-owned
statements used by implementation bodies:

- `evaluate` — a command that evaluates an expression node using the
  explicitly supplied context for any child handler invocation and returns an
  immutable `ExecutionResult`
- `syntax` — a command that converts an expression or statement node to an
  immutable `SyntaxValue` without evaluating or executing it, or returns an
  original nested expression, statement, or block node selected by an optional
  zero-based `at` child path
- `value-kind` — a command that accepts every `ShellValue` and returns its
  outer runtime tag so shell code can narrow opaque dynamic values
- `kind`, `field`, and `child` — commands that inspect a `SyntaxValue` and
  receive an explicit context argument; `child` returns one detached child by
  zero-based ordinal or, with `--count`, returns the scalar child count
- `execute context block` — execute a required block with the explicitly
  supplied context and return an immutable `ExecutionResult`
- `result` — construct one immutable `ExecutionResult` using exactly one of
  `--complete`, `--expression`, `--return`, `--break`, `--continue`, or
  `--error`
- `result-kind`, `result-value`, `result-error`, `result-break`, and
  `result-continue` — commands that decompose an `ExecutionResult`
- `present` — a command that tests whether an optional argument, clause, or block was supplied
- `return expression` — evaluate and return a dynamic `ShellValue` from an
  operator implementation or an `ExecutionResult` from a statement
  implementation
- `emit expression` — append statement output
- ordinary declared control-flow statements needed to write handlers

These are ordinary `stmt` declarations whose handlers happen to be implemented
in TypeScript rather than shell. Like any `stmt` handler, each receives its
expression-valued parameters as unevaluated `ExpressionNode` bindings when
invoked; nothing evaluates them beforehand. `result`, `emit`, `return`,
`present`, and `field` evaluate the specific parameters their own documented
behavior requires as part of running, using the same internal evaluation entry
point that the `evaluate` statement itself calls. This is the identical
evaluate-from-within-the-handler pattern a language-implemented `stmt` uses by
calling `evaluate` explicitly, not a separate eager-evaluation policy.

Every executable handler construct must have a `StatementDefinition` in shell.
A representative bootstrap surface is:

```text
language shell operators shell_ops {
stmt if condition then {} [else {}]
stmt while condition do {}
stmt break
stmt continue
stmt execute context block
stmt result [--complete] [--expression value] [--return value] [--break] [--continue] [--error message]
stmt result-kind context result
stmt result-value context result
stmt result-error context result
stmt result-break context result
stmt result-continue context result
stmt value-kind context value
stmt child [--count] context [ordinal] syntaxValue
stmt return value
stmt emit value
}
```

`evaluate`, `execute`, `result`, `result-kind`, `result-value`, `result-error`,
`result-break`, `result-continue`, `present`, `syntax`, `value-kind`, `kind`,
`field`, and `child` must be declared as host-backed statements in shell's startup
declarations. They use the same statement definitions and dispatch whether
executed at the top level or as `$`'s operand. `$` is an ordinary primitive
prefix operator whose evaluator dispatches a nested shell statement produced by
grouping's statement fallback (see D9).

`value-kind context value` always succeeds for a valid `ShellValue` and returns
one of `"number"`, `"string"`, `"boolean"`, `"expression-node"`,
`"statement-node"`, `"syntax"`, `"nested-block"`, `"execution-result"`, or
`"repeated"`. This is the primitive shell-level type pattern used before calling
narrower commands. `kind` remains a separate command for inspecting the AST
kind inside an already narrowed `SyntaxValue`.

For example, even though `syntax` documents the value it produces, shell code
treats the command result dynamically before passing it to `child`:

```text
candidate = $ (syntax context expression)
if $ (value-kind context candidate) == "syntax" then {
  first = $ (child context 0 candidate)
} else {
  return $ (result --error "syntax returned an unexpected value")
}
```

The TypeScript implementation of `child` performs the same narrowing at its
entry point. Documentation of a command's result is a runtime contract, not a
static type assertion available to shell code.

`present` receives an already-bound shell value without evaluating an
`ExpressionNode`. It returns false for the empty-string default of an absent
optional single part and for an empty repeated binding; otherwise it returns
true.

These are ordinary shell statements with runtime-owned implementations. Every
built-in and user-command executor returns the same TypeScript `StatementResult`
type and receives dynamic `ShellValue` values at its runtime boundary. TypeScript
implementations narrow that union before use. Shell code has no corresponding
TypeScript type system: parser nodes, syntax values, blocks, execution results,
and repeated bindings are opaque dynamic objects. A shell implementation must
inspect a value's runtime kind before passing it to a type-specific command.
Invalid types produce descriptive error results rather than unchecked casts. In
particular, `execute` narrows its block operand to `NestedBlockNode`; it must not
reconstruct source through string interpolation.

### Statement results

Every built-in statement, custom statement, and user command returns this common
TypeScript result envelope:

```ts
type CompletedStatementResult = {
  readonly output: string[];
  readonly execution: { readonly kind: "complete" };
  readonly value?: ShellValue;
};

type AbruptStatementResult = {
  readonly output: string[];
  readonly execution: AbruptExecutionResult | HandlerReturn;
  readonly value?: never;
};

type StatementResult = CompletedStatementResult | AbruptStatementResult;

type ExpressionResult =
  | (Omit<CompletedStatementResult, "value"> & { readonly value: ShellValue })
  | AbruptStatementResult;
```

`StatementResult` owns output transport. A parent execution appends a child
statement's `output` exactly once. Shell source execution eventually consumes
that accumulated output. `execution` is the statement's control outcome and is
always present. `value` is a separate optional dynamic value produced by commands
such as `syntax`, `result`, `evaluate`, and `execute`. At the top level, an
unused `value` is discarded only after output and `execution` have been handled.
Inside `$()`, the nested statement must complete normally and produce `value`;
that value becomes the value of the enclosing `$` expression while output
continues through the surrounding collection path.

`ExpressionResult` uses the same output, execution, and value types. Its normal
case requires a value, while its abrupt case propagates control without a value.
Consequently every `ShellValue`, including an opaque object or repeated binding,
can flow through statement and expression evaluation. Individual consumers are
responsible for runtime narrowing; for example, arithmetic operators require
numbers and `child` requires a `SyntaxValue` parent.

`evaluate` and `execute` put an immutable, handler-visible `ExecutionResult` in
`StatementResult.value`; the execution of the `evaluate` or `execute` command
itself is `complete`. They do not put output inside the returned object.
Retaining, inspecting, or repeatedly decomposing an `ExecutionResult` therefore
never replays output. Ignoring the value returned by either command deliberately
discards the contained outcome but does not suppress its output. A custom
statement implementation owns all responsibility for inspecting, consuming,
translating, and constructing the outcome it returns.

### Execution results

`ExecutionResult` is an opaque `ShellValue` with one mutually exclusive
outcome:

```ts
type CompleteExecutionResult = { readonly kind: "complete" };

type ExpressionExecutionResult = {
  readonly kind: "expression";
  readonly value: ShellValue;
};

type AbruptExecutionResult =
  | { readonly kind: "return"; readonly value: ShellValue }
  | { readonly kind: "break" }
  | { readonly kind: "continue" }
  | { readonly kind: "error"; readonly message: string };

type ExecutionResult =
  | CompleteExecutionResult
  | ExpressionExecutionResult
  | AbruptExecutionResult;

type HandlerReturn = {
  readonly kind: "handler-return";
  readonly value: ShellValue;
};
```

The object is not a general-purpose record. It may be assigned to a normal
handler-local binding, returned as an expression value, and passed to the
result-inspection commands, but it cannot be used as scalar `context` or
converted into source text implicitly.

`evaluate` produces either `expression` with the evaluated `ShellValue` or
`error` with a message. An operator handler's dynamic return value is consumed
at the operator boundary and becomes the `expression` value of the outer
evaluation result. A consumer that requires a particular value kind must narrow
it before use.

`execute` produces `complete` after ordinary block completion, or captures the
block's `return`, `break`, `continue`, or `error` outcome at the explicit
execution boundary. Those contained outcomes do not automatically become the
calling custom statement's outcome. Its implementation must explicitly return
an appropriate `ExecutionResult` constructed with `result`. Output
produced before any outcome remains in `StatementResult.output` and follows
normal output handling.

The `result` command is the sole language-level constructor for these opaque
objects. Exactly one option is required:

```text
result --complete
result --expression value
result --return value
result --break
result --continue
result --error message
```

`value` may be any `ShellValue`, while `message` must narrow to a string. Missing,
repeated, or conflicting options and values on flag-only options make the
constructor statement itself return an `error` execution outcome with a short
descriptive message; they do not construct a handler-visible result value.
The `--name` spelling is ordinary shared statement-option syntax, not raw-tail
or `result`-specific parsing. `StatementDefinition` must represent flag-only and
value-bearing options with that spelling, plus the mutual-exclusivity grouping
decided under D15, so future statements can use the same facility.

The decomposition commands behave as follows:

- `result-kind context result` returns `"complete"`, `"expression"`,
  `"return"`, `"break"`, `"continue"`, or `"error"`.
- `result-value context result` returns the dynamic value from an `expression`
  or `return` result and is a descriptive runtime error for every other kind.
- `result-error context result` returns the message from an `error` result and
  is a descriptive runtime error for every other kind.
- `result-break context result` and `result-continue context result` accept
  every result kind and return whether it represents that control action.

Errors raised by a supplied expression or block become `error` outcomes. Each
statement implementation determines the error message it returns; built-in
statements use short descriptive strings and normally propagate an existing
error result unchanged. Invalid invocations of `evaluate`, `execute`, `result`,
or a decomposition command are likewise represented as error results at their
statement boundary rather than thrown through language execution. By contrast,
an error encountered while processing a valid `evaluate` or `execute` request
is captured in the handler-visible result value, leaving that command's own
execution outcome `complete` so the statement implementation can decide what to
do with it.

### Statement body execution

An implementation body and every nested block body use the same statement-body
executor as built-in statements. A body is itself executable statement logic:
it executes child statements in source order, appends each child's output once,
and examines each child's `StatementResult.execution` before deciding whether
to continue.

- `complete` proceeds to the next child statement.
- `break`, `continue`, `return`, `handler-return`, and `error` stop the current
  body immediately and are returned unchanged to its parent scope.
- A loop consumes `break` by completing the loop and consumes `continue` by
  beginning its next iteration. It propagates `return`, `handler-return`, and
  `error` unchanged.
- A non-loop parent propagates `break` and `continue` unchanged. Reaching the
  top level without a loop converts either one to an `error` result.
- An `expression` `ExecutionResult` is handler-visible data and is never stored
  in `StatementResult.execution`. A statement-handler boundary normalizes it to
  `execution: complete` plus its contained value in `StatementResult.value`.

Thus break, continue, and public return outcomes require no exception-like
special parser or dispatcher path. Their built-in statement implementations
return the corresponding body result, and ordinary body sequencing performs the
unwinding by returning that result to the parent. Scope frames leave naturally
as the body executor returns.

The handler-level `return expression` command exits the current implementation
body with its evaluated `ShellValue`. At an operator-handler boundary, that
value becomes the operator's dynamic expression value. At a statement-handler
boundary, it must narrow to an `ExecutionResult`; a scalar such as `return 5` is
therefore invalid, while this
is valid:

```text
return $ (result --return 5)
```

Internally, the `return` command produces a `HandlerReturn` so the runtime can
distinguish the current implementation returning a value from an ordinary child
statement propagating a public `ExecutionResult` whose kind is `return`. The
appropriate handler boundary consumes and normalizes only `handler-return`: an
operator boundary converts its `ShellValue` to a normal `ExpressionResult`; a
statement-handler boundary converts an `expression` result to `execution:
complete` plus `StatementResult.value`, adopts `complete` or an abrupt result as
`StatementResult.execution`, and rejects a non-`ExecutionResult` value; and an
`execute` boundary converts its caller-block value to a handler-visible return
result. `HandlerReturn` never escapes as a handler-visible value or top-level
result.

A statement implementation that reaches the end without an explicit handler
return produces `complete`. An operator implementation that reaches the end
without a dynamic return value produces an `error` result for the surrounding
evaluation.

At the top level, `complete` finishes normally. An `error` writes its message to
standard error and halts the current source execution before any later
statement. An unconsumed `break`, `continue`, or `return` is converted to a
short descriptive `error` and handled the same way. A private `handler-return`
that reaches the top level without an applicable handler boundary is also an
error. Output accumulated before the error remains on the normal output path.
The core library reports this through a host-provided error sink so it remains
browser-compatible; the Node terminal and script adapters bind that sink to
standard error.

### Expression results

Custom operator handlers must return one `ShellValue` on the path executed for
each invocation. `return expression` evaluates its expression once using the
current handler context and exits the implementation body. A statement handler
instead uses the same command to return an `ExecutionResult`, as specified
above.

An explicit `execute` establishes a separate execution boundary. A return in
its caller-supplied block evaluates its expression using the context supplied to
`execute` and the block's established evaluation scope, then becomes a `return`
execution result. It does not automatically escape into the handler that invoked
`execute`. The runtime does not perform static control-flow analysis: if an
operator-handler path reaches the end without a handler return, the
surrounding evaluation produces an error result.

The returned value may be any `ShellValue`. JSON text is an ordinary string;
AST nodes, `SyntaxValue`, nested blocks, repeated bindings, and
`ExecutionResult` objects remain opaque dynamic objects when they flow through
an expression. Existing expression consumers impose their own runtime
requirements; for example, an arithmetic primitive rejects a non-number and
`evaluate` rejects a value that is not an `ExpressionNode`.

### Scope and lifetime

- A custom statement or operator implementation retains a reference to the exact
  scope in which its implementation was declared. It does not copy or snapshot
  that scope.
- Invocation arguments and blocks contain syntax and language metadata only.
  They do not capture the caller's environment.
- Every statement or operator handler call creates a fresh invocation scope
  whose parent is the implementation's declaration scope. The handler parameters,
  including `context`, are immutable bindings in that scope and shadow
  same-named bindings in outer scopes.
- Handler-body reads search from the current invocation scope outward. The first
  matching binding wins. The first implementation provides no syntax for
  bypassing a shadowing binding to name an outer binding directly; declarations
  should choose non-conflicting parameter names when that access is needed.
- Assignment searches through the same scope chain as a read. If it finds a
  mutable binding, it writes to that binding's scope. If it finds an immutable
  invocation parameter, assignment fails. If the name is undefined throughout
  the chain, assignment creates a mutable binding in the current innermost
  scope. Explicit scope-qualified reads and writes are deferred.
- `evaluate` first receives an `ExpressionNode` through normal handler lookup,
  then evaluates that node in the implementation's declaration scope using the
  node's retained operator-set identity. The intermediate handler invocation
  scope is not visible while evaluating the node. The supplied `context` is
  passed to any custom operator handler the evaluation invokes.
- `execute` first receives a `NestedBlockNode` through normal handler lookup,
  then executes that block from the implementation's declaration scope. The
  intermediate handler invocation scope is not implicitly visible to the block.
  A statement such as `for` may deliberately establish another scope for a body
  it executes, but that behavior belongs to that statement's implementation.
- `execute` uses the block's declared language when present; otherwise it inherits the invocation language.
- The interpreter keeps the current scope in its execution stack. Recursive and
  nested handler calls push frames containing their fresh scopes. Returning any
  non-complete child result leaves those scopes as the statement-body calls
  return; no shared binding map is overwritten or manually restored.
- Shell source execution starts in the startup-declared `shell` language.
- `shell` is always available for explicit selection in a post-startup `stmt`
  signature; `{ shell }` selects that language only for the annotated block.
- Registry references are resolved when the implementation is declared.
- Recursive custom statements and expressions are allowed, with a configurable recursion-depth guard.
- Error text is owned by the statement implementation. Built-ins use short
  descriptive messages and do not require a separate structured diagnostic
  object in the first implementation.

## Runtime Model

Add separate syntax and implementation registries:

```ts
interface StatementBindingKey {
  languageName: string;
  statementName: string;
}

interface StatementImplementation {
  key: StatementBindingKey;
  declaration: StatementDefinition;
  contextParameter: "context";
  body: StatementNode[];
  shellLanguage: Language;
  declarationScope: RuntimeScope;
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
  declarationScope: RuntimeScope;
}

interface PrimitiveOperatorBinding {
  key: OperatorBindingKey;
  evaluate: HostOperatorEvaluator;
}

interface PrimitiveStatementBinding {
  key: StatementBindingKey;
  execute: HostStatementExecutor;
}

interface CommandStatementBinding {
  key: StatementBindingKey;
  declaration: StatementDefinition;
  implementationBody: StatementNode[];
  execute: HostStatementExecutor;
}

type StatementBindingState =
  | { kind: "unresolved" }
  | { kind: "language"; implementation: StatementImplementation }
  | { kind: "primitive"; binding: PrimitiveStatementBinding }
  | { kind: "command"; binding: CommandStatementBinding };

interface LanguageRuntimeCompanion {
  languageName: string;
  statements: Map<string, StatementBindingState>;
}

type ScalarValue = number | string | boolean;

type AtomicShellValue =
  | ScalarValue
  | ExpressionNode
  | StatementNode
  | SyntaxValue
  | NestedBlockNode
  | ExecutionResult;

type RepeatedHandlerBinding = readonly AtomicShellValue[];

type ShellValue =
  | AtomicShellValue
  | RepeatedHandlerBinding;

type ScopeBinding =
  | { readonly mutable: false; readonly value: ShellValue }
  | { readonly mutable: true; value: ShellValue };

interface RuntimeScope {
  readonly parent?: RuntimeScope;
  readonly bindings: Map<string, ScopeBinding>;
}

interface InterpreterFrame {
  readonly scope: RuntimeScope;
}
```

`ShellValue` is the one TypeScript union for values crossing command, statement,
and expression boundaries. `RepeatedHandlerBinding` is produced only when
binding a repeated statement part; language code cannot construct a general
list, but the opaque binding may flow through `StatementResult` and
`ExpressionResult` like any other `ShellValue`. `ExpressionNode`,
`StatementNode`, `SyntaxValue`, `NestedBlockNode`, and `ExecutionResult` are
likewise opaque dynamic shell objects. TypeScript host implementations use type
guards over `ShellValue`, and shell implementations use `value-kind` followed by
the appropriate specialized inspection command. `context` remains deliberately
narrower and accepts only a `ScalarValue`.

Opaque object variants must be nominally distinguishable at runtime. Expression
and statement parser-node classes, immutable syntax objects, nested blocks,
execution results, and repeated bindings therefore carry internal class identity
or a non-user-visible brand used by the shared TypeScript guards. Their public `kind` fields are not
used to discriminate the outer `ShellValue`: an identifier `ExpressionNode` and
an identifier `SyntaxValue` may have similar public shapes but must produce
different `value-kind` results. Shell code cannot read or forge the internal
brand.

`HostStatementExecutor` and the executor used for a user `cmd` must return
`StatementResult`; there is no output-only or string-only executor signature.
`HostOperatorEvaluator` returns `ExpressionResult`. Primitive operators and
commands validate the value kinds required by their contracts rather than
narrowing the shared result types themselves.

`Language` describes parsing and owns statement availability. Runtime handler
state remains outside parser-owned `StatementDefinition`, in a runtime companion
indexed by the owning language and local statement name. The runtime companion
stores each declaration's `StatementBindingState`; completing a declaration
changes only that qualified binding state after structural equality with that
language's existing canonical `StatementDefinition` has been validated.

`ShellEnvironment` owns the language registry and each language's statement
runtime companion. A
`RuntimeScope` owns name bindings and links to its lexical parent. Each custom
implementation stores its exact declaration scope, while each invocation gets a
new child scope represented by the current `InterpreterFrame`. Parameter
bindings use the immutable `ScopeBinding` variant. Assignment may update only a
mutable binding; it never replaces or writes through an immutable parameter.

Parsing and dispatch become:

1. Handle assignments where the active language permits them.
2. Look up the source statement name only among declarations owned by the
   active language.
3. If that exact name exists, parse exclusively against that declaration
   and dispatch its one implementation. A parse failure, unresolved binding, or
   execution error is final and never retries an OS command or `__fallback__`.
4. If the exact name does not exist, look for the reserved `__fallback__`
   declaration in the active language. Parse the source through that declaration
   before invoking its ordinary statement handler.
5. If the language has no fallback declaration, fallback parsing fails, or its
   declaration has no implementation, return a descriptive error. There is no
   host-level unknown-statement dispatch after this point.

An OS command is therefore executable only when the active language's completed
`__fallback__` handler deliberately invokes it. A declared statement name always
takes precedence over an OS executable of the same name, including when the
declaration remains unresolved or the source does not satisfy its signature.

Decision: each language-owned statement declaration has zero or one
implementation. A bodyless declaration begins unresolved. It may be completed exactly once by a
matching declaration with an inline `implement` suffix or by a TypeScript
primitive binding. Those completion forms are mutually exclusive. Registering a
second implementation, repeating an unresolved declaration without completing
it, or completing it with a mismatched signature is an error. Runtime dispatch
resolves the binding when the statement is used and reports an unimplemented-
statement error if it is still unresolved. Language construction does not
require every local declaration to be implemented. Language ownership prevents
ambient declarations from overriding shell built-ins: `application.echo` and
`shell.echo` are different entries, and dispatch consults only the active
language. Within one qualified entry, language and primitive implementations
remain mutually exclusive rather than having a precedence rule.

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
one language-scoped `stmt` declaration surface. The owning language stores the
complete statement shape. The `implement context body { shell } { ... }` suffix
stores its implementation body with that shape. Parser declarations and runtime
implementations remain separate entries in the language's runtime companion
despite their shared declaration surface.

Omitting the suffix creates an unresolved local declaration rather than
permanently classifying the statement as a TypeScript primitive. A later
completion must name the same language and repeat the same canonical shape with
an `implement` suffix. It cannot complete a same-named declaration in another
language. A new local `stmt` that already has the suffix still declares and
implements atomically.

Only the startup statements actually implemented by TypeScript receive primitive
bindings. Other startup signatures, including `expr` and `raw`, may stay
unresolved until matching nonprimitive declarations are processed. Each
qualified `(languageName, statementName)` declaration owns at most one inline
shell implementation or TypeScript primitive binding. The same local name in a
different language owns independent syntax and binding state. Language
construction permits unresolved statements so syntax can be registered
independently of runtime availability.

### D3. Evaluation is determined by statement context

Decision: do not introduce separate eager and deferred expression declaration
forms. Expression syntax is parsed independently of evaluation policy. The
statement receiving an expression determines when it is evaluated.

- `cmd` is greedy. Its shared built-in handler evaluates every expression-valued
  invocation argument as its own first action, before it executes the stored
  command body. The body receives runtime values rather than expression nodes.
- `stmt` is deferred. No evaluation occurs before a `stmt` handler is invoked.
  Every expression-valued invocation argument is parsed into an
  `ExpressionNode` and bound directly to the handler's parameter, unevaluated.
  This is true whether the invoked handler is a language-implemented body or a
  TypeScript primitive: both receive the same unevaluated node, and both are
  free to evaluate it, ignore it, or evaluate it more than once as part of
  running. Nothing evaluates it on their behalf beforehand.
- Once invoked, a handler evaluates a bound expression using the evaluation
  entry point available to it. A shell-language implementation body does this
  only through shell's declared `evaluate` statement. A TypeScript primitive
  implementation — including `evaluate` itself, `result`, `emit`, `return`,
  `present`, and `field` — instead calls the same underlying evaluator
  directly, since it cannot invoke a shell statement from TypeScript. Either
  way, evaluation happens inside the invoked handler's own logic, not as an
  automatic step that runs before the handler starts. A handler may evaluate
  the node zero, one, or multiple times with contexts of its choosing.
- Shell's declared `syntax` statement converts a parsed expression or statement
  node to detached inspection data without evaluating or executing it. `kind`,
  `field`, and `child` inspect that data.
- Every custom expression operation, including a call operation, runs only while
  an expression evaluator is evaluating an AST containing that operator.
- A custom operator receives unevaluated operand nodes and decides which
  operands to pass to `evaluate`, in what order, and how many times.

The runtime must not attach an eager/deferred strategy to an expression
declaration. Evaluation policy belongs to the consuming statement definition
and execution context: `cmd`'s shared handler applies its evaluation policy
before the stored body runs, while every `stmt` handler, custom or primitive,
applies its own policy from within its own execution.

### D4. Statement and execution results

Decision: keep internal output transport separate from handler-visible execution
outcomes. Every built-in statement executor and user-command executor returns
the same TypeScript `StatementResult` union; there are no separate output-only,
primitive, or user-command result types. Its `output` is appended to its parent
exactly once, its required `execution` controls statement-body sequencing, and
its optional `value` is discarded at the top level or consumed by `$()`.

`ShellValue` is the common dynamic value union shared by `StatementResult` and
`ExpressionResult`. TypeScript implementations narrow it with type guards.
Shell implementations see opaque dynamic objects and use `value-kind` plus
specialized inspection commands before relying on a value's kind. A completed
statement may expose any `ShellValue`; a completed expression must expose one.
An abrupt result exposes no value.

`evaluate` and `execute` return an immutable `ExecutionResult` through
`StatementResult.value`. `ExecutionResult` contains only the mutually exclusive
completion outcome: normal completion, expression value, return value, break,
continue, or error message. It never contains output. Consequently,
retaining or inspecting the result cannot replay output, and ignoring it cannot
suppress output already produced by the operation.

This supersedes the earlier decision to discard the aggregate result of an
executed block. `execute` captures the block's completion outcome at its explicit
boundary and exposes it to handler code without automatically propagating that
control action through the calling handler.

A custom statement has full responsibility for a captured result. It narrows
the captured dynamic value to `ExecutionResult`, inspects the captured object,
uses `result` to construct the outcome it chooses to
propagate, and uses handler-level `return` to make that object the statement
implementation's outcome. A raw scalar return such as
`return 5` remains invalid in a statement implementation, while
`return $ (result --return 5)` is valid. No separate `result-propagate`
operation or automatic contained-outcome propagation is provided.

Every statement body, including an implementation body, uses the same
statement-body executor. It appends child output, examines the child's
`StatementResult.execution`, continues only after `complete`, and otherwise
returns the outcome to its parent. Loops consume break and continue; other
parents propagate them. Top-level unhandled control becomes an error, and a
top-level error prints its implementation-defined message to standard error and
halts the current source execution.

### D5. Operator binding

Decision: operator definitions use direct evaluator bodies. A body is optional:

```text
operators logic_ops {
  infix "++" precedence 7 associativity left parameters context left right body {
    return $ (result-value context $ (evaluate context left)) + $ (result-value context $ (evaluate context right))
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
language, and a reference to its exact declaration scope. Only the matched
pairs `()`, `{}`, and `[]` are valid call delimiters;
a `call` declaration must reject every other or mismatched `open`/`close` pair
at declaration time, when the `call` statement itself is parsed, not when it is
first used or bound. For example, `call open ( close ]` is rejected immediately
as a mismatched pair, before any parameter, body, or primitive binding is
considered. The opening
delimiter is the call operator symbol used for parsing and runtime lookup; the
closing delimiter is implied by the supported matched pair. An optional exact
head is added to the lookup key only to distinguish a head-restricted call from
a generic call using the same opening delimiter.

Custom operator bodies receive unevaluated operand nodes. Prefix and infix
parameters are `ExpressionNode` values. Call parameters are a target
`ExpressionNode` and either one argument `ExpressionNode` or `""` when the call
is empty. The body chooses evaluation order and invokes `evaluate` explicitly,
including for ordinary arithmetic implementations. Evaluation uses the
operator implementation's declaration scope. Host primitive evaluators
own their evaluation policy through the same evaluator context rather than
relying on the parser to evaluate operands.

The expression parser consults the active operator set before consuming a call
delimiter. It must not contain an identifier-specific call loop. Parser state
determines the delimiter's role: while expecting a value, `(` starts grouping
(subject to grouping's own statement fallback, decided under D9); after a left
value has been parsed, a selected opening delimiter is a postfix call operator.
For example, the `(` in `2 + (` begins the right-hand grouped value, while the
`(` following a call operator's target, such as `f(` when a matching call
operator is selected, continues that target as a call. A generic call operator
applies after any valid target; a head-restricted call applies only to its
configured value and takes priority over a generic call for that value. `$`
has no call-operator declaration, so it never triggers this continuation:
`$ (...)` always parses its `(` as ordinary grouping, which is exactly what
allows grouping's statement fallback to produce `$`'s nested-statement operand.
If no matching call operator is selected, the delimiter is not an expression
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
   operator set and the named `shell` language with its complete local `stmt`
   inventory.
2. Bind the subset of unresolved statement declarations and bodyless operator
   declarations implemented as TypeScript primitives. After this phase, the
   primitive shell surface required to process normal declarations is
   executable.
3. Process nonprimitive declarations and user source in order. A matching
   language-scoped `stmt ... implement ...` declaration can complete an
   unresolved statement in the same language, including `expr` or `raw`, before
   later source uses it. Using a local declaration before it is completed reports
   an unimplemented-statement error.

For example, the startup script may declare:

```text
operators shell_ops {
  prefix "-" precedence 9
  infix "+" precedence 7 associativity left
}
language shell operators shell_ops {
  stmt echo extras...
  stmt eval expression
  stmt __fallback__ command arguments...
}
```

The startup script contains declarations, not TypeScript implementation
references. TypeScript binding code uses stable keys: language name plus local
statement name for primitive statements; operator set, fixity, and symbol for prefix and
infix operators; and operator set, opening delimiter, and optional exact head
for call operators. Registering a binding validates that its key resolves to a
compatible unresolved declaration owned by the named language. Initialization fails for
a binding whose declaration is missing, duplicate, incompatible, or already
implemented by a language body. An unresolved statement or unbound operator may
remain after primitive binding and fails only if runtime execution reaches it
before a permitted completion occurs.

A minimal TypeScript bootstrap seed is permitted solely to parse the declaration
language required by the startup script, including `operators`, `language`, and
the nested `stmt` and `cmd` entries in language bodies. It is not a second
user-visible grammar. Once startup
declarations have been executed, the resulting declarations are authoritative;
the seed must not supply executable built-ins or signatures not declared by the
script.

### D7. AST representation

This is consequential because exposing parser objects directly would make the
language API depend on internal TypeScript classes.

Decision: expression and statement arguments remain opaque parser-node bindings.
The declared `syntax` converts either to immutable normalized `SyntaxValue`
data; `kind`, `field`, and `child` inspect that normalized value. An optional
zero-based `at` child path makes `syntax` return a selected original expression,
statement, or nested-block node when an implementation needs a functional
subcomponent handle.

The AST inspection API is not subject to the goal of avoiding new language data
structures. Implementations need access to the parser's existing structural
data, and `syntax` is the preferred public API for exposing it. With no `at`
selector, `syntax` must provide the complete normalized structure for every
supported `ExpressionNode` and `StatementNode` variant, including every
semantically relevant field and child relationship. The only initially omitted
information is source location metadata, as explicitly decided below.

- `SyntaxValue` is an opaque shell capability, not a general-purpose record or
  list value.
- Parser nodes and `SyntaxValue` values cannot be mutated through the handler
  API.
- Neither parser nodes nor `SyntaxValue` values contain an environment
  reference. An implementation retains its declaration scope separately
  and uses it only when evaluating or executing a supplied parser node.
- AST nodes, syntax values, nested blocks, repeated bindings, and execution
  results are opaque shell capabilities, not general-purpose runtime data
  structures.
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

This is consequential because shell commands such as `evaluate`, `execute`,
the `result-*` decomposition commands, `present`, `syntax`, `value-kind`, `kind`,
`field`, and `child` must be usable in an expression without creating a second command
namespace or grammar, and without adding parsing logic that is specific to `$`.

Decision: `$` is an ordinary primitive prefix operator, declared and parsed
through the same generic `prefix` mechanism as any other prefix operator (for
example unary `-`). No call-operator declaration, exact-head matching, or
lookahead exists for `$`. The only parser change this notation requires is
generic and applies to every language: grouping (`(...)`) may hold either an
ordinary expression or, when its content cannot be parsed as one complete
expression up to the matching `)`, a single statement parsed by the same
generic statement parser used at the top level. That fallback statement is
carried by one new expression node:

```ts
export class GroupedStatementExpressionNode {
  readonly kind = "grouped-statement";

  constructor(readonly statement: StatementNode) {}
}
```

This node is an ordinary `ExpressionNode` variant produced by grouping alone;
it has no dependency on `$` or on any operator declaration.

`$`'s primitive evaluator special-cases only at evaluation time: when its
operand is a `GroupedStatementExpressionNode`, `$` dispatches the wrapped
`StatementNode` through the ordinary statement executor instead of evaluating
its operand as an expression. The nested statement uses the same `shell`
language, `StatementDefinition`, implementation, and normal dispatch path as
the identical statement written at the top level. There is no `$`-specific
statement set, separate command registry, or private command grammar. When
`$`'s operand is an ordinary expression rather than a grouped statement,
evaluating `$` is a descriptive runtime error: `$` has no defined behavior
other than dispatching a nested statement. A bare `$` with no following
operand at all is simply a parse error for a missing required prefix operand,
identical to any other prefix operator; `$` is declared only as a `prefix`
operator and is never treated as a bare identifier or an ordinary value.

When `$` dispatches its nested statement, the statement must produce an
internal `StatementResult` with `execution.kind === "complete"` and a `value`;
`$` yields that typed value as its own expression result. A non-complete
execution outcome propagates through the enclosing statement body instead of
producing a value. A statement that completes without a value produces a
descriptive no-value error result in this position. At the top level, the same
value-producing statement executes normally and its unused value is discarded
after ordinary output handling. The value may be any `ShellValue`:
`evaluate`, `execute`, and `result` produce opaque `ExecutionResult` objects;
`syntax` and `child` may produce opaque syntax objects; `field` produces a
scalar structural value; `syntax at` may produce an expression-node,
statement-node, or nested-block object; and a repeated statement part may flow
as an opaque repeated binding.

The notation must satisfy all of these requirements:

- shell selects no generic `()` call operator;
- `$` requires no call-operator declaration, exact-head matching, or parser
  knowledge of its own symbol beyond an ordinary prefix-operator entry;
- grouping's fallback to statement parsing is a generic parser capability
  usable by any expression, not a feature conditioned on `$`;
- every statement declared by `shell` can be parsed and dispatched both at the
  top level and as `$`'s operand;
- it can pass an explicit `context` plus one or more operands without relying
  on whitespace splitting outside the expression parser;
- it can accept unevaluated `ExpressionNode` and `NestedBlockNode` values where
  required.

#### Grouping's statement fallback

Ordinary grouping remains a parser fundamental: `(` opens, the parser attempts
to parse one complete expression, and `)` must close it exactly where the
expression ends. This decision adds exactly one fallback: if the tokens up to
the matching `)` do not reduce to one complete expression (for example, a bare
statement invocation such as `evaluate context condition`, which has no
operator between its positional identifiers), the parser instead parses that
same span, in full, with the ordinary generic statement parser and wraps the
result in a `GroupedStatementExpressionNode`. A practical implementation first
locates the matching `)` by tracking nested delimiter depth, then attempts the
expression parse bounded by that span, and falls back to a statement parse of
that exact span only if the expression parse does not consume it entirely,
avoiding exception-driven backtracking. This applies uniformly to every `(`
grouping in the language, independent of any operator, so it does not
special-case `$`.

Ordinary arithmetic grouping such as `(1 + 2)` is unaffected: it already
reduces to one complete expression, so the fallback never triggers. Call
operator arguments remain expression-only; they never accept the
grouped-statement form. The fallback applies only to plain grouping.

```text
$ (evaluate context condition)
$ (result-value context $ (evaluate context condition))
$ (result-kind context $ (execute context body))
$ (present context optionalBlock)
$ (field context $ (syntax context node) "name")
$ (evaluate context $ (syntax context arguments at 0 1))
```

Ordinary source remains positional wherever a plain expression fully consumes
a parenthesized span:

```text
foo (1)                  # two expressions where the statement shape permits
evaluate (context value)  # two expressions: evaluate, then grouped (context value)
```

`evaluate (context value)` differs from `evaluate context value`:
`(context value)` is not one complete expression (two bare identifiers, no
operator), so it falls back to a statement parse of `context value`, an
undeclared statement that ordinarily fails to parse or dispatch, rather than
binding `context` and `value` as `evaluate`'s two positional arguments. Only
`$ (evaluate context value)`, where `(evaluate context value)` is `$`'s single
operand, produces the intended nested statement.

Suggested initial built-in handler runtime commands are:

```text
evaluate context expression                 # returns an ExecutionResult
execute context block                       # returns an ExecutionResult
result --complete                           # constructs a complete result
result --expression value                   # constructs an expression result
result --return value                       # constructs a return result
result --break                              # constructs a break result
result --continue                           # constructs a continue result
result --error message                      # constructs an error result
result-kind context result                  # returns the outcome name
result-value context result                 # returns an expression/return value
result-error context result                 # returns an error message
result-break context result                 # tests the break outcome
result-continue context result              # tests the continue outcome
value-kind context value                    # returns the outer ShellValue kind
syntax context node [at indexes...]         # returns SyntaxValue or a selected parser-node handle
present context optionalValue    # tests optional argument, clause, or block presence
kind context syntaxValue         # returns the normalized syntax kind
field context syntaxValue name   # returns a validated structural field
child [--count] context [ordinal] syntaxValue # returns one child or its parent's child count
```

The canonical `choose` implementation demonstrates the required sequence:
retain the opaque result from `evaluate`, narrow it with `value-kind`, inspect
its execution kind, narrow its expression value, capture the selected
`execute` result, and explicitly reconstruct the outcome returned by the
statement implementation.

`execute`, `emit`, and `return` use the same ordinary statement model.
`execute` produces an `ExecutionResult`, while `emit` does not produce a value
and therefore produces the ordinary no-value error when used as `$`'s operand.
`return` accepts any `ShellValue` in an operator implementation and requires an
`ExecutionResult` in a statement implementation. A future `source` command is
deferred with source-span exposure.

The parser impact is:

1. Add grouping's statement fallback exactly as described above. This is the
  only change to expression-primary parsing, and it is not conditioned on `$`
  or on any other operator symbol.
2. Declare `$` as an ordinary primitive prefix operator with a precedence high
  enough that it binds only to its immediate operand, so `$ (foo) + 1` parses
  as `($ (foo)) + 1` and never absorbs the trailing `+ 1` into its own operand.
3. Give `$`'s primitive prefix evaluator the one special case described above:
  dispatch a `GroupedStatementExpressionNode` operand as a nested statement;
  reject any other operand kind with a descriptive runtime error.
4. Execute the parsed nested statement through the ordinary shell statement
  dispatcher. The dispatcher binds its typed arguments in the same way at the
  top level and in this nested position; `$` first propagates a non-complete
  `StatementResult.execution` and otherwise consumes `StatementResult.value`.

This is simpler than a generic shell call because it avoids callable runtime
values, keeps handler-binding conversion inside built-in commands, and removes
call-operator machinery, exact-head matching, and lookahead entirely from `$`.
It requires one small, generic addition to grouping, plus tests for the
grouping fallback, `$`'s special-cased evaluation, and nested-statement value
capture. The scanner already emits `$` as an operator token, so no scanner
change is needed.

`$` does not participate in the call-operator model described under D5.
Generic and head-restricted `call` declarations remain available for languages
that want conventional `target(arguments)` call syntax; they are unrelated to
`$` and to grouping's statement fallback.

### D10. Block language syntax and command restriction

Decision: replace `{} :: languageName` in statement signatures with
`{ languageName }`. Interpret that form only while parsing `stmt` shape
declarations.

Decision: remove custom body-language annotations from `cmd`. Command bodies are
always executable content in the fixed shell command-body language. Programs
that require custom block parsing must use a `stmt` declaration with an inline
implementation suffix.

### D11. Structured data scope

Decision: do not add general-purpose list or record construction to this
feature. `ScalarValue` is limited to numbers, strings, and booleans. `ShellValue`
also includes opaque expression and statement AST nodes, `SyntaxValue` objects,
nested blocks, readonly repeated bindings, and `ExecutionResult` objects. Any of these may flow through
statement or expression results, including custom operator results, but only
`ScalarValue` may be used as `context`. Flowing an opaque repeated binding does
not make it a constructible or mutable general-purpose list.

Implementations represent structured state as JSON text. The core runtime treats
that JSON as an ordinary string and does not parse, validate, query, or mutate
it. An implementation may use an external utility such as `jq` when a
host-provided command/value bridge is available. General-purpose data structures
remain a separate roadmap feature.

### D12. Handler invocation scopes and assignment

Decision: a custom statement or operator implementation retains the exact scope
in which it is declared. Every invocation creates a fresh child scope whose
parent is that declaration scope. The invocation's `context` and source-level
parameters are immutable bindings in the child scope. They shadow same-named
outer bindings, and an attempted assignment to one is an error rather than a
write to a shadowed outer binding.

Reads search from the innermost current scope outward and use the first matching
binding. Assignment performs the same search: it updates the first matching
mutable binding in the scope where that binding was found, errors if the first
match is immutable, and creates a new mutable binding in the innermost current
scope when no binding exists. Explicitly qualified outer-scope reads and writes
are deferred. In the first implementation, code that needs an otherwise
shadowed outer value must avoid the parameter-name conflict.

The handler invocation scope is used to run the handler body, but it is not
inserted into the evaluation environment of a caller-supplied expression or
block. For `$ (evaluate context condition)`, ordinary handler lookup first
retrieves the expression-node handle from the invocation parameter named
`condition`. `evaluate` then evaluates that node from the implementation's
declaration scope. If the node is itself the identifier `condition` and that
declaration scope binds `condition` to `99`, evaluation returns an
`ExecutionResult` whose expression value is `99`;
`$ (result-value context $ (evaluate context condition))` extracts `99`. The
identifier does not resolve back to the invocation parameter.

The interpreter carries the current scope in its execution frames. Recursive
and nested calls therefore receive distinct invocation-scope objects. Leaving a
frame on normal completion, operator `return`, or error propagation restores
the caller's frame and scope naturally; invocation bindings are not implemented
by overwriting and later restoring entries in a shared map.

### D13. Language fallback statements

Decision: fallback is represented by the reserved statement name
`__fallback__`. It is not a host dispatcher callback or an implicit OS-command
path. Each language may own its own `__fallback__` declaration and completed
handler, written as an ordinary language handler or supplied as a TypeScript
primitive. This is normal language-scoped statement ownership, not an exception
to the ownership of other statements. `__fallback__` differs only in the special
name-miss dispatch that selects it.

The fallback declaration has the ordinary statement shape:

```text
stmt __fallback__ command arguments...
```

`command` and `arguments...` use the normal statement-part parsing and binding
rules already defined by the common declaration model. When source such as
`git status --short` has no exact local declaration, fallback parsing behaves as
if the declaration were invoked with `git` as `command` and the remaining source
as the repeated `arguments` part. Quoting, expression boundaries, validation,
and repeated binding behavior are therefore inherited from the declared
statement parts; fallback adds no alternate parsing policy.

For every source statement, the parser first looks for an exact statement name
owned by the active language. An exact match always wins, even if its
declaration is unresolved, its arguments fail validation, or its handler later
returns an error. Only the complete absence of that name from the active
language triggers `__fallback__`. This prevents an OS executable from shadowing
or rescuing any declared statement.

Fallback is itself declared syntax. The unmatched source must parse completely
against the active language's local `__fallback__` `StatementDefinition`
before its handler can run. No raw, partially parsed, or parse-failed invocation
is sent directly to an OS executor. The resulting fallback invocation is an
ordinary `NamedStatementNode` whose `name` is `__fallback__` and whose `raw`
field retains the unmatched source. Its `command` binding contains the unmatched
source name and its `arguments` binding contains the ordinarily parsed repeated
remainder. It executes through the normal statement dispatcher and returns the
common `StatementResult`. If the language does not provide a completed `__fallback__`,
the fallback source does not satisfy its declaration, or its handler cannot be
resolved, execution produces a descriptive error.

The fallback handler may implement OS-command behavior, but the core dispatcher
does not assume that it does. A language can instead use its fallback to report
a domain-specific error or perform another declared behavior. The active
statement or block language exclusively determines whether `__fallback__` is
available; fallback is never inherited from the caller's language.

The startup `shell` language declares `shell.__fallback__` with the canonical
shape above and receives a TypeScript primitive binding that dispatches OS
commands. Other languages neither inherit that primitive nor share shell's
fallback binding. They may provide their own handler or omit fallback.

Writing `__fallback__ ...` directly is permitted and follows ordinary exact-name
statement dispatch. This is a low-level consequence of it being a real statement
and is not advertised as a user-facing feature.

`cmd` declarations are language-owned statements in the same namespace as
`stmt` declarations. Defining a command creates an exact local statement entry
whose implementation uses the common built-in command handler to evaluate its
arguments greedily and execute its stored body. Exact-name lookup therefore
finds a defined command before considering `__fallback__`; the fallback handler
does not participate in defined-command dispatch.

This explicit hook replaces anonymous `Language.defaultStatement` parsing and
the separate runtime notion of strict versus permissive unknown statements. A
language without a usable `__fallback__` rejects an unmatched name; a language
with one parses only through that declared signature. Implementation may retain
temporary compatibility fields while migrating, but the completed design has
one fallback mechanism.

### D14. Language-scoped declaration syntax

This is consequential because the syntax must express ownership at declaration
time, preserve the three-phase primitive bootstrap, support interactive or late
language extension, and prevent an unqualified statement from entering a global
registry.

Decision: declare statements and commands inside their owning language and use
an explicit `extend language` form for later additions or same-language
completion:

```text
language application operators application_ops {
  stmt choose condition (then {}) [else {}] implement context body { shell } {
    # handler body
  }

  cmd greet name {
    echo hello $name
  }

  stmt __fallback__ command arguments... implement context body { shell } {
    return $ (result --error "unknown application statement")
  }
}

extend language application {
  stmt unless condition (then {}) implement context body { shell } {
    # handler body
  }
}
```

An unresolved primitive is written as a bodyless local declaration and bound by
its qualified TypeScript key:

```text
language shell operators shell_ops {
  stmt echo extras...
  stmt __fallback__ command arguments...
}
```

The host binds `shell.echo` and `shell.__fallback__`; a bodyless declaration in
another language is a different unresolved entry. A later `extend language`
block may complete an unresolved local statement by repeating its exact shape
with `implement`, subject to the existing validate-before-write rules.

Initial `language` creation requires an operator-set selection and rejects
duplicate local statement or command names. An
`extend language` block may add a new local `stmt` or `cmd`, or complete one
unresolved local `stmt`; it cannot replace the language's operator set, alter an
existing signature, replace a completed handler, or affect a same-named entry in
another language. Top-level unqualified `stmt` and `cmd` declarations are
rejected.

Standalone `stmt ...` and `cmd ...` snippets elsewhere in this plan are
abbreviated statement-shape fragments assumed to be inside their stated owning
language; they are not valid top-level declaration source. Implementation must
not preserve the current global declaration behavior merely to keep an
abbreviated example executable.

### D15. Value-bearing statement options

This is consequential because `result`'s six mutually exclusive options
(`--complete`, `--expression value`, `--return value`, `--break`, `--continue`,
`--error message`) need a `StatementDefinition` capability that does not exist
today: `StatementQualifierDefinition` (`parser/statement.ts`) represents only a
boolean flag keyword, with no way to attach a value to an option or to declare
mutual exclusivity among a group of options. The same shape is reused
throughout this plan (`--count` is flag-only; `--error message` is
value-bearing), so its parsing and validation rules must be settled before
task 3.1 declares `result` and the other handler runtime commands.

Decision: extend the statement-option model with two option kinds plus an
optional mutual-exclusivity grouping.

- A **flag-only option** (`--name`) is the existing boolean qualifier: present
  or absent, bound to `true`/`false`.
- A **value-bearing option** (`--name value`) additionally consumes exactly one
  expression-valued argument named `value` immediately following its keyword.
  It is bound like any other expression-valued part: an unevaluated
  `ExpressionNode`, following the same deferred-value rules as a positional
  argument.
- Declaring a set of options as an **exclusivity group** (for example
  `result`'s six options) requires exactly one option in that group to be
  present in a given invocation. Zero or more than one present option is a
  descriptive parse-time error identifying the group and the offending option
  names; the error is raised by the statement parser before the handler is
  invoked, not by the handler body.
- Options outside a declared exclusivity group remain independently optional,
  as `[--count]` already is for `child`.
- A value-bearing option's value is parsed with the same positional-boundary
  rules as an ordinary required argument: it consumes exactly one expression up
  to the next declared clause, option, or statement boundary.
- Option keywords participate in statement-boundary detection exactly like
  qualifier keywords do today: encountering a declared `--name` stops
  positional-argument or vararg collection for the current part, per the
  existing boundary rules.
- A value-bearing option may not itself contain a vararg or repeated part in
  this first implementation.

`stmt result [--complete] [--expression value] [--return value] [--break]
[--continue] [--error message]` declares one exclusivity group over all six
options; declaring the same six as independent optional value-bearing options
instead would not enforce "exactly one" and is rejected.

## Implementation Plan

### 1. Specify runtime values and handler behavior

- [x] 1.1 Decide D1: implementation bodies are always written in the startup-declared `shell` language; do not introduce a dedicated handler language.
- [x] 1.2 Decide D2: use one complete language-scoped `stmt` declaration surface for syntax and optional implementation; permit an exact matching declaration in the same language to complete an unresolved signature, while retaining separate parser and runtime registries.
- [x] 1.3 Decide D3: evaluation policy belongs to statement context; `cmd` is greedy and `stmt` is deferred.
- [x] 1.4 Decide D7 AST exposure and source metadata: convert opaque expression- and statement-node bindings to immutable normalized `SyntaxValue` data, expose no offsets, line numbers, or columns initially, and defer optional source spans.
- [ ] 1.5 Define `ScalarValue`, the common dynamic `ShellValue` union, opaque `ExpressionNode`, `StatementNode`, and `NestedBlockNode`, immutable `ExecutionResult` and `SyntaxValue` objects, readonly repeated bindings, `StatementResult`, and `ExpressionResult`; require every built-in and user-command executor to return `StatementResult`, and specify exactly-once output propagation, runtime narrowing, top-level value discard, and `$()` value consumption.
- [ ] 1.6 Use the decided environment and scope model: implementations retain their exact declaration scope; nodes capture no environment; every handler call creates a fresh child invocation scope containing immutable parameters; `evaluate` and `execute` cross back to the declaration scope after their node or block arguments have been resolved; and every body return restores the caller frame. Complete the remaining recursion-limit and output-collection specifications.
- [ ] 1.7 Document the exact behavior of every initial handler runtime command, including the `result` constructor, `result-*` decomposition commands, and each command's top-level and `$()` result handling.
- [ ] 1.8 Specify the parse-now/evaluate-later contract and expression-boundary errors as public semantics.
- [ ] 1.9 Define a parser-change checklist based on the canonical common `stmt` model and apply it to every later task.
- [x] 1.10 Decide D6: register startup signatures, bind the TypeScript primitive subset, then process nonprimitive declarations and user source in order.
- [x] 1.11 Decide D8: give every `stmt` and operator handler a single `context` binding instead of a prescribed storage primitive.
- [x] 1.12 Decide D9: shell declares `$` as an ordinary primitive prefix operator whose evaluator dispatches a nested statement produced by grouping's generic statement fallback, using the same parser and dispatcher used at the top level, then consumes its value.
- [x] 1.13 Decide the generic call argument grammar: delimiters contain zero or one expression AST; multiple logical arguments use the selected binary comma operator, trailing commas and whitespace-separated values are rejected, and call `SyntaxValue` currently flattens the top-level comma spine after the target.
- [x] 1.14 Decide statement scope: every statement declaration, syntax definition, implementation, and declaration scope is owned by one language; names are unique only within that language; and TypeScript bindings use qualified `(languageName, statementName)` keys.
- [x] 1.15 Decide `return` semantics: handler-level `return` exits the current implementation body; an operator implementation may return any dynamic `ShellValue`, while a statement implementation must return an `ExecutionResult` explicitly constructed with `result`. Returns in caller blocks become `return` outcomes, and operator fallthrough becomes an error result.
- [x] 1.16 Decide D11 structured data scope: `ScalarValue` remains number, string, or boolean; JSON strings are the structured interchange format; AST/syntax/block/repeated/result objects may flow opaquely through the common `ShellValue` result channel; and general-purpose list and record construction remains deferred to the project's data-structure roadmap.
- [x] 1.17 Decide nested syntax access: `syntax` returns the complete detached `SyntaxValue` by default, while an optional zero-based `at` child path returns a corresponding original expression-, statement-, or block-node handle and rejects paths ending on normalized-only metadata wrappers.
- [x] 1.18 Decide D12 invocation scope and assignment semantics: use a fresh child scope per call, immutable invocation parameters, inner-to-outer lookup, assignment to the first matching mutable binding, innermost creation for undefined names, and execution-frame unwinding on every exit path.
- [x] 1.19 Revise D4 execution results: retain `StatementResult` for exactly-once output transport and required execution control, expose immutable output-free `ExecutionResult` objects from `evaluate` and `execute`, and inspect them through declared `result-*` statements.
- [x] 1.20 Decide captured outcome propagation: add `result` as the constructor for every `ExecutionResult` kind; require custom statement implementations to inspect captured outcomes and explicitly construct the result they return; provide no automatic propagation of outcomes contained in values; and make ordinary statement bodies propagate their child statement's direct non-complete execution outcomes structurally.
- [x] 1.21 Revise the TypeScript value model: require every built-in and user command to return `StatementResult`; allow every `ShellValue` in statement and expression value positions; keep shell values dynamically typed and opaque; require runtime narrowing through `value-kind` and specialized commands; and exclude `expression` from the internal statement-control union by normalizing it to `complete` plus `StatementResult.value`.
- [x] 1.22 Complete scalar AST inspection: make indexed `child` return one detached syntax value, add `child --count` for cardinality, reserve structural traversal to those commands, and define the initial per-kind scalar `field` matrix.
- [x] 1.23 Decide `$`'s nested-statement representation: generalize grouping to fall back to a full statement parse when its parenthesized content is not one complete expression, producing a `GroupedStatementExpressionNode` containing one `StatementNode`; keep ordinary call arguments expression-only; add statement syntax variants, statement-node shell values and narrowing, and statement-aware `syntax`, `child`, and `field` behavior.
- [x] 1.24 Decide D13 fallback dispatch: use a language-owned `__fallback__` statement, trigger it only when the source name matches no declaration in the active language, require fallback source to parse fully, give every exact declared name precedence over OS commands, and produce an error when no completed fallback is available.
- [x] 1.25 Decide fallback ownership: every language owns an independent `__fallback__` declaration and handler under the same scoping rules as its other statements; only name-miss dispatch is special.
- [x] 1.26 Decide the fallback signature and invocation binding: use `stmt __fallback__ command arguments...`; map the unmatched source name to `command` and parse the remainder as ordinary repeated `arguments` using the common statement rules.
- [x] 1.27 Decide user `cmd` integration: a command is a language-local statement in the same namespace, backed by the shared built-in command handler, and exact-name dispatch resolves it without involving `__fallback__`.
- [ ] 1.28 **Decision: define the initial OS-backed fallback result contract.** Specify stdout, stderr, exit status, spawn failures, `StatementResult.output`, optional `StatementResult.value`, and `$()` behavior for shell's OS-command handler.
- [x] 1.29 Decide direct `__fallback__` source behavior: allow direct exact-name invocation as ordinary statement behavior, but do not advertise it as a feature.
- [x] 1.30 Decide D14 language-scoped declaration syntax: place `stmt` and `cmd` definitions inside the owning `language`, use `extend language` for additions and same-language completion, require qualified TypeScript bindings, and reject unqualified top-level definitions.
- [ ] 1.31 Decide D15: extend the statement-option model with value-bearing options (`--name value`) alongside existing flag-only options, plus a declared mutual-exclusivity group that requires exactly one present option and reports a descriptive parse-time error otherwise; declare `result`'s six options as one exclusivity group.

### 2. Separate runtime dispatch from shell command dispatch

- [ ] 2.1 Introduce a reusable statement execution context and `StatementResult` body executor instead of extending parser types with handlers.
- [ ] 2.2 Add language-owned statement runtime companions to `ShellEnvironment`, including unresolved, TypeScript-bound, language-bound, and shared-command-handler binding states keyed by `(languageName, statementName)`.
- [ ] 2.3 Associate every syntax declaration, implementation, and declaration scope with one owning language; permit independent same-name entries in other languages and reject duplicates only within one language.
- [ ] 2.4 Refactor primitive, language-handler, and command-form statement dispatch behind the same `StatementResult` executor boundary; make every `cmd` a qualified local statement entry using the shared built-in command executor; and bind primitives only after their owning-language declarations are available.
- [ ] 2.5 Remove host-level unknown-statement and OS fallback dispatch; route an unmatched source name only through the active language's parsed and completed `__fallback__` statement, with no retry after exact-name parse, binding, or execution failures.
- [ ] 2.6 Add tests proving language-owned declarations may remain unresolved, matching same-language declarations or qualified TypeScript bindings complete them exactly once, use before completion fails at runtime, and duplicate or conflicting same-language completions fail without affecting same-name declarations in other languages.
- [ ] 2.7 Add fallback precedence tests proving an exact local declaration always wins over `__fallback__` and an OS executable of the same name, including unresolved declarations, invalid arguments, and handler errors.

### 3. Declare and parse implementation bodies in shell

- [ ] 3.1 Extend the common `StatementDefinition` model with the D15 value-bearing option and mutual-exclusivity-group syntax, then define shell entries for `if`, `while`, `break`, `continue`, `execute`, `return`, `emit`, and the handler runtime commands, including the six-option `result` constructor, `result-kind`, `result-value`, `result-error`, `result-break`, `result-continue`, `value-kind`, `child [--count] context [ordinal] syntaxValue`, and `syntax context node [at indexes...]`; select those same statements for top-level and `$()` execution without command-specific raw-tail parsing.
- [ ] 3.2 Declare `$` as an ordinary primitive prefix operator with no call-operator declaration; generalize grouping to produce a `GroupedStatementExpressionNode` when its content does not reduce to one complete expression, and give `$`'s evaluator the one special case that dispatches that node's `StatementNode` through the normal statement executor; keep ordinary `CallExpressionNode` arguments expression-only and do not add a separate nested-command registry.
- [ ] 3.3 Extend shell with typed-value handling and the declared handler runtime commands required by implementation bodies; do not introduce a dedicated handler language.
- [ ] 3.4 Extend the bootstrap language-declaration parser with the decided language-scoped `stmt` syntax and recognize the reserved `implement context body { shell } { ... }` suffix, then parse every suffix body with the generic statement parser and resolved shell language.
- [ ] 3.5 Treat a language-owned `stmt` without the inline implementation suffix as unresolved; allow one matching qualified TypeScript or same-language completion, and report an error only if execution reaches it first.
- [ ] 3.6 Store parsed inline implementation nodes, source locations, and binding state in the owning language's runtime companion rather than `StatementDefinition`.
- [ ] 3.7 Reject malformed inline implementation suffixes, duplicate `implement` suffixes, reserved-keyword signature collisions, repeated unresolved declarations in one language, signature-mismatched same-language completions, and second or conflicting implementations; allow unrelated same-name declarations in different languages.
- [ ] 3.8 Add parser and shell tests proving every statement and implementation construct resolves through its owning language declaration.
- [ ] 3.9 Replace source-prefix dispatch in function and handler bodies with generic `StatementNode` dispatch.
- [ ] 3.10 Parse entries inside `operators` bodies with an operator-definition `Language`, replacing manual token interpretation.
- [ ] 3.11 Audit `cmd`, `func`, `operators`, `language`, and `stmt` raw-tail parsing; remove or migrate `func` to the call-operator model and enrich `StatementDefinition` where necessary.
- [ ] 3.12 Document the minimal bootstrap exceptions needed to parse `operators`, `language`, `extend language`, and nested `stmt`/`cmd` declaration entries; bootstrap code may construct declarations, but may not introduce a second user-visible grammar.
- [ ] 3.13 Parse `{}` and `{ languageName }` as inherited and explicit block-language metadata only in `stmt` signatures.
- [ ] 3.14 Remove `:: languageName` parsing from statement declarations and reject it with a migration-oriented error.
- [ ] 3.15 Make `cmd` a language-scoped statement declaration using the shared command handler; remove custom body-language capture and ensure every command body uses the fixed shell command-body language.
- [ ] 3.16 For every parser file modified in this phase, remove specialized parsing from the touched path or document a bounded temporary exception and follow-up removal task.
- [ ] 3.17 Define and parse `prefix`, `infix`, generic `call`, and optional head-restricted `call head symbol` declarations, including the generic zero-or-one expression operand, comma-expression argument representation, opening-delimiter operator identity, the supported `()`, `{}`, and `[]` matched pairs with declaration-time rejection of any other or mismatched `open`/`close` pair, head precedence over generic calls, duplicate-key rejection, and body arity validation. `$` is declared as an ordinary `prefix` operator and never uses this call-declaration model.
- [ ] 3.18 Remove the hard-coded identifier-call loop from the expression parser; make call continuation depend exclusively on parser state and the selected opening delimiter, with no lookahead or special-casing for any operator symbol, including `$`.
- [ ] 3.19 Make every positional statement-argument parser path use the same selected-call boundary rule: without an applicable generic or head-restricted call operator, `foo (1)` can bind two expression arguments; with an applicable operator, it binds one call expression.
- [ ] 3.20 Make `language` own local `stmt`, `cmd`, and reserved `__fallback__` declarations while selecting an operator set; do not add a separate expression-form registry or host-level unknown-name policy.
- [ ] 3.21 Create the authoritative startup declaration script: declare `shell_ops`; declare every built-in shell statement and command form inside the named `shell` language, including `$` as an ordinary primitive `prefix` operator; include `stmt __fallback__ command arguments...`; and omit a generic call operator.
- [ ] 3.22 Implement the three-phase bootstrap: register startup signatures and `shell` with the minimal declaration seed, bind TypeScript primitives, then process nonprimitive declarations and user source in order; discard seed-only definitions once the primitive declaration surface is executable.
- [ ] 3.23 Replace TypeScript-constructed built-in statement and operator signatures with declarations produced inside the startup `shell` language and the operator set it selects.
- [ ] 3.24 Bind TypeScript primitive statement handlers by validated `(languageName, statementName)` keys and primitive operator evaluators by their existing qualified operator keys after signature registration and before nonprimitive or user source processing.
- [ ] 3.25 Bind TypeScript primitive statements only to matching unresolved `stmt` declarations in the named language, including `shell.__fallback__`, and primitive operators only to matching body-less declarations.
- [ ] 3.26 Reject duplicate, incompatible, declaration-less, or already language-completed qualified primitive bindings during registration; permit unresolved statements and unbound operators and report them only when used before completion.
- [ ] 3.27 Add tests proving startup signatures parse first, language-owned registries exist before implementation binding, TypeScript bindings occur before nonprimitive and user source, and no TypeScript handler can execute without a declaration in its qualified language.
- [ ] 3.28 Implement exact-name-first parser resolution followed by `__fallback__` parsing only when no exact local declaration exists; require complete validation through one `StatementDefinition` on both paths and replace anonymous `defaultStatement`/`strictStatements` unknown-name behavior with this explicit hook.
- [ ] 3.29 Enforce the decided direct-invocation rule and reject invalid fallback declarations, duplicate fallback configuration, and any bypass of the fallback parser contract.

### 4. Build the handler runtime

- [ ] 4.1 Use ordinary `StatementNode[]` as the parsed handler-body representation and execute every body through the same statement-body executor used by built-in statements.
- [ ] 4.2 Implement a fresh handler invocation scope per call, parented by the implementation's declaration scope; bind typed `context` and source-level parameters there as immutable values without converting them to source strings; and implement inner-to-outer reads, assignment to the first matching mutable binding, immutable-binding errors, and innermost creation for undefined names.
- [ ] 4.3 Implement `evaluate`, `execute`, the six-option `result` constructor, immutable `ExecutionResult` production, `value-kind`, the `result-*` decomposition commands, `syntax`, AST inspection, `present`, `emit`, `break`, `continue`, and handler-level `return` with boundary-specific dynamic-value validation; make expression evaluation result-aware so `$()` can propagate a nested statement's non-complete execution outcome without coercing it to an expression value.
- [ ] 4.4 Generalize statement-body execution and existing `if`, `while`, and `for` logic so every body appends child output once, continues only on `complete`, propagates return and error, lets loops consume break and continue, and lets non-loop parents propagate break and continue.
- [ ] 4.5 Enforce operator and statement handler return contracts; make statement fallthrough `complete` and operator fallthrough `error`; capture caller-block outcomes in `execute`; implement top-level statement-value discard and `$()` value consumption; and keep `StatementResult.output` separate from `ExecutionResult` with exactly-once parent propagation.
- [ ] 4.6 Carry the current scope in interpreter execution frames; add recursion and loop guards; and verify every body return restores its caller's scope without shared-map restoration or exception-only control paths.
- [ ] 4.7 Use implementation-defined error messages, require short descriptive messages from built-ins, propagate errors as `ExecutionResult` values, and make the top-level runner report an unhandled error through a host-provided error sink and halt before executing later statements; bind the Node adapters' sink to standard error without introducing Node dependencies into the core or browser build.
- [ ] 4.8 Bind the declared `context` parameter for every `stmt` and operator handler invocation: use `""` at the top level and require an explicit value for nested handler invocation (D8).
- [ ] 4.9 Implement the decided `__fallback__` invocation binding and common `StatementResult` boundary; keep any Node OS adapter behind a declared fallback primitive and out of the browser-compatible core.

### 5. Execute custom statements

- [ ] 5.1 Convert parsed `NamedStatementNode` arguments, clauses, qualifiers, and blocks into typed handler bindings.
- [ ] 5.2 Resolve an exact declaration owned by the active language before considering `__fallback__`; dispatch the fully parsed node only through its resolved ordinary or fallback implementation and never retry through another path.
- [ ] 5.3 Ensure unselected blocks are never parsed or executed beyond the existing opaque nested-block representation.
- [ ] 5.4 Ensure repeated `evaluate` and `execute` calls repeat observable work and return independent `ExecutionResult` handles, while repeated inspection of one handle never replays output.
- [ ] 5.5 Verify block-language inheritance and explicit block language annotations.
- [ ] 5.6 Add end-to-end language-local `choose`, `unless`, `repeat-while`, and multi-block examples, including a language-local `if` that does not affect the distinct primitive `shell.if` used by handler bodies.
- [ ] 5.7 Verify multi-token expressions are parsed as one argument up to declared clause and block boundaries.

### 6. Add scoped AST reflection

- [ ] 6.1 Keep offsets, line numbers, and columns out of the initial `SyntaxValue`; preserve an extensible optional source-span shape for future work.
- [ ] 6.2 Implement complete recursive, immutable `ExpressionNode` and `StatementNode` to `SyntaxValue` conversion for every node variant, semantically relevant field, and child relationship, including named arguments, blocks, qualifiers, recursive clauses, raw arguments, and assignments; implement the corresponding normalized-child traversal used by `syntax ... at ...` and do not store parser-node references in the returned `SyntaxValue`.
- [ ] 6.3 Implement `syntax` child-path selection plus `kind`, the complete expression- and statement-kind `field` matrix, zero-based `child context ordinal syntaxValue` lookup, and `child --count context syntaxValue`; return one detached, non-evaluable child or a scalar count per call, return only original expression-, statement-, or block-node handles from `syntax at`, reject paths ending on normalized-only wrappers, validate flag/ordinal combinations, require non-negative integer ordinals and literal non-negative path indexes, and defer `source` until source spans are exposed.
- [ ] 6.4 Keep `context` scalar and verify JSON strings pass unchanged through it; allow opaque `ShellValue` objects and repeated bindings to flow through `StatementResult.value`, `ExpressionResult.value`, `ExecutionResult` expression/return values, `result-value`, and custom operator returns without adding general-purpose list or record construction, inspection, or mutation.
- [ ] 6.5 Implement explicit `context` parameters for `stmt` and operator handlers, including empty-string top-level invocation and explicit nested values.
- [ ] 6.6 Ensure handler runtime commands pass the context supplied in their syntax to child handler invocations.
- [ ] 6.7 Add end-to-end example handlers that inspect every expression- and statement-node variant and its semantically relevant fields, including identifiers, literals, operators, ordinary calls, `$()` statement calls, comma trees, arguments, blocks, qualifiers, clauses, assignments, and nested components through `syntax`, without asserting any particular storage mechanism.
- [ ] 6.8 Verify retained `SyntaxValue` data contains no environment reference and cannot mutate parser ASTs.

### 7. Integrate expression operators

- [ ] 7.1 Remove `func` as a separate expression implementation mechanism; provide migration or replacement guidance through the call-operator model.
- [ ] 7.2 Extend expression evaluation to resolve custom prefix, infix, and call operators through one runtime dispatch path.
- [ ] 7.3 Ensure every operator implementation runs only when its containing expression is evaluated by its consuming context.
- [ ] 7.4 Require the executed path of every custom operator invocation to return one `ShellValue`; permit opaque AST, syntax, block, repeated, and `ExecutionResult` values to flow through expression results, reject runtime fallthrough without static reachability analysis, and preserve consumer-specific runtime type validation.
- [ ] 7.5 Add tests covering greedy command arguments, deferred statement arguments, explicit repeated statement evaluation, and call-operator execution during evaluation.

### 8. Bind custom operators

- [x] 8.1 Decide D5: use direct operator implementation bodies; an omitted body declares a primitive eligible for a TypeScript binding.
- [ ] 8.2 Define the selected `prefix`, `infix`, generic `call`, and head-restricted `call` statement forms; require their optional parameter-and-body group to be all-or-nothing; validate prefix arity one, infix arity two, generic target-plus-optional-expression arity, and only the `()`, `{}`, and `[]` call-delimiter pairs, rejecting any other or mismatched `open`/`close` pair at declaration time. `$` is declared as an ordinary bodyless `prefix` operator bound to a `PrimitiveOperatorBinding` implementing the grouped-statement dispatch described under D9.
- [ ] 8.3 Store parsed handler bodies and primitive host bindings outside `OperatorSetDefinition` or in a runtime companion object; permit unbound selected primitives and reject them only when evaluation reaches them.
- [ ] 8.4 Dispatch prefix, infix, and call evaluation through the active operator-set runtime binding.
- [ ] 8.5 Retain current built-in arithmetic behavior through explicit TypeScript primitive bindings.
- [ ] 8.6 Add precedence, associativity, empty and comma-expression call parsing, custom-body evaluation, primitive evaluation, runtime-only missing-binding errors, and cross-language isolation tests.

### 9. Integrate and document

- [ ] 9.1 Update shell and language documentation with `stmt` and operator implementation syntax, including languages that omit the call operator.
- [ ] 9.2 Document the evaluation-context difference among `cmd`, `stmt`, and expression operators.
- [ ] 9.3 Add examples showing greedy command evaluation, selective statement evaluation, and AST-backed declaration data.
- [ ] 9.4 Run type checking, the complete test suite, and browser build verification.
- [ ] 9.5 Document `__fallback__` declaration, parsing, precedence, error, and host-capability behavior, including examples of languages with and without OS-backed fallback.

## Required Test Cases

- A custom `choose` executes exactly one branch and uses the primitive shell
  `if` in its implementation without recursive self-dispatch.
- `choose 3 == 4 then { ... } else { ... }` binds one parsed condition expression, not three raw arguments.
- A custom `unless` reverses branch selection without evaluating both blocks.
- A custom `repeat-while` re-evaluates its condition for every iteration.
- An omitted optional block binds `""`, can be guarded with `present`, and is
  rejected by `execute`; `present` does not evaluate a supplied handle.
- A block with an explicit language executes in that language.
- The startup script registers `shell` as the default shell-execution language,
  declares every built-in shell statement locally, and selects its operator set.
- `language application operators application_ops { ... }` owns every nested
  `stmt` and `cmd`; an unqualified top-level `stmt` or `cmd` is rejected.
- `extend language application { ... }` can add a local statement or command and
  can complete an unresolved statement only by repeating its exact signature.
- `extend language` rejects an operator-set change, an altered existing
  signature, replacement of a completed handler, and changes to another
  language's same-named declaration.
- TypeScript statement binding requires the qualified language and statement
  name; an unqualified or wrong-language binding is rejected even when another
  language contains the same local name.
- A source name declared by the active language is parsed and dispatched only as
  that declaration; an OS executable with the same name is never considered.
- An exact local declaration that is unresolved, receives invalid syntax, or
  returns an error does not retry through `__fallback__`.
- A source name absent from the active language is parsed completely through
  that language's `__fallback__` declaration before its handler runs.
- `stmt __fallback__ command arguments...` binds the unmatched source name and
  repeated remainder using the same parser, quoting, validation, and binding
  rules as an ordinary direct invocation of that declaration.
- Two languages may implement different `__fallback__` handlers; executing the
  same unmatched source in each language invokes only its local handler.
- `shell.__fallback__` is a qualified TypeScript primitive that dispatches OS
  commands; another language does not inherit or share that binding.
- A language-local `cmd greet ...` is an exact statement-name match and executes
  through the shared command handler without invoking `__fallback__`.
- Direct `__fallback__ ...` invocation is accepted as an exact local statement
  call, although user documentation does not present it as a normal feature.
- An unmatched source name produces a descriptive error when the active language
  has no completed `__fallback__` handler or when the source fails fallback
  parsing.
- A block uses only its retained language's `__fallback__`; caller and shell
  fallback behavior is not inherited.
- A fallback handler returns the common `StatementResult`, and OS execution is
  reachable only through a declared fallback implementation rather than direct
  unknown-name dispatch.
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
- Grouping `(evaluate context condition)` on its own, with no preceding `$`, does not reduce to one complete expression, so it falls back to a full statement parse and produces a `GroupedStatementExpressionNode` wrapping the `evaluate context condition` `NamedStatementNode`.
- `$ (evaluate context value)` parses as an ordinary `PrefixExpressionNode` whose operator is `$` and whose operand is that same `GroupedStatementExpressionNode`; ordinary `CallExpressionNode.args` remains `ExpressionNode[]` and is unaffected.
- `$` never triggers call continuation and needs no call-operator declaration: whether or not a language also selects a generic `()` call operator, `$ (value)` still parses `$` as a prefix operator applied to grouped content, and `foo (1)` still follows the ordinary call-operator boundary rule independent of `$`.
- While expecting a value, `(` groups an expression, including after an infix
  operator as in `2 + (1)`; after a parsed left value, a selected `(` is the call
  operator. `$`, having no call-operator declaration, never causes this
  postfix-call continuation.
- `$ (1 + 2)` is a runtime error: `(1 + 2)` reduces to one complete expression
  rather than a grouped statement, and `$`'s evaluator rejects any operand that
  is not a `GroupedStatementExpressionNode`.
- `$ (foo) + 1` parses as `($ (foo)) + 1`, proving `$`'s declared precedence
  binds only to its immediate parenthesized operand.
- `evaluate`, `execute`, `result`, every `result-*` decomposition command,
  `syntax`, `present`, `value-kind`, `kind`, `field`, and `child` resolve through
  the same declared shell statements at the top level and inside `$()`.
- `$ (evaluate context expression)`, `$ (syntax context expression [at
  indexes...])`, and other nested forms parse one ordinary shell statement and
  dispatch it through the normal shell statement executor.
- Successful `evaluate` returns an immutable `expression` result, and
  `result-value` recovers its `ShellValue` without re-evaluating the expression.
- Normal `execute` returns `complete`; a block return, break, continue, or
  execution error returns the corresponding mutually exclusive result kind.
- `result` constructs every result kind; it rejects zero options, multiple options,
  repeated options, missing values, values supplied to flag-only options,
  and non-string error messages, while accepting every `ShellValue` for
  expression and return values.
- `result-kind` exposes every result kind; `result-value` accepts only
  `expression` and `return`; `result-error` accepts only `error`; and
  `result-break` and `result-continue` return booleans for every kind. Invalid
  decomposition produces a short descriptive error result.
- A statement implementation returns an `ExecutionResult` explicitly constructed
  by `result`; `return 5` is a type error at that boundary. An
  operator implementation may return any `ShellValue`, including an opaque
  `ExecutionResult` as expression data.
- Every built-in executor and user-command executor returns the same TypeScript
  `StatementResult` union. No executor returns a bare string, output array, or
  command-specific result type.
- `StatementResult.value`, `ExpressionResult.value`, and the expression and
  return cases of `ExecutionResult` can each contain every `ShellValue`,
  including expression nodes, statement nodes, syntax values, blocks, execution
  results, and repeated bindings.
- `value-kind` distinguishes every outer `ShellValue` kind. Type-specific
  commands reject values of the wrong kind, and shell implementations narrow an
  opaque value before using such a command.
- An identifier `ExpressionNode` and an identifier `SyntaxValue` produce
  `"expression-node"` and `"syntax"` respectively from `value-kind`, proving
  that outer value narrowing uses nominal runtime identity rather than their
  similar public structure.
- A `StatementNode` produces `"statement-node"` from `value-kind`; `evaluate`
  rejects it, while `syntax` accepts it.
- A statement handler returning `result --expression value` is normalized to a
  completed `StatementResult` whose `value` is `value`; `expression` is never a
  `StatementResult.execution` control case.
- A public `return` outcome propagated from a child statement passes unchanged
  through a statement implementation. It is not confused with the private
  `handler-return` produced when that implementation executes its own `return`
  command, and `handler-return` is never exposed to language code.
- Reaching the end of a statement implementation produces `complete`; reaching
  the end of an operator implementation produces an error result.
- A custom statement that calls `execute` explicitly decides whether to ignore,
  consume, translate, or return the contained outcome. Ignoring an error or
  control result is permitted and never causes implicit propagation.
- A statement body executes children in order and stops at the first direct
  break, continue, return, or error result. Non-loop parents propagate that
  result unchanged; loops consume break and continue and propagate return and
  error.
- Break or continue propagates through nested non-loop statement bodies until a
  loop consumes it. If it reaches the top level, it becomes a short descriptive
  error.
- A return in a block passed to `execute` uses the explicit execute context and
  the block's evaluation scope, and is exposed as a return result to the caller.
- An error reaching the top level writes its exact implementation-provided
  message to standard error and prevents every later statement in that source
  execution from running. Built-in statements use short descriptive messages
  and normally propagate existing errors unchanged.
- The core top-level executor reports errors through a host-provided sink; Node
  adapters write that sink to standard error, and the browser build requires no
  Node global or module.
- Output produced by `evaluate` or `execute`, including output produced before
  an error or control-flow outcome, is appended to the parent
  `StatementResult.output` exactly once. Ignoring, retaining, or repeatedly
  inspecting the `ExecutionResult` neither suppresses nor replays that output.
- A retained `ExecutionResult` is immutable and contains no execution-scope or
  environment reference.
- Any statement declared by `shell` is accepted syntactically inside `$()`; if
  its execution is non-complete, `$()` propagates that outcome; if it completes
  without `StatementResult.value`, `$()` produces a descriptive no-value error.
- A non-complete result from a statement nested inside `$()` short-circuits the
  containing expression and reaches the enclosing statement-body executor
  without being coerced to a scalar or losing previously collected output.
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
- An unresolved `stmt` belongs only to its declaring language and has no effect
  in another language, including one with a same-named statement.
- An executable language may select an unresolved `stmt`; invoking it before a
  TypeScript or language completion reports an unimplemented-statement error.
- A statement declaration rejects an inline implementation when it already has a
  TypeScript primitive binding, and rejects a primitive binding when it already
  has an inline implementation.
- `cmd` evaluates every expression-valued argument before its implementation body runs.
- `stmt` evaluates no expression-valued argument before its implementation body runs.
- A custom statement can skip evaluation of an argument.
- A custom statement can evaluate one argument more than once.
- A custom implementation sees live changes made to its declaration scope after
  declaration; declaration does not snapshot or clone scope state.
- Retaining or passing an expression or block node does not retain another
  environment.
- Every custom statement and operator call creates a distinct invocation scope
  parented by its declaration scope; recursive calls never overwrite a shared
  parameter map.
- A recursive `stmt walk` call receives its own parameter bindings; after the
  inner call returns, reads in the outer call still produce the outer argument
  values.
- Invocation parameters, including `context`, shadow outer bindings and are
  immutable. Assigning to such a parameter reports an error and does not fall
  through to a same-named mutable outer binding.
- Reads use the innermost matching binding. Assignment updates the mutable
  binding found by that same lookup, while assignment to an undefined name
  creates a mutable binding in the current innermost scope.
- If a handler assigns to an unshadowed mutable declaration-scope binding, the
  new value remains visible in that declaration scope after the call. A name
  first created by assignment in the invocation scope is absent after the call
  returns.
- Given a declaration-scope binding `condition = 99` and a `stmt choose`
  invocation whose `condition` parameter contains an identifier node also named
  `condition`, `$ (evaluate context condition)` first obtains the node from the
  invocation scope and returns an `expression` result whose value is `99` after
  declaration-scope evaluation. `result-value` extracts that `99`.
- `evaluate` and `execute` do not expose the intermediate handler invocation
  scope to the supplied expression or block. A control-flow implementation may
  deliberately create a further scope for a body it executes.
- Normal completion and direct break, continue, return, and error results all
  return from the current statement body and restore the caller's scope. After
  a failed top-level invocation, a later invocation cannot observe the failed
  call's parameter or local bindings.
- A custom operator, including a call operator, runs only when its containing
  expression is evaluated.
- Custom prefix, infix, and call handlers receive unevaluated operand nodes;
  operands run only when the handler explicitly passes them to `evaluate`, in
  the order and number of times chosen by the handler.
- An operator handler may return any `ShellValue` through nested lexical `if`,
  `while`, and `for` bodies. A statement handler must instead return an
  `ExecutionResult`, such as `return $ (result --return 5)`.
- A return in a caller block run by explicit `execute` becomes a `return` result
  and does not become the calling statement's outcome unless that implementation
  explicitly returns an appropriate result.
- A custom operator invocation whose executed path falls through produces a
  missing-return error result without requiring static reachability analysis;
  consumers retain responsibility for numeric or other type requirements.
- A custom operator may return any `ShellValue`, including an AST node,
  `SyntaxValue`, nested block, repeated binding, or `ExecutionResult`. A
  consumer such as arithmetic rejects a value whose runtime kind it cannot use.
- Structured handler context is passed as JSON text. The runtime treats it as an
  ordinary string and does not add JSON parsing or collection operations.
- `execute` exposes an output-free `ExecutionResult` to shell code while its
  internal `StatementResult.output` continues through normal output handling.
- `syntax` does not evaluate an expression-node operand or execute a
  statement-node operand.
- `syntax context node` returns the complete detached `SyntaxValue` for either
  accepted node kind.
- The default `syntax` result exposes every semantically relevant field and
  child relationship of every supported expression- and statement-node variant;
  source locations are the only intentionally deferred AST metadata.
- Normalizing `$ (evaluate context value)` produces a prefix operator syntax
  value whose one operand is a `statement` syntax value for `evaluate`; it does
  not execute `evaluate`.
- `syntax context statementCall at 0` returns the original `StatementNode`.
  Deeper paths can return original expression or nested-block handles, while a
  path ending on an `argument`, `block`, `qualifier`, or `clause` metadata
  wrapper is rejected.
- For a left-associated comma AST for `f(1, 2, 3)`, `syntax context arguments
  at 0 1` returns the original node for `2`; passing that result to `evaluate`
  evaluates only `2` and produces an `expression` result whose value is `2`.
- `syntax ... at ...` rejects a missing index, negative or non-integer index,
  out-of-range index, descent through a leaf, and selection of a normalized-only
  metadata wrapper without evaluating or executing the source node.
- `child context ordinal syntaxValue` returns exactly one detached child
  `SyntaxValue`; it accepts zero-based non-negative integer ordinals and rejects
  invalid or out-of-range ordinals without returning a repeated binding.
- `child --count context syntaxValue` returns zero for leaf kinds and the
  `operands` or `children` count for composite kinds; it rejects an ordinal,
  while indexed `child` rejects a missing ordinal.
- A retained `SyntaxValue` is immutable, contains no environment reference, and
  cannot mutate parser ASTs.
- `field` implements the documented scalar matrix for expression and statement
  syntax kinds, including statement names and raw spelling, part names and
  ordinals, qualifier state, raw values, and nested-block content. All other
  fields, including `operands` and `children`, produce a descriptive error.
  `SyntaxValue` exposes no offset, line, or column in the first implementation.
- A `stmt` or operator handler declares and receives a single `context` parameter distinct from its source-level parts or operand parameters.
- A top-level statement or operator invocation passes `""` as its handler's `context` parameter without changing source syntax.
- A nested handler operator or `execute` invocation passes its child's context explicitly; it does not inherit the caller's context.
- Built-in and custom handler statements produce the same parsed node shape for the same declared signature.
- Every built-in statement and operator obtains its signature from the startup
  script before its TypeScript handler is bound.
- Startup fails if a supplied TypeScript primitive statement or
  primitive-operator handler has no matching qualified declaration or conflicts
  with a language implementation. A same-named declaration in another language
  is not a match. An unresolved statement or unbound operator does not fail
  startup; it reports an error only if execution or evaluation reaches it before
  a permitted completion.
- Startup registers signatures first, binds the TypeScript primitive subset
  second, and only then processes matching nonprimitive completions such as
  `expr` and `raw` followed by user source.
- Handler control flow and operator-definition entries execute without source-prefix or manual token dispatch.
- Every statement parser path changed by this work is driven by a common `stmt` declaration; no changed path introduces statement-specific grammar.
- A syntax capability missing from `stmt` is implemented in the shared declaration model before it is consumed by a built-in or custom statement.
- `stmt action body { custom_lang }` records `custom_lang` as block metadata.
- `{ custom_lang }` in an invocation remains ordinary block content rather than an annotation.
- `cmd` rejects both legacy `:: languageName` annotations and any attempt to treat body content as a language annotation.
- Two languages may own same-named statements with different syntax and
  implementations; dispatch and qualified primitive binding never cross those
  language boundaries.
- Runtime error text is the exact message selected by the statement
  implementation; built-ins use short descriptive strings.

## Non-Goals For The First Implementation

- arbitrary host objects exposed to language code
- asynchronous handlers
- continuations, resumable blocks, or macros that rewrite ASTs
- mutation of parser ASTs
- parsing or inspecting block bodies as statement ASTs
- implicit overriding of built-in shell statements
- general-purpose list or record values and collection operations
- built-in JSON parsing, validation, querying, or mutation
- handler inspection, suppression, redirection, or replay of buffered statement output
- serialization or persistence of declaration environments
- explicit scope-qualified reads or writes
- custom `cmd` body languages
