---
name: github
description: Interact with GitHub using gh CLI. Use when working with GitHub repos, issues, PRs, or releases.
requires:
  bins:
    - gh
  env:
    - GITHUB_TOKEN
---

# GitHub

## Prerequisites

This skill requires the GitHub CLI (`gh`) to be installed and authenticated.

## Common Operations

### Issues

```bash
# Create issue
gh issue create --title "Title" --body "Description"

# List issues
gh issue list --state open

# View issue
gh issue view 123
```

### Pull Requests

```bash
# Create PR
gh pr create --title "Title" --body "Description"

# List PRs
gh pr list --state open

# Merge PR
gh pr merge 123 --merge
```

### Releases

```bash
# Create release
gh release create v1.0.0 --title "v1.0.0" --notes "Release notes"
```

## References

- [GitHub CLI Manual](references/GH_MANUAL.md) - Complete command reference