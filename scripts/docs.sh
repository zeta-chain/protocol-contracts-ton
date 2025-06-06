#!/bin/bash

# —— 1. Locale guard —─────────────────────────────────────────────────────────
# Enforcing a "C" locale guarantees reproducible sort order and decimal        
# separators.  (Some CI images default to UTF-8 locales which may break awk.)
export LC_ALL=C
export LANG=C

# —— 2. CLI arguments with sensible fallbacks —───────────────────────────────
INPUT_FILE=${1:-contracts/gateway.fc}   # Default contract path (for devs)
OUTPUT_FILE=${2:-docs/gateway.md}       # Where to write the final docs

# Ensure the output directory exists so we don’t die on a missing path.
mkdir -p "$(dirname "$OUTPUT_FILE")"

# —— 3. Work in a temp file so we never leave half-baked docs behind —────────
TMP_FILE=$(mktemp)          # Final markdown lives here until complete
FILE_TMP=$(mktemp)         # Intermediate file for awk output

###############################################################################
# 4. Markdown preamble                                                         #
###############################################################################
{
  echo "# TON Gateway Docs"
  echo
} > "$TMP_FILE"

###############################################################################
# 5. AWK pass - the heavy lifter                                              #
#    * Written to be POSIX-awk compatible (no /\s/, \+, gensub, etc.).        #
#    * Inline comments are sprinkled liberally to clarify the logic.          #
###############################################################################

awk '
############################################################################
# Utility helpers (trim) - POSIX-compliant implementations                  #
############################################################################
function ltrim(s) { sub(/^[[:space:]]+/, "", s); return s }
function rtrim(s) { sub(/[[:space:]]+$/, "", s); return s }
function trim(s) { return rtrim(ltrim(s)) }

############################################################################
# Detect section-header comment lines we do *not* want to treat as doc text #
############################################################################
function is_section_comment(line) {
    return line ~ /={3,}/ || line ~ /^(Sizes|GAS|OP|EXTERNAL|INTERNAL|PARSING|GETTERS|TL-B|AUTH)/
}

############################################################################
# Extract function name from a FunC definition line                          #
############################################################################
function extract_func_name(line,   copy) {
    copy = line
    sub(/^[[:space:]]+/, "", copy)                             # Leading WS
    # If the line starts with "() func_name(" - strip the unit sigil.
    if (copy ~ /^\(\)[[:space:]]*[A-Za-z0-9_]+[[:space:]]*\(/)
        sub(/^\(\)[[:space:]]*/, "", copy)
    match(copy, /^([A-Za-z0-9_]+)[[:space:]]*\(/)
    return substr(copy, RSTART, RLENGTH - 1)
}

############################################################################
# Identify lines that are *actual* function definitions (not if/while etc.)  #
############################################################################
function is_function_definition(line) {
    pat = "^[[:space:]]*(\\(\\))?[[:space:]]*[A-Za-z0-9_]+[[:space:]]*\\([^)]*\\)[[:space:]]*(impure)?[[:space:]]*(inline|inline_ref)?[[:space:]]*(method_id)?[[:space:]]*\\{";
    ctl = "^[[:space:]]*(if|while|repeat)[[:space:]]*\\(";
    return (line ~ pat) && !(line ~ ctl)
}

############################################################################
# Public API filter - only expose handle_* + recv_*                          #
############################################################################
function want_function(name) { return name ~ /^(handle_|recv_)/ }

############################################################################
# BEGIN block - initialise state                                             #
############################################################################
BEGIN {
    collecting_comment   = 0     # Are we in a block of leading ";;" lines?
    comment              = ""    # Accumulated comment text
    const_header_printed = 0     # Printed the "## Constants" header yet?
    in_const_block       = 0     # Are we in a block of constants?
}

############################################################################
# 1) Capture consecutive ";; <text>" lines                                   #
############################################################################
/^[[:space:]]*;;/ {
    line = substr($0, index($0, ";;") + 2)          # Strip the marker
    if (!is_section_comment(line)) {
        # Normalise capitalisation a tiny bit → "foo bar" → "Foo bar"
        text = trim(line)
        text = toupper(substr(text,1,1)) substr(text,2)
        comment = (comment ? comment "\n" : "") text
        collecting_comment = 1
    }
    next
}

############################################################################
# 2) Function defs - emit md if we *just* captured a comment                 #
############################################################################
{
    if (is_function_definition($0)) {
        if (in_const_block) {
            print ""
            in_const_block = 0
        }
        fname = extract_func_name($0)
        if (want_function(fname) && collecting_comment && comment) {
            print "### `" fname "`\n"              # H3 header
            print "```func"                      # Code fence start
            print $0                            # The definition line itself
            print "```\n"                       # Code fence end
            print comment "\n"                # The doc string
        }
        collecting_comment = comment = ""      # Reset for next round
        next
    }
}

############################################################################
# 3) Constant extraction - opcode & error ids                                #
############################################################################
/^[[:space:]]*const[[:space:]]+[A-Za-z0-9_:]+[[:space:]]*=/ {
    # Example line:  const op::internal::deposit = 101;

    # 3.1. Chop off the leading "const" keyword
    line = $0
    sub(/^[[:space:]]*const[[:space:]]+/, "", line)

    # 3.2. Split on the first "=" to isolate LHS and RHS
    split(line, parts, "=")
    identifier = trim(parts[1])
    value_part = trim(parts[2])

    # 3.3. Remove trailing semicolon and inline comments from RHS
    sub(/;.*/, "", value_part)
    value = trim(value_part)

    # 3.4. Only emit op:: and error:: groups - the rest is internal noise
    if (identifier ~ /^op::/ || identifier ~ /^error::/) {
        if (!const_header_printed) {
            print "### Constants\n"            # One-time section header
            const_header_printed = 1
        }
        print "- **" identifier "** = " value  # • **op::blah** = 123
        in_const_block = 1
    }
    next
}

############################################################################
# 4) Reset comment collection on any plain line                              #
############################################################################
{
    collecting_comment = 0; comment = ""
}
' "$INPUT_FILE" > "$FILE_TMP"

###############################################################################
# 6. Append AWK output to the top-level markdown only if something was found #
###############################################################################
if [ -s "$FILE_TMP" ]; then
  {
    echo "## $(basename "$INPUT_FILE")"
    echo
    cat "$FILE_TMP"
  } >> "$TMP_FILE"
fi

rm "$FILE_TMP"   # No longer needed

###############################################################################
# 7. Strip CRLFs, trailing blank lines, and atomically move into place        #
###############################################################################
tr -d '\r' < "$TMP_FILE" | \
  sed -e :a -e '/^\n*$/{$d;N;ba' -e '}'> "$OUTPUT_FILE"
rm "$TMP_FILE"