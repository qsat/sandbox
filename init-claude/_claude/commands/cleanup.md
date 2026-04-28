# /cleanup

Clean up the current branch before opening a PR.

## Steps

1. Check for debug code: `grep -rn "console\.log\|print(\|debugger\|pdb\." --include="*.ts" --include="*.py" .`
2. Check for leftover TODO/FIXME comments added in this branch
3. Verify no secrets or credentials in changed files
4. Run tests if a test command is defined in CLAUDE.md
5. Verify commit messages follow the project convention
6. Suggest a clean PR description based on the commits

Report each finding and ask before making any changes.
