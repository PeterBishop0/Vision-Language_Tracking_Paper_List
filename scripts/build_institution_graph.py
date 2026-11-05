#!/usr/bin/env python3
"""Extend README-derived VLT coauthorship data using verifiable per-paper role annotations.

No affiliations or corresponding authors are inferred from last-author order or
coauthorship. A paper can belong to multiple institutions when explicit, cited
role annotations support that assignment. Unverified papers remain visible in
an explicit 'institution pending verification' group.
"""
import argparse
import csv
import json
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

from build_graph import build_graph, parse_source, normalize, uid

ALLOWED_ROLES = {'first', 'cofirst', 'corresponding'}
PENDING_KEY = '__pending__'
PENDING_LABEL = 'Institution pending verification / 机构待核实'
FIELDS = ['paper_title', 'author_name', 'institution', 'role', 'evidence_url']


def load_annotations(path, papers):
    warnings = []
    by_title = {normalize(p['title']): p for p in papers}
    verified = []
    if not path.exists():
        return [], [f'{path} missing: institution grouping will be unverified']
    with path.open('r', encoding='utf-8-sig', newline='') as f:
        reader = csv.DictReader(f)
        missing = set(FIELDS) - set(reader.fieldnames or [])
        if missing:
            raise ValueError('Annotation CSV missing required columns: ' + ', '.join(sorted(missing)))
        seen = set()
        for i, row in enumerate(reader, start=2):
            title = (row.get('paper_title') or '').strip()
            name = (row.get('author_name') or '').strip()
            institution = (row.get('institution') or '').strip()
            role = (row.get('role') or '').strip().lower()
            evidence = (row.get('evidence_url') or '').strip()
            if not title and not name and not institution:
                continue
            # Blank affiliation is a TODO, not evidence of an affiliation.
            if not institution:
                continue
            p = by_title.get(normalize(title))
            if not p:
                warnings.append(f'annotations row {i}: paper title not found: {title[:70]}')
                continue
            if not name or normalize(name) not in {normalize(n) for n in p['authors']}:
                warnings.append(f'annotations row {i}: author not found on paper: {name} / {title[:55]}')
                continue
            if role not in ALLOWED_ROLES:
                warnings.append(f'annotations row {i}: invalid role {role!r}; choose {sorted(ALLOWED_ROLES)}')
                continue
            if role == 'first' and normalize(name) != normalize(p['authors'][0]):
                warnings.append(f'annotations row {i}: first author mismatch: {name} / {title[:55]}')
                continue
            if not (evidence.startswith('https://') or evidence.startswith('http://')):
                warnings.append(f'annotations row {i}: evidence_url required for verified institution: {title[:55]}')
                continue
            key = (p['id'], normalize(name), normalize(institution), role)
            if key in seen:
                continue
            seen.add(key)
            verified.append({
                'paper_id': p['id'], 'author_id': uid('a', normalize(name)),
                'name': name, 'institution': institution,
                'role': role, 'evidence_url': evidence,
            })
    return verified, warnings


def build_institution_data(papers, authors, annotations):
    authors_by_id = {a['id']: a for a in authors}
    annotated_by_paper = defaultdict(list)
    for x in annotations:
        annotated_by_paper[x['paper_id']].append(x)
    for p in papers:
        p['first_author_id'] = p['author_ids'][0] if p['author_ids'] else None
        p['verified_roles'] = annotated_by_paper.get(p['id'], [])
        p['corresponding_author_ids'] = sorted({x['author_id'] for x in p['verified_roles'] if x['role'] == 'corresponding'})
        p['institution_status'] = 'verified' if p['verified_roles'] else 'pending'

    groups = {}  # institution name -> group
    for p in papers:
        recs = p['verified_roles']
        institutions = {x['institution'] for x in recs} or {PENDING_KEY}
        for institution in institutions:
            if institution not in groups:
                groups[institution] = {
                    'id': uid('i', normalize(institution)),
                    'name': PENDING_LABEL if institution == PENDING_KEY else institution,
                    'verified': institution != PENDING_KEY,
                    'paper_ids': [], 'representatives': [], 'author_ids': [],
                }
            g = groups[institution]
            g['paper_ids'].append(p['id'])
            g['author_ids'].extend(p['author_ids'])
            reps = [x for x in recs if x['institution'] == institution]
            if institution == PENDING_KEY and p['first_author_id']:
                # Known from author order, but affiliation remains UNKNOWN.
                reps = [{'paper_id': p['id'], 'author_id': p['first_author_id'],
                         'name': authors_by_id[p['first_author_id']]['name'],
                         'institution': '', 'role': 'first', 'evidence_url': ''}]
            g['representatives'].extend(reps)
    result = []
    for g in groups.values():
        g['paper_ids'] = sorted(set(g['paper_ids']))
        g['author_ids'] = sorted(set(g['author_ids']))
        g['paper_count'] = len(g['paper_ids'])
        rep_by_author = defaultdict(lambda: {'author_id': '', 'name': '', 'roles': set(), 'paper_ids': set(), 'evidence_urls': set()})
        for r in g['representatives']:
            a = rep_by_author[r['author_id']]
            a['author_id'] = r['author_id']; a['name'] = r['name']; a['roles'].add(r['role'])
            a['paper_ids'].add(r['paper_id'])
            if r['evidence_url']: a['evidence_urls'].add(r['evidence_url'])
        g['representatives'] = [{
            'author_id': x['author_id'], 'name': x['name'], 'roles': sorted(x['roles']),
            'paper_ids': sorted(x['paper_ids']), 'evidence_urls': sorted(x['evidence_urls']),
        } for x in sorted(rep_by_author.values(), key=lambda x: (-len(x['paper_ids']), x['name'].casefold()))]
        g['representative_count'] = len(g['representatives'])
        result.append(g)
    return sorted(result, key=lambda x: (not x['verified'], -x['paper_count'], x['name'].casefold()))


def export_blank_rows(papers, path):
    """Convenience editor: one blank institution row for each README first author.
    This never overwrites a populated CSV; use an external editor to merge rows.
    """
    if path.exists():
        raise FileExistsError(f'Will not overwrite existing file: {path}')
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('w', encoding='utf-8-sig', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=FIELDS)
        writer.writeheader()
        for p in sorted(papers, key=lambda p: (-p['year'], p['title'])):
            writer.writerow({'paper_title': p['title'], 'author_name': p['authors'][0] if p['authors'] else '',
                             'institution': '', 'role': 'first', 'evidence_url': ''})


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--input', type=Path, default=Path('README.md'))
    ap.add_argument('--annotations', type=Path, default=Path('data/paper_roles.csv'))
    ap.add_argument('--output', type=Path, default=Path('docs/data/graph.json'))
    ap.add_argument('--export-template', type=Path, help='Write a blank, paper-complete editor CSV and exit')
    args = ap.parse_args()
    papers, warnings, raw = parse_source(args.input.read_text(encoding='utf-8'))
    if not papers:
        sys.exit('No paper entries parsed. Keep the original README markdown format.')
    if args.export_template:
        export_blank_rows(papers, args.export_template)
        print(f'Wrote {len(papers)} paper rows to {args.export_template}')
        return
    authors, papers, edges = build_graph(papers)
    annotations, more_warnings = load_annotations(args.annotations, papers)
    groups = build_institution_data(papers, authors, annotations)
    payload = {
        'meta': {
            'source': args.input.name,
            'generated_utc': datetime.now(timezone.utc).isoformat(timespec='seconds'),
            'raw_entries': raw, 'unique_papers': len(papers),
            'researchers': len(authors), 'coauthorship_edges': len(edges),
            'verified_institutions': sum(g['verified'] for g in groups),
            'verified_papers': sum(p['institution_status'] == 'verified' for p in papers),
            'warnings': warnings + more_warnings,
            'identity_note': 'Same-normalized-name author IDs are provisional; ORCID/OpenAlex disambiguation pending.',
            'affiliation_note': 'Only source-backed first/co-first/corresponding roles establish institution membership; coauthors are not assumed to share affiliation.',
        },
        'authors': authors, 'papers': papers, 'edges': edges,
        'institutions': groups,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'Parsed {raw} entries → {len(papers)} papers, {len(authors)} names, {len(edges)} coauthor edges')
    print(f'Institution annotations: {len(annotations)} verified records; {len(groups)} cards incl. pending')
    for msg in payload['meta']['warnings']:
        print('WARNING:', msg, file=sys.stderr)

if __name__ == '__main__':
    main()
