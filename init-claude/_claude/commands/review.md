# /review

Review the current branch's changes for correctness, security, and style.

## Steps

1. Run `git diff main...HEAD` to see all changes on this branch
2. Check each changed file for:
   - Logic errors or edge cases
   - Security issues (injection, secrets in code, missing validation)
   - Code style violations (comments that explain WHAT, unused variables, dead code)
   - Missing or inadequate tests
3. Report findings grouped by severity: **Critical** / **Major** / **Minor**
4. Suggest specific fixes for Critical and Major issues

## Output Format

```
## Review Summary

### Critical
- <file>:<line> — <issue>

### Major
- <file>:<line> — <issue>

### Minor
- <file>:<line> — <issue>

### Verdict
LGTM / Needs changes
```
