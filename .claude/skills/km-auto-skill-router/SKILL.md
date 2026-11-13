---
name: km-auto-skill-router
description: Automatically select relevant enabled Skills for Niagara N4, Java, PLC/BMS, debugging, code review, UI, security, and engineering documents; verify availability before use.
---

# K.M. Auto Skill Router

## Purpose
Help Claude choose, combine, and apply relevant **already available** Skills when the user works on engineering or software tasks, especially Niagara N4, Java, PLC/BMS, commissioning, testing, security, UI/UX, and documents. This is a **routing procedure**, not a programmatic plugin loader or a guarantee that any given Skill is installed.

## When to activate
Activate when a request calls for technical diagnosis, implementation, code review, optimization, engineering tests, UI/UX design, document generation, GitHub workflow, security review, or a combination of these. Avoid activating for unrelated small talk or simple factual answers.

## Operating procedure
1. **Classify intent.** Determine the requested output and constraints. Respect explicit instructions (e.g., audit only, do not change other code, no invented test results).
2. **Discover availability.** Use the Skills actually visible to this Claude session: account-enabled/synced Skills, built-in Skills, plugin Skills, and repository-local Skills where supported. Inspect the provided Skill descriptions and instructions. Do not assume a Skill is available merely because its name appears in a GitHub README or another session.
3. **Choose minimally.** Prefer one primary Skill and at most two complementary Skills with non-overlapping functions. Let Claude's native Skill-selection/invocation mechanism load them as supported; the router itself cannot forcibly invoke an unavailable Skill or download one into a session.
4. **Apply the workflow.** Follow the selected Skills' instructions and use only the tools/permissions actually available. If a relevant Skill is unavailable, proceed with normal reasoning or state the missing capability; do not fabricate a Skill invocation.
5. **Verify.** Run relevant static checks, tests, or readbacks when execution and input artifacts exist. Distinguish observed results from simulations and untested ideas. Never claim hardware-in-the-loop validation for Niagara/PLC without actual access.
6. **Report briefly.** For substantive tasks, end with `Skills used: ...` only for Skills confirmed loaded/applied, or `Skills used: none verified`. State meaningful unresolved issues.

## Routing hints — candidate categories, not guaranteed installed commands

| Work | Candidate Skill categories or names to look for | Required engineering focus |
| --- | --- | --- |
| Niagara N4 / Java crashes, missing classes, strange runtime behavior | `diagnosing-bugs`, `systematic-debugging`, `code-review` | Reproduce, logs, classpath/JAR inspection, API compatibility, root cause |
| Niagara N4 bulk changes, new features, regression prevention | `brainstorming`, `writing-plans`, `test-driven-development`, `verification-before-completion` | Preserve existing behavior, isolate changes, smoke/regression tests, performance |
| PLC/BMS/BACnet/Modbus/RS-485/VAV | Testing, troubleshooting, documentation Skills if available | Separate electrical facts from assumptions; use actual device/vendor evidence |
| Security / licensing / dependencies | Security review, static analysis, dependency-audit Skills | Threat model, concrete findings, no claims of invulnerability |
| Software architecture / optimization | Architecture review, profiling, code-review Skills | Measure before/after, maintainable code, no silent behavioral changes |
| HMI / dashboard / web UI | `ui-ux-pro-max`, `frontend-design` | Usable responsive UI, accessibility, preserve behavior |
| PDF / Excel / DOCX / PPTX / reports | Appropriate document-format Skills | Correct formulas, faithful export, clear source and validation |
| GitHub branches / PRs / reviews | Git/workflow Skills and available GitHub tools | Check branch/base, do not force push or overwrite unrelated work |

Names above are discovery hints only. Never invoke a command by guessing its name. If there are overlapping instructions, prioritize user requirements and platform safety rules.

## GitHub usage
- A Skill committed under `.claude/skills/km-auto-skill-router/SKILL.md` applies to supported Claude Code sessions in **that repository**. A GitHub file by itself does not install a Skill globally or automatically grant access to account Skills.
- Skills enabled under Claude **Customize > Skills** can already be selected automatically when supported and enabled. Claude Code account synchronization is environment- and version-dependent; check the active session rather than assuming every Skill is present.
- Do not fetch and execute arbitrary GitHub scripts as part of routing. Installing or updating third-party Skills is a separate, audited workflow.
- Do not modify existing source code, secrets, or Git history to make this router work.

## Examples
- User: `Review my N4 plugin, especially NoClassDefFoundError and 1000+ devices; do not edit yet.` → Check for available debugging and code-review Skills, read logs/source, provide evidence-ranked findings, no edits.
- User: `Build a commissioning Excel report with formulas and QA.` → Prefer the available spreadsheet Skill; verify formula references and label demo values as demo.
- User: `Redesign my HMI without changing logic.` → Prefer a UI Skill, preserve interfaces and test interactions.

## Boundaries
This is an instruction-only Skill. It cannot enforce automatic skill chaining, install Skills from GitHub by itself, circumvent tool approvals, or run continuously. Report those limits explicitly when relevant.
