/* ============================================================
 * 墨记 Mojot · Windows 桌面启动器
 *
 * 作用：内置一个极小的静态 HTTP 服务器（仅监听 127.0.0.1），
 *       启动后在默认浏览器打开编辑器，并显示一个托盘式说明窗口。
 *       关闭窗口即结束进程、释放端口。
 *
 * 编译（MinGW-w64）：
 *   gcc -O2 -mwindows -o Mojot-Markdown.exe desktop/launcher.c -lws2_32 -lshell32
 *
 * 说明：这是「零依赖原生启动器」，不打包 Chromium / Node，
 *       因为编辑器本身是纯静态网页；体积仅几十 KB，便于随仓库分发。
 *       网页文件必须位于 exe 同目录（或上一级发布目录）下。
 * ============================================================ */
#ifndef UNICODE
#define UNICODE
#endif
#ifndef _UNICODE
#define _UNICODE
#endif

/* winsock2.h 必须在 windows.h 之前，否则会拉入冲突的旧 winsock 定义 */
#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#include <shellapi.h>
#include <stdio.h>
#include <string.h>

#define APP_NAME   L"墨记 Mojot"
#define APP_VER    L"v1.1.0"
#define PORT_START 17777
#define PORT_TRIES 20
#define BUF_SIZE   (64 * 1024)

static SOCKET g_listen = INVALID_SOCKET;
static volatile int g_running = 1;
static wchar_t g_root[MAX_PATH];
static int g_port = 0;

/* ---------- 工具 ---------- */
static void utf8_to_wide(const char *src, wchar_t *dst, size_t cap) {
    if (!cap) return;
    int n = MultiByteToWideChar(CP_UTF8, 0, src, -1, dst, (int)cap);
    if (n <= 0) dst[0] = 0;
}

static const wchar_t *mime_of(const wchar_t *path) {
    const wchar_t *dot = wcsrchr(path, L'.');
    if (!dot) return L"application/octet-stream";
    if (_wcsicmp(dot, L".html") == 0 || _wcsicmp(dot, L".htm") == 0) return L"text/html; charset=utf-8";
    if (_wcsicmp(dot, L".css") == 0)  return L"text/css; charset=utf-8";
    if (_wcsicmp(dot, L".js") == 0)   return L"text/javascript; charset=utf-8";
    if (_wcsicmp(dot, L".json") == 0) return L"application/json; charset=utf-8";
    if (_wcsicmp(dot, L".md") == 0)   return L"text/markdown; charset=utf-8";
    if (_wcsicmp(dot, L".svg") == 0)  return L"image/svg+xml";
    if (_wcsicmp(dot, L".txt") == 0)  return L"text/plain; charset=utf-8";
    return L"application/octet-stream";
}

/* 把 URL 路径安全地映射到 root 内的文件；返回 0 表示拒绝 */
static int resolve_path(const char *url, wchar_t *out, size_t cap) {
    if (strstr(url, "..") || strchr(url, '\0') == NULL) return 0;
    /* 去掉查询串 */
    char clean[1024];
    strncpy(clean, url, sizeof(clean) - 1);
    clean[sizeof(clean) - 1] = 0;
    char *q = strchr(clean, '?'); if (q) *q = 0;
    char *hash = strchr(clean, '#'); if (hash) *hash = 0;
    if (clean[0] != '/') return 0;
    if (strcmp(clean, "/") == 0) strcpy(clean, "/index.html");

    /* URL 解码（支持 %XX，含 UTF-8 中文路径） */
    char decoded[2048]; size_t di = 0;
    for (size_t i = 0; clean[i] && di + 4 < sizeof(decoded); i++) {
        if (clean[i] == '%' && clean[i+1] && clean[i+2]) {
            char hex[3] = { clean[i+1], clean[i+2], 0 };
            decoded[di++] = (char)strtol(hex, NULL, 16); i += 2;
        } else if (clean[i] == '+') {
            decoded[di++] = ' ';
        } else {
            decoded[di++] = clean[i];
        }
    }
    decoded[di] = 0;
    /* 禁止反斜杠穿越 */
    for (size_t i = 0; decoded[i]; i++) if (decoded[i] == '\\') decoded[i] = '/';

    wchar_t rel[MAX_PATH];
    utf8_to_wide(decoded + 1, rel, MAX_PATH); /* 去掉开头 / */
    if (wcslen(rel) == 0) wcscpy(rel, L"index.html");

    if (swprintf(out, cap, L"%s\\%s", g_root, rel) < 0) return 0;
    /* 归一化并确认仍在 root 下 */
    wchar_t full[MAX_PATH];
    if (!GetFullPathNameW(out, MAX_PATH, full, NULL)) return 0;
    wcsncpy(out, full, cap - 1); out[cap - 1] = 0;
    if (_wcsnicmp(out, g_root, wcslen(g_root)) != 0) return 0;
    return 1;
}

static void send_all(SOCKET s, const char *data, size_t len) {
    size_t sent = 0;
    while (sent < len && g_running) {
        int n = send(s, data + sent, (int)(len - sent), 0);
        if (n <= 0) break;
        sent += (size_t)n;
    }
}

static void send_simple(SOCKET s, int code, const char *reason, const char *body) {
    char head[512];
    int n = _snprintf(head, sizeof(head),
        "HTTP/1.1 %d %s\r\nContent-Type: text/plain; charset=utf-8\r\n"
        "Content-Length: %u\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n",
        code, reason, (unsigned)strlen(body));
    if (n > 0) send_all(s, head, (size_t)n);
    send_all(s, body, strlen(body));
}

static void handle_client(SOCKET c) {
    char req[BUF_SIZE];
    int n = recv(c, req, sizeof(req) - 1, 0);
    if (n <= 0) { closesocket(c); return; }
    req[n] = 0;

    char method[16] = {0}, url[1024] = {0};
    if (sscanf(req, "%15s %1023s", method, url) != 2) {
        send_simple(c, 400, "Bad Request", "400 Bad Request"); closesocket(c); return;
    }
    if (_stricmp(method, "GET") != 0 && _stricmp(method, "HEAD") != 0) {
        send_simple(c, 405, "Method Not Allowed", "405"); closesocket(c); return;
    }

    wchar_t file[MAX_PATH];
    if (!resolve_path(url, file, MAX_PATH)) {
        send_simple(c, 403, "Forbidden", "403 Forbidden"); closesocket(c); return;
    }

    HANDLE h = CreateFileW(file, GENERIC_READ, FILE_SHARE_READ, NULL,
                           OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);
    if (h == INVALID_HANDLE_VALUE) {
        send_simple(c, 404, "Not Found", "404 Not Found"); closesocket(c); return;
    }
    DWORD size = GetFileSize(h, NULL);
    if (size == INVALID_FILE_SIZE || size > 32 * 1024 * 1024) {
        CloseHandle(h);
        send_simple(c, 413, "Payload Too Large", "413"); closesocket(c); return;
    }

    char *body = (char *)malloc((size_t)size + 1);
    if (!body) { CloseHandle(h); send_simple(c, 500, "Internal Server Error", "500"); closesocket(c); return; }
    DWORD got = 0;
    if (size > 0) ReadFile(h, body, size, &got, NULL);
    CloseHandle(h);
    body[got] = 0;

    char ct[128];
    WideCharToMultiByte(CP_UTF8, 0, mime_of(file), -1, ct, sizeof(ct), NULL, NULL);
    char head[512];
    int hn = _snprintf(head, sizeof(head),
        "HTTP/1.1 200 OK\r\nContent-Type: %s\r\nContent-Length: %u\r\n"
        "Connection: close\r\nCache-Control: no-store\r\n"
        "X-Content-Type-Options: nosniff\r\n\r\n", ct, (unsigned)got);
    if (hn > 0) send_all(c, head, (size_t)hn);
    if (_stricmp(method, "HEAD") != 0) send_all(c, body, got);
    free(body);
    closesocket(c);
}

static DWORD WINAPI server_thread(LPVOID unused) {
    (void)unused;
    while (g_running) {
        SOCKET c = accept(g_listen, NULL, NULL);
        if (c == INVALID_SOCKET) { Sleep(20); continue; }
        handle_client(c);
    }
    return 0;
}

static int start_server(void) {
    WSADATA wsa;
    if (WSAStartup(MAKEWORD(2, 2), &wsa) != 0) return 0;
    for (int i = 0; i < PORT_TRIES; i++) {
        SOCKET s = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
        if (s == INVALID_SOCKET) continue;
        BOOL reuse = TRUE;
        setsockopt(s, SOL_SOCKET, SO_REUSEADDR, (const char *)&reuse, sizeof(reuse));
        struct sockaddr_in addr;
        memset(&addr, 0, sizeof(addr));
        addr.sin_family = AF_INET;
        addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK); /* 只监听 127.0.0.1 */
        addr.sin_port = htons((u_short)(PORT_START + i));
        if (bind(s, (struct sockaddr *)&addr, sizeof(addr)) == 0 && listen(s, 16) == 0) {
            g_listen = s; g_port = PORT_START + i;
            CreateThread(NULL, 0, server_thread, NULL, 0, NULL);
            return 1;
        }
        closesocket(s);
    }
    return 0;
}

/* ---------- 界面 ---------- */
static HFONT make_font(int size, int bold) {
    return CreateFontW(size, 0, 0, 0, bold ? FW_BOLD : FW_NORMAL, 0, 0, 0,
        DEFAULT_CHARSET, OUT_DEFAULT_PRECIS, CLIP_DEFAULT_PRECIS,
        CLEARTYPE_QUALITY, DEFAULT_PITCH | FF_DONTCARE, L"Microsoft YaHei UI");
}

#define ID_BTN_OPEN  1001
#define ID_BTN_QUIT  1002

static HWND g_hwnd;
static HFONT g_f_title, g_f_body, g_f_small;

static LRESULT CALLBACK WndProc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp) {
    switch (msg) {
    case WM_COMMAND:
        if (LOWORD(wp) == ID_BTN_OPEN) {
            wchar_t url[128];
            swprintf(url, 128, L"http://127.0.0.1:%d/", g_port);
            ShellExecuteW(NULL, L"open", url, NULL, NULL, SW_SHOWNORMAL);
        } else if (LOWORD(wp) == ID_BTN_QUIT) {
            PostMessageW(hwnd, WM_CLOSE, 0, 0);
        }
        return 0;
    case WM_CTLCOLORSTATIC: {
        HDC dc = (HDC)wp;
        SetBkColor(dc, RGB(251, 250, 248));
        SetTextColor(dc, RGB(34, 36, 43));
        return (LRESULT)GetStockObject(NULL_BRUSH);
    }
    case WM_CLOSE:
        g_running = 0;
        DestroyWindow(hwnd);
        return 0;
    case WM_DESTROY:
        PostQuitMessage(0);
        return 0;
    }
    return DefWindowProcW(hwnd, msg, wp, lp);
}

static void build_ui(HWND hwnd) {
    g_f_title = make_font(26, 1);
    g_f_body  = make_font(16, 0);
    g_f_small = make_font(14, 0);

    HWND t;
    t = CreateWindowW(L"STATIC", L"墨记 Mojot", WS_CHILD | WS_VISIBLE | SS_LEFT,
        28, 22, 420, 40, hwnd, NULL, NULL, NULL);
    SendMessageW(t, WM_SETFONT, (WPARAM)g_f_title, TRUE);

    wchar_t url[128];
    swprintf(url, 128, L"http://127.0.0.1:%d/", g_port);
    t = CreateWindowW(L"STATIC", L"编辑器已在默认浏览器中打开", WS_CHILD | WS_VISIBLE | SS_LEFT,
        28, 76, 440, 26, hwnd, NULL, NULL, NULL);
    SendMessageW(t, WM_SETFONT, (WPARAM)g_f_body, TRUE);

    wchar_t addr[160];
    swprintf(addr, 160, L"本地地址：%s", url);
    t = CreateWindowW(L"STATIC", addr, WS_CHILD | WS_VISIBLE | SS_LEFT,
        28, 108, 440, 24, hwnd, NULL, NULL, NULL);
    SendMessageW(t, WM_SETFONT, (WPARAM)g_f_small, TRUE);
    SetTextColor(GetDC(t), RGB(91, 91, 214));

    t = CreateWindowW(L"STATIC",
        L"文档与偏好保存在浏览器本地，关闭本窗口即停止服务。",
        WS_CHILD | WS_VISIBLE | SS_LEFT, 28, 140, 440, 48, hwnd, NULL, NULL, NULL);
    SendMessageW(t, WM_SETFONT, (WPARAM)g_f_small, TRUE);

    HWND b1 = CreateWindowW(L"BUTTON", L"重新打开编辑器", WS_CHILD | WS_VISIBLE | BS_PUSHBUTTON,
        28, 200, 170, 40, hwnd, (HMENU)ID_BTN_OPEN, NULL, NULL);
    SendMessageW(b1, WM_SETFONT, (WPARAM)g_f_body, TRUE);
    HWND b2 = CreateWindowW(L"BUTTON", L"退出", WS_CHILD | WS_VISIBLE | BS_PUSHBUTTON,
        212, 200, 100, 40, hwnd, (HMENU)ID_BTN_QUIT, NULL, NULL);
    SendMessageW(b2, WM_SETFONT, (WPARAM)g_f_body, TRUE);
}

int WINAPI WinMain(HINSTANCE hInst, HINSTANCE hPrev, LPSTR cmd, int show) {
    (void)hPrev; (void)cmd;

    /* 网页根目录 = exe 所在目录；也兼容「exe 在 desktop/ 子目录」的情况 */
    GetModuleFileNameW(NULL, g_root, MAX_PATH);
    wchar_t *slash = wcsrchr(g_root, L'\\');
    if (slash) *slash = 0;
    /* 若根目录下没有 index.html，尝试上一级（源码仓库布局） */
    wchar_t probe[MAX_PATH];
    swprintf(probe, MAX_PATH, L"%s\\index.html", g_root);
    if (GetFileAttributesW(probe) == INVALID_FILE_ATTRIBUTES) {
        wchar_t up[MAX_PATH];
        swprintf(up, MAX_PATH, L"%s\\..\\index.html", g_root);
        if (GetFileAttributesW(up) != INVALID_FILE_ATTRIBUTES) {
            wchar_t full[MAX_PATH];
            if (GetFullPathNameW(up, MAX_PATH, full, NULL)) {
                slash = wcsrchr(full, L'\\'); if (slash) *slash = 0;
                wcsncpy(g_root, full, MAX_PATH - 1); g_root[MAX_PATH - 1] = 0;
            }
        }
    }

    if (!start_server()) {
        MessageBoxW(NULL, L"无法启动本地服务（端口被占用或 Winsock 初始化失败）。", APP_NAME, MB_ICONERROR);
        return 1;
    }

    WNDCLASSW wc;
    memset(&wc, 0, sizeof(wc));
    wc.lpfnWndProc = WndProc;
    wc.hInstance = hInst;
    wc.hbrBackground = CreateSolidBrush(RGB(251, 250, 248));
    wc.lpszClassName = L"MojotLauncher";
    wc.hCursor = LoadCursor(NULL, IDC_ARROW);
    wc.hIcon = LoadIcon(NULL, IDI_APPLICATION);
    RegisterClassW(&wc);

    g_hwnd = CreateWindowW(L"MojotLauncher", APP_NAME L"  ·  " APP_VER,
        WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU | WS_MINIMIZEBOX,
        CW_USEDEFAULT, CW_USEDEFAULT, 500, 300,
        NULL, NULL, hInst, NULL);
    if (!g_hwnd) { MessageBoxW(NULL, L"无法创建窗口。", APP_NAME, MB_ICONERROR); return 1; }
    build_ui(g_hwnd);
    ShowWindow(g_hwnd, show);
    UpdateWindow(g_hwnd);

    wchar_t url[128];
    swprintf(url, 128, L"http://127.0.0.1:%d/", g_port);
    ShellExecuteW(NULL, L"open", url, NULL, NULL, SW_SHOWNORMAL);

    MSG msg;
    while (GetMessageW(&msg, NULL, 0, 0) > 0) {
        TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }
    g_running = 0;
    if (g_listen != INVALID_SOCKET) closesocket(g_listen);
    WSACleanup();
    return 0;
}
