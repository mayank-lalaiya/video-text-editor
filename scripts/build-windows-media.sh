#!/usr/bin/env bash
set -euo pipefail

if [[ "${MSYSTEM:-}" != UCRT64 ]]; then
  echo "Use an MSYS2 UCRT64 shell on Windows x64." >&2
  exit 1
fi
for tool in gcc g++ make ninja pkg-config curl tar unzip node; do
  command -v "$tool" >/dev/null || { echo "Missing build tool: $tool" >&2; exit 1; }
done

cd "$(dirname "$0")/.."
root="$(pwd)"
destination="$root/resources/media-tools/win32-x64"
work="$(mktemp -d "${TMPDIR:-/tmp}/video-editor-win-build.XXXXXX")"
prefix="$work/prefix"
jobs="${NUMBER_OF_PROCESSORS:-2}"
mkdir -p "$prefix/include" "$prefix/lib" "$destination/sources" "$destination/licenses"
echo "Native build workspace: $work"

curl --fail --location --retry 3 \
  https://github.com/Kitware/CMake/releases/download/v3.31.10/cmake-3.31.10-windows-x86_64.zip \
  --output "$work/cmake.zip"
echo "13d1a463d7130df5339baedd63d8ae990aaf385062b2f42f372796143ae94086  $work/cmake.zip" | sha256sum --check --status
unzip -q "$work/cmake.zip" -d "$work"
cmake="$work/cmake-3.31.10-windows-x86_64/bin/cmake.exe"

for codec in x264 x265 zlib; do
  url="$(node -p "JSON.parse(require('fs').readFileSync('resources/media-tools/win32-x64/sources.json')).$codec.url")"
  hash="$(node -p "JSON.parse(require('fs').readFileSync('resources/media-tools/win32-x64/sources.json')).$codec.sha256")"
  archive="$destination/sources/$codec.tar.gz"
  curl --fail --location --retry 3 "$url" --output "$archive"
  echo "$hash  $archive" | sha256sum --check --status
  mkdir "$work/$codec"
  tar -xzf "$archive" --strip-components=1 -C "$work/$codec"
done

cd "$work/zlib"
make -f win32/Makefile.gcc -j"$jobs" libz.a
cp libz.a "$prefix/lib/"
cp zlib.h zconf.h "$prefix/include/"
cp LICENSE "$destination/licenses/zlib.txt"

cd "$work/x264"
./configure --prefix="$prefix" --host=x86_64-w64-mingw32 \
  --enable-static --disable-cli --disable-opencl --disable-asm --bit-depth=8
make -j"$jobs"
make install
cp COPYING "$destination/licenses/x264.txt"

common=(-G Ninja -DENABLE_SHARED=OFF -DENABLE_CLI=OFF -DENABLE_ASSEMBLY=OFF
  -DENABLE_NUMA=OFF -DENABLE_HDR10_PLUS=OFF -DCMAKE_BUILD_TYPE=Release
  -DCMAKE_CXX_STANDARD=11 -DCMAKE_INSTALL_PREFIX="$prefix")
"$cmake" -S "$work/x265/source" -B "$work/x265-10" "${common[@]}" \
  -DHIGH_BIT_DEPTH=ON -DEXPORT_C_API=OFF
"$cmake" --build "$work/x265-10" --parallel "$jobs"
"$cmake" -S "$work/x265/source" -B "$work/x265-8" "${common[@]}" \
  -DHIGH_BIT_DEPTH=OFF -DLINKED_10BIT=ON \
  -DEXTRA_LIB=x265_main10.a -DEXTRA_LINK_FLAGS="-L$work/x265-8"
cp "$work/x265-10/libx265.a" "$work/x265-8/libx265_main10.a"
"$cmake" --build "$work/x265-8" --parallel "$jobs"
"$cmake" --install "$work/x265-8"
cd "$work/x265-8"
mv libx265.a libx265_main8.a
ar -M <<'ARCHIVE'
CREATE libx265.a
ADDLIB libx265_main8.a
ADDLIB libx265_main10.a
SAVE
END
ARCHIVE
cp libx265.a "$prefix/lib/"
cp "$work/x265/COPYING" "$destination/licenses/x265.txt"

source_archive="$root/resources/media-tools/darwin-arm64/ffmpeg-9.0.2.tar.xz"
echo "8c3850283eb25fa026482078a04051e0be17347b09ef81a0849bec15a96e002e  $source_archive" | sha256sum --check --status
cp "$source_archive" "$destination/sources/ffmpeg-9.0.2.tar.xz"
mkdir "$work/ffmpeg"
tar -xJf "$source_archive" --strip-components=1 -C "$work/ffmpeg"
cd "$work/ffmpeg"
export PKG_CONFIG_PATH="$prefix/lib/pkgconfig"
./configure --target-os=mingw32 --arch=x86_64 --disable-autodetect \
  --disable-network --disable-debug --disable-doc --disable-ffplay \
  --disable-shared --enable-static --enable-gpl --enable-libx264 \
  --enable-libx265 --enable-zlib --disable-x86asm --pkg-config-flags=--static \
  --extra-cflags="-I$prefix/include -D_WIN32_WINNT=0x0A00" \
  --extra-ldflags="-L$prefix/lib -static" --extra-libs="-lstdc++ -lwinpthread" \
  --extra-version=video-text-editor-win1
make -j"$jobs"
cp ffmpeg.exe ffprobe.exe "$destination/"
cp COPYING.GPLv2 "$destination/licenses/ffmpeg-gpl.txt"
cp LICENSE.md "$destination/licenses/ffmpeg-overview.md"
cp -R /ucrt64/share/licenses "$destination/licenses/toolchain"

cd "$root"
gcc -std=c11 -O2 -Wall -Wextra -Werror -municode -static \
  -D_WIN32_WINNT=0x0A00 resources/media-tools/win32-x64/media-guardian.c \
  -o "$destination/media-guardian.exe"
strip "$destination/ffmpeg.exe" "$destination/ffprobe.exe" "$destination/media-guardian.exe"
{
  echo "Windows x64 CPU media workers; GPL-2.0-or-later FFmpeg/x264/x265."
  echo "Built from the included immutable source archives using scripts/build-windows-media.sh."
  echo "H.264 8-bit and HEVC 8/10-bit; no GPU or separately installed codec is required."
  echo "FFmpeg networking, GPLv3 and nonfree components are not enabled."
  echo "No guarantee of real-time export or physical HDR appearance is implied."
  gcc --version
  "$cmake" --version
  pacman -Q
  for binary in ffmpeg ffprobe media-guardian; do
    echo "Dependencies: $binary.exe"
    objdump -p "$destination/$binary.exe" | grep 'DLL Name:'
  done
} > "$destination/BUILD-INFO.txt"
echo "Windows native tools built. Intermediate workspace retained at: $work"
