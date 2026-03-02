#!/bin/bash
# Korea Decode: Cleanup old files after rebuild
# Review this script before running!

echo "=== Korea Decode Cleanup ==="
echo "This will remove old files replaced by the rebuild."
echo ""

# Old single-page files (replaced by /about/index.html, etc.)
OLD_FILES=(
  "about.html"
  "contact.html"
  "privacy-policy.html"
  "terms.html"
  "post.html"
  "main.js"
  "style.css"
  "sitemap.xml"
  "blueprint.md"
  "GEMINI.md"
  "admin/ai-config.html"
)

# Old directories
OLD_DIRS=(
  "posts"
  "wp-content"
  "wp-includes"
  "js"
  "scripts"
)

echo "Files to remove:"
for f in "${OLD_FILES[@]}"; do
  if [ -e "$f" ]; then
    echo "  - $f"
  fi
done

echo ""
echo "Directories to remove:"
for d in "${OLD_DIRS[@]}"; do
  if [ -d "$d" ]; then
    echo "  - $d/"
  fi
done

echo ""
read -p "Proceed with cleanup? (y/N) " confirm
if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
  echo "Aborted."
  exit 0
fi

for f in "${OLD_FILES[@]}"; do
  if [ -e "$f" ]; then
    rm -v "$f"
  fi
done

for d in "${OLD_DIRS[@]}"; do
  if [ -d "$d" ]; then
    rm -rv "$d"
  fi
done

echo ""
echo "Cleanup complete!"
