# Project-level Claude Code skills

41 skills live in `.claude/skills/` (auto-loaded by Claude Code for this repository). Sources, commit SHAs, licenses and the list of local modifications are in `THIRD_PARTY_NOTICES.md`. Python/system dependencies are in `requirements-skills.txt`.

## Installed (41)

| Area | Skills |
|---|---|
| Process / Software Engineering (obra/superpowers, 14) | `brainstorming` `writing-plans` `executing-plans` `subagent-driven-development` `dispatching-parallel-agents` `test-driven-development` `systematic-debugging` `verification-before-completion` `requesting-code-review` `receiving-code-review` `finishing-a-development-branch` `using-git-worktrees` `using-superpowers` `writing-skills` |
| Engineering / Docs (mattpocock/skills, 13) | `tdd` `diagnosing-bugs` `codebase-design` `improve-codebase-architecture` `domain-modeling` `grilling` `grill-me` `grill-with-docs` `research` `pr` `prototype` `handoff` `writing-for-agents` |
| Documentation & tooling (anthropics/skills, 10) | `doc-coauthoring` `docx` `pdf` `pptx` `xlsx` `mcp-builder` `skill-creator` `webapp-testing` `web-artifacts-builder` `frontend-design` |
| UI/UX (nextlevelbuilder, 3) | `ui-ux-pro-max` `ui-styling` `design-system` |
| Discovery (vercel-labs, 1) | `find-skills` |

`grill-me`, `grill-with-docs`, `handoff`, `improve-codebase-architecture` are user-invoked only (`disable-model-invocation: true`): run them as `/name`.

## Deliberately not installed

| Skill(s) | Reason |
|---|---|
| `code-review` (mattpocock), `claude-api` (anthropics) | Same name as Claude Code built-ins; a project-level copy overrides the built-in (observed in-session). |
| `design`, `slides` (nextlevelbuilder) | Same name as built-ins; also logo/brand generation, outside scope. |
| `brand`, `banner-design` | Branding/marketing, outside scope. |
| mattpocock `ask-matt`, `setup-matt-pocock-skills`, `to-spec`, `to-tickets`, `triage`, `wayfinder`, `implement`, `implement-spec` | Issue-tracker pipeline that needs `/setup-matt-pocock-skills` config (`docs/agents/…`) which this repo does not have; `ask-matt` routes to them. |
| mattpocock `teach`, `retro`, `wait-what`, `to-questionnaire`, `wizard` | Not related to the target domains. |
| anthropics `canvas-design`, `algorithmic-art`, `slack-gif-creator`, `theme-factory`, `brand-guidelines`, `internal-comms` | Art/branding/comms, outside scope. |
| `diagnosing-superpowers` | Maintainer bug-report tooling. |
| anthropics `discernment-nudge`, `academy-guide` | Auto-trigger on nearly every answer; change global behaviour. |
| mattpocock `in-progress/*`, `misc/*` | Not published by the author. |

None of the five upstream repositories contains a skill aimed at Java, Niagara N4, PLC, BMS or security auditing; the installed set covers general software-engineering process, UI/UX and documentation only. Domain/security skills would have to come from another source.

## Known caveats

- `using-superpowers` is normally injected by the superpowers plugin's SessionStart hook. That hook is **not** copied here; the skill still loads and works on demand, and the hook is active whenever the superpowers plugin is installed on the account.
- Claude Code–specific frontmatter keys (`disable-model-invocation`, `argument-hint`) make the generic `skill-creator` validator flag 6 skills; Claude Code itself loads them.
- `webapp-testing/scripts/with_server.py` runs the given server command through a shell (upstream design); only pass commands you trust. Its pipes are still unread (a very chatty server could block).
- `mcp-builder` docs contain `npx -y {service}-mcp-server`; review any package before running it.
- `design-system/scripts/fetch-background.py` downloads stock images from `images.pexels.com` when used (no API key).
- Fonts `IBMPlexSerif-*` and `InstrumentSerif-*` in `ui-styling/canvas-fonts` ship without an OFL text file upstream.
- `doc-coauthoring` ships without a LICENSE.txt upstream.
