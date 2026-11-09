# Skills

A skill is a folder with a `SKILL.md` (front matter `name` and `description`, then instructions), the same format Claude Code uses.
Agents can list skills, load the one that fits the task and follow it.

| Tool | Does |
|---|---|
| `list_skills` | Name and purpose of every skill found |
| `use_skill` | Returns a skill's instructions and its folder |
| `read_skill_file` | Reads a text file inside a skill folder (references, scripts, templates) |

* Available to agents with the read-files permission, in every project. They are offered only when at least one skill exists.
* Folders: `DINH_MAI_SKILLS_DIR` (several folders separated by `;` on Windows) or, by default, `~/.claude/skills`. Skills are found up to three levels deep. They are read when needed and **never copied into the app or the project**, so nothing from the skill folders can end up in the repository.
* `read_skill_file` stays inside the skill folder (also through links), and refuses credential files (`.env`, keys, tokens) and binaries.
* A skill's scripts run only through `run_command` with an absolute path, so they go through the command policy and approval queue. Skills written for other assistants may name tools this app does not have; the agent is told to use what it has and say so when a step cannot be done.

## Test cases

| ID | Case | Expected | Test |
|---|---|---|---|
| S-1 | Front matter with quotes, BOM, CRLF; file without front matter | parsed / empty meta | `skill-tools.test.ts` |
| S-2 | Nested skill folders; folder without SKILL.md; folder inside a skill | only real top-level skills listed | `skill-tools.test.ts` |
| S-3 | `list_skills`, `use_skill`, unknown name, no skills | listing, body + folder, error, "No skills found" | `skill-tools.test.ts` |
| S-4 | `read_skill_file` with `../x`, an absolute path, `.env`, a PNG, a missing file | all refused; normal file read | `skill-tools.test.ts` |
| S-5 | Tool offered only to agents that can read files | as stated | `skill-tools.test.ts` |
| S-6 **M** | Agent given a task that matches the `watch` or `pixel-trainer-kitbash` skill | it lists, loads and follows the skill | manual (not yet run) |
