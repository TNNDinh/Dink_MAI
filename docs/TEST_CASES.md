# Test cases: Unity, Dink_ATU, BlueStacks and release gate

Automated cases run with `npm test` (vitest, no Unity/BlueStacks needed). Manual cases need the real tools and are marked **M**.
Status of the manual cases at the time of writing: **not yet run** (no Unity/BlueStacks session was available).

## 1. Unity batch mode (`unity_run`)

| ID | Case | Expected | Auto |
|---|---|---|---|
| U-1 | Compile command is built with `-batchmode -nographics -projectPath … -logFile - -quit` | exact string | `unity-tools.test.ts` |
| U-2 | Test mode builds `-runTests -testPlatform EditMode/PlayMode` and an optional safe filter | contains flags | `unity-tools.test.ts` |
| U-3 | Method with shell characters (`A.B & calc`), bad build target, quote in path | throws | `unity-tools.test.ts` |
| U-4 | Editor lookup: env path first, then version folders, else null | as stated | `unity-tools.test.ts` |
| U-5 | Folder without ProjectVersion.txt | error "not a Unity project" | `game-tools-flow.test.ts` |
| U-6 | `Temp/UnityLockfile` present | error "open in a Unity editor" | `game-tools-flow.test.ts` |
| U-7 | Editor found, output has `error CS1002` | exit code shown, errors listed first | `game-tools-flow.test.ts` |
| U-8 | Unknown mode | error | `game-tools-flow.test.ts` |
| U-9 | Tool offered only with a workspace and run permission | in/out of the tool list | `unity-tools.test.ts`, `phase6.test.ts` |
| U-10 **M** | Real compile of a project with a syntax error | the CS error is listed, exit code non-zero | manual |
| U-11 **M** | Real PlayMode test run | results XML in `Temp/agent-test-results.xml`, exit 0 | manual |

## 2. MCP bridge (`unity_bridge`)

| ID | Case | Expected | Auto |
|---|---|---|---|
| B-1 | Ports 7890-7899: closed, clone, matching project | the matching port (7892 in the test) | `unity-bridge.test.ts` |
| B-2 | Nothing answers | `null` / message pointing to `unity_run` | both test files |
| B-3 | Manifest edit adds the git URL once and keeps other dependencies | as stated | `unity-bridge.test.ts` |
| B-4 | Non-Unity folder | `not_unity`, nothing written | `unity-bridge.test.ts` |
| B-5 | Missing bridge: bundled copy placed in `Packages/` | `installed`, files exist | `unity-bridge.test.ts` |
| B-6 | Already in manifest or `Packages/` | `present`, nothing changes | `unity-bridge.test.ts` |
| B-7 | No bundled copy | falls back to git URL (`installed_from_git`) | `unity-bridge.test.ts` |
| B-8 | `status`, `compile_errors`, `menu_item` send the expected requests; `execute_code` without code | request paths/bodies; error | `game-tools-flow.test.ts` |
| B-9 **M** | Task started on a Unity project without the bridge | `unity.bridge` event; Unity loads the package at next open | manual |
| B-10 **M** | Editor open, `status` then `compile_errors` | connected on a port; JSON errors | manual |

## 3. Dink_ATU (`apk_to_unity`)

| ID | Case | Expected | Auto |
|---|---|---|---|
| A-1 | `analyze` adds `-Analyze`; `convert` can add `-DecompileLogic`, `-SkipAssetRipper`, `-Name` | flags present/absent | `atu-tools.test.ts` |
| A-2 | Name or path with `;`, `"`, `$(...)` | throws | `atu-tools.test.ts` |
| A-3 | Dink_ATU missing / no `tools` folder | error with install steps | `game-tools-flow.test.ts` |
| A-4 | Input outside the project (`../evil.apk`), or missing file | error | `game-tools-flow.test.ts` |
| A-5 | Valid APK: command contains `atu_output`, result shows exit code | as stated | `game-tools-flow.test.ts` |
| A-6 **M** | `analyze` on a real APK | `REPORT.md` with engine/version/backend | manual |
| A-7 **M** | `convert` on a Mono game | `decompiled/` C# and `UnityProject/` | manual |
| A-8 **M** | `convert` with `decompile_logic` on an IL2CPP game | `il2cpp/dump.cs`, `Logic_PseudoC/` (about 10 minutes) | manual |

## 4. BlueStacks (`android_play`)

| ID | Case | Expected | Auto |
|---|---|---|---|
| P-1 | Commands for connect, tap, swipe, key, launch, ui_dump, screenshot, text, logcat | exact adb lines | `android-tools.test.ts` |
| P-2 | Package with `;`, text with `;`, non-numeric coordinate, key `power`, quote in path, bad address | throws | `android-tools.test.ts` |
| P-3 | adb lookup: BlueStacks first, `adb` fallback | as stated | `android-tools.test.ts` |
| P-4 | adb failure "no devices" | hint about ADB/connect | `game-tools-flow.test.ts` |
| P-5 | Screenshot | saved under `atu_output/screens/<name>.png` | `game-tools-flow.test.ts` |
| P-6 | Install without or with a missing APK; unknown action | error | `game-tools-flow.test.ts` |
| P-7 **M** | connect, install, packages, launch a real game | package listed, game starts | manual |
| P-8 **M** | `ui_dump` on a menu screen | buttons with bounds | manual |
| P-9 **M** | `screenshot` then open the PNG | valid image of the screen | manual |

## 5. Release gate (`android_build`)

| ID | Case | Expected | Auto |
|---|---|---|---|
| G-1 | Original copied into `Assets/` under another name | reported as unresolved | `build-gate.test.ts` |
| G-2 | Replaced content with same name | not reported | `build-gate.test.ts` |
| G-3 | AAB with an unresolved asset | refused, Unity never started, `error` event | both gate tests |
| G-4 | APK with unresolved assets | allowed, starts with `🔴 TEST BUILD ONLY`, lists files | both gate tests |
| G-5 | APK with nothing unresolved | still red "test build" notice | `build-gate.test.ts` |
| G-6 | APK build | `TEST_BUILD_WARNING.txt`, `error` event, `DinhMaiBuild.cs` created, `-dmAab false` | `game-tools-flow.test.ts` |
| G-7 | AAB after replacement | allowed, `-dmAab true`, "Built Builds/game.aab" | `game-tools-flow.test.ts` |
| G-8 | Nothing extracted at all | nothing to resolve, AAB allowed | `build-gate.test.ts` |
| G-9 | Bad target | error | `game-tools-flow.test.ts` |
| G-10 **M** | Real APK build of a small project | `Builds/game-TEST.apk` installs on BlueStacks | manual |
| G-11 **M** | Real AAB build after resolving everything | `Builds/game.aab` exists | manual |
| G-12 **M** | Re-saved (not byte-identical) asset | counted resolved: known limitation | manual |

## 6. Cross-cutting

| ID | Case | Expected | Auto |
|---|---|---|---|
| X-1 | All five tools are in the lead developer's list after `run_command`; reviewers and agents without run permission do not get them | exact list | `phase6.test.ts` |
| X-2 | Every command goes through the command policy and the approval queue | pending approval appears for unsafe commands | **M** |
| X-3 | Aborting a run kills a running Unity/adb command | process stops | **M** |

## Running

```
npm run typecheck
npm test                          # all automated cases
npx vitest run tests/game-tools-flow.test.ts
```

## 7. End-to-end run with the real Claude Code CLI (2026-11-05)

`tests/zz-e2e.test.ts` (skipped unless `DINH_E2E=1`; paths are hard-coded to `D:/Projects/ATU_E2E`, a throwaway empty Unity 6000.2.6f2 project)
starts the real Orchestrator with Claude Code (sonnet) agents and approves only Unity / apk2unity / adb commands.
Input: the owner's own `VoxelDash.apk`. Result of the last full run:

| Step | Result |
|---|---|
| Bridge package missing in the project | installed automatically (`unity.bridge` event) |
| `apk_to_unity` analyze, then convert | OK: Unity 6000.2.6f2, IL2CPP, arm64; convert 33 s |
| Agent writes `docs/GAME_DOC.md` | OK on the third run (see bugs 3-5); the document states honestly what could not be recovered |
| 5 original textures copied into `Assets/` | `android_build aab` refused, event `build.gate` level error |
| Agent deletes the listed files, asks again | AAB built (`Builds/game.aab`, 26 MB) |
| `android_build apk` | built; result starts with the red TEST BUILD notice; `TEST_BUILD_WARNING.txt` written; error event |
| BlueStacks play (`android_play`) | **not exercised** in this run |
| Ghidra logic decompile | **not exercised** |

Bugs this run found and fixed:
1. The Claude CLI loaded the PC's own MCP servers and connectors (Docs, Canva, Discord), so agents believed they had no file tools. The provider now passes `--strict-mcp-config`, an empty `--mcp-config` and `--disable-slash-commands`.
2. The bridge plugin needs `com.unity.test-framework` and `com.unity.ugui`; a project without them failed to compile. They are now added to the manifest.
3. A leftover `Temp/UnityLockfile` made the tools think the editor was open. Now only a held lock counts.
4. Models sometimes dropped one fence of the ` ```tool_calls ` block, or answered in `<invoke>` XML; both forms are now parsed (the JSON form is still the one requested).
5. `search_files` skips big files, so a 38 MB `dump.cs` could not be searched. New tool `search_large_file` streams one file line by line.

Not fixed / still true: the agents' final reports sometimes admit they have no record of earlier steps (each task only sees the summaries of the ones before it).
