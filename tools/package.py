"""Combine the Electron and Pandoc archives with the prepared app."""
from pathlib import Path
import json
import os
import plistlib
import shutil
import subprocess
import sys
import tarfile
import zipfile

TARGETS = {
    "linux-x64": ("Fedora-Nobara-x64", "pandoc-3.14/bin/pandoc"),
    "win32-x64": ("Windows-x64", "pandoc-3.14/pandoc.exe"),
    "darwin-arm64": ("macOS-Apple-Silicon", "pandoc-3.14-arm64/bin/pandoc"),
    "darwin-x64": ("macOS-Intel", "pandoc-3.14-x86_64/bin/pandoc"),
}
PROJECT = Path(__file__).resolve().parents[1]
metadata = json.loads((PROJECT / "package.json").read_text(encoding="utf-8"))
product = metadata["productName"]
version = metadata["version"]
target = sys.argv[1]
build, runtime, output = map(lambda s: Path(s).resolve(), sys.argv[2:])
label, binary = TARGETS[target]
mac = target.startswith("darwin")
linux = target.startswith("linux")
stage = build / target
if stage.exists():
    shutil.rmtree(stage)
stage.mkdir(parents=True)
output.mkdir(parents=True, exist_ok=True)
# The command-line unzip preserves Electron's macOS framework symlinks.
outer = stage if mac else stage / product
outer.mkdir(exist_ok=True)
subprocess.run(["unzip", "-q", str(runtime / f"{target}.zip"), "-d", str(outer)], check=True)
if mac:
    bundle = stage / f"{product}.app"
    (stage / "Electron.app").rename(bundle)
    resources = bundle / "Contents/Resources"
    plist = bundle / "Contents/Info.plist"
    values = plistlib.loads(plist.read_bytes())
    values.update(CFBundleIdentifier="de.romanwerkstatt.desktop", CFBundleDisplayName=product,
                  CFBundleName=product, CFBundleShortVersionString=version, CFBundleVersion=version,
                  NSMicrophoneUsageDescription=f"{product} verwendet das Mikrofon, um dein Diktat lokal zu transkribieren.")
    # A renamed Electron app must not use the runtime's own ASAR integrity hash.
    values.pop("ElectronAsarIntegrity", None)
    plist.write_bytes(plistlib.dumps(values))
else:
    resources = outer / "resources"
    name = "electron" if linux else "electron.exe"
    (outer / name).rename(outer / (product if linux else f"{product}.exe"))
resources.mkdir(exist_ok=True)
(resources / "default_app.asar").unlink(missing_ok=True)
shutil.copy2(build / "app.asar", resources)
shutil.copytree(build / "app.asar.unpacked", resources / "app.asar.unpacked")
pandoc = resources / Path(binary).name
if linux:
    with tarfile.open(runtime / (target + "-pandoc.tar.gz")) as archive, pandoc.open("wb") as dest:
        with archive.extractfile(binary) as source:
            shutil.copyfileobj(source, dest)
else:
    with zipfile.ZipFile(runtime / (target + "-pandoc.zip")) as archive, archive.open(binary) as source, pandoc.open("wb") as dest:
        shutil.copyfileobj(source, dest)
pandoc.chmod(0o755)
shutil.copy2(runtime / "pandoc-COPYING.md", resources / "Pandoc-Lizenz.md")
(resources / "Pandoc-Quelle.txt").write_text("Pandoc 3.14\nhttps://github.com/jgm/pandoc/tree/3.14\n", encoding="utf-8")
shutil.copy2(PROJECT / "STARTEN.txt", outer)
stem = output / f"{product}-{version}-{label}"
if mac:
    if os.environ.get("RCODESIGN"):
        subprocess.run([os.environ["RCODESIGN"], "sign", str(bundle)], check=True)
    else:
        subprocess.run(["codesign", "--force", "--deep", "--sign", "-", str(bundle)], check=True)
    entries = [bundle.name, "STARTEN.txt", "LICENSE", "LICENSES.chromium.html"]
elif not linux:
    entries = [product]
if linux:
    with tarfile.open(str(stem) + ".tar.gz", "w:gz", compresslevel=5) as archive:
        archive.add(outer, arcname=product)
else:
    dest = Path(str(stem) + ".zip")
    dest.unlink(missing_ok=True)
    subprocess.run(["zip", "-q", "-5", "-r", "-y", str(dest), *[name for name in entries if (stage / name).exists()]], cwd=stage, check=True)
