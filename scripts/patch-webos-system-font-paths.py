#!/usr/bin/env python3
"""Configure Cobalt's inherited Linux Starboard port to use webOS system fonts."""

from pathlib import Path
import re
import sys

if len(sys.argv) != 2:
    raise SystemExit(f"usage: {sys.argv[0]} <cobalt-source-root>")

source = Path(sys.argv[1]) / "starboard/linux/shared/system_get_path.cc"
text = source.read_text()

font_dir = """    case kSbSystemPathFontDirectory:
      if (starboard::strlcpy(path.data(), "/usr/share/fonts", kPathSize) >=
          kPathSize) {
        return false;
      }
      break;"""

font_config = """    case kSbSystemPathFontConfigurationDirectory:
      if (!GetContentDirectory(path.data(), kPathSize)) {
        return false;
      }
      if (starboard::strlcat(path.data(), "/system_fonts", kPathSize) >=
          kPathSize) {
        return false;
      }
      break;"""

def replace_case(contents: str, case_name: str, replacement: str) -> str:
    pattern = re.compile(
        rf"^[ \t]*case {re.escape(case_name)}:.*?(?=^[ \t]*case |^[ \t]*default:)",
        re.MULTILINE | re.DOTALL,
    )
    updated, count = pattern.subn(replacement + "\n", contents, count=1)
    if count != 1:
        raise SystemExit(f"Could not uniquely patch {case_name} in {source}")
    return updated

# In upstream Cobalt 23.lts.6 both font path IDs share one case body. Patch the
# configuration case first; this consumes the shared implementation and leaves
# the font-directory case available for the second replacement.
text = replace_case(
    text, "kSbSystemPathFontConfigurationDirectory", font_config
)
text = replace_case(text, "kSbSystemPathFontDirectory", font_dir)

source.write_text(text)
print(f"Configured webOS system font paths in: {source}")
