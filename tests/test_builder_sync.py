"""Regression tests for the private-JSON to public comparison boundary.

Run with: python -m unittest discover -s tests -p test_builder_sync.py -v
The fixture is a synthetic private checkout; no private source or ROM is needed.
"""
from __future__ import annotations

import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import sys
import tempfile
import unittest
from unittest import mock


TOOLS = Path(__file__).resolve().parents[1] / "tools"
sys.path.insert(0, str(TOOLS))
spec = importlib.util.spec_from_file_location("sync_builder_translations", TOOLS / "sync_builder_translations.py")
sync = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sync)

REVISION = "a" * 40
STAMP = "2026-10-24T12:34:56+00:00"
DONOR_KEY = "dialogue_full_2000_3999.json:s004ae000_136e"
EXACT_DONOR = "*: I saw a child\ncross the sea on a\ngiant clam. No, no\nlie! I saw it!"
ACTIVE_TEXT = '<VOICE_42>*: I saw a child\ncross the sea on a<PROMPT><WAIT>giant clam. No, no\nlie! I saw it!'
PRIVATE_MARKER = "PRIVATE-NATIVE-CODE-DO-NOT-PUBLISH"


def dump(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False), encoding="utf8")


def entry(identity, current="Fresh current", gameboy="Fresh Game Boy", delocalized="Fresh Delocalized"):
    return {
        "id": identity,
        "japanese": "日本語<WAIT><END>",
        "private_metadata": PRIVATE_MARKER,
        "translations": {
            edition: {"english": text + "<WAIT><END>", "native_metadata": PRIVATE_MARKER}
            for edition, text in zip(sync.EDITION_KEYS, (current, gameboy, delocalized))
        },
    }


def baseline_row(catalog, identity, *, table=None, row_id=None):
    table = table or sync.CATALOGS.get(catalog, catalog)
    row_id = row_id or identity
    return {
        "catalog": catalog, "source_id": identity, "id": row_id,
        "table": table, "key": table + ":" + row_id,
        "labels": ["Reviewed scene"], "note": "Keep reviewed annotation",
        "japanese_psx": "古い日本語", "japanese_status": "recorded",
        "current": "STALE CURRENT", "gameboy": "STALE GB", "delocalized": "STALE DELOC",
        "current_menu": None, "gameboy_menu": None, "delocalized_menu": None,
        "japanese_gbc_dqm1": "Verified historical source",
        "japanese_gbc_dqm2": "Not verified",
        "gbc_details": {"variants": [], "note": "Keep evidence", "supporting_sources": [], "game_status": {}},
        "raw": {"translations": {}}, "different": True,
    }


def source_evidence():
    return {
        "schema_version": 1,
        "private_metadata": PRIVATE_MARKER,
        "english_sources": [{
            "game": "dwm2_" + edition, "title": edition.title(),
            "record_id": "DWM2_" + edition.title() + "_1F2365",
            "text": EXACT_DONOR, "private_metadata": PRIVATE_MARKER,
            "references": [{"pointer_offset": 2031802, "private_metadata": PRIVATE_MARKER}],
        } for edition in ("cobi", "tara")],
        "japanese_sources": [{
            "game": "dqm2_" + edition, "record_id": "jp_" + edition + "_1F18AC",
            "text": "こどもが おおきな かいにのって", "method": "verified-extracted-original-source",
        } for edition in ("ruka", "iru")],
        "japanese_applicability": {"dqm1": False, "dqm2": True},
        "edition_notes": {
            "gameboy": "Original English source; active wording uses PSX presentation controls.",
            "delocalized": "Official DWM2 English reused; no separate DWM2 Delocalized source is supplied.",
            "private_metadata": PRIVATE_MARKER,
        },
        "validation": {"private_metadata": PRIVATE_MARKER},
    }


class BuilderSyncTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.builder = self.root / "private-builder"
        self.site = self.root / "public-site"
        self.site.mkdir()
        self.catalog_root = self.builder / "src/translations"
        self.entries = {}
        for index, catalog in enumerate(sync.CATALOGS):
            identity = f"entry_{index}"
            item = entry(identity, f"Fresh current {index}", f"Fresh Game Boy {index}", f"Fresh Delocalized {index}")
            if catalog == "dialogue/main/2000_3999.json":
                item = entry("s004ae000_136e", "I saw a child riding a giant clam across the sea!", ACTIVE_TEXT, ACTIVE_TEXT)
                item["japanese"] = "子供が 大きな貝に乗って 海をわたってただよお~。<WAIT><END>"
                item["source_evidence"] = source_evidence()
            self.entries[catalog] = [item]
        # The eighteenth catalog exercises structured patch wording and leaves.
        self.entries["patches/test_labels.json"] = [{
            "id": "labels", "native_metadata": PRIVATE_MARKER,
            "translations": {edition: [f"{edition} patch 0", f"{edition} patch 1"] for edition in sync.EDITION_KEYS},
        }]
        for catalog in self.entries:
            self.write_catalog(catalog)
        self.keep = baseline_row("dialogue/main/0000_1999.json", "entry_0", table="legacy_dialogue_table.json", row_id="stable-row-id")
        self.deleted = baseline_row("dialogue/main/0000_1999.json", "deleted_entry")
        self.clam = baseline_row("dialogue/main/2000_3999.json", "s004ae000_136e")
        self.baseline = {
            "schema_version": 1, "rows": [self.keep, self.deleted, self.clam],
            "source_updates": [{"kind": "old-supplement", "text": "STALE SUPPLEMENT"}],
            "coverage": {}, "revision": "b" * 40,
        }
        dump(self.site / "comparison-data.json", self.baseline)
        (self.site / "index.html").write_text(
            '<html><script>window.DQM_COMPARISON_CONTEXT=' + json.dumps(self.baseline) +
            ';</script><time id="builder-updated-at">STALE DATE</time></html>', encoding="utf8")
        (self.site / "browser-drafts.json").write_text("USER LOCAL DRAFTS", encoding="utf8")
        self.git_mock = mock.patch.object(sync, "git", side_effect=self.fake_git)
        self.git_mock.start()
        self.addCleanup(self.git_mock.stop)

    def fake_git(self, root, *args):
        self.assertEqual(root, self.builder.resolve())
        if args == ("rev-parse", "HEAD"):
            return REVISION
        if args == ("status", "--porcelain", "--untracked-files=no", "--", "src/translations"):
            return ""
        self.fail(f"Unexpected Git request: {args}")

    def write_catalog(self, catalog):
        dump(self.catalog_root / catalog, {"schema_version": 2, "private_metadata": PRIVATE_MARKER, "entries": self.entries[catalog]})

    def run_export(self, **kwargs):
        return sync.export(self.builder, self.site, updated_at=STAMP, **kwargs)

    def context(self):
        return json.loads((self.site / "comparison-data.json").read_text(encoding="utf8"))

    def snapshot(self):
        return {path.name: path.read_bytes() for path in self.site.iterdir() if path.is_file()}

    def test_complete_18_catalog_refresh_preserves_keys_evidence_and_removes_stale_rows(self):
        result = self.run_export()
        context = self.context()
        self.assertEqual(result["rows"], 19)
        self.assertEqual(len(context["coverage"]["catalogs"]), 18)
        by_key = {row["key"]: row for row in context["rows"]}
        self.assertNotIn(self.deleted["key"], by_key)
        kept = by_key[self.keep["key"]]
        self.assertEqual(kept["current"], "Fresh current 0")
        self.assertEqual(kept["gameboy"], "Fresh Game Boy 0")
        self.assertEqual(kept["labels"], self.keep["labels"])
        self.assertEqual(kept["gbc_details"], self.keep["gbc_details"])
        self.assertEqual(kept["note"], self.keep["note"])
        self.assertEqual(kept["source_revision"], REVISION)
        self.assertIn('patches/test_labels.json:["labels",[0]]', by_key)
        self.assertIn('patches/test_labels.json:["labels",[1]]', by_key)
        self.assertTrue(all(row["source_revision"] == REVISION for row in context["rows"]))
        self.assertEqual(context["source_updates"][0]["kind"], "builder-json-export")
        self.assertNotIn("old-supplement", json.dumps(context))
        self.assertEqual((self.site / "browser-drafts.json").read_text(), "USER LOCAL DRAFTS")

    def test_active_builder_values_and_separate_original_source_evidence(self):
        self.run_export()
        row = next(row for row in self.context()["rows"] if row["key"] == DONOR_KEY)
        self.assertEqual(row["gameboy"], EXACT_DONOR)
        self.assertEqual(row["delocalized"], EXACT_DONOR)
        self.assertEqual(row["raw"]["translations"]["gameboy"]["english"], ACTIVE_TEXT + "<WAIT><END>")
        self.assertTrue(all(source["text"] == EXACT_DONOR for source in row["english_sources"]))
        self.assertEqual({source["record_id"] for source in row["english_sources"]}, {"DWM2_Cobi_1F2365", "DWM2_Tara_1F2365"})
        self.assertEqual(set(row["gbc_details"]["variants"][0]["games"]), {"dqm2_ruka", "dqm2_iru"})
        self.assertEqual(row['japanese_gbc_dqm1'], 'Not applicable')
        self.assertIn("no separate DWM2 Delocalized source is supplied", row["edition_notes"]["delocalized"])

    def test_same_id_builder_editions_are_authoritative_and_export_has_no_public_donor_dependency(self):
        self.run_export()
        item = self.entries["dialogue/main/2000_3999.json"][0]
        item["translations"]["gameboy"]["english"] = 'Revised GB<LINE>with controls<WAIT><END>'
        item["translations"]["delocalized"]["english"] = 'Revised extension<PROMPT>with controls<WAIT><END>'
        # There are no row-specific Japanese or Current prerequisites either.
        item["japanese"] = '別の言葉'
        item["translations"]["current"]["english"] = 'Independent Current wording'
        self.write_catalog("dialogue/main/2000_3999.json")
        original_load = sync.load
        def builder_or_baseline_only(path):
            self.assertTrue(Path(path).is_relative_to(self.root), f'Unexpected public fixture dependency: {path}')
            return original_load(path)
        with mock.patch.object(sync, "load", side_effect=builder_or_baseline_only):
            self.run_export()
        row = next(row for row in self.context()["rows"] if row["key"] == DONOR_KEY)
        self.assertEqual(row["gameboy"], 'Revised GB\nwith controls')
        self.assertEqual(row["delocalized"], 'Revised extension\nwith controls')
        self.assertEqual(row["current"], 'Independent Current wording')
        self.assertTrue(all(source["text"] == EXACT_DONOR for source in row["english_sources"]))
        self.assertNotIn('original_donor_override', json.dumps(self.context()))

    def test_removing_builder_evidence_clears_previously_owned_details(self):
        self.run_export()
        del self.entries["dialogue/main/2000_3999.json"][0]["source_evidence"]
        self.write_catalog("dialogue/main/2000_3999.json")
        self.run_export()
        row = next(row for row in self.context()["rows"] if row["key"] == DONOR_KEY)
        self.assertNotIn('english_sources', row)
        self.assertNotIn('edition_notes', row)
        self.assertEqual(row['gbc_details']['variants'], [])
        self.assertEqual(row['japanese_gbc_dqm2'], 'Not verified')
        self.assertEqual(row['gameboy'], EXACT_DONOR)

    def test_malformed_evidence_is_rejected_before_writing(self):
        source = self.entries["dialogue/main/2000_3999.json"][0]["source_evidence"]["english_sources"][0]
        for extra in ({'file': 'C:/private/folder.json'}, {'bytes_hex': '00', 'source_sha256': 'a' * 64},
                      {'text': {'private_metadata': PRIVATE_MARKER}}, {'references': [{'pointer_offset': True}]}):
            with self.subTest(extra=extra):
                original = copy.deepcopy(source)
                source.update(extra)
                self.write_catalog("dialogue/main/2000_3999.json")
                before = self.snapshot()
                with self.assertRaises(ValueError):
                    self.run_export()
                self.assertEqual(self.snapshot(), before)
                source.clear()
                source.update(original)

    def test_legacy_patch_leaf_keeps_its_original_key_and_reviewed_evidence(self):
        legacy = baseline_row("patches/test_labels.json", "labels", row_id='["labels",[0]]')
        legacy["path"] = [0]
        self.baseline["rows"].append(legacy)
        dump(self.site / "comparison-data.json", self.baseline)
        self.run_export()
        row = next(row for row in self.context()["rows"] if row["key"] == legacy["key"])
        self.assertEqual(row["current"], "current patch 0")
        self.assertEqual(row["note"], legacy["note"])
        self.assertEqual(row["labels"], legacy["labels"])
        self.assertEqual(row["gbc_details"], legacy["gbc_details"])

    def test_all_companions_agree_and_check_mode_is_read_only_and_idempotent(self):
        self.run_export()
        context = self.context()
        document = (self.site / "index.html").read_text(encoding="utf8")
        match = re.search(r"window\.DQM_COMPARISON_CONTEXT\s*=\s*", document)
        embedded, _ = json.JSONDecoder().raw_decode(document, match.end())
        self.assertEqual(embedded, context)
        self.assertIn('<time id="builder-updated-at">24 October 2026</time>', document)
        coverage = json.loads((self.site / "coverage-report.json").read_text(encoding="utf8"))
        self.assertEqual(coverage["included_rows"], len(context["rows"]))
        self.assertEqual(coverage["source_sha256"], context["coverage"]["source_sha256"])
        manifest = json.loads((self.site / "source-manifest.json").read_text(encoding="utf8"))
        self.assertEqual(manifest["translation_revision"], REVISION)
        self.assertEqual(manifest["row_count"], len(context["rows"]))
        for name, expected_hash in manifest["published_sha256"].items():
            self.assertEqual(hashlib.sha256((self.site / name).read_bytes()).hexdigest(), expected_hash)
        markdown = (self.site / "DQM-translation-comparison.md").read_text(encoding="utf8")
        self.assertIn(REVISION, markdown)
        self.assertIn("*: I saw a child<br>cross the sea on a<br>giant clam.", markdown)
        self.assertEqual(manifest['builder_source_evidence'], [{
            'key': DONOR_KEY, 'catalog': 'src/translations/dialogue/main/2000_3999.json',
            'entry_id': 's004ae000_136e'}])
        self.assertNotIn('source_donor_evidence', manifest)
        before = self.snapshot()
        # Omitted --updated-at must reuse the stored sync timestamp.
        sync.export(self.builder, self.site, check=True)
        self.assertEqual(self.snapshot(), before)
        sync.export(self.builder, self.site)
        self.assertEqual(self.snapshot(), before)

    def test_missing_catalog_refuses_before_writing_any_output(self):
        (self.catalog_root / "menus/mobile.json").unlink()
        before = self.snapshot()
        with self.assertRaisesRegex(ValueError, "Missing builder catalog"):
            self.run_export()
        self.assertEqual(self.snapshot(), before)

    def test_dirty_translation_source_refuses_before_writing(self):
        before = self.snapshot()
        with mock.patch.object(sync, "git", side_effect=[REVISION, " M src/translations/text/system.json"]):
            with self.assertRaisesRegex(ValueError, "Commit builder translation changes"):
                self.run_export()
        self.assertEqual(self.snapshot(), before)

    def test_private_extra_fields_never_cross_public_wording_boundary(self):
        self.run_export()
        for name in sync.OUTPUTS:
            self.assertNotIn(PRIVATE_MARKER, (self.site / name).read_text(encoding="utf8"), name)
        row = next(row for row in self.context()["rows"] if row["key"] == self.keep["key"])
        self.assertEqual(set(row["raw"]), {"id", "japanese", "translations"})
        self.assertEqual(set(row["raw"]["translations"]["current"]), {"english"})

    def test_symlink_output_is_rejected_without_touching_target(self):
        outside = self.root / "outside-public-site.txt"
        outside.write_text("OUTSIDE MUST STAY UNCHANGED", encoding="utf8")
        target = self.site / "coverage-report.json"
        try:
            target.symlink_to(outside)
        except OSError:
            # Windows may restrict symlink creation even for a test fixture.
            # Exercise the same guard by mocking only this path's is_symlink.
            real_is_symlink = Path.is_symlink
            def is_symlink(path):
                return path == target or real_is_symlink(path)
            with mock.patch.object(Path, "is_symlink", is_symlink):
                with self.assertRaisesRegex(ValueError, "Output must be a regular file"):
                    self.run_export()
        else:
            with self.assertRaisesRegex(ValueError, "Output must be a regular file"):
                self.run_export()
        self.assertEqual(outside.read_text(encoding="utf8"), "OUTSIDE MUST STAY UNCHANGED")

    def test_stale_check_fails_without_rewriting_public_files(self):
        self.run_export()
        path = self.site / "DQM-translation-comparison.md"
        path.write_text("CORRUPTED OLD DOWNLOAD", encoding="utf8")
        before = self.snapshot()
        with self.assertRaisesRegex(ValueError, "Export is stale: DQM-translation-comparison.md"):
            sync.export(self.builder, self.site, check=True)
        self.assertEqual(self.snapshot(), before)

    def test_missing_edition_and_duplicate_ids_are_rejected(self):
        catalog = "text/system.json"
        del self.entries[catalog][0]["translations"]["gameboy"]
        self.write_catalog(catalog)
        with self.assertRaisesRegex(ValueError, "Missing maintained edition"):
            self.run_export()
        self.entries[catalog][0]["translations"]["gameboy"] = {"english": "Restored"}
        self.entries[catalog].append(copy.deepcopy(self.entries[catalog][0]))
        self.write_catalog(catalog)
        with self.assertRaisesRegex(ValueError, "Duplicate builder ID"):
            self.run_export()


if __name__ == "__main__":
    unittest.main()
