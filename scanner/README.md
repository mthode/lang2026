This directory contains the source code for the scanner, which is responsible for tokenizing the input source code.  The scanner reads the input character by character and produces a stream of tokens that represent the syntactic elements of the language.

The scanner supports a variety of token types, including identifiers, literals, operators, and delimiters.  It also handles whitespace and comments, which are always included in the output and it is the parser's responsibility to ignore them.

Each token includes information about its type, value, and position in the input, which can be used to provide useful error messages as well as syntax highlighting in a code editor.

Lines that end with a backslash \ are treated as a continuation of the next line, allowing for multi-line commands.  The backslash and newline remain in the output as whitespace tokens.

Lines with unbalenced brackets () [] {} are treated as a single line, allowing for multi-line expressions.  The scanner keeps track of the balance of brackets and completes a command when the brackets are balanced, even if there are newlines in between.

