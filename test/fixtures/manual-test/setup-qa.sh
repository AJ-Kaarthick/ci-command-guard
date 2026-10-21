#!/usr/bin/env bash
set -euo pipefail

TARGET_DIR="/tmp/ci-command-guard-qa"
FIXTURE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Setting up CI Command Guard Manual QA Fixture at: ${TARGET_DIR}"

rm -rf "${TARGET_DIR}"
mkdir -p "${TARGET_DIR}"

# Copy all files including hidden .github directory
cp -R "${FIXTURE_DIR}/." "${TARGET_DIR}/"
# Remove the setup script itself from the QA sandbox
rm -f "${TARGET_DIR}/setup-qa.sh"

cd "${TARGET_DIR}"
git init -q
git config user.name "QA Tester"
git config user.email "qa@example.com"
git add .
git commit -qm "Initial fixture commit"

echo ""
echo "================================================================="
echo " QA Fixture initialized successfully at:"
echo "   ${TARGET_DIR}"
echo "================================================================="
echo ""
echo "Manual QA Steps:"
echo "1. Install the extension in VS Code:"
echo "   code --install-extension <path-to-packaged-vsix>"
echo ""
echo "2. Open the fixture folder in VS Code:"
echo "   code ${TARGET_DIR}"
echo ""
echo "3. Verify Automatic Detection & Problems Panel:"
echo "   - Open .github/workflows/01-valid.yml -> 0 problems."
echo "   - Open .github/workflows/02-broken-scripts.yml -> squiggles on 'buid' and 'pest'."
echo "   - Hover over 'buid' -> detailed explanation + suggestion."
echo "   - Hover over 'pest' -> explanation stating ambiguous alternatives (no auto-fix)."
echo ""
echo "4. Verify Ctrl+. Quick Fix:"
echo "   - Put cursor on 'buid', press Ctrl+. -> Select 'Fix this reference: Replace \\'buid\\' with \\'build\\''."
echo "   - Notice exact token replacement without touching surrounding YAML."
echo "   - Put cursor on 'pest' -> Notice NO 'Fix this reference' option appears (only bulk options)."
echo ""
echo "5. Verify Bulk Fix Review Modal & Cancel:"
echo "   - Open .github/workflows/06-bulk-fix-target.yml."
echo "   - Run Command Palette: 'CI Command Guard: Fix All Safe Issues in Current Workflow'."
echo "   - In the modal review dialog, click 'Cancel' -> Verify NO files changed."
echo "   - Re-run command, click 'Apply Changes' -> Verify all 3 safe issues are fixed."
echo "   - Press Ctrl+Z (Undo) -> Verify changes revert cleanly."
echo "================================================================="
