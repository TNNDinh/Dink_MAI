# Multi-AI Development Studio

Ứng dụng desktop (Windows) để điều phối **nhiều mô hình AI như một team phát triển phần mềm/game**. Bạn tạo dự án, chọn team (Project Manager, Developer, Game Designer, Game Analyst...), đặt mục tiêu; app lập kế hoạch, chia task cho từng agent, chạy song song, kiểm soát ngân sách và quyền hạn, rồi ghi kết quả vào thư mục dự án.

* Mỗi agent dùng một mô hình bạn chọn (Anthropic, OpenAI, Gemini, OpenRouter, DeepSeek, Groq, Ollama, endpoint tùy chỉnh, hoặc **Claude Code** đã đăng nhập sẵn trên máy).
* Agent chỉ làm trong thư mục dự án, qua các công cụ có kiểm soát quyền (đọc/ghi file, chạy lệnh, tạo ảnh, git...). Lệnh nhạy cảm đi qua hàng đợi phê duyệt.
* Có bộ công cụ cho game Unity: phân tích ngược APK/XAPK bằng **Dink_ATU**, chạy Unity batch, chơi thử trên BlueStacks, build APK/AAB (xem mục 6).

Tài liệu kỹ thuật chi tiết: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · hạn chế đã biết: [docs/LIMITATIONS.md](docs/LIMITATIONS.md) · công cụ game: [docs/UNITY_GAME_TOOLS.md](docs/UNITY_GAME_TOOLS.md) · test case: [docs/TEST_CASES.md](docs/TEST_CASES.md) · skills: [docs/SKILLS.md](docs/SKILLS.md).

---

## 1. Cài đặt

### Cách A: dùng bản đã đóng gói
Trong thư mục `release/` có hai bản (Windows x64):

* `MultiAI-Studio-<phiên bản>-setup.exe`: trình cài đặt.
* `MultiAI-Studio-<phiên bản>-portable.exe`: chạy thẳng, không cài.

Bản chưa được ký số nên Windows SmartScreen có thể cảnh báo ở lần chạy đầu. Chưa có tự cập nhật: muốn lên bản mới phải cài lại.

### Cách B: chạy từ mã nguồn

Yêu cầu: Windows, Node.js 24 (app dùng `node:sqlite` có sẵn), `git` trong PATH.

```powershell
git clone https://github.com/TNNDinh/Dink_MAI.git
cd Dink_MAI
npm install
npm run dev
```

Các lệnh khác:

| Lệnh | Việc làm |
|---|---|
| `npm run dev` | Chạy app ở chế độ phát triển (có hot reload) |
| `npm run build` | Build mã nguồn vào `out/` |
| `npm test` | Chạy toàn bộ unit test (Vitest) |
| `npm run typecheck` | Kiểm tra kiểu TypeScript |
| `npm run smoke` | Build rồi chạy app tự kiểm tra, lưu ảnh chụp màn hình |
| `npm run package` | Tạo installer + portable trong `release/` |
| `npm run package:dir` | Đóng gói thành thư mục (nhanh hơn, để thử) |

> Terminal của VS Code đặt biến `ELECTRON_RUN_AS_NODE=1` làm Electron chạy như Node thường. `npm run dev` và `npm run smoke` đã tự bỏ biến này, nên hãy dùng hai lệnh đó thay vì gọi `electron` trực tiếp.

---

## 2. Bắt đầu nhanh (5 bước)

1. **Kết nối mô hình AI**: vào **Model Connections** → thêm một kết nối.
   * Có API key: chọn nhà cung cấp, dán key. Key được mã hóa bằng Windows DPAPI, không bao giờ lưu dạng thường và giao diện không đọc lại được.
   * Không muốn dùng key: chọn **Claude Code**. App gọi `claude -p` bằng tài khoản Claude Code đã đăng nhập trên máy (cần cài Claude Code CLI).
   * Bấm **Test connection**, rồi **Discover models** để lấy danh sách mô hình.
2. **Nhập giá** (nếu cần theo dõi chi phí): app không đoán giá. Mô hình chưa có giá được ghi là "chưa biết" và không tính vào ngân sách (OpenRouter tự có giá từ API; mô hình local là $0).
3. **Tạo dự án**: vào **Projects → New project**. Điền tên, thư mục gốc (thư mục có sẵn hoặc đường dẫn mới), loại dự án và **mục tiêu** (goal). Có thể đặt ngân sách (USD) và số vòng lặp tối đa.
4. **Tạo team**: vào **AI Agents**, tạo agent từ template cho dự án (ví dụ `project_manager`, `game_analyst`, `game_designer`) và gán **kết nối + mô hình** cho từng agent. Agent nào chưa có mô hình sẽ hiện lý do trong cột issues.
5. **Chạy**: mở **Task Manager** và bắt đầu một run cho dự án (hộp thoại cho phép đổi mục tiêu, ngân sách, số vòng lặp, số task chạy song song). Theo dõi trong **AI Office** (các agent làm việc theo phòng ban), **Task Manager** (bảng task), **Dashboard** (chi phí, token).

Nút **STOP** dừng mọi lần gọi mô hình và tiến trình con đang chạy. Run bị dừng hoặc lỗi có thể **Resume**: các task chưa xong quay về hàng đợi.

---

## 3. Các trang trong app

| Trang | Dùng để |
|---|---|
| Dashboard | Tổng quan dự án, run, chi phí và token theo mô hình/agent |
| Projects | Tạo, xem, sửa dự án (mục tiêu, ngân sách, bypass phê duyệt, tự phục hồi) |
| Workspace | Duyệt file, soạn thảo bằng Monaco, terminal chạy lệnh, tìm kiếm, xem chỉ mục ngữ cảnh |
| Source Control | Xem thay đổi, commit, nhánh, checkpoint và rollback bằng git |
| Live Preview | Xem trước ứng dụng web/game đang chạy |
| AI Office | Hình dung team đang làm gì, theo phòng ban (có phòng **Dink_ATU** cho Game Analyst) |
| AI Agents | Tạo/sửa agent: prompt, quyền hạn, mô hình, giới hạn chi phí |
| Model Connections | Kết nối nhà cung cấp, test, tìm mô hình, nhập giá, Playground chat |
| Workflow Editor | Dựng quy trình dạng đồ thị (có bước phê duyệt của người) và chạy |
| Asset Library | Ảnh/asset do AI tạo, kèm giá và lịch sử |
| Task Manager | Bảng task, phụ thuộc giữa task, trạng thái, lỗi |
| XAPK to APK | Kéo một file `.xapk` / `.apkm` / `.apks` (hoặc thư mục apk tách) vào, nhận lại 1 file `.apk` đã ký, lưu cạnh file gốc. Xem mục 6 |
| Settings | Đường dẫn công cụ (ví dụ Dink_ATU), tùy chọn chung |

---

## 4. Quyền hạn và phê duyệt

Mỗi agent có bộ quyền riêng: đọc file, ghi file, chạy lệnh (`ask` / `allowlist` / ...), internet, git commit.

* Lệnh agent muốn chạy đi qua **chính sách lệnh**. Lệnh trong danh sách cho phép (như `npm test`, `tsc`) chạy ngay; lệnh khác, hoặc lệnh trỏ ra ngoài thư mục dự án, vào **hàng đợi phê duyệt** để bạn bấm cho phép hoặc từ chối. Yêu cầu hết hạn sau 15 phút và tính là từ chối.
* Lệnh nguy hiểm (công cụ đĩa, xóa đệ quy thư mục hệ thống, `shutdown`, sửa registry...) bị **chặn cứng**, kể cả khi bypass.
* **Bypass approvals**: bật trong trang chi tiết dự án, hoặc bấm *Bypass for this project* trong hộp phê duyệt (cần bấm hai lần). Từ lúc đó mọi lệnh được phép của dự án chạy mà không hỏi, và các lệnh đang chờ được cho chạy luôn. Chỉ dùng cho dự án bạn tin tưởng.
* Agent không đọc/ghi được file bí mật (`.env`, file key) và không động vào `.git`.

Hàng rào này là chính sách đọc chữ trong lệnh, **không phải sandbox của hệ điều hành**: lệnh được duyệt chạy với quyền Windows của bạn. Chi tiết: [docs/LIMITATIONS.md](docs/LIMITATIONS.md).

---

## 5. Chi phí và giới hạn

* **Ngân sách dự án/run**: kiểm tra trước mỗi lần gọi mô hình. Hết ngân sách, run chuyển sang `paused`; nâng ngân sách rồi Resume.
* **Giới hạn mỗi task: $10** (hằng số `MAX_TASK_COST_USD` trong `src/main/orchestrator/orchestrator.ts`). Task vượt mức bị dừng và **không tự chạy lại** (chạy lại từ đầu sẽ tốn thêm y như vậy). Hãy chia task nhỏ hơn. Nếu file kết quả đã được ghi đủ, đừng Resume đúng task đó: tạo run mới với mục tiêu nói rõ phần nào đã xong.
* **Giới hạn vòng công cụ**: một task mặc định 12 vòng (40 vòng cho agent có `android_play`). Agent được nhắc trước 2 vòng cuối; vòng cuối không có công cụ nên phải viết ra những gì đã biết.
* Kết quả công cụ cũ được rút gọn trong hội thoại để tránh trả tiền lặp lại cho cùng một đoạn văn bản dài.
* Gọi bị hủy hoặc lỗi được ghi 0 token vì không biết đã dùng bao nhiêu.

Mẹo tiết kiệm: đặt ngân sách thấp khi thử, dùng mô hình nhỏ cho agent đơn giản, và viết mục tiêu rõ phạm vi ("chỉ viết tài liệu, không viết code").

---

## 6. Làm game Unity và phân tích ngược game (Dink_ATU)

Các công cụ dưới đây xuất hiện cho agent khi dự án có thư mục làm việc và agent có đủ quyền (xem bảng đầy đủ ở [docs/UNITY_GAME_TOOLS.md](docs/UNITY_GAME_TOOLS.md)):

| Công cụ | Việc làm |
|---|---|
| `game_init` | Tạo project Unity mới từ template (clone một nhánh của repo template) |
| `unity_run` | Unity batch mode: biên dịch, chạy test, chạy editor method |
| `unity_bridge` | Điều khiển Unity editor đang mở qua MCP bridge |
| `apk_to_unity` | **Dink_ATU**: `analyze` hoặc `convert` APK/XAPK/thư mục game PC thành project Unity và code đã dịch ngược |
| `android_play` | Chơi game Android trên BlueStacks qua adb |
| `android_build` | Build APK (thử) hoặc AAB (store), có cổng kiểm tra phát hành |

### Cài Dink_ATU
Clone https://github.com/TNNDinh/Dink_ATU rồi chạy `setup.ps1 -WithGhidra` một lần (khoảng 600 MB). Nếu đã có trên máy, vào **Settings → Tools → Browse** và chọn thư mục chứa `apk2unity.ps1` (ví dụ `D:\apk2unity`). Thứ tự tìm: thư mục chọn trong Settings, biến môi trường `DINK_ATU_DIR`, rồi `D:\Projects\Dink_ATU` và `D:\apk2unity`.

### Quy trình viết tài liệu cho một game có sẵn (ví dụ thực tế: Parking Loop)

1. Tạo thư mục dự án, đặt file `.apk`/`.xapk` vào `input/`. **Chỉ dùng game của bạn, game mã nguồn mở, hoặc ứng dụng bạn có quyền phân tích.**
2. Tạo dự án trong app (loại `unity`) và tạo đúng 3 agent: `project_manager`, `game_analyst` (phòng Dink_ATU), `game_designer`. Gán mô hình cho từng agent.
3. Đặt mục tiêu, ví dụ:
   > Tài liệu hóa game trong `input/<tên>.xapk`. Game Analyst chạy Dink_ATU và ghi bằng chứng vào `docs/evidence/`; Game Designer viết `docs/GAME_DESIGN.md` từ bằng chứng đó, gắn tag VERIFIED/INFERRED và liệt kê câu hỏi mở. Chỉ viết tài liệu: không phát triển, không build, không chơi trên giả lập.
4. Bắt đầu run (ngân sách gợi ý $15-30, cho chạy 1 task một lúc). Planner tự chia: (1) Analyst chạy Dink_ATU và viết `docs/evidence/assets-and-data.md`; (2) Analyst viết `docs/evidence/code-map.md`; (3) Designer, chờ cả hai, viết `docs/GAME_DESIGN.md`. Kết quả của Dink_ATU nằm trong `atu_output/<tên>/`.
5. Duyệt lệnh Dink_ATU khi được hỏi (lệnh `apk2unity.ps1` tham chiếu thư mục ngoài dự án nên cần phê duyệt), hoặc bật bypass cho dự án.

### Đổi XAPK thành APK (trang "XAPK to APK")

Không cần dự án hay agent: mở trang **XAPK to APK** trong thanh bên, kéo file `.xapk` vào (hoặc bấm *Choose file…*), rồi bấm **Convert to APK**. App gộp các phần (base + config) bằng APKEditor, căn chỉnh và ký bằng uber-apk-signer, rồi lưu `<tên>.apk` cạnh file gốc (không bao giờ ghi đè file có sẵn).

- Cần Java: dùng JDK trong Dink_ATU (`tools/jdk`), nếu không có thì `JAVA_HOME` hoặc `java` trong PATH.
- Lần đầu app tải hai file jar (khoảng 10 MB) vào thư mục dữ liệu của app, kiểm tra SHA-256 cố định rồi giữ lại cho các lần sau.
- Tùy chọn **Lower the minimum Android version** (mặc định tắt): hạ `minSdkVersion` trong manifest, ví dụ game cần SDK 32 (Android 12L) nhưng BlueStacks chỉ Android 11 (SDK 30) sẽ báo `INSTALL_FAILED_OLDER_SDK`. Game vẫn có thể crash nếu dùng tính năng chỉ có ở Android mới.
- File OBB đi kèm không thể nằm trong apk; app chỉ cảnh báo.
- Apk đã ký bằng khóa debug, nên không cài đè được lên bản đã cài từ Play Store (gỡ bản cũ trước).

### Giữ cho tài liệu trung thực
Agent có `apk_to_unity` hoặc `android_play` được dặn gắn mỗi khẳng định về game gốc bằng `[VERIFIED: nguồn]` (đọc từ code C# thật, từ `ui_dump`/`logcat`, hoặc từ file dữ liệu) hoặc `[INFERRED]` (suy ra từ tên, outline, pseudo-C), và ghi "unknown" thay vì bịa. Đây là chỉ dẫn cho mô hình, không phải khóa kỹ thuật: người đọc vẫn nên soi các chỗ không có tag và các con số không có nguồn.

Giới hạn cần biết: game IL2CPP chỉ cho outline lớp (`il2cpp/dump.cs`); với `decompile_logic` Ghidra thêm pseudo-C nhưng chạy rất lâu và chỉ là gợi ý. Dữ liệu level/giá thường nằm trong ScriptableObject mà AssetRipper xuất ra rỗng, nên cần chơi thử để biết số liệu thật.

### Cổng phát hành
* Build **APK** luôn được phép nhưng đóng dấu `TEST BUILD ONLY - NOT FOR RELEASE` và liệt kê các asset gốc chưa thay.
* Build **AAB** (bản cửa hàng) bị từ chối khi còn asset giống hệt asset đã trích từ game gốc. Hãy thay bằng tài nguyên của bạn hoặc xóa chúng. Cổng này chỉ bắt bản sao y nguyên, không kiểm tra giấy phép.

---

## 7. Skills

Skill là một thư mục có `SKILL.md` (cùng định dạng với Claude Code). Agent có quyền đọc file có thể liệt kê (`list_skills`), nạp (`use_skill`) và đọc file trong skill (`read_skill_file`). Thư mục skill lấy từ biến `DINH_MAI_SKILLS_DIR` (nhiều thư mục ngăn bằng `;`) hoặc mặc định `~/.claude/skills`. Xem [docs/SKILLS.md](docs/SKILLS.md).

### Cho AI điều khiển app (MCP)

Thay vì dùng MCP "desktop" (AI nhìn màn hình rồi bấm chuột), app có sẵn một MCP server nội bộ để Claude Code (hoặc client MCP khác) gọi thẳng vào app.

1. Vào **Settings → AI access (MCP) → Turn on**.
2. Bấm **Copy** ở dòng "Connect Claude Code" rồi dán vào terminal (lệnh dạng `claude mcp add --transport http studio http://127.0.0.1:47615/mcp --header "Authorization: Bearer …"`). Chỉ cần làm một lần; token được lưu mã hóa và giữ nguyên giữa các lần mở app.
3. App phải đang chạy thì AI mới gọi được.

Các tool: `projects_list`, `tasks_*`, `run_start/stop/resume`, `files_*`, `file_write`, `git_*`, `automation_*`, `events_recent`, `agents_list`; `app_call` gọi bất kỳ hàm nào còn lại của app (xem `IpcContract` trong `src/shared/ipc.ts`, `app_channels` liệt kê tên); `ui_snapshot` / `ui_click` / `ui_type` / `ui_key` / `ui_screenshot` / `ui_eval` thao tác cửa sổ app bằng sự kiện chuột/phím thật, không cần cửa sổ nằm trên cùng.

An toàn: chỉ lắng nghe `127.0.0.1`, bắt buộc có token, từ chối request từ trình duyệt (Origin) và Host lạ. AI **không** thể trả lời hộp phê duyệt lệnh, chạy lệnh terminal của người dùng, mở hộp thoại chọn thư mục, bật "bypass approvals" hay đọc/đổi token. **New token** vô hiệu hóa mọi client đang dùng token cũ.

---

## 8. Biến môi trường thường dùng

| Biến | Tác dụng |
|---|---|
| `DINK_ATU_DIR` | Thư mục Dink_ATU (chứa `apk2unity.ps1`) |
| `UNITY_EDITOR_PATH`, `UNITY_EDITORS_DIR` | Nơi tìm Unity editor |
| `GAME_TEMPLATE_REPO` | Repo template cho `game_init` |
| `BLUESTACKS_DIR`, `BLUESTACKS_ADB_PORT`, `BLUESTACKS_ADB_SERIAL` | Cấu hình BlueStacks/adb |
| `DINH_MAI_SKILLS_DIR` | Thư mục skills |
| `MADS_USER_DATA` | Dùng thư mục dữ liệu riêng (test, tránh đụng profile thật) |
| `MADS_MCP=1`, `MADS_MCP_PORT`, `MADS_MCP_TOKEN` | Ép bật MCP server, đổi cổng (mặc định 47615), đặt token cố định (chỉ dùng cho chạy tự động/test) |

Dữ liệu người dùng (SQLite `studio.db`, khóa mã hóa) nằm trong `%APPDATA%\Multi-AI Development Studio`.

---

## 9. Xử lý sự cố

| Triệu chứng | Cách xử lý |
|---|---|
| Agent báo "no model" / không chạy | Gán kết nối và mô hình cho agent ở trang AI Agents |
| Task thất bại: "above the $10.00 limit for one task" | Chia task nhỏ hơn; xem mục 5 |
| Run `paused` vì hết ngân sách | Nâng ngân sách rồi Resume |
| Lệnh đứng chờ mãi | Có yêu cầu phê duyệt đang chờ; duyệt, hoặc bật bypass cho dự án |
| "Dink_ATU is not installed / has no tools" | Cài Dink_ATU và chạy `setup.ps1 -WithGhidra`, hoặc chọn thư mục ở Settings → Tools |
| "not a Unity project" | Thư mục thiếu `ProjectSettings/ProjectVersion.txt` |
| "open in a Unity editor already" | Đóng editor hoặc dùng `unity_bridge`; chỉ xóa `Temp/UnityLockfile` khi chắc không có Unity nào đang chạy |
| `INSTALL_FAILED_OLDER_SDK` khi cài xapk | Game cần Android mới hơn emulator; dùng trang XAPK to APK với tùy chọn hạ minimum Android, hoặc tạo instance BlueStacks Android 13 |
| adb "no devices" | Mở BlueStacks, bật Android Debug Bridge, chạy `android_play connect` |
| Nhà cung cấp trả lỗi lạ | Dùng Test connection và xem lỗi đã được chuẩn hóa (`auth`, `rate_limit`, `timeout`...) |
| `npm run dev` báo `app` undefined | Biến `ELECTRON_RUN_AS_NODE` đang bật; chạy bằng `npm run dev` (script đã tự bỏ biến này) |

---

## 10. Bản quyền và lưu ý

* Plugin Unity MCP đi kèm (`resources/unity-mcp-plugin`) thuộc giấy phép AnkleBreaker Open License: được dùng miễn phí nhưng không được bán lại, và sản phẩm có kèm nó phải hiện dòng "Powered by AnkleBreaker MCP". Xem [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Nếu phát hành app, hãy hiển thị dòng này ở trang About (hiện chưa làm).
* Phân tích ngược chỉ để học tập và làm việc trên game/ứng dụng bạn có quyền. Không đăng lại nội dung của người khác.

Tác giả: Dinhtnn.
