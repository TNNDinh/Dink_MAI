# Unity, Dink_ATU, BlueStacks and the release gate

Agents of a team can work on a Unity game end to end: open Unity, study an existing game package, play it on an emulator,
write documentation and build for Android. Everything below is a **tool** an agent may call. Tools appear only when the
project has a workspace and the agent has the permissions named in the table.

| Tool | Does | Needs permission |
|---|---|---|
| `game_init` | Seeds an **empty** project from a base game template (clones one branch of a template repo) so there is a real Unity project to build on | run commands + write files |
| `unity_run` | Unity in batch mode: compile and list errors, run EditMode/PlayMode tests, run an editor method | run commands |
| `unity_bridge` | Talks to the Unity editor that is open on the project through the MCP bridge (compile errors, menu item, C# code); can install the bridge package | run commands + write files |
| `apk_to_unity` | Dink_ATU: `analyze` an APK/XAPK/PC game folder, or `convert` it to a Unity project and decompiled code | run commands + read files |
| `android_play` | Plays an Android game on BlueStacks through adb | run commands + write files |
| `android_build` | Builds the game as APK (test) or AAB (store), behind the release gate | run commands + write files |

Every command these tools start goes through the normal command policy and approval queue (`run_command` rules), is logged
in the command log, and has a timeout. Values that go into a command line are validated or quoted; anything with shell
characters is refused.

## Starting a new game from a base template

The other tools all need an existing Unity project — they refuse a folder with no `ProjectSettings/ProjectVersion.txt`, and `apk_to_unity`
only reverse-engineers an APK you already own. So a brand-new game begins with `game_init`:

1. Create an **empty** project (nothing but its `.git`).
2. `game_init` with a `template` (a branch of the template repo; default `base_mobile`, a complete Unity mobile project). It clones that
   branch shallow into the project, moves the files to the project root, keeps the project's own `.git`, and drops the template's history.
3. The folder is now a Unity project: `unity_run` (mode `compile`) to check it builds, then `android_build` (target `apk`) for a test build.

* Default template repo: `https://github.com/TNNDinh/Base_Template.git` (override with `GAME_TEMPLATE_REPO`, or the `repo_url` argument).
  Known base branches: `base_mobile`, `base_pc`, `auto_chess`, `bus_dash`, `kingdom_assault_3d`, `mircro_rpg`, `prop_horror`.
* It refuses a folder that is already a Unity project or that is not empty, so it never overwrites work. The clone needs git and the network,
  and goes through the normal command approval.

## Setup

| Need | How |
|---|---|
| Unity editor | Found from `ProjectSettings/ProjectVersion.txt` in `UNITY_EDITOR_PATH`, `UNITY_EDITORS_DIR`, Unity Hub folders or `D:\EditorUnity`. |
| MCP bridge | Installed automatically (see below). |
| Dink_ATU | Clone https://github.com/TNNDinh/Dink_ATU, run `setup.ps1 -WithGhidra` once (about 600 MB). Set `DINK_ATU_DIR`, or keep it in `D:\Projects\Dink_ATU` / `D:\apk2unity`. |
| BlueStacks | Installed and running, Settings > Advanced > Android Debug Bridge on. The app uses its `HD-Adb.exe` and `127.0.0.1:5555` (`BLUESTACKS_DIR`, `BLUESTACKS_ADB_PORT`, `BLUESTACKS_ADB_SERIAL` override). |

## The Unity MCP bridge

* Before an agent starts a task in a Unity project, the app checks `Packages/manifest.json` and `Packages/`. If the bridge
  (`com.anklebreaker.unity-mcp`) is missing, the copy that ships with the app (`resources/unity-mcp-plugin`) is placed in
  `Packages/com.anklebreaker.unity-mcp`. This works offline. If the app has no bundled copy, the git URL is added to the manifest.
  An `unity.bridge` event is recorded.
* With the editor open, `unity_bridge` finds the right editor by scanning ports 7890-7899 and matching the `projectPath`
  from `ping` (a Multiplayer Play Mode clone has another path and is skipped).
* Without an open editor, use `unity_run`. The project cannot be opened twice: if `a Unity editor really holds `Temp/UnityLockfile` (a leftover file from a crashed run does not count), `unity_run`
  and `android_build` refuse.
* Licence: the plugin is under the AnkleBreaker Open License. Free use is allowed; it may not be sold or resold, and a product
  that includes it must show "Powered by AnkleBreaker MCP". See `THIRD_PARTY_NOTICES.md`. **If the app is published, show that line on the About page** (not done yet).

## From an APK to a documented game

1. Put the `.apk`/`.xapk` in the project (for example `input/game.apk`). Only use games you own, open-source games or apps you have the right to analyse.
2. `apk_to_unity` `analyze`: engine, Unity version, Mono or IL2CPP. Result in `atu_output/<name>/REPORT.md`.
3. `apk_to_unity` `convert`: Unity project (`UnityProject/`), assets (`extracted/`), and code. Mono games give C# with function bodies
   (`decompiled/`). IL2CPP games give class outlines (`il2cpp/dump.cs`); with `decompile_logic` Ghidra adds pseudo-C of the logic (long run).
4. If the code is only outlines and behaviour must be guessed, install the APK on BlueStacks with `android_play`: `connect`,
   `install`, `packages` (find the package name), `launch`, then repeat `ui_dump` / `screenshot` / `tap` / `swipe` / `key`, and `logcat` for warnings.
   Tool results are text, so the agent reads the screen through `ui_dump` (texts, buttons, bounds). Games drawn with OpenGL show little there;
   screenshots go to `atu_output/screens/` for people to look at.
5. The agent writes what it learned into project memory (`write_memory`, kinds `design_doc` / `note`) or doc files, then builds the new game.

## The release gate

* Dink_ATU output lives in `atu_output/<name>/` (`UnityProject/Assets`, `extracted/assets`).
* A file in the game's own `Assets/` whose bytes equal one of those extracted files is **unresolved**: it still is the original asset, whatever its new name or folder.
* **APK = test build.** It is always allowed, and every result starts with `🔴 TEST BUILD ONLY — NOT FOR RELEASE`, listing the unresolved assets.
  A `error` event `build.gate` is recorded, and `Builds/TEST_BUILD_WARNING.txt` is written next to `game-TEST.apk`.
* **AAB = store build.** Refused while any asset is unresolved. The message lists the files. Resolve each by replacing it with original or licensed work
  (the content must change) or by deleting it, then ask again.
* Builds run `DinhMai.BuildTools.BuildAndroid` from `Assets/Editor/DinhMaiBuild.cs`, which the tool writes if it is absent. Output: `Builds/game-TEST.apk` or `Builds/game.aab`.
  The project needs enabled scenes in Build Settings and its Android signing settings.

### What the gate does not do

* Only exact copies are found. An asset that was re-saved, re-compressed or edited slightly counts as resolved. Code, scene layouts and design copied from the original are not checked.
* It checks media-type files (images, audio, models, video, fonts, animation). It cannot tell whether a replacement is licensed.
* An agent can still run a build through `unity_run` (execute_method) or `run_command` and skip the gate. The approval queue is the safeguard there.
* Large projects: the scan stops at 40,000 files and says so in the message.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| "not a Unity project" | The project folder has no `ProjectSettings/ProjectVersion.txt`. |
| "Unity X was not found" | Set `UNITY_EDITOR_PATH` or `UNITY_EDITORS_DIR`. |
| "open in a Unity editor already" | Close the editor, or use `unity_bridge`. Delete a stale `Temp/UnityLockfile` only if no Unity is running. |
| "Dink_ATU is not installed / has no tools" | Clone it and run `setup.ps1 -WithGhidra`. |
| adb "no devices" | Start BlueStacks, enable ADB, run `android_play` `connect`. |
| AAB refused | Replace or remove the listed files, then try again. |
| Build fails with "no enabled scenes" | Add scenes in File > Build Settings. |
