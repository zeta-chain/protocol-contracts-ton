#!/bin/bash

# Ensure consistent behavior across platforms
export LC_ALL=C
export LANG=C

INPUT_DIR=${1:-contracts}
OUTPUT_FILE=${2:-docs/gateway.md}

mkdir -p "$(dirname "$OUTPUT_FILE")"

# Create a temporary file
TMP_FILE=$(mktemp)

echo "# TON Gateway Docs" > "$TMP_FILE"
echo "" >> "$TMP_FILE"

# Sort files to ensure consistent order
for file in $(find "$INPUT_DIR" -name "*.fc" | sort); do
  echo "## $(basename "$file")" >> "$TMP_FILE"
  echo "" >> "$TMP_FILE"

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

    /^\s*;;/ {
      line = substr($0, index($0, ";;") + 2);
      if (!is_section_comment(line)) {
        comment = (comment ? comment ORS : "") normalize(line);
        collecting = 1;
      }
      next;
    }

    /^\s*(\(\))?[ \t]*[a-zA-Z0-9_]+[ \t]*\(.*\)[ \t]*(impure)?[ \t]*(inline|inline_ref)?[ \t]*(method_id)?[ \t]*\{/ {
      if (collecting && comment) {
        fname = extract_func_name($0);
        print "### `" fname "`"
        print ""
        print "**Signature:**"
        print "```func"
        print $0
        print "```"
        print ""
        print "**Description:**"
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
  ' "$file" >> "$TMP_FILE"
done

# Convert to Unix line endings and move to final location
tr -d '\r' < "$TMP_FILE" > "$OUTPUT_FILE"
rm "$TMP_FILE"
