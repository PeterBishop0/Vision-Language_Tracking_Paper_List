#!/usr/bin/env python3
"""Build a researcher-first VLT atlas with a ONE-INSTITUTION-PER-PAPER classification.

Primary affiliation policy: explicitly curated affiliation #1 from a paper >
first author's affiliation recorded for that specific paper > corresponding-author
institution as transparent proxy > Unknown. Missing proof is never invented.
Original individual paper author affiliations / roles remain in verified_roles.
"""
import argparse,csv,json,sys
from pathlib import Path
from datetime import datetime,timezone
from collections import defaultdict
from build_graph import parse_source,build_graph,normalize,uid

UNKNOWN='__unknown__'
HEAD=['paper_title','author_name','institution','role','evidence_url']

def read_csv(path):
    with path.open(encoding='utf-8-sig',newline='') as f:return list(csv.DictReader(f))

def build_dataset(readme,roles_path,primary_path):
    parsed,warnings,raw=parse_source(readme)
    authors,papers,edges=build_graph(parsed)
    mapping={normalize(p['title']):p for p in papers}
    for p in papers:
        p['first_author_id']=p['author_ids'][0] if p['author_ids'] else None
        p['verified_roles']=[]
    for row in read_csv(roles_path):
        name=(row.get('author_name') or '').strip();inst=(row.get('institution') or '').strip()
        p=mapping.get(normalize(row.get('paper_title','')))
        if not p or not name or not inst:continue
        role=(row.get('role') or '').strip().lower()
        if role not in {'first','cofirst','corresponding'}:continue
        if normalize(name) not in {normalize(n) for n in p['authors']}:
            warnings.append(f'Unknown author annotation: {name} / {p["title"][:40]}');continue
        if role=='first' and normalize(name)!=normalize(p['authors'][0]):continue
        url=row.get('evidence_url','').strip()
        if not url.startswith(('https://','http://')):continue
        rec={'author_id':uid('a',normalize(name)),'name':name,'institution':inst,'role':role,'evidence_url':url,'source_type':'paper_record'}
        if rec not in p['verified_roles']:p['verified_roles'].append(rec)
    overrides={}
    if primary_path.exists():
        for row in read_csv(primary_path):
            key=normalize(row.get('paper_title',''))
            if key and key in mapping and row.get('primary_institution','').strip() and row.get('evidence_url','').startswith(('http://','https://')):
                overrides[key]=row
            elif key: warnings.append('Invalid or unmatched primary affiliation override: '+row.get('paper_title',''))
    for p in papers:
        o=overrides.get(normalize(p['title']))
        first=[r for r in p['verified_roles'] if r['role']=='first' and normalize(r['name'])==normalize(p['authors'][0])]
        corr=[r for r in p['verified_roles'] if r['role']=='corresponding']
        if o:
            name=o['primary_institution'].strip();status='paper_first_affiliation';url=o['evidence_url'].strip()
        elif first:
            # First author can list multiple affiliations; source list order is only a fallback.
            # To certify affiliation #1, add an explicit override in primary_affiliations.csv.
            name=first[0]['institution'];url=first[0]['evidence_url']
            status='first_author_affiliation' if len({r['institution'] for r in first})==1 else 'first_author_multi_affiliation_unchecked'
        elif corr:
            name=corr[0]['institution'];url=corr[0]['evidence_url'];status='corresponding_reference'
        else:
            name='机构待核实';url='';status='unknown'
        p.update(primary_institution=name, primary_status=status,primary_evidence_url=url,
                 institution_id=uid('i',normalize(name)) if status!='unknown' else UNKNOWN,
                 corresponding_author_ids=sorted({r['author_id'] for r in corr}))
    ins={}
    for p in papers:
        key=p['institution_id'];g=ins.setdefault(key,{'id':key,'name':p['primary_institution'],'paper_ids':[],'author_ids':[],'lead_author_ids':[],'statuses':[]})
        g['paper_ids'].append(p['id']);g['author_ids']+=p['author_ids'];g['lead_author_ids'].append(p['first_author_id'])
        g['statuses'].append(p['primary_status'])
    for g in ins.values():
        g['paper_count']=len(g['paper_ids'])
        g['author_ids']=sorted(set(g['author_ids']));g['lead_author_ids']=sorted(set(g['lead_author_ids']));g['statuses']=sorted(set(g['statuses']))
        g['is_singleton']=g['paper_count']==1
        g['is_unknown']=g['id']==UNKNOWN
    groups=sorted(ins.values(),key=lambda x:(x['is_unknown'],-x['paper_count'],x['name'].casefold()))
    counts={}
    for a in authors:
        a['first_author_paper_ids']=[p['id'] for p in papers if p['first_author_id']==a['id']]
        a['corresponding_paper_ids']=[p['id'] for p in papers if a['id'] in p['corresponding_author_ids']]
        a['primary_institutions']=sorted({p['primary_institution'] for p in papers if p['first_author_id']==a['id'] and p['primary_status']!='unknown'})
    meta={'source':'README.md + paper_roles.csv + primary_affiliations.csv','generated_utc':datetime.now(timezone.utc).isoformat(timespec='seconds'),
          'raw_entries':raw,'unique_papers':len(papers),'researchers':len(authors),'coauthorship_edges':len(edges),
          'institutions':len(groups)-int(UNKNOWN in ins), 'major_institutions':sum(not g['is_singleton'] and not g['is_unknown'] for g in groups),
          'singleton_institutions':sum(g['is_singleton'] and not g['is_unknown'] for g in groups),
          'unknown_papers':sum(p['primary_status']=='unknown' for p in papers),
          'status_counts':dict(__import__('collections').Counter(p['primary_status'] for p in papers)),
          'warnings':warnings,
          'identity_note':'Authors are identified by normalized names (NOT ORCID-disambiguated).',
          'institution_note':'One primary institution per paper. Explicit #1 paper affiliation prioritized; first-author or corresponding affiliation used as labeled fallback. Single-paper institutions collapsed only in the UI.'}
    return {'meta':meta,'papers':papers,'authors':authors,'edges':edges,'institutions':groups}

def main():
    a=argparse.ArgumentParser();a.add_argument('--input',type=Path,default=Path('README.md'));a.add_argument('--annotations',type=Path,default=Path('data/paper_roles.csv'));a.add_argument('--primary',type=Path,default=Path('data/primary_affiliations.csv'));a.add_argument('--output',type=Path,default=Path('docs/data/graph.json'))
    x=a.parse_args();d=build_dataset(x.input.read_text(encoding='utf-8'),x.annotations,x.primary)
    x.output.parent.mkdir(parents=True,exist_ok=True);x.output.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({k:d['meta'][k] for k in ['unique_papers','researchers','coauthorship_edges','institutions','major_institutions','singleton_institutions','unknown_papers','status_counts']},ensure_ascii=False,indent=2))
    for warn in d['meta']['warnings']:print('WARNING:',warn,file=sys.stderr)
if __name__=='__main__':main()
