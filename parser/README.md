# Parser Usage Guide

This directory contains the parser used by the shell language. The parser has two main jobs:

1. Parse shell statements (commands and assignments)
2. Parse command declarations and invocations for user-defined commands

The scanner tokenizes input first, and the parser builds structured nodes from those tokens.

## What To Use

Use these APIs depending on what you are doing:

- `createParser(config)`
	- Parses normal shell lines and scripts.
	- Used by shell runtime for built-in commands, assignments, and general command parsing.

- `parseCommandDeclaration(tokens)`
	- Parses a `cmd` declaration into a `CommandDeclaration`.
	- Use when registering user-defined commands.

- `validateDeclaration(decl, existingCommandNames)`
	- Validates declaration-level rules (keyword collisions, invalid vararg nesting patterns, etc).

- `parseInvocation(tokens, decl)`
	- Parses one command invocation against a specific declaration.

- `validateInvocation(result, decl)`
	- Validates invocation cardinality rules (required clauses present, single-occurrence constraints, etc).

## Command Declaration Syntax

User-defined commands are declared with `cmd`:

```text
cmd [qualifier? ...] commandName argDecls { body }
```

### Argument declaration forms

- Required positional unnamed: `_`
- Required positional named: `name`
- Optional positional unnamed: `_?`
- Optional positional named: `name?`
- Required keyed clause: `(keyword argDecls)`
- Required keyed clause, repeatable: `(keyword argDecls)+`
- Optional keyed clause: `[keyword argDecls]`
- Optional keyed clause, repeatable: `[keyword argDecls]*`
- Vararg unnamed positional: `...`
- Vararg with trailing required named args: `... destination`

### Ordering rules

Inside one clause, declarations are ordered as:

1. Required positional
2. Optional positional
3. Keyed clauses
4. Optional vararg (`...`) and trailing required named args

### Examples

```text
cmd noop { echo ok }
cmd greet name { echo hello $name }
cmd cp _ ... destination { echo copy $args to $destination }
cmd send urgent? (to _) _ { echo send $1 to $to urgent=$urgent }
cmd add (item _)+ { echo $item }
```

## Invocation Behavior

Given a declaration, invocation parsing is deterministic and left-to-right.

### Qualifiers

- Declared as `keyword?` before command name.
- In invocation, present means `true`, absent means `false`.

Example:

```text
cmd verbose? build target { echo verbose=$verbose target=$target }
verbose build app
build app
```

### Keyed clauses

- Clause keywords are recognized only when unquoted.
- Quoted tokens are always values.

Example:

```text
cmd send (to _) _ { echo to=$to msg=$1 }
send to admin "to"
```

In this example, `"to"` is a value, not a second `to` clause.

### Vararg greediness

`...` consumes as many values as possible in the current clause, but stops when:

- a recognized keyword starts a keyed clause, or
- it must reserve values for trailing required names in the same clause.

Example:

```text
cmd cp _ ... destination { echo srcs=$args dst=$destination }
cp a b c out
```

Result shape is effectively:

- varArgs: `a`, `b`, `c`
- named `destination`: `out`

## Parsed Output Shape

Invocation parsing returns `ParsedCommand`:

```ts
interface ParsedArguments {
	clauseName: string;
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

`ArgumentValue` reuses parser value types (`ExpressionNode | string | NestedBlockNode`).

## Built-in Commands And User Commands

- User-defined commands use declaration + invocation parsing directly.
- Built-in commands still execute through their existing command handlers.
- Current migration status: declaration-based invocation translation is in place for `cd`, `echo`, `eval`, and `for`.
- `if` and `while` remain on their current parsing path for now.

## Practical Flow For User Commands

When implementing or invoking user-defined commands in shell runtime:

1. Parse declaration source with `parseCommandDeclaration(scan(source))`
2. Validate with `validateDeclaration(...)`
3. Store resulting `CommandDeclaration`
4. On invocation, parse with `parseInvocation(scan(line), declaration)`
5. Validate with `validateInvocation(...)`
6. Map parsed values into template variables and execute the command body

## Notes

- Keywords are case-sensitive.
- Duplicate keyed clause keywords in one declaration are invalid.
- The scanner emits `...` as a single operator token.







