# Command Declaration Grammar v2: Specification and Implementation Plan

## Goal
Define a precise and implementable grammar for `cmd` declarations that supports:
- Qualifiers (boolean keyword flags that appear before the command name)
- Positional arguments (required and optional)
- Keyed argument clauses (keyword-led argument groups)
- Quantifiers for keyed arguments (`+`, `*`)
- Vararg declarations (`...`)
- Deterministic invocation parsing with greedy behavior.  Choose simplicity in the parser and intuitive semantics for script authors, even if it some constructions are not possible (e.g. place restrictions on varargs).

This is a **breaking change** and does not preserve legacy declaration syntax.  The new grammar replaces the existing `CommandDefinition`, `CommandArgumentDefinition`, and `ArgumentInfo` structures.  Where concept names overlap (e.g. `CommandDefinition`), the same class/interface name may be retained with an updated shape to match this spec.  All existing argument-declaration and invocation-parsing code paths are superseded by the new implementation.

## Scope Decisions
- Keywords are case-sensitive.
- Duplicate keyed argument keywords in one declaration are invalid.
- Each clause may contain at most one vararg declaration.
- Multiple vararg declarations in one command are only possible by using keyword arguments.
- Qualifiers are boolean flags: present => `true`, absent => `false`.
- The existing scanner will be used for tokenization, possibly with some adjustments, but the changes there 
  should be far less extensive than the changes to the parser
- The scanner must be updated so that three consecutive `.` characters are emitted as a single `...` token (type `"operator"`) rather than three separate delimiter tokens.
- The scanner treats `_` as an identifier token, so no special handling is needed for that character in the scanner.
  It is the parser's responsibility to recognize `_` as a positional argument declaration token based on context.

## Parser Output

The parser returns a `ParsedCommand` for each invocation.  It contains:
- A dictionary of named arguments (from named positional declarations).
- A list of unnamed positional argument values (from `_` and `...` declarations), in invocation order, stored in the `varArgs` field.
- A dictionary of qualifier keywords mapped to their boolean value (`true` if present, `false` if absent).
- A dictionary of keyed clauses, keyed by their keyword, each mapping to a list of clause occurrences.  Each occurrence is itself a `ParsedArguments` containing its own named arguments and unnamed argument list.  This structure is recursive for nested clauses.

```typescript
// ArgumentValue is the existing union type from the parser:
//   type ArgumentValue = ExpressionNode | string | NestedBlockNode;
// It is reused here so that parsed arguments contain fully evaluated
// values rather than raw tokens.

interface ParsedArguments {
  clauseName: string;  // the keyword of the clause or command name for the root clause
  namedArgs: Record<string, ArgumentValue>;
  varArgs: ArgumentValue[];
  clauses: Record<string, ParsedArguments[]>;
}

interface ParsedCommand {
  commandName: string;
  qualifiers: Record<string, boolean>;
  arguments: ParsedArguments;
}
```

## Terminology
  - `...` means zero or more unnamed positional arguments.
  - `_` means one required unnamed positional argument.

## Grammar

All EBNF productions for command declarations are collected here.

```ebnf
CommandDefn      ::= "cmd" QualifierDecl* CommandName ArgDecls Body
Body             ::= "{" CommandText "}"

ArgDecls         ::= ArgDecl* OptionalArgDecl* KeyedDecl* ("..." NamedArgDecl*)?

ArgDecl          ::= "_"
                   | NamedArgDecl

NamedArgDecl     ::= ArgumentName

OptionalArgDecl  ::= "_" "?"
                   | ArgumentName "?"

KeyedDecl        ::= "(" Keyword ArgDecls ")" "+"?
                   | "[" Keyword ArgDecls "]" "*"?

QualifierDecl    ::= Keyword "?"
```

## Declaration Semantics

### Body blocks

The `Body` production (`"{" CommandText "}"`) is parsed and executed using the same nested-block handling that already exists in the current codebase (see `NestedBlockNode` and the nested scope mechanism in the parser).  No new body-handling logic is required; the existing infrastructure for extracting, storing, and evaluating nested blocks is reused as-is.

Similarly the arguments values are handled as `ArgumentValue` according to the existing parser logic, which means that any argument that is a nested block will be fully parsed and stored as a `NestedBlockNode` in the resulting `ParsedCommand` structure.  The command execution logic can then evaluate those blocks as needed.

### Argument declaration ordering (`ArgDecls`)

The `ArgDecls` production enforces a specific ordering: required positional arguments first, then optional positional arguments, then keyed clause declarations, then an optional vararg (`...`) optionally followed by trailing named arguments.

This structure prevents positional ambiguity.  Mandatory arguments can be consumed from the beginning and end of the argument list.  The optional arguments can then be processed using the remaining tokens in the middle.  Trailing arguments after `...` must be given a name to allow for unambiguous binding after the optional section.

Generally there will be no trailing mandatory arguments after the optional section, but the grammar allows for patterns like a copy command with a variable number of source files followed by a required destination:

```
cmd cp _ ... destination
```

### Vararg behavior and restrictions

Varargs (`...`) are greedy and will consume as many tokens as possible, except under the following conditions:
- A keyword is encountered that matches a keyed clause, in which case the vararg stops consuming and the keyword starts the new clause.
- If the current clause contains trailing required positional declarations after the vararg, then the vararg must stop consuming before it would make it impossible to satisfy those required declarations.  Note other clauses are not considered.  Parsing varargs only considers the declarations in the current clause, so if there are required positional declarations after the vararg in a different clause, that does not affect how many tokens the vararg consumes.

Not identified in the formal grammar, but a restriction on varargs is applied after parsing the `cmd` declaration: trailing required arguments are not allowed when a child clause contains varargs.  This is because the vararg greedy parsing strategy would not be able to determine how many tokens to consume without considering other clauses, which would add complexity and reduce readability of the parsing rules.  By disallowing this pattern, we can keep the parsing rules simpler and more intuitive.

### Optional positional declarations

In the `OptionalArgDecl` production, `_` `"?"` and `ArgumentName` `"?"` are each two separate tokens.  The declaration parser consumes the `"?"` token following `"_"` or an argument name to mark the argument as optional.

Optional arguments will always consume a token if one is available, but they do not cause a parse error if no token is available.  This means that optional arguments can be omitted from the invocation, and the parser will simply not bind any value to them.

### Keyed declarations (clauses)

The `KeyedDecl` production defines two forms for keyed argument clauses:

- `()` denotes a **required** clause.  The `+` quantifier allows multiple occurrences (one-or-more).  Without `+`, exactly one occurrence is required.  The `?` and `*` quantifiers are not allowed on `()` since zero occurrences of a required argument would be contradictory.

- `[]` denotes an **optional** clause.  The `*` quantifier allows multiple occurrences (zero-or-more).  Without `*`, at most one occurrence is allowed.  The `?` quantifier would be redundant (already optional), and `+` contradicts optional semantics, so neither is allowed.

In the internal representation of the parser, both forms are desugared to a canonical form that includes the quantifier information, so that the invocation parsing logic can treat them uniformly.

### Qualifiers

A `QualifierDecl` (`Keyword "?"`) declares a boolean flag that appears before the command name in both the declaration and (optionally) the invocation.  If the qualifier is present in the invocation, it is set to `true`, otherwise it is `false`.  Qualifiers are typically used for flags that modify the behavior of the command.

#### Invocation resolution of qualifiers and command name

Qualifier keywords must be distinct from all registered command names.  This invariant allows the parser to resolve qualifiers and the command name in a single left-to-right pass without backtracking:

1. The parser examines the first token of the invocation.
2. If the token matches a known qualifier keyword, it records the qualifier as `true` and advances to the next token.
3. Step 2 repeats until a token is reached that is **not** a known qualifier keyword.
4. That token is taken as the command name.

Because the qualifier and command-name namespaces are disjoint, every token is unambiguously either a qualifier or the command name, and no lookahead beyond one token is needed.

## Declaration Validation Rules
Beyond the grammar, a declaration is invalid if any of the following holds:
- Duplicate keyed clause keyword
- Qualifier keyword collides with keyed clause keyword or any registered command name (qualifier and command-name namespaces must be disjoint to enable single-pass resolution)
- Nested keyword clauses cannot contain `...` when a higher-level clause contains trailing required positional declarations

## Invocation Semantics

### Keyword vs. value disambiguation
Quoted tokens (e.g. `"to"`) are always treated as argument values — they can never match a qualifier name, command name, or keyed-clause keyword.  Only unquoted tokens are eligible for keyword matching.  This gives script authors a simple escape mechanism when a value happens to collide with a keyword:

```
cmd send (to _) _ { ... }
send to admin "to"          # "to" is a value, not a second `to` clause
```

### Overview
Unnamed positional arguments are consumed from the remaining token stream according to the declaration order and the presence of keywords that trigger clause boundaries.

Trailing required arguments need special consideration since they can terminate a vararg section.  The parser will keep track of the number of tokens remaining.  When it encounters a vararg declaration, it will check whether the current clause contains any trailing required arguments.  If so, the parser will calculate how many tokens must be reserved to satisfy those trailing required arguments, and the vararg will only consume tokens up to that point.  This allows the parser to enforce the rule that varargs cannot consume tokens that are needed to satisfy required declarations later in the same clause.

All keyed-clause keywords declared anywhere in the command (at any nesting depth) are collected into a single **global keyword set** at declaration time.  Duplicate keywords within a command declaration are invalid.  In addition to the global set, each clause stores its own list of directly declared child keywords.  The global set enables fast recognition of whether a token is a keyword, while the per-clause lists allow the parser to determine the keyword's relationship to the current clause (child, ancestor, or unreachable) for dispatch and unwinding.

#### Left-to-right token processing

The parser walks tokens left-to-right.  At each token it checks:

1. **Is the token a keyword?**  (Only unquoted tokens are eligible; quoted tokens are always values.)
   - **Keyword is declared in the current clause**: The current positional argument sequence ends.  A new child clause begins — the parser recurses into that clause's declarations and continues consuming tokens left-to-right.
   - **Keyword is declared in a parent clause**: The current clause terminates.  The parser unwinds the clause stack, terminating each intermediate clause, until it reaches the clause that declares the keyword.  If any terminated clause is missing required arguments, a parse error is raised.  A new child clause begins in that ancestor clause.
   - **Keyword is in the global set but is not declared in the current clause or any ancestor clause**: This is a **parse error**.  The keyword is recognized but not legal in this context.
   - **Token is not a keyword**: It is consumed as a positional argument value in the current clause.  If no more values can be accepted according to the current clause's declaration, then this clause is now complete and the parser unwinds the clause stack until it finds a clause that can accept this token as a value.  If no such clause exists, a parse error is raised for too many positional arguments.

2. **Clause termination by keyword** is the only mechanism that ends a clause mid-stream.  There is no explicit "end-of-clause" delimiter — a clause's tokens are bounded by the next keyword that belongs to a parent or sibling scope, or by the end of the token stream.

### Clause-local greedy rule for varargs
For any clause containing a vararg declaration `...`:
- It consumes as many tokens as possible.
- It must stop when either:
  - A recognized keyword begins another keyed clause (per the keyword resolution rules above), or
  - Additional consumption would make it impossible to satisfy trailing required positional declarations in the same clause.

This second yields copy-style behavior such as:
- `cmd cp _ ... destination`
- `cp src1 src2 src3 dst` 

The presence of the `destination` required declaration after the vararg means that the vararg must stop consuming before the last token, so that the last token can be bound to `destination`.

Here the parser would return `varargs = [src1, src2, src3]` and `destination = dst`

**Important Note on Nested Varargs and Greediness:** Because varargs are strictly greedy, a vararg inside a keyed clause will consume all subsequent non-keyword tokens.  This could result in arguments being consumed that the user intended as mandatory arguments for a higher-level clauses.  The parser will not backtrack to reassign tokens to the higher-level clause.  This is deterministic behavior by the parser, and the resulting absence of mandatory arguments will rightly trigger an error during invocation or post-parse validation. The user must re-order their arguments to remove the error.

### Invocation Validation (Post-parse Weeding)
Required and optional keyed clauses of various arity (`+`, `*`, `()`, `[]`) are intentionally normalized to a canonical form of `[]*` (zero-or-more, optional) during the core invocation parsing phase to simplify the parser's state machine. Validation of the original constraints (e.g., verifying that a required clause appears at least once, or that a single-use clause doesn't appear multiple times) is handled in a separate semantic validation step immediately after parsing, functioning much like type checking in a standard compiler. The parser focuses purely on structure, leaving validation of cardinality to a subsequent pass over the AST.



## Implementation Strategy

The implementation is organized into phases that build on each other.  Each phase produces testable artifacts and can be validated independently before proceeding to the next.

### Phase 1: Scanner — Emit `...` as a single token

**File:** `scanner/index.ts`

Modify the scanner so that three consecutive `.` characters are emitted as a single `...` token with type `"operator"` rather than three separate `"delimiter"` tokens.  This is a small, self-contained change: when the scanner encounters a `.`, it checks whether the next two characters are also `.`.  If so, it emits one token with `value: "..."` and advances past all three characters.  Otherwise, the single `.` is emitted as a delimiter as before.

**Tests:** Add scanner tests that verify:
- `...` produces a single operator token.
- A lone `.` still produces a delimiter token.
- `..` produces two delimiter tokens (not a special form).
- `...` inside a string literal is not treated as an operator.

---

### Phase 2: Declaration data structures

**New file:** `parser/declaration.ts`

Define the TypeScript types that represent a parsed command declaration.  These are the internal structures the declaration parser produces and the invocation parser consumes.  They are distinct from the invocation-side `ParsedCommand` / `ParsedArguments` interfaces already specified in this document.

```typescript
interface PositionalArgDecl {
  kind: "named" | "unnamed";   // named = ArgumentName, unnamed = _
  name?: string;               // present when kind is "named"
  optional: boolean;
}

interface VarargDecl {
  trailingNamedArgs: string[];  // named args declared after ...
}

interface KeyedClauseDecl {
  keyword: string;
  required: boolean;            // () = true, [] = false
  allowMultiple: boolean;       // + or * present
  argDecls: ArgDeclGroup;       // recursive — clause has its own args
}

interface QualifierDecl {
  keyword: string;
}

interface ArgDeclGroup {
  positional: PositionalArgDecl[];   // required first, then optional
  keyedClauses: KeyedClauseDecl[];
  vararg?: VarargDecl;               // present only if ... declared
}

interface CommandDeclaration {
  name: string;
  qualifiers: QualifierDecl[];
  argDecls: ArgDeclGroup;
  body: NestedBlockNode;
  globalKeywords: Set<string>;       // all keywords at any depth
}
```

These types are pure data — no parsing logic yet.

Also define the invocation-side `ParsedArguments` and `ParsedCommand` interfaces in the same file (as specified in the **Parser Output** section above).  They will be imported by the invocation parser in a later phase.

**Tests:** Type-level only — no runtime tests needed for this phase.

---

### Phase 3: Declaration parser

**File:** `parser/declaration.ts` (continued)

Implement `parseCommandDeclaration(tokens: Token[]): CommandDeclaration`.  This function takes the full token stream of a `cmd` declaration line (everything after `cmd`) and produces a `CommandDeclaration`.

The parser processes tokens left-to-right:

1. **Qualifiers:** Consume tokens matching `Keyword "?"` pairs.  Each becomes a `QualifierDecl`.  Stop when the next token is not followed by `?`.
2. **Command name:** The next token is the command name identifier.
3. **ArgDecls:** Call a recursive `parseArgDeclGroup()` that handles the `ArgDecls` production:
   - Required positional args (`_` or `ArgumentName` not followed by `?`).
   - Optional positional args (`_?` or `ArgumentName?`).
   - Keyed clause declarations (`(` ... `)` with optional `+`, or `[` ... `]` with optional `*`).  Each clause recurses into `parseArgDeclGroup()` for its own argument declarations.
   - Vararg `...` optionally followed by trailing named args.
4. **Body:** The final `{ ... }` block, extracted using the existing `extractNestedBlock()` infrastructure.
5. **Global keyword set:** After parsing, walk the declaration tree and collect all keyed-clause keywords into a flat `Set<string>`.  Duplicates at any depth are detected here.

**Tests:** Parse various declaration forms and assert the resulting `CommandDeclaration` structure:
- Simple command with no args: `cmd noop { ... }`
- Positional only: `cmd echo _ ... { ... }`
- Named positional: `cmd greet name { ... }`
- Optional args: `cmd greet name? { ... }`
- Keyed clauses: `cmd send (to _) _ { ... }`
- Nested keyed clauses: `cmd move (from _) (to _) { ... }`
- Qualifiers: `cmd verbose? cp _ ... destination { ... }`
- Multiple quantifiers: `cmd add (item _)+ { ... }`
- Optional clauses: `cmd config [verbose] { ... }`
- Vararg with trailing named: `cmd cp _ ... destination { ... }`
- Error cases: duplicate keywords, invalid quantifier placement.

---

### Phase 4: Declaration validation

**File:** `parser/declaration.ts` (continued)

Implement `validateDeclaration(decl: CommandDeclaration, existingCommandNames: Set<string>): void` which throws on invalid declarations.

Rules to enforce:
1. **Duplicate keyed-clause keywords** — the global keyword set is already built in Phase 3; if construction detected a duplicate, error.
2. **Qualifier–command-name collision** — each qualifier keyword is checked against `existingCommandNames`.
3. **Qualifier–clause-keyword collision** — each qualifier keyword is checked against the global keyword set.
4. **Nested vararg with trailing required** — walk the declaration tree.  If a clause has trailing required positional args (args after `...`), then none of its child clauses may contain a `...`.  This is a depth-first check.

**Tests:**
- Valid declarations pass without error.
- Each invalid pattern produces a descriptive error message.

---

### Phase 5: Invocation parser

**New file:** `parser/invocation.ts`

This is the core engine.  Implement `parseInvocation(tokens: Token[], decl: CommandDeclaration): ParsedCommand`.

#### 5a: Qualifier resolution

Walk leading tokens.  If a token's value is in the declaration's qualifier set, record it as `true` and advance.  Stop at the first non-qualifier token; that token is the command name.  Consume it.  Any declared qualifiers not seen default to `false`.

#### 5b: Clause-stack machine

Maintain a stack of active clauses.  The stack starts with the root `ArgDeclGroup` from the declaration.

For each remaining token (left-to-right):

1. **Quoted token?**  Always a value — skip keyword checks.
2. **Is token in global keyword set?**
   - **Child of current clause?**  End positional consumption in the current clause.  Push a new clause frame onto the stack.  Continue consuming into the new clause.
   - **In an ancestor clause?**  Unwind the stack, terminating intermediate clauses (checking required args are satisfied).  Push the new clause frame onto the ancestor.
   - **In global set but not reachable?**  Parse error.
3. **Not a keyword:** Consume as a positional value in the current clause, respecting the ordering in `ArgDeclGroup.positional`.  If the current clause's positional and vararg slots are exhausted, unwind until a clause that can accept a value is found.

#### 5c: Vararg greedy consumption

When the current consumption index reaches the vararg position in `ArgDeclGroup`:
- Count the remaining tokens (excluding those that will be consumed by keyword clauses — approximated by tokens that are not in the global keyword set).
- Reserve slots for trailing required positional args in the same clause.
- Consume up to `remaining - reserved` tokens into the vararg.
- A keyword token always terminates vararg consumption regardless of reservation.

#### 5d: Result assembly

After all tokens are consumed, build `ParsedCommand`:
- `commandName` from the consumed command name token.
- `qualifiers` from the qualifier map.
- `arguments` as a `ParsedArguments` tree built from the clause stack.  Each clause frame maps its consumed values into `namedArgs` (for named positional declarations) and `varArgs` (for unnamed `_` and `...`).  Child clause frames are grouped by keyword into the `clauses` dictionary, with each occurrence as a separate `ParsedArguments` entry in the list.

**Tests:** Test invocations against known declarations:
- Simple positional: `echo hello world` against `cmd echo _ ... { ... }`.
- Named positional: `greet Alice` against `cmd greet name { ... }`.
- Keyed clauses: `send to admin hello` against `cmd send (to _) _ { ... }`.
- Multiple clause occurrences: `add item apple item banana` against `cmd add (item _)+ { ... }`.
- Vararg with trailing: `cp a b c dst` against `cmd cp _ ... destination { ... }`.
- Qualifier present/absent: `verbose cp a b` vs `cp a b`.
- Quoted keyword escape: `send to admin "to"` — `"to"` is a value, not a clause trigger.
- Error cases: missing required args, unknown keyword in context, too many positional args.

---

### Phase 6: Post-parse validation

**File:** `parser/invocation.ts` (continued)

Implement `validateInvocation(result: ParsedCommand, decl: CommandDeclaration): void`.

This runs immediately after `parseInvocation` returns and enforces cardinality and presence rules that the parser intentionally deferred:

1. **Required positional args** — any non-optional positional `ArgDecl` without a value is an error.
2. **Required clauses** — `()` clauses that are not present (occurrence count = 0) are an error.
3. **Single-occurrence clauses** — `()` without `+` or `[]` without `*` that appear more than once are an error.
4. **At-least-one clauses** — `()+` that appear zero times are an error.

**Tests:** Exercise each cardinality rule with valid and invalid invocations.

---

### Phase 7: Integration with shell system

This phase connects the new parsing pipeline to the existing shell execution engine.

#### 7a: Update `cmd` command handler

**File:** `shell/commands/command.ts`

Replace the existing declaration-parsing logic with a call to `parseCommandDeclaration()` followed by `validateDeclaration()`.  The resulting `CommandDeclaration` is stored in the environment's command registry.

Update `UserCommandDefinition` in `shell/commands/types.ts` to hold a `CommandDeclaration` instead of the current `declarations` array.

#### 7b: Update user command execution

**File:** `shell/index.ts`

When a user-defined command is invoked:
1. Look up its `CommandDeclaration` from the registry.
2. Call `parseInvocation()` with the invocation tokens and declaration.
3. Call `validateInvocation()` on the result.
4. Execute the command body with the `ParsedCommand` argument values substituted into the body template.

The existing `renderTemplateVariables()` function is reused for substitution.  The mapping from `ParsedArguments` to the template variable dictionary is straightforward: `namedArgs` entries map to `$name`, `varArgs` entries map to `$1`, `$2`, etc. (or a list variable if the language later supports them), and clause entries can be iterated over.

#### 7c: Update parser configuration

**File:** `parser/index.ts`

The shell's `ParserConfig` no longer needs `CommandDefinition` entries for user-defined commands.  Instead, the parser routes user command invocations through the new invocation parser.  Built-in commands (`if`, `while`, `for`, `echo`, `eval`, `cd`) retain their existing `CommandDefinition` entries and parsing logic since they use hardcoded parsers that predate the new declaration system.

#### 7d: Clean up obsolete code

Remove or deprecate the old `CommandArgumentDefinition`, `ArgumentInfo`, and `UserCommandDefinition.declarations` structures.  Update all imports.  The old `parseCommandArgumentsByDefinition()` function can be retained temporarily for built-in commands but is no longer used for user-defined commands.

**Tests:** End-to-end tests that define commands with the new syntax and invoke them:
- Define and invoke a simple command.
- Define a command with qualifiers and verify boolean flag behavior.
- Define a command with keyed clauses and verify argument grouping.
- Define a command with varargs and verify greedy consumption.
- Error cases: bad declarations, bad invocations.

---

### Phase 8: Built-in command migration (optional, deferred)

The built-in commands (`if`, `while`, `for`, `echo`, `eval`, `cd`) currently use hardcoded parsing logic.  Migrating them to use the new declaration system is desirable for consistency but is not required for the initial release.  Each built-in command would be expressed as a `CommandDeclaration` and its executor would receive a `ParsedCommand` instead of a raw `CommandNode`.  This migration can be done incrementally, one command at a time, with existing tests validating each migration.

---

### Dependency graph

```
Phase 1 (scanner)
    │
    ▼
Phase 2 (data structures)
    │
    ├──────────────┐
    ▼              ▼
Phase 3         Phase 5a
(decl parser)   (qualifier resolution — can prototype)
    │              │
    ▼              │
Phase 4            │
(decl validation)  │
    │              │
    ├──────────────┘
    ▼
Phase 5 (invocation parser, full)
    │
    ▼
Phase 6 (post-parse validation)
    │
    ▼
Phase 7 (integration)
    │
    ▼
Phase 8 (built-in migration, optional)
```

Phases 1 and 2 are prerequisites for everything else.  Phases 3–4 (declaration side) and Phase 5a (qualifier resolution prototype) can proceed in parallel.  Phase 5 (full invocation parser) requires Phase 3 for the declaration structures it consumes.  Phase 6 depends on Phase 5.  Phase 7 depends on all prior phases.

### Testing strategy

Tests are written alongside each phase using vitest.  The test file `test/parser.test.ts` is extended with new `describe` blocks for:
- Scanner `...` tokenization (Phase 1).
- Declaration parsing (Phase 3).
- Declaration validation (Phase 4).
- Invocation parsing (Phase 5).
- Post-parse validation (Phase 6).

Integration tests in `test/shell.test.ts` cover end-to-end command definition and invocation (Phase 7).

Each phase's tests are self-contained and do not depend on later phases, so they serve as regression tests throughout the implementation.

