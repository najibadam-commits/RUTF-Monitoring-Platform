"""Checks an APK's native libraries for 16 KB page-size compatibility (the Android Studio
"APK is not compatible with 16 KB devices" warning).

A .so is compatible when every PT_LOAD segment in its ELF program headers is aligned to at least
16384 bytes. This reads that straight from the binaries. It does not check zip alignment of the
stored .so files, which the Android Gradle Plugin 8.5.1+ already handles.

Usage: python tools/check-16kb-alignment.py [path/to/app-debug.apk]
Default: app/build/intermediates/apk/debug/app-debug.apk (what Android Studio's Run button builds).
Exit code 1 if any library is not aligned.
"""
import struct
import sys
import zipfile

apk = sys.argv[1] if len(sys.argv) > 1 else "app/build/intermediates/apk/debug/app-debug.apk"


def load_alignments(data):
    is64 = data[4] == 2
    if is64:
        phoff = struct.unpack_from("<Q", data, 0x20)[0]
        entsize, num = struct.unpack_from("<HH", data, 0x36)
    else:
        phoff = struct.unpack_from("<I", data, 0x1C)[0]
        entsize, num = struct.unpack_from("<HH", data, 0x2A)
    out = []
    for i in range(num):
        off = phoff + i * entsize
        if struct.unpack_from("<I", data, off)[0] != 1:  # PT_LOAD
            continue
        out.append(struct.unpack_from("<Q", data, off + 0x30)[0] if is64 else struct.unpack_from("<I", data, off + 0x1C)[0])
    return out


bad = []
with zipfile.ZipFile(apk) as z:
    libs = [n for n in z.namelist() if n.endswith(".so")]
    for name in sorted(libs):
        aligns = load_alignments(z.read(name))
        ok = bool(aligns) and min(aligns) >= 16384
        print(f"{'OK ' if ok else 'BAD'}  {name}  (min LOAD alignment {min(aligns) if aligns else '?'})")
        if not ok:
            bad.append(name)
print(f"\n{len(libs)} native librar{'y' if len(libs) == 1 else 'ies'}, {len(bad)} not 16 KB aligned.")
sys.exit(1 if bad else 0)
