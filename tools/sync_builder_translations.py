"""Export translation wording from a private builder checkout to a public page.

Reads JSON only; never imports builder code or copies its checkout. Only the five
public comparison artifacts are written. Existing row keys and source evidence
are retained for matching records. Deleted builder records leave the comparison;
local browser drafts are independent of this export.
"""
from __future__ import annotations

import argparse
import copy
from collections import Counter
from datetime import datetime, timezone
import hashlib
import html
import json
from pathlib import Path
import re
import subprocess

EDITION_KEYS = ('current', 'gameboy', 'delocalized')
CATALOGS = {
    'dialogue/main/0000_1999.json': 'dialogue_full_0000_1999.json',
    'dialogue/main/2000_3999.json': 'dialogue_full_2000_3999.json',
    'dialogue/main/4000_6131.json': 'dialogue_full_4000_6131.json',
    'dialogue/extra.json': 'dialogue_extra.json',
    'dialogue/church.json': 'church_dialogue.json',
    'dialogue/medal_appraisal.json': 'medal_appraisal_dialogue.json',
    'dialogue/recruitment.json': 'recruitment_text.json',
    'dialogue/services.json': 'service_dialogue.json',
    'text/system.json': 'system_text.json',
    'text/executable.json': 'exe_pool_text.json',
    'text/static.json': 'static_extra.json',
    'text/static_pools.json': 'static_extra_pools.json',
    'text/location_titles.json': 'location_titles.json',
    'text/monster_captions.json': 'library_monster_captions.json',
    'menus/general.json': 'menu_text.json',
    'menus/keyboard.json': 'menu_text_keyboard.json',
    'menus/mobile.json': 'menu_text_mobile.json',
}
OUTPUTS = ('index.html', 'comparison-data.json', 'coverage-report.json',
           'DQM-translation-comparison.md', 'source-manifest.json')


def digest(data):
    return hashlib.sha256(data).hexdigest()


def load(path):
    return json.loads(Path(path).read_text(encoding='utf-8-sig'))


def encoded(value, *, compact=False):
    return json.dumps(value, ensure_ascii=False, allow_nan=False,
                      separators=(',', ':') if compact else None,
                      indent=None if compact else 2)


def git(root, *args):
    return subprocess.check_output(['git', '-c', f'safe.directory={root.as_posix()}',
                                    '-C', str(root), *args], encoding='utf8').strip()


def clean(text):
    if not isinstance(text, str):
        return ''
    text = re.sub(r'<(?:PROMPT|LINE)>', '\n', text)
    text = re.sub(r'<(?:PLAYER|VARIABLE:[^>]+)>', lambda m: '{' + m[0][1:-1] + '}', text)
    text = re.sub(r'<[^>]+>', '', text)
    text = re.sub(r'^(?:\*|＊)「', '', text)
    return re.sub(r'\n{3,}', '\n\n', text).strip()


def wording(value):
    if isinstance(value, str):
        return clean(value), None
    if isinstance(value, list):
        return '\n'.join(clean(v) for v in value if isinstance(v, str)), None
    if not isinstance(value, dict):
        return '', None
    full = value.get('english_full') or value.get('english_lines') or value.get('english') or value.get('english_short', '')
    text = wording(full)[0]
    short = value.get('english_short')
    if short is None and value.get('english_full'):
        short = value.get('english') or value.get('english_lines')
    menu = wording(short)[0] if short is not None else None
    return text, menu if menu and menu != text else None


def leaf_paths(value, prefix=()):
    if isinstance(value, str):
        yield prefix
    elif isinstance(value, list):
        for i, item in enumerate(value):
            yield from leaf_paths(item, prefix + (str(i),))
    elif isinstance(value, dict):
        for key, item in value.items():
            yield from leaf_paths(item, prefix + (key,))


def at(value, path):
    for part in path:
        value = value[int(part)] if isinstance(value, list) else value[part]
    return value


def source_rows(builder, baseline):
    old = {(r['catalog'], r['id']): r for r in baseline}
    source_counts = Counter((r['catalog'], r.get('source_id', r['id'])) for r in baseline)
    for row in baseline:
        source_key = (row['catalog'], row.get('source_id', row['id']))
        if source_counts[source_key] == 1:
            old.setdefault(source_key, row)
    root = builder / 'src/translations'
    for required in CATALOGS:
        if not (root / required).is_file():
            raise ValueError(f'Missing builder catalog: {required}')
    paths = sorted(path for folder in ('dialogue', 'menus', 'text', 'patches')
                   for path in (root / folder).rglob('*.json'))
    rows, hashes, counts, exclusions = [], {}, Counter(), []
    for path in paths:
        if path.is_symlink() or not path.resolve().is_relative_to(root.resolve()):
            raise ValueError('Translation source leaves the permitted JSON directory')
        catalog = path.relative_to(root).as_posix()
        document = load(path)
        if document.get('schema_version') != 2 or not isinstance(document.get('entries'), list):
            raise ValueError(f'Unsupported builder translation schema: {catalog}')
        hashes['src/translations/' + catalog] = digest(path.read_bytes())
        seen_ids = set()
        for entry in document['entries']:
            identity = entry['id']
            if identity in seen_ids:
                raise ValueError(f'Duplicate builder ID in {catalog}: {identity}')
            seen_ids.add(identity)
            variants = entry['translations']
            if any(key not in variants for key in EDITION_KEYS):
                raise ValueError(f'Missing maintained edition: {catalog}:{identity}')
            counts['source_records'] += 1
            paths_to_export = list(leaf_paths(variants['current'])) if catalog.startswith('patches/') else [()]
            for subpath in paths_to_export:
                counts['leaf_records'] += 1
                sid = identity + ('.' + '.'.join(subpath) if subpath else '')
                values = {edition: at(variants[edition], subpath) for edition in EDITION_KEYS}
                display = {edition: wording(value) for edition, value in values.items()}
                if not any(text for text, _ in display.values()):
                    exclusions.append({'catalog': catalog, 'id': sid, 'reason': 'No maintained English wording'})
                    continue
                path_identity = json.dumps([identity, [int(p) if p.isdigit() else p for p in subpath]],
                                           ensure_ascii=False, separators=(',', ':'))
                candidates = (sid, sid + '.english', path_identity) if subpath else (sid,)
                previous = next((old[(catalog, candidate)] for candidate in candidates
                                 if (catalog, candidate) in old), None)
                if subpath and not previous:
                    sid = path_identity
                row = copy.deepcopy(previous) if previous else {
                    'table': CATALOGS.get(catalog, catalog), 'id': sid,
                    'source_id': sid, 'catalog': catalog,
                    'labels': ['Dialogue' if catalog.startswith('dialogue/') else 'Project text'],
                    'note': '', 'japanese_status': 'not_recorded',
                    'japanese_gbc_dqm1': 'Not verified', 'japanese_gbc_dqm2': 'Not verified',
                    'gbc_details': {'variants': [], 'supporting_sources': [], 'note': '', 'game_status': {
                        game: {'status': 'not_verified', 'note': 'Source correspondence has not been established.'}
                        for game in ('dqm1', 'dqm2')}},
                }
                japanese = entry.get('japanese', entry.get('japanese_lines'))
                if isinstance(japanese, list):
                    japanese = '\n'.join(japanese)
                if japanese is not None and not subpath:
                    row['japanese_psx'] = clean(japanese)
                    row['japanese_status'] = 'recorded'
                else:
                    row.setdefault('japanese_psx', 'Not recorded')
                # Deliberately whitelist wording; never export native code/metadata.
                safe_values = {edition: ({k: v for k, v in value.items()
                               if k in ('english', 'english_short', 'english_full', 'english_lines')}
                               if isinstance(value, dict) else copy.deepcopy(value))
                               for edition, value in values.items()}
                row['raw'] = {'id': row['id'], 'japanese': japanese if isinstance(japanese, str) else row['japanese_psx'],
                              'translations': safe_values}
                row['builder_entry_id'] = identity
                row['builder_value_path'] = list(subpath)
                for edition, (text, menu) in display.items():
                    row[edition], row[edition + '_menu'] = text, menu
                row['different'] = len({row[e] for e in EDITION_KEYS}) > 1
                row['key'] = row['table'] + ':' + row['id']
                rows.append(row)
    if not rows:
        raise ValueError('Refusing to publish an empty comparison')
    if len({row['key'] for row in rows}) != len(rows):
        raise ValueError('Duplicate public row keys after source refresh')
    return rows, hashes, counts, exclusions


def apply_donors(rows, donor):
    # Validate pinned public source evidence without depending on private ROMs.
    from donor_source_audit import validate_artifact
    validate_artifact(donor)
    matches = [row for row in rows if row['key'] == donor['key']]
    if len(matches) != 1:
        raise ValueError('Expected one original clam dialogue row')
    row = matches[0]
    if '大きな貝' not in row['japanese_psx'] or 'giant clam' not in row['current']:
        raise ValueError('Builder source must contain the verified Port Ritz clam correction (PR #80)')
    row['english_sources'] = copy.deepcopy(donor['english_sources'])
    row['edition_notes'] = copy.deepcopy(donor['edition_notes'])
    for edition in ('gameboy', 'delocalized'):
        row[edition] = donor['display'][edition]
        row[edition + '_menu'] = None
    # raw retains the actual builder edition values; public source display is explicit.
    row['different'] = len({row[e] for e in EDITION_KEYS}) > 1
    sources = copy.deepcopy(donor['japanese_sources'])
    row['gbc_details'] = {'variants': [{'text': sources[0]['text'],
        'games': [s['game'] for s in sources], 'sources': sources}],
        'supporting_sources': [], 'note': 'Both Japanese GBC versions independently verified against their original ROMs.',
        'game_status': {'dqm1': {'status': 'not_applicable', 'note': 'DWM2 dialogue.'},
                        'dqm2': {'status': 'verified', 'note': 'Original Ruka and Iru records byte-verified.'}}}
    row['japanese_gbc_dqm1'] = 'Not applicable'
    row['japanese_gbc_dqm2'] = sources[0]['text']
    return row


def replace_context(document, context):
    match = re.search(r'window\.DQM_COMPARISON_CONTEXT\s*=\s*', document)
    if not match:
        raise ValueError('Page comparison context assignment is missing')
    _, end = json.JSONDecoder().raw_decode(document, match.end())
    payload = encoded(context, compact=True).replace('<', '\\u003c')
    return document[:match.end()] + payload + document[end:]


def markdown(context):
    columns = [('Entry', 'key'), ('Labels', 'labels'), ('Japanese-PSX', 'japanese_psx'),
               ('Japanese-GBC DQM1', 'japanese_gbc_dqm1'), ('Japanese-GBC DQM2', 'japanese_gbc_dqm2'),
               ('Current', 'current'), ('Current short/menu', 'current_menu'),
               ('Game Boy', 'gameboy'), ('Delocalized', 'delocalized')]
    def cell(value):
        if isinstance(value, list):
            value = ', '.join(value)
        return html.escape(str(value or '')).replace('|', '&#124;').replace('\n', '<br>')
    result = ['# DQM translation comparison', '',
              f'Last updated from phakic/dqm1 on {context["date"]}.',
              f'Builder revision: `{context["revision"]}`.', '',
              '| ' + ' | '.join(name for name, _ in columns) + ' |',
              '| ' + ' | '.join('---' for _ in columns) + ' |']
    result.extend('| ' + ' | '.join(cell(row.get(key)) for _, key in columns) + ' |' for row in context['rows'])
    result.extend(['', f'{len(context["rows"]):,} comparison rows from {context["coverage"]["source_records"]:,} source records.'])
    return '\n'.join(result) + '\n'


def export(builder, site, updated_at=None, check=False):
    builder, site = Path(builder).resolve(), Path(site).resolve()
    for name in OUTPUTS:
        path = site / name
        if path.is_symlink() or (path.exists() and not path.is_file()):
            raise ValueError(f'Output must be a regular file: {name}')
    baseline = load(site / 'comparison-data.json')
    revision = git(builder, 'rev-parse', 'HEAD')
    if not re.fullmatch('[0-9a-f]{40}', revision):
        raise ValueError('Builder revision is not an immutable Git commit')
    if git(builder, 'status', '--porcelain', '--untracked-files=no', '--', 'src/translations'):
        raise ValueError('Commit builder translation changes before publishing')
    same_revision = baseline.get('builder_revision') == revision
    stamp = updated_at or (baseline.get('updated_from_builder_at') if check or same_revision else None)
    stamp = stamp or datetime.now(timezone.utc).isoformat(timespec='seconds')
    when = datetime.fromisoformat(stamp)
    if when.utcoffset() is None:
        raise ValueError('Update timestamp must include a timezone')
    rows, hashes, counts, exclusions = source_rows(builder, baseline['rows'])
    donor = load(Path(__file__).resolve().parent.parent / 'updates/clam-source-donors.json')
    apply_donors(rows, donor)
    baseline_order = {r['key']: i for i, r in enumerate(baseline['rows'])}
    rows.sort(key=lambda r: baseline_order.get(r['key'], len(baseline_order)))
    labels = Counter(label for row in rows for label in row['labels'])
    coverage = {'source_records': counts['source_records'], 'leaf_records': counts['leaf_records'],
                'included_rows': len(rows), 'excluded_rows': len(exclusions),
                'catalogs': dict(Counter(row['catalog'] for row in rows)),
                'exclusions': exclusions, 'source_sha256': hashes, 'label_counts': dict(labels)}
    context = copy.deepcopy(baseline)
    context.update(revision=revision, commit=revision, dirty=False, generated_at=stamp,
                   updated_from_builder_at=stamp, date=f'{when.day} {when.strftime("%B %Y")}',
                   builder_repository='phakic/dqm1', builder_repository_url='https://github.com/phakic/dqm1',
                   builder_revision=revision, rows=rows, coverage=coverage)
    gbc_coverage = {'rows': len(rows), 'dqm1': {}, 'dqm2': {}, 'by_catalog': {}}
    for row in rows:
        cat = gbc_coverage['by_catalog'].setdefault(row['catalog'], {'rows': 0, 'dqm1': {}, 'dqm2': {}})
        cat['rows'] += 1
        for game in ('dqm1', 'dqm2'):
            status = row.get('gbc_details', {}).get('game_status', {}).get(game, {}).get('status', 'not_verified')
            gbc_coverage[game][status] = gbc_coverage[game].get(status, 0) + 1
            cat[game][status] = cat[game].get(status, 0) + 1
    context.setdefault('gbc_sources', {})['coverage'] = gbc_coverage
    # Historical supplements no longer override wording freshly read from builder.
    context['source_updates'] = [{'kind': 'builder-json-export', 'source_repository': context['builder_repository_url'],
                                 'source_revision': revision, 'date': stamp[:10],
                                 'original_donor_override': donor['key']}]
    for row in rows:
        row['source_revision'] = revision
    document = replace_context((site / 'index.html').read_text(encoding='utf8'), context)
    stamp_label = html.escape(context['date'])
    document = re.sub(r'(<time\b[^>]*id="builder-updated-at"[^>]*>).*?(</time>)',
                      lambda m: m[1] + stamp_label + m[2], document)
    coverage_text = (f'{len(rows):,} comparison rows from {counts["source_records"]:,} source records; '
                     f'{len(exclusions):,} empty/control-only slots excluded.')
    document = re.sub(r'<p(?: id="coverage-summary")?>[\d,]+ comparison rows from [\d,]+ source records; [^<]*excluded\.</p>',
                      '<p id="coverage-summary">' + coverage_text + '</p>', document)
    outputs = {'index.html': document.encode('utf8'),
               'comparison-data.json': (encoded(context) + '\n').encode('utf8'),
               'coverage-report.json': (encoded(dict(coverage, revision=revision, generated_at=stamp, date=context['date'])) + '\n').encode('utf8'),
               'DQM-translation-comparison.md': markdown(context).encode('utf8')}
    manifest = {'schema_version': 2, 'source_repository': context['builder_repository_url'],
                'translation_revision': revision, 'generated_at': stamp, 'updated_from_builder_at': stamp,
                'row_count': len(rows), 'source_file_sha256': hashes,
                'published_sha256': {name: digest(data) for name, data in outputs.items()},
                'source_donor_evidence': {'file': 'updates/clam-source-donors.json',
                    'sha256': digest((Path(__file__).resolve().parent.parent / 'updates/clam-source-donors.json').read_bytes())}}
    outputs['source-manifest.json'] = (encoded(manifest) + '\n').encode('utf8')
    if check:
        different = [name for name, data in outputs.items() if not (site / name).exists() or (site / name).read_bytes() != data]
        if different:
            raise ValueError('Export is stale: ' + ', '.join(different))
    else:
        for name, data in outputs.items():
            (site / name).write_bytes(data)
    return {'rows': len(rows), 'builder_revision': revision, 'outputs': list(outputs)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--builder-root', type=Path, required=True)
    parser.add_argument('--site-root', type=Path, required=True)
    parser.add_argument('--updated-at', help='ISO timestamp, normally the current sync time')
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    print(encoded(export(args.builder_root, args.site_root, args.updated_at, args.check)))


if __name__ == '__main__':
    main()
