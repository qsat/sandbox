# /standup

Generate a standup report from recent git activity.

## Steps

1. Run `git log --since="yesterday" --oneline --author="$(git config user.email)"` 
2. Run `git status` to see in-progress work
3. Check for any open TODOs: `grep -r "TODO\|FIXME" --include="*.ts" --include="*.py" -l`
4. Summarize in standup format

## Output Format

```
## Yesterday
- <what was completed>

## Today
- <what is planned>

## Blockers
- <any blockers, or "None">
```
