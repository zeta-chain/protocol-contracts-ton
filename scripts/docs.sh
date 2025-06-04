#!/bin/bash

# Ensure consistent behavior across platforms
export LC_ALL=C
export LANG=C

INPUT_FILE=${1:-contracts/gateway.fc}
OUTPUT_FILE=${2:-docs/gateway.md}

mkdir -p "$(dirname "$OUTPUT_FILE")"

# Create a temporary file
TMP_FILE=$(mktemp)

echo "# TON Gateway Docs" > "$TMP_FILE"
echo "" >> "$TMP_FILE"

# Process the specific file
FILE_TMP=$(mktemp)

awk '
    function is_section_comment(line) {
      return line ~ /={3,}/ || line ~ /^(Sizes|GAS|OP|EXTERNAL|INTERNAL|PARSING|GETTERS|TL-B|AUTH)/;
    }

    function extract_func_name(line) {
      sub(/^[ \t]+/, "", line)  # Trim leading spaces/tabs
      if (line ~ /^\(\)[ \t]*[a-zA-Z0-9_]+[ \t]*\(/) {
        sub(/^\(\)[ \t]*/, "", line)
      }
      match(line, /^([a-zA-Z0-9_]+)[ \t]*\(/)
      return substr(line, RSTART, RLENGTH - 1)
    }

    function normalize(text) {
      sub(/^[[:space:]]+/, "", text);
      return toupper(substr(text,1,1)) substr(text,2);
    }

    function is_function_definition(line) {
      # Match function definitions but exclude if statements and other control structures
      return line ~ /^\s*(\(\))?[ \t]*[a-zA-Z0-9_]+[ \t]*\([^)]*\)[ \t]*(impure)?[ \t]*(inline|inline_ref)?[ \t]*(method_id)?[ \t]*\{/ && 
             !(line ~ /^\s*if\s*\(/ || line ~ /^\s*while\s*\(/ || line ~ /^\s*repeat\s*\(/);
    }

    /^\s*;;/ {
      line = substr($0, index($0, ";;") + 2);
      if (!is_section_comment(line)) {
        comment = (comment ? comment ORS : "") normalize(line);
        collecting = 1;
      }
      next;
    }

    is_function_definition($0) {
      if (collecting && comment) {
        fname = extract_func_name($0);
        print "### `" fname "`"
        print ""
        print "```func"
        print $0
        print "```"
        print ""
        print comment
        print ""
        comment = ""
        collecting = 0;
      }
    }

    {
      if (!/^\s*;;/) {
        collecting = 0;
        comment = "";
      }
    }
  ' "$INPUT_FILE" > "$FILE_TMP"

# Only add the file section if it has content
if [ -s "$FILE_TMP" ]; then
  echo "## $(basename "$INPUT_FILE")" >> "$TMP_FILE"
  echo "" >> "$TMP_FILE"
  cat "$FILE_TMP" >> "$TMP_FILE"
fi

# Clean up the temporary file
rm "$FILE_TMP"

# Convert to Unix line endings, remove trailing newlines, and move to final location
tr -d '\r' < "$TMP_FILE" | sed -e :a -e '/^\n*$/{$d;N;ba' -e '}' > "$OUTPUT_FILE"
rm "$TMP_FILE"
