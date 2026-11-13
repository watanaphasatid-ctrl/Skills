# K.M. Auto Skill Router — GitHub package

This package is ready for a **Claude Code repository**, not a global Claude account installation.

## GitHub installation
1. Add `.claude/skills/km-auto-skill-router/SKILL.md` to the **root of the target repository** (keep existing Skills intact).
2. If a root `CLAUDE.md` already exists, **append** the content from `CLAUDE.md.ADDITIONS`; never overwrite existing instructions. If no `CLAUDE.md` exists, create one with that content.
3. Commit the changes on a feature branch, then merge via pull request into the branch your Claude Code session uses.
4. Open a new supported Claude Code session attached to that repo and verify the Skill is listed in the session. Test with a small code-review request, and check whether it was actually loaded.

## Limitations
- Project Skills do **not** load in every kind of Claude cloud thread, especially cloud threads within a Project. In that case, use the separate Claude account ZIP, uploaded through Customize > Skills.
- Skills already enabled in the Claude account can be invoked automatically when relevant. This router improves task-specific guidance; it cannot programmatically make every other Skill run.
- This package deliberately has no executable hooks, scripts, network access, or external dependencies.
