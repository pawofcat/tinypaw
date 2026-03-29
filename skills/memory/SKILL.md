---
name: memory
description: Two-layer memory system with grep-based recall. Use when the user wants to remember something, mentions memory, or asks about past events.
always: true
---

# Memory

## Configuration

Memory path is configured in `config.json`:

```json
{
  "memory": {
    "path": "./workspace/memory"
  }
}
```

Default: `./workspace/memory`

## Structure

- `{memory.path}/MEMORY.md` — Long-term facts (preferences, project context, relationships)
- `{memory.path}/HISTORY.md` — Append-only event log. Search with grep.

## Search Past Events

```bash
grep -i "keyword" memory/HISTORY.md
```

## When to Update MEMORY.md

Write important facts immediately:
- User preferences
- Project context
- Relationships

## Tools

Use the built-in memory tools:
- `memory_search` - Search memory files
- `memory_get` - Read a specific memory file
- `memory_append` - Append content to a memory file