import unittest
from build_graph import parse_source, build_graph


class ReadmeParserTest(unittest.TestCase):
    def test_deduplicate_while_preserving_categories(self):
        src = '''## Datasets (One Pass Evaluation):
* **A Sample Benchmark**, Jane Doe, John Roe (CVPR24)
[[Paper](https://example.com/a)]
## Initialize Settings:
### NL+BBox:
* **A Sample Benchmark**, Jane Doe, John Roe (CVPR24)
[[Paper](https://example.com/a)]
* **TrackX**: **A New Tracker**, Jane Doe, Wu San and Alice Lee (TCSVT25)
[[Paper](https://example.com/t)]
### NL Only:
* **Natural Tracker**, Alice Lee, Bo Li (CVPR26)
[[Paper](https://example.com/n)]
'''
        papers,warnings,entries=parse_source(src)
        self.assertEqual(entries,4)
        self.assertEqual(len(papers),3)
        self.assertEqual(warnings,[])
        sample=next(p for p in papers if p['title']=='A Sample Benchmark')
        self.assertEqual(set(sample['categories']), {'Datasets','NL+BBox'})
        tracker=next(p for p in papers if p['title']=='A New Tracker')
        self.assertEqual(tracker['authors'], ['Jane Doe','Wu San','Alice Lee'])
        self.assertEqual(tracker['ccf'],'B')
        authors,papers,edges=build_graph(papers)
        self.assertEqual(len(authors),5)
        self.assertEqual(len(edges),5)


if __name__=='__main__':
    unittest.main()
