# Third-Party Notices

The skills under `.claude/skills/` are copies of upstream open-source skills; the only modifications are listed under “Modifications” below. Upstream authors retain their copyright; each license is reproduced below. Update by re-copying from the pinned commit or a newer upstream commit.

| Upstream | Commit | License | Skills installed |
|---|---|---|---|
| https://github.com/obra/superpowers | `22f0b463e7a5e579904dd6211a520321035526f7` | MIT | 14 (skills/ minus diagnosing-superpowers) |
| https://github.com/mattpocock/skills | `5863806dd4e15c63174bee4e7515a4256792ecfa` | MIT | 13 (subset of those published in .claude-plugin/plugin.json; see SKILLS.md) |
| https://github.com/anthropics/skills | `2c5958ecac7cee2b583967a2c4981d0f4a75c579` | Apache-2.0 (per-skill LICENSE.txt; doc-coauthoring ships none) | 10 (see SKILLS.md) |
| https://github.com/nextlevelbuilder/ui-ux-pro-max-skill | `6ae86f61f520d6ca229d2f40e070410638c908c5` | MIT | 3 (ui-ux-pro-max, ui-styling, design-system) |
| https://github.com/vercel-labs/skills | `b716f9dc2ba36b6aa8f0080615e5a3a6caeac63b` | MIT | 1 (skills/find-skills) |

Anthropic skills are Apache-2.0; each carries its own `LICENSE.txt` in its skill directory. Upstream `anthropics/skills` also publishes `THIRD_PARTY_NOTICES.md` for third-party components that may be referenced by its skills; it has not been audited here.

## Modifications (relative to upstream at the commits above)

- `obra/superpowers` skills: `superpowers:<skill>` cross-references rewritten to `<skill>` (project-level skills have no plugin namespace).
- `ui-ux-pro-max/SKILL.md`: `${CLAUDE_PLUGIN_ROOT}/.claude/skills/` replaced with `.claude/skills/` (the variable is only defined for plugins).
- `webapp-testing/examples/*.py`: `/mnt/user-data/outputs/` replaced with `/tmp/`.
- `webapp-testing/scripts/with_server.py`: stop the server's whole process group on cleanup (previously `cd … && server` left an orphan).
- Removed dev-only `scripts/tests/` from `ui-ux-pro-max`, `ui-styling`, `design-system`, and the junk file `.coverage`.

Anthropic skills are Apache-2.0 and the above changes to them are noted here per section 4 of that license.

---

## obra/superpowers

```text
MIT License

Copyright (c) 2025 Jesse Vincent

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## mattpocock/skills

```text
MIT License

Copyright (c) 2026 Matt Pocock

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## nextlevelbuilder/ui-ux-pro-max-skill

```text
MIT License

Copyright (c) 2024 Next Level Builder

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## vercel-labs/skills

```text
MIT License

Copyright (c) 2026 Vercel, Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
