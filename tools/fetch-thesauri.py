"""Build the local lookup index from LibreOffice's MyThes dictionaries."""
from pathlib import Path
import sqlite3
from urllib.request import urlopen
import os

DATA = Path(__file__).resolve().parents[1] / "data"
BASE = "https://raw.githubusercontent.com/LibreOffice/dictionaries/master/"
SOURCES = {
    "de": ("de/th_de_DE_v2.dat", ["de/README_thesaurus.txt", "de/COPYING_LGPL_v2.1.txt"]),
    "en": ("en/th_en_US_v2.dat", ["en/WordNet_license.txt"]),
    "es": ("es/th_es_v2.dat", ["es/README_th_es.txt", "es/LGPLv2.1.txt", "es/MPL-1.1.txt", "es/LGPLv3.txt", "es/GPLv3.txt", "es/LICENSE.md"]),
    "fr": ("fr_FR/dictionaries/thes_fr.dat", ["fr_FR/dictionaries/README_thes_fr.txt"]),
    "pt": ("pt_PT/th_pt_PT.dat", ["pt_PT/README_th_pt_PT.txt", "pt_PT/LICENSES.txt"]),
}

def fetch(name):
    with urlopen(BASE + name, timeout=60) as response:
        return response.read()

def entries(raw, lang):
    lines = iter(raw.split(b"\n"))
    charset = next(lines).decode("ascii").strip()
    for line in lines:
        word, sep, count = line.rstrip(b"\r").rpartition(b"|")
        if not sep or not count.isdigit():
            continue
        values = []
        for _ in range(int(count)):
            sense = next(lines, b"").decode(charset, errors="replace").strip()
            values.append(sense)
        yield lang, word.decode(charset, errors="replace").lower(), "\n".join(values)

DATA.mkdir(exist_ok=True)
temp = DATA / "thesauri.tmp"
temp.unlink(missing_ok=True)
db = sqlite3.connect(temp)
db.execute("create table thesaurus (lang text, word text, senses text, primary key (lang, word)) without rowid")
for lang, (source, notices) in SOURCES.items():
    print(lang, flush=True)
    db.executemany("insert or ignore into thesaurus values (?, ?, ?)", entries(fetch(source), lang))
    notice_dir = DATA / "licenses" / lang
    notice_dir.mkdir(parents=True, exist_ok=True)
    for notice in notices:
        try:
            (notice_dir / Path(notice).name).write_bytes(fetch(notice))
        except Exception as exc:
            print(notice, exc)
    (notice_dir / "QUELLE.txt").write_text(BASE + source + "\n", encoding="utf-8")
db.commit()
db.execute("vacuum")
db.close()
os.replace(temp, DATA / "thesauri.sqlite")
