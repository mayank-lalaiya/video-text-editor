#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <signal.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

static volatile sig_atomic_t stopping = 0;

static void stop_requested(int signal_number) {
  (void)signal_number;
  stopping = 1;
}

static double monotonic_seconds(void) {
  struct timespec value;
  if (clock_gettime(CLOCK_MONOTONIC, &value) != 0) {
    perror("media-guardian clock");
    exit(125);
  }
  return value.tv_sec + value.tv_nsec / 1000000000.0;
}

static bool parent_closed(void) {
  struct pollfd descriptor = {.fd = 3, .events = POLLIN | POLLHUP};
  int result = poll(&descriptor, 1, 0);
  if (result < 0 && errno != EINTR) {
    perror("media-guardian lifeline");
    return true;
  }
  if (result > 0) {
    char byte;
    ssize_t count = read(3, &byte, 1);
    if (count == 0) return true;
    if (count < 0 && errno != EINTR && errno != EAGAIN) {
      perror("media-guardian lifeline read");
      return true;
    }
  }
  return getppid() == 1;
}

static bool poster_name(const char *name) {
  if (strlen(name) != 40 || strcmp(name + 36, ".png") != 0) return false;
  for (int index = 0; index < 36; index++) {
    char value = name[index];
    if (index == 8 || index == 13 || index == 18 || index == 23) {
      if (value != '-') return false;
    } else if (!((value >= '0' && value <= '9') ||
                 (value >= 'a' && value <= 'f'))) {
      return false;
    }
  }
  return true;
}

static void clean_directory(const char *path) {
  const char *name = strrchr(path, '/');
  if (!name) return;
  name++;
  bool session = strncmp(name, "video-text-editor-", 18) == 0;
  bool export = strncmp(name, ".video-text-editor-", 19) == 0;
  if ((!session && !export) || strlen(name) <= (session ? 18u : 19u)) {
    fprintf(stderr, "media-guardian refused an unrecognized cleanup directory\n");
    return;
  }
  int descriptor = open(path, O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
  if (descriptor < 0) {
    if (errno != ENOENT) perror("media-guardian cleanup open");
    return;
  }
  DIR *directory = fdopendir(descriptor);
  if (!directory) {
    perror("media-guardian cleanup directory");
    close(descriptor);
    return;
  }
  struct dirent *entry;
  while ((entry = readdir(directory))) {
    if ((export && (strcmp(entry->d_name, "text.png") == 0 ||
                    strcmp(entry->d_name, "output.mp4") == 0)) ||
        (session && poster_name(entry->d_name))) {
      if (unlinkat(descriptor, entry->d_name, 0) != 0 && errno != ENOENT)
        perror("media-guardian cleanup file");
    }
  }
  closedir(directory);
  if (rmdir(path) != 0 && errno != ENOENT)
    perror("media-guardian cleanup removal");
}

int main(int argc, char **argv) {
  if (argc == 2 && strcmp(argv[1], "-version") == 0) {
    puts("media-guardian version 1-video-text-editor");
    return 0;
  }
  const char *directories[2];
  int directory_count = 0;
  int command = 1;
  while (command + 1 < argc && strcmp(argv[command], "--cleanup-dir") == 0) {
    if (directory_count == 2) {
      fputs("media-guardian accepts at most two cleanup directories\n", stderr);
      return 125;
    }
    directories[directory_count++] = argv[command + 1];
    command += 2;
  }
  if (command + 1 >= argc || strcmp(argv[command], "--") != 0 ||
      fcntl(3, F_GETFD) < 0) {
    fputs("media-guardian needs a command and parent lifeline on fd 3\n", stderr);
    return 125;
  }
  command++;
  struct sigaction action = {.sa_handler = stop_requested};
  sigemptyset(&action.sa_mask);
  sigaction(SIGTERM, &action, NULL);
  sigaction(SIGINT, &action, NULL);
  sigaction(SIGHUP, &action, NULL);
  signal(SIGPIPE, SIG_IGN);
  pid_t child = fork();
  if (child < 0) {
    perror("media-guardian fork");
    return 125;
  }
  if (child == 0) {
    close(3);
    signal(SIGTERM, SIG_DFL);
    signal(SIGINT, SIG_DFL);
    signal(SIGHUP, SIG_DFL);
    signal(SIGPIPE, SIG_DFL);
    execv(argv[command], &argv[command]);
    perror("media-guardian exec");
    _exit(127);
  }
  bool lost_parent = false;
  double deadline = 0;
  int status = 0;
  for (;;) {
    lost_parent = parent_closed() || lost_parent;
    pid_t finished = waitpid(child, &status, WNOHANG);
    if (finished == child) break;
    if (finished < 0 && errno != EINTR) {
      perror("media-guardian wait");
      kill(child, SIGKILL);
      return 125;
    }
    if ((stopping || lost_parent) && deadline == 0) {
      if (kill(child, SIGTERM) != 0 && errno != ESRCH)
        perror("media-guardian terminate");
      deadline = monotonic_seconds() + 2;
    }
    if (deadline != 0 && monotonic_seconds() >= deadline) {
      if (kill(child, SIGKILL) != 0 && errno != ESRCH)
        perror("media-guardian kill");
    }
    struct timespec pause = {.tv_nsec = 20000000};
    nanosleep(&pause, NULL);
  }
  lost_parent = parent_closed() || lost_parent;
  if (lost_parent) {
    for (int index = directory_count - 1; index >= 0; index--)
      clean_directory(directories[index]);
  }
  close(3);
  if (WIFEXITED(status)) return WEXITSTATUS(status);
  if (WIFSIGNALED(status)) return 128 + WTERMSIG(status);
  return 125;
}
