#!/usr/bin/env python3
"""Verify the unadapted Game Boy donor records for the Port Ritz clam line.

By default this checks the published evidence file without copyrighted ROMs.
Pass --source-root to also compare the evidence with the original extraction
packages, complete ROM hashes, raw byte spans, and text-directory pointers.
Use --write with --source-root to reproduce the evidence file.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path


SITE_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ARTIFACT = SITE_ROOT / "updates" / "clam-source-donors.json"
ENGLISH_TEXT = "*: I saw a child\ncross the sea on a\ngiant clam. No, no\nlie! I saw it!"
JAPANESE_TEXT = (
    "＊「こどもが おおきな かいにのって\n  うみを わたってただよぉ～。\n"
    "＊「オラは ウソなんか ついてねえ…\n  このめで はっきり みただ！"
)
SOURCE_SPECS = (
    ("dwm2_cobi", "DWM2_Cobi", "DWM2_Cobi_1F2365", "english"),
    ("dwm2_tara", "DWM2_Tara", "DWM2_Tara_1F2365", "english"),
    ("dqm2_ruka", "DQM2_Ruka_Japanese", "jp_ruka_1F18AC", "japanese"),
    ("dqm2_iru", "DQM2_Iru_Japanese", "jp_iru_1F18AC", "japanese"),
)


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def read_record(path: Path, record_id: str) -> dict:
    matches = [record for line in path.read_text(encoding="utf-8").splitlines()
               if (record := json.loads(line))["id"] == record_id]
    require(len(matches) == 1, f"Expected exactly one record {record_id} in {path}")
    return matches[0]


def additional_package(source_root: Path) -> Path:
    choices = (
        source_root / "DQM_Delocalized_and_Japanese_Text_Extracts" / "DQM_Additional_Text_Extracts",
        source_root / "DQM_Additional_Text_Extracts",
    )
    found = next((path for path in choices if (path / "manifest.json").is_file()), None)
    require(found is not None, "Could not locate the additional Japanese/Delocalized extraction manifest")
    return found


def source_evidence(source_root: Path) -> dict:
    additional = additional_package(source_root)
    manifest = json.loads((additional / "manifest.json").read_text(encoding="utf-8"))
    evidence = {"english_sources": [], "japanese_sources": []}
    for game, folder, record_id, language in SOURCE_SPECS:
        if language == "english":
            package = source_root / "DWM_GBC_English_Text_Extracts"
            metadata = json.loads((package / folder / "manifest.json").read_text(encoding="utf-8"))
            rom_hash = metadata["input_sha256"]
            # The original uploaded filename included (1); the read-only local
            # copy may omit that duplicate-download suffix.
            original_filename = metadata["input_filename"]
            rom_names = [original_filename, original_filename.replace("(1).gbc", ".gbc")]
        else:
            package = additional
            metadata = manifest["games"][record_id.rsplit("_", 1)[0]]
            rom_hash = metadata["sha256"]
            rom_names = [metadata["source_rom_filename"]]
        source_file = package / folder / "strings.jsonl"
        record = read_record(source_file, record_id)
        start = record.get("start", record.get("offset"))
        end = record.get("end", record.get("end_offset_exclusive"))
        raw = bytes.fromhex(record.get("bytes_hex", record.get("raw_hex")))
        rom_path = next((source_root / name for name in rom_names if (source_root / name).is_file()), None)
        require(rom_path is not None, f"Cannot find source ROM for {game}")
        rom = rom_path.read_bytes()
        require(sha256(rom) == rom_hash, f"Full ROM hash mismatch for {game}")
        require(rom[start:end] == raw, f"Source bytes do not match ROM for {record_id}")
        references = record.get("refs", record.get("references"))
        for reference in references:
            pointer_offset = reference["pointer_offset"]
            pointer = int.from_bytes(rom[pointer_offset:pointer_offset + 2], "little")
            expected_pointer = start % 0x4000 + 0x4000
            require(pointer == expected_pointer, f"Text pointer mismatch for {record_id}")
        evidence[f"{language}_sources"].append({
            "game": game,
            "title": metadata["title"],
            "source_package": "DWM_GBC_English_Text_Extracts" if language == "english" else "DQM_Additional_Text_Extracts",
            "file": f"{folder}/strings.jsonl",
            "record_id": record_id,
            "offset_hex": f"0x{start:06X}",
            "end_offset_hex": f"0x{end:06X}",
            "rom_sha256": rom_hash,
            "source_file_sha256": sha256(source_file.read_bytes()),
            "source_sha256": sha256(raw),
            "text": record["text"],
            "annotated_text": record.get("raw_text", record.get("annotated_text")),
            "bytes_hex": raw.hex(" ").upper(),
            "references": references,
            "method": "verified-extracted-original-source",
        })
    return evidence


def make_artifact(evidence: dict) -> dict:
    return {
        "schema_version": 1,
        "key": "dialogue_full_2000_3999.json:s004ae000_136e",
        "catalog": "dialogue/main/2000_3999.json",
        "id": "s004ae000_136e",
        "source_status": "verified_original_gameboy_text",
        **evidence,
        "display": {"gameboy": ENGLISH_TEXT, "delocalized": ENGLISH_TEXT},
        "edition_notes": {
            "gameboy": "Unadapted original English donor text from the official Cobi and Tara releases, including its speaker marker and line breaks.",
            "delocalized": "Official DWM2 English donor reused for the project's sequel extension. The supplied Delocalized 1.09 patch is for DWM1; no separate DWM2 Delocalized source is supplied. This text is not attributed to a DWM2 ROM hack.",
        },
        "validation": {
            "record_spans_compared_with_original_roms": 4,
            "full_rom_sha256_verified": 4,
            "directory_pointers_verified": 4,
            "english_editions_have_identical_source_bytes": True,
            "japanese_editions_have_identical_source_bytes": True,
        },
    }


def validate_artifact(artifact: dict) -> None:
    require(artifact["schema_version"] == 1, "Unsupported evidence schema")
    require(artifact["key"] == "dialogue_full_2000_3999.json:s004ae000_136e", "Wrong row key")
    for language, expected_text, expected_start, expected_end in (
        ("english", ENGLISH_TEXT, 0x1F2365, 0x1F23B0),
        ("japanese", JAPANESE_TEXT, 0x1F18AC, 0x1F18FF),
    ):
        sources = artifact[f"{language}_sources"]
        require(len(sources) == 2, f"Expected both {language} editions")
        require(len({s["game"] for s in sources}) == 2, f"Repeated {language} edition")
        require(len({s["rom_sha256"] for s in sources}) == 2, f"Repeated {language} ROM")
        for source in sources:
            label = source["record_id"]
            raw = bytes.fromhex(source["bytes_hex"])
            require(source["text"] == expected_text, f"Donor wording changed for {label}")
            require(int(source["offset_hex"], 16) == expected_start, f"Wrong start for {label}")
            require(int(source["end_offset_hex"], 16) == expected_end, f"Wrong end for {label}")
            require(len(raw) == expected_end - expected_start, f"Wrong byte span for {label}")
            require(sha256(raw) == source["source_sha256"], f"Byte hash mismatch for {label}")
            require(raw[-2:] == b"\xF7\xF0", f"Missing wait/end controls for {label}")
            require(len(source["references"]) == 1, f"Unexpected pointer count for {label}")
            for field in ("rom_sha256", "source_file_sha256", "source_sha256"):
                require(len(source[field]) == 64 and all(c in "0123456789abcdef" for c in source[field]), f"Invalid {field} for {label}")
        require(sources[0]["bytes_hex"] == sources[1]["bytes_hex"], f"{language} edition bytes differ")
    require(artifact["display"] == {"gameboy": ENGLISH_TEXT, "delocalized": ENGLISH_TEXT}, "Display must use the exact donor record")
    require("no separate DWM2 Delocalized source is supplied" in artifact["edition_notes"]["delocalized"], "Missing sequel source qualification")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--artifact", type=Path, default=DEFAULT_ARTIFACT)
    parser.add_argument("--source-root", type=Path, help="Directory containing the original ROMs and extracted-text packages")
    parser.add_argument("--write", action="store_true", help="Reproduce the evidence artifact after verifying original sources")
    args = parser.parse_args()
    require(not args.write or args.source_root is not None, "--write requires --source-root")
    if args.source_root is not None:
        reproduced = make_artifact(source_evidence(args.source_root))
        validate_artifact(reproduced)
        if args.write:
            args.artifact.parent.mkdir(parents=True, exist_ok=True)
            args.artifact.write_text(json.dumps(reproduced, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        else:
            existing = json.loads(args.artifact.read_text(encoding="utf-8"))
            require(existing == reproduced, "Published evidence differs from original sources")
    artifact = json.loads(args.artifact.read_text(encoding="utf-8"))
    validate_artifact(artifact)
    print("PASS: exact original clam dialogue; Cobi, Tara, Ruka, and Iru evidence is consistent.")
    if args.source_root is not None:
        print("PASS: four original ROM hashes, raw source spans, extraction files, and directory pointers verified.")


if __name__ == "__main__":
    main()
