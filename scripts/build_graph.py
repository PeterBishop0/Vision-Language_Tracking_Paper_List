#!/usr/bin/env python3
"""Build a preliminary VLT author coauthorship graph directly from README.md.

No third-party Python dependencies, network access, or API credentials required.
Author identities are provisional: identical normalized names are treated as the
same author. Resolve ambiguities before using this graph for research metrics.
"""

import argparse
import hashlib
import itertools
import json
import re
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

HEADERS = {
    "Datasets (One Pass Evaluation)": "Datasets",
    "NL+BBox": "NL+BBox",
    "NL & NL+BBox": "NL & NL+BBox",
    "NL Only": "NL Only",
}
LEVEL_A = {"CVPR", "ICCV", "NEURIPS", "AAAI", "MM", "TIP", "TPAMI", "TMM", "IJCV"}
LEVEL_B = {"ECCV", "IJCAI", "ICASSP", "TCSVT", "TOMM", "PR", "TITS"}
VENUE_NAMES = {"MM": "ACM MM", "PR": "Pattern Recognition", "NEURIPS": "NeurIPS"}
PAPER_LINE = re.compile(r"^\*\s+(?:\*\*([^*]+)\*\*:\s+)?\*\*([^*]+)\*\*,\s*(.+?)\s*\(([^()]+)\)\s*$")
LINK_LINE = re.compile(r"\[\[(Paper|Code|Github|Project|Evaluation Toolkit & Github)\]\((https?://[^)]+)\)\]")
VENUE_LINE = re.compile(r"([A-Za-z]+)\s*(20\d{2}|\d{2})(?:\b|,|\s|$)")


def normalize(s):
    return re.sub(r"\s+", " ", s.strip()).casefold()


def uid(prefix, s):
    return prefix + "_" + hashlib.sha1(s.encode("utf-8")).hexdigest()[:12]


def split_authors(raw):
    raw = re.sub(r"\s+\band\b\s+", ", ", raw, flags=re.I)
    names = []
    for item in raw.split(","):
        name = re.sub(r"\s+", " ", item.strip(" *\t\n"))
        if name and normalize(name) not in {normalize(x) for x in names}:
            names.append(name)
    return names


def parse_source(readme):
    section = None
    records = []
    warnings = []
    current = None
    for index, line in enumerate(readme.splitlines(), start=1):
        line = line.rstrip()
        heading = re.match(r"^#{2,3}\s+(.+?)(?::)?\s*$", line)
        if heading:
            title = heading.group(1).rstrip(":").strip()
            if title in HEADERS:
                section = HEADERS[title]
            elif title == "Initialize Settings":
                section = None
            elif line.startswith("###"):
                section = None
        if not section:
            continue
        if line.startswith("* "):
            m = PAPER_LINE.match(line)
            if not m:
                warnings.append(f"line {index}: could not parse paper metadata: {line[:100]}")
                current = None
                continue
            label, title, author_text, venue_text = m.groups()
            venue_m = VENUE_LINE.search(venue_text)
            if not venue_m:
                warnings.append(f"line {index}: could not parse venue/year: {venue_text}")
                current = None
                continue
            venue_code = venue_m.group(1).upper()
            yy = int(venue_m.group(2))
            year = yy if yy >= 2000 else 2000 + yy
            level = "A" if venue_code in LEVEL_A else "B" if venue_code in LEVEL_B else None
            if level is None:
                warnings.append(f"line {index}: venue {venue_code} not in configured CCF A/B map; classified Unknown")
            current = {
                "title": title.strip(), "short_name": (label or "").strip(),
                "authors": split_authors(author_text), "venue": VENUE_NAMES.get(venue_code, venue_code),
                "venue_code": venue_code, "year": year, "ccf": level or "Unknown",
                "categories": [section], "paper_url": "", "code_url": "", "other_urls": [],
            }
            if not current["authors"]:
                warnings.append(f"line {index}: paper has no authors")
            records.append(current)
        elif current:
            for label, url in LINK_LINE.findall(line):
                if label == "Paper" and not current["paper_url"]:
                    current["paper_url"] = url
                elif label in {"Code", "Github", "Evaluation Toolkit & Github"} and not current["code_url"]:
                    current["code_url"] = url
                else:
                    current["other_urls"].append(url)

    papers_by_title = {}
    for rec in records:
        k = normalize(rec["title"])
        if k not in papers_by_title:
            rec["id"] = uid("p", k)
            papers_by_title[k] = rec
        else:
            p = papers_by_title[k]
            for cat in rec["categories"]:
                if cat not in p["categories"]:
                    p["categories"].append(cat)
            for field in ("paper_url", "code_url"):
                if not p[field] and rec[field]:
                    p[field] = rec[field]
            if {normalize(x) for x in p["authors"]} != {normalize(x) for x in rec["authors"]}:
                warnings.append(f"duplicate title with conflicting author list: {p['title']}")
    return list(papers_by_title.values()), warnings, len(records)


def build_graph(papers):
    authors_by_name = {}
    edges = {}
    for p in papers:
        ids = []
        for name in p["authors"]:
            k = normalize(name)
            if k not in authors_by_name:
                authors_by_name[k] = {"id": uid("a", k), "name": name, "paper_ids": [], "collaborator_ids": []}
            a = authors_by_name[k]
            if p["id"] not in a["paper_ids"]:
                a["paper_ids"].append(p["id"])
            ids.append(a["id"])
        p["author_ids"] = ids
        for a, b in itertools.combinations(sorted(set(ids)), 2):
            key = (a, b)
            if key not in edges:
                edges[key] = {"source": a, "target": b, "paper_ids": []}
            if p["id"] not in edges[key]["paper_ids"]:
                edges[key]["paper_ids"].append(p["id"])
    by_id = {a["id"]: a for a in authors_by_name.values()}
    for edge in edges.values():
        edge["weight"] = len(edge["paper_ids"])
        by_id[edge["source"]]["collaborator_ids"].append(edge["target"])
        by_id[edge["target"]]["collaborator_ids"].append(edge["source"])
    authors = sorted(authors_by_name.values(), key=lambda x: (-len(x["paper_ids"]), x["name"].casefold()))
    papers = sorted(papers, key=lambda x: (-x["year"], x["title"].casefold()))
    return authors, papers, sorted(edges.values(), key=lambda x: (-x["weight"], x["source"]))


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--input", type=Path, default=Path("README.md"))
    ap.add_argument("--output", type=Path, default=Path("docs/data/graph.json"))
    args = ap.parse_args()
    if not args.input.exists():
        ap.error(f"source file not found: {args.input}")
    papers, warnings, raw_count = parse_source(args.input.read_text(encoding="utf-8"))
    if not papers:
        sys.exit("Error: no papers parsed from README; check its format.")
    authors, papers, edges = build_graph(papers)
    payload = {
        "meta": {
            "source": args.input.name, "generated_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "raw_entries": raw_count, "unique_papers": len(papers), "researchers": len(authors),
            "coauthorship_edges": len(edges), "warnings": warnings,
            "identity_note": "Author identities are provisional and merged by normalized name; homonyms may be conflated.",
            "ccf_note": "CCF A/B labels are mapped from venue abbreviations in the curated README; verify against official CCF directory when updating.",
        },
        "authors": authors, "papers": papers, "edges": edges,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Parsed {raw_count} README entries → {len(papers)} unique papers, {len(authors)} authors, {len(edges)} coauthor edges")
    for msg in warnings:
        print("WARNING:", msg, file=sys.stderr)


if __name__ == "__main__":
    main()
