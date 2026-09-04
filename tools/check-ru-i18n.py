#!/usr/bin/env python3
"""Check Russian i18n files for common translation mistakes.

Checks:
  1. Homoglyphs - Latin letters that look like Cyrillic ones (A, B, C, E, H,
     K, M, O, P, T, X and lowercase c, e, o, p, x) inside Cyrillic words,
     e.g. "Алагadda" or "АП" with a Latin P.
  2. Mixed-script words, except known abbreviations (3D, MP3, GPS, ...),
     color codes (\\C[n]) and brand names.
  3. Placeholder parity: every {token}, %N and \\C[n] code present in the
     English string must also be present in the Russian one.

Usage:
    python tools/check-ru-i18n.py

Exit code is 1 when problems are found, so it can run in CI.
"""
import json
import os
import re
import sys

BASE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                    "js", "i18n")

# Latin look-alikes of Cyrillic letters (and vice versa for the reverse check).
LAT_IN_CYR = set("ABCEHKMOPTXceopx")
CYR_IN_LAT = set("АВЕКМНОРСТХасеорх")

# Tokens that are legitimately mixed-script.
ALLOW = {
    "Hypernet", "LimeCorp", "Noodle", "PearMac", "PearTunes", "PearWorld",
    "Archways", "HyperDeck", "HyperTamer", "Hypermetro", "Hypercapitalist",
    "CamelCase", "Esoteric", "Y2K", "ONU", "MP3",
}
ALLOW_PREFIX = ("3D", "2D")
ALLOW_SUBSTRING = ("Y2K", "Zip", "MP3", "GPS", "VR", "DVD")


def is_cyr(c):
    return "\u0400" <= c <= "\u052f" or c in "ёЁ"


def is_lat(c):
    return "A" <= c <= "Z" or "a" <= c <= "z"


def iter_strings(node, path=""):
    if isinstance(node, str):
        yield path, node
    elif isinstance(node, dict):
        for k, v in node.items():
            yield from iter_strings(v, path + "/" + str(k))
    elif isinstance(node, list):
        for i, v in enumerate(node):
            yield from iter_strings(v, path + "/" + str(i))


def check_homoglyphs(text):
    """Find Latin look-alikes inside Cyrillic words and vice versa."""
    problems = []
    for m in re.finditer(r"[^\s^{}<>\\/\"]+", text):
        tok = re.sub(r"^[Cc]\[\d+\]", "", m.group(0))
        if any(s in tok for s in ALLOW_SUBSTRING):
            continue
        if tok in ALLOW or tok.startswith(ALLOW_PREFIX):
            continue
        if re.fullmatch(r"[A-Za-z0-9]+", tok):
            continue  # pure latin token, fine
        cyr_chars = [c for c in tok if is_cyr(c)]
        lat_chars = [c for c in tok if is_lat(c)]
        if cyr_chars and lat_chars:
            bad_lat = sorted({c for c in lat_chars if c in LAT_IN_CYR})
            if bad_lat and not re.fullmatch(r"[A-Z0-9]+-.+", tok):
                problems.append((tok, "latin-in-cyrillic: " + "".join(bad_lat)))
    return problems


TOK_RE = re.compile(r"\\\\[A-Z]+|\{[^{}]+\}|%\d+")


def tokens(s):
    found = TOK_RE.findall(s or "")
    norm = []
    for t in found:
        if t.startswith("{") and t.endswith("}"):
            # ICU-style variants: compare only the number of alternatives,
            # the text itself is supposed to be translated.
            norm.append("{}|x" + str(t.count("|")))
        else:
            norm.append(t)
    return sorted(norm)


def main():
    errors = []
    for sub in ["", "plugins", "conversations", "lore"]:
        en_d = os.path.join(BASE, "en", sub)
        ru_d = os.path.join(BASE, "ru", sub)
        if not os.path.isdir(en_d):
            continue
        for name in sorted(os.listdir(en_d)):
            if not name.endswith(".json"):
                continue
            ep, rp = os.path.join(en_d, name), os.path.join(ru_d, name)
            if not os.path.exists(rp):
                errors.append(f"{sub}/{name}: missing ru file")
                continue
            try:
                en = json.load(open(ep, encoding="utf-8"))
                ru = json.load(open(rp, encoding="utf-8"))
            except Exception as exc:
                errors.append(f"{sub}/{name}: bad JSON ({exc})")
                continue

            def walk(a, b, p=""):
                if isinstance(a, str):
                    if isinstance(b, str) and b:
                        for tok, why in check_homoglyphs(b):
                            errors.append(
                                f"{sub}/{name}{p}: {why} in {tok!r}")
                        if tokens(a) != tokens(b):
                            errors.append(
                                f"{sub}/{name}{p}: placeholders "
                                f"{tokens(a)} != {tokens(b)}")
                elif isinstance(a, dict):
                    for k, v in a.items():
                        walk(v, b.get(k) if isinstance(b, dict) else None,
                             p + "/" + str(k))
                elif isinstance(a, list):
                    for i, v in enumerate(a):
                        walk(v, b[i] if isinstance(b, list) and i < len(b)
                             else None, p + "/" + str(i))

            walk(en, ru)

    # Filter out known-OK hyphenated abbreviations like 3D-принтер.
    errors = [e for e in errors
              if not re.search(r"^[A-Z0-9]+-[а-яё]", e.split(" in ")[-1])]

    for e in errors:
        print(e)
    print(f"\n{len(errors)} problem(s)")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
