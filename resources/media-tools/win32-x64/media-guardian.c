#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <io.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <wchar.h>

static void report(const char *operation) {
  fprintf(stderr, "media-guardian %s failed (Windows error %lu)\n",
          operation, (unsigned long)GetLastError());
}

static bool append(wchar_t *buffer, size_t *length, wchar_t value) {
  if (*length >= 32766) return false;
  buffer[(*length)++] = value;
  buffer[*length] = L'\0';
  return true;
}

static wchar_t *command_line(int argc, wchar_t **argv, int start) {
  wchar_t *buffer = calloc(32768, sizeof(wchar_t));
  if (!buffer) return NULL;
  size_t length = 0;
  for (int index = start; index < argc; index++) {
    if (index != start && !append(buffer, &length, L' ')) goto failed;
    if (!append(buffer, &length, L'"')) goto failed;
    const wchar_t *position = argv[index];
    for (;;) {
      size_t slashes = 0;
      while (*position == L'\\') {
        slashes++;
        position++;
      }
      size_t count = (*position == L'"' || *position == L'\0')
                         ? slashes * 2
                         : slashes;
      if (*position == L'"') count++;
      for (size_t slash = 0; slash < count; slash++)
        if (!append(buffer, &length, L'\\')) goto failed;
      if (*position == L'\0') break;
      if (!append(buffer, &length, *position++)) goto failed;
    }
    if (!append(buffer, &length, L'"')) goto failed;
  }
  return buffer;
failed:
  free(buffer);
  fputs("media-guardian command exceeds the Windows command-line limit\n", stderr);
  return NULL;
}

static bool poster_name(const wchar_t *name) {
  if (wcslen(name) != 40 || wcscmp(name + 36, L".png") != 0) return false;
  for (int index = 0; index < 36; index++) {
    wchar_t value = name[index];
    if (index == 8 || index == 13 || index == 18 || index == 23) {
      if (value != L'-') return false;
    } else if (!((value >= L'0' && value <= L'9') ||
                 (value >= L'a' && value <= L'f'))) {
      return false;
    }
  }
  return true;
}

static wchar_t *child_path(const wchar_t *directory, const wchar_t *name) {
  size_t length = wcslen(directory) + wcslen(name) + 2;
  wchar_t *path = calloc(length, sizeof(wchar_t));
  if (path) swprintf(path, length, L"%ls\\%ls", directory, name);
  return path;
}

static void clean_directory(const wchar_t *path) {
  const wchar_t *name = wcsrchr(path, L'\\');
  const wchar_t *slash = wcsrchr(path, L'/');
  if (!name || (slash && slash > name)) name = slash;
  if (!name) return;
  name++;
  bool session = wcsncmp(name, L"video-text-editor-", 18) == 0;
  bool output = wcsncmp(name, L".video-text-editor-", 19) == 0;
  if ((!session && !output) || wcslen(name) <= (session ? 18u : 19u)) {
    fputs("media-guardian refused an unrecognized cleanup directory\n", stderr);
    return;
  }
  HANDLE directory = CreateFileW(
      path, FILE_LIST_DIRECTORY | FILE_READ_ATTRIBUTES | DELETE,
      FILE_SHARE_READ | FILE_SHARE_WRITE, NULL, OPEN_EXISTING,
      FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT, NULL);
  if (directory == INVALID_HANDLE_VALUE) {
    if (GetLastError() != ERROR_FILE_NOT_FOUND &&
        GetLastError() != ERROR_PATH_NOT_FOUND) report("cleanup directory");
    return;
  }
  BY_HANDLE_FILE_INFORMATION info;
  if (!GetFileInformationByHandle(directory, &info) ||
      !(info.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) ||
      (info.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT)) {
    fputs("media-guardian refused a redirected cleanup directory\n", stderr);
    CloseHandle(directory);
    return;
  }
  wchar_t *pattern = child_path(path, L"*");
  if (!pattern) {
    fputs("media-guardian cleanup allocation failed\n", stderr);
    CloseHandle(directory);
    return;
  }
  WIN32_FIND_DATAW entry;
  HANDLE search = FindFirstFileW(pattern, &entry);
  free(pattern);
  if (search != INVALID_HANDLE_VALUE) {
    do {
      if (!((output && (wcscmp(entry.cFileName, L"text.png") == 0 ||
                       wcscmp(entry.cFileName, L"output.mp4") == 0)) ||
            (session && poster_name(entry.cFileName)))) continue;
      wchar_t *file = child_path(path, entry.cFileName);
      if (!file) {
        fputs("media-guardian cleanup allocation failed\n", stderr);
        continue;
      }
      HANDLE handle = CreateFileW(
          file, DELETE | FILE_READ_ATTRIBUTES,
          FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, NULL,
          OPEN_EXISTING, FILE_FLAG_OPEN_REPARSE_POINT, NULL);
      free(file);
      if (handle == INVALID_HANDLE_VALUE) {
        if (GetLastError() != ERROR_FILE_NOT_FOUND) report("cleanup file");
        continue;
      }
      FILE_DISPOSITION_INFO removal = {.DeleteFile = TRUE};
      if (!SetFileInformationByHandle(handle, FileDispositionInfo, &removal,
                                      sizeof(removal))) report("cleanup removal");
      CloseHandle(handle);
    } while (FindNextFileW(search, &entry));
    if (GetLastError() != ERROR_NO_MORE_FILES) report("cleanup enumeration");
    FindClose(search);
  } else if (GetLastError() != ERROR_FILE_NOT_FOUND) report("cleanup enumeration");
  FILE_DISPOSITION_INFO removal = {.DeleteFile = TRUE};
  if (!SetFileInformationByHandle(directory, FileDispositionInfo, &removal,
                                  sizeof(removal))) report("cleanup directory removal");
  CloseHandle(directory);
}

static int parent_state(HANDLE lifeline, bool *cancelled) {
  DWORD available = 0;
  if (!PeekNamedPipe(lifeline, NULL, 0, NULL, &available, NULL)) {
    DWORD error = GetLastError();
    if (error == ERROR_BROKEN_PIPE || error == ERROR_PIPE_NOT_CONNECTED) return 1;
    report("lifeline");
    return -1;
  }
  if (available) {
    unsigned char command = 0;
    DWORD received = 0;
    if (!ReadFile(lifeline, &command, 1, &received, NULL) || received != 1) {
      report("cancellation read");
      return -1;
    }
    if (command != 1) {
      fputs("media-guardian received an invalid cancellation command\n", stderr);
      return -1;
    }
    *cancelled = true;
  }
  return 0;
}

int wmain(int argc, wchar_t **argv) {
  if (argc == 2 && wcscmp(argv[1], L"-version") == 0) {
    puts("media-guardian version 1-video-text-editor");
    return 0;
  }
  const wchar_t *directories[2];
  int directory_count = 0;
  int command = 1;
  while (command + 1 < argc &&
         wcscmp(argv[command], L"--cleanup-dir") == 0) {
    if (directory_count == 2) {
      fputs("media-guardian accepts at most two cleanup directories\n", stderr);
      return 125;
    }
    directories[directory_count++] = argv[command + 1];
    command += 2;
  }
  intptr_t descriptor = _get_osfhandle(3);
  if (command + 1 >= argc || wcscmp(argv[command], L"--") != 0 ||
      descriptor == -1) {
    fputs("media-guardian needs a command and parent lifeline on fd 3\n", stderr);
    return 125;
  }
  HANDLE lifeline = (HANDLE)descriptor;
  if (!SetHandleInformation(lifeline, HANDLE_FLAG_INHERIT, 0)) {
    report("lifeline inheritance");
    return 125;
  }
  command++;
  wchar_t *line = command_line(argc, argv, command);
  if (!line) return 125;
  HANDLE job = CreateJobObjectW(NULL, NULL);
  JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits = {0};
  limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
  if (!job || !SetInformationJobObject(job, JobObjectExtendedLimitInformation,
                                       &limits, sizeof(limits))) {
    report("job creation");
    if (job) CloseHandle(job);
    free(line);
    return 125;
  }
  STARTUPINFOW startup = {.cb = sizeof(startup)};
  startup.dwFlags = STARTF_USESTDHANDLES;
  startup.hStdInput = GetStdHandle(STD_INPUT_HANDLE);
  startup.hStdOutput = GetStdHandle(STD_OUTPUT_HANDLE);
  startup.hStdError = GetStdHandle(STD_ERROR_HANDLE);
  PROCESS_INFORMATION child = {0};
  if (!CreateProcessW(argv[command], line, NULL, NULL, TRUE,
                      CREATE_SUSPENDED | CREATE_NO_WINDOW, NULL, NULL,
                      &startup, &child)) {
    report("worker creation");
    free(line);
    CloseHandle(job);
    return 127;
  }
  free(line);
  if (!AssignProcessToJobObject(job, child.hProcess) ||
      ResumeThread(child.hThread) == (DWORD)-1) {
    report("worker job assignment");
    TerminateProcess(child.hProcess, 125);
    WaitForSingleObject(child.hProcess, INFINITE);
    CloseHandle(child.hThread);
    CloseHandle(child.hProcess);
    CloseHandle(job);
    return 125;
  }
  CloseHandle(child.hThread);
  bool cancelled = false;
  int parent = 0;
  bool failure = false;
  for (;;) {
    parent = parent_state(lifeline, &cancelled);
    if (parent != 0 || cancelled) {
      if (!TerminateJobObject(job, 125)) {
        report("job termination");
        failure = true;
      }
      WaitForSingleObject(child.hProcess, INFINITE);
      break;
    }
    DWORD status = WaitForSingleObject(child.hProcess, 20);
    if (status == WAIT_OBJECT_0) break;
    if (status != WAIT_TIMEOUT) {
      report("worker wait");
      failure = true;
      break;
    }
  }
  DWORD result = 125;
  if (!GetExitCodeProcess(child.hProcess, &result)) {
    report("worker result");
    failure = true;
  }
  CloseHandle(child.hProcess);
  CloseHandle(job);
  if (!parent) parent = parent_state(lifeline, &cancelled);
  if (parent == 1) {
    for (int index = directory_count - 1; index >= 0; index--)
      clean_directory(directories[index]);
  }
  _close(3);
  return failure || parent < 0 || cancelled ? 125 : (int)result;
}
