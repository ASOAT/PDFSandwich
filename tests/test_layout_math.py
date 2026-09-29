import sys
from pathlib import Path
import numpy as np
from sklearn.cluster import DBSCAN as ReferenceDBSCAN
from skimage.metrics import structural_similarity as reference_ssim
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'backend'))
from pdfsandwich_layout_math import DBSCAN,structural_similarity


def test_page_clusters_equal_reference_with_duplicates_boundaries_and_negative_coordinates():
    rng=np.random.default_rng(2401)
    for dimensions in (1,2):
        for metric in ('euclidean','manhattan'):
            for eps in (.1,1,4):
                points=np.concatenate([rng.normal(size=(150,dimensions))*10,np.zeros((4,dimensions)),np.ones((4,dimensions))*eps])
                expected=ReferenceDBSCAN(eps=eps,min_samples=1,metric=metric).fit(points).labels_
                actual=DBSCAN(eps=eps,min_samples=1,metric=metric).fit(points).labels_
                assert np.array_equal(actual,expected)


def test_scan_similarity_equals_reference_for_noise_flat_pages_and_textlike_patterns():
    rng=np.random.default_rng(2402)
    random=rng.integers(0,256,(120,180),dtype=np.uint8)
    white=np.full((120,180),255,dtype=np.uint8)
    striped=white.copy();striped[20:70:5,20:160]=0
    for first,second in [(random,random),(random,255-random),(white,white),(white,striped),(random,striped)]:
        assert abs(structural_similarity(first,second)-reference_ssim(first,second))<1e-12
