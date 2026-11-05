import unittest
from pathlib import Path
from build_institution_graph import build_dataset

ROOT=Path(__file__).resolve().parent.parent

class TestNetworkFirstInstitutionPolicy(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data=build_dataset((ROOT/'README.md').read_text(encoding='utf-8'),ROOT/'data/paper_roles.csv',ROOT/'data/primary_affiliations.csv')
    def test_every_paper_has_exactly_one_primary_institution(self):
        papers=self.data['papers'];groups=self.data['institutions']
        self.assertEqual(len(papers),65)
        ids=[pid for g in groups for pid in g['paper_ids']]
        self.assertCountEqual(ids,[p['id'] for p in papers])
        self.assertEqual(len(ids),len(set(ids)))
    def test_first_affiliation_overrides_author_multi_affiliation(self):
        papers=self.data['papers']
        ad=next(p for p in papers if 'Aware Distillation' in p['title'])
        chat=next(p for p in papers if p['title'].startswith('ChatTracker: Enhancing Visual Tracking Performance'))
        self.assertEqual(ad['primary_institution'],'Jilin University')
        self.assertEqual(chat['primary_institution'],'East China Normal University')
        self.assertEqual(ad['primary_status'],'paper_first_affiliation')
    def test_uncertainty_preserved(self):
        m=self.data['meta']
        self.assertEqual(sum(m['status_counts'].values()),m['unique_papers'])
        self.assertGreater(m['unknown_papers'],0)
        self.assertTrue(all(p.get('primary_status') for p in self.data['papers']))
    def test_singleton_is_a_view_flag_not_data_merge(self):
        gs=self.data['institutions']
        one=[g for g in gs if g['is_singleton'] and not g['is_unknown']]
        self.assertGreater(len(one),0)
        self.assertTrue(all(g['paper_count']==1 for g in one))
        self.assertEqual(len({g['name'] for g in one}),len(one))
    def test_role_evidence_retained(self):
        p=next(p for p in self.data['papers'] if 'Aware Distillation' in p['title'])
        self.assertTrue(any(x['role']=='corresponding' for x in p['verified_roles']))
        self.assertTrue(p['corresponding_author_ids'])
if __name__=='__main__':unittest.main()
