import csv
import tempfile
import unittest
from pathlib import Path
from build_graph import parse_source, build_graph
from build_institution_graph import load_annotations, build_institution_data

SRC='''## Initialize Settings:
### NL+BBox:
* **First Paper**, Alice Smith, Bob Chen, Carol Wu (CVPR25)
[[Paper](https://example.org/first)]
* **Second Paper**, Bob Chen, Eric Xu (ICCV25)
[[Paper](https://example.org/second)]
'''

class InstitutionTests(unittest.TestCase):
    def setup_data(self):
        ps,_,_=parse_source(SRC)
        authors,ps,edges=build_graph(ps)
        return authors,ps,edges

    def make_csv(self, path, rows):
        with path.open('w', encoding='utf-8', newline='') as f:
            writer=csv.DictWriter(f,fieldnames=['paper_title','author_name','institution','role','evidence_url'])
            writer.writeheader();writer.writerows(rows)

    def test_no_institution_guesses_from_coauthors_or_last_author(self):
        authors, ps, _ = self.setup_data()
        groups=build_institution_data(ps,authors,[])
        self.assertEqual(len(groups),1)
        self.assertFalse(groups[0]['verified'])
        self.assertEqual(groups[0]['paper_count'],2)
        self.assertEqual(len(ps[0]['corresponding_author_ids']),0)

    def test_multiple_institutions_and_roles_same_paper(self):
        authors,ps,_=self.setup_data()
        with tempfile.TemporaryDirectory() as td:
            path=Path(td)/'annotations.csv'
            self.make_csv(path,[
                {'paper_title':'First Paper','author_name':'Alice Smith','institution':'Uni A','role':'first','evidence_url':'https://example.org/a'},
                {'paper_title':'First Paper','author_name':'Bob Chen','institution':'Uni B','role':'corresponding','evidence_url':'https://example.org/a'},
                {'paper_title':'Second Paper','author_name':'Eric Xu','institution':'Uni C','role':'corresponding','evidence_url':'https://example.org/b'},
            ])
            annotation,warnings=load_annotations(path,ps)
        self.assertEqual(warnings,[])
        groups=build_institution_data(ps,authors,annotation)
        self.assertEqual({x['name'] for x in groups},{'Uni A','Uni B','Uni C'})
        self.assertEqual(len(ps[0]['corresponding_author_ids']),1)
        self.assertEqual(next(g for g in groups if g['name']=='Uni A')['representatives'][0]['roles'],['first'])

    def test_invalid_or_uncited_institution_is_skipped(self):
        authors,ps,_=self.setup_data()
        with tempfile.TemporaryDirectory() as td:
            path=Path(td)/'annotations.csv'
            self.make_csv(path,[
                {'paper_title':'First Paper','author_name':'Carol Wu','institution':'Uni A','role':'first','evidence_url':'https://example.org/a'},
                {'paper_title':'First Paper','author_name':'Alice Smith','institution':'Uni A','role':'first','evidence_url':''},
            ])
            annotation,warnings=load_annotations(path,ps)
        self.assertEqual(annotation,[])
        self.assertEqual(len(warnings),2)

if __name__=='__main__':unittest.main()
