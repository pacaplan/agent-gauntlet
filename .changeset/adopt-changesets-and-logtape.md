---
"agent-gauntlet": minor
---

### New Features
- Add LogTape logger for structured logging with stop-hook support
- Adopt Changesets for automated release workflow and changelog generation
- Extend stop-hook configuration with `enabled` flag and environment variable overrides

### Improvements
- Simplify stop-hook by delegating interval check to executor
- Add status icons and systemMessage to stop-hook output
- Expose `intervalMinutes` in stop-hook configuration
