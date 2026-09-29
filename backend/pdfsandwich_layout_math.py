"""Small equivalents of the two numerical operations BabelDOC uses here.

Avoid importing all of sklearn/scipy/pandas just to group page glyphs or
compare two uint8 grayscale page images. These are deliberately narrow APIs.
"""
from itertools import product
import numpy as np


class DBSCAN:
    """For min_samples=1, DBSCAN is connected components of radius neighbors."""
    def __init__(self, eps, min_samples=1, metric='euclidean'):
        if eps<=0 or min_samples!=1 or metric not in ('euclidean','manhattan'):
            raise ValueError('Unsupported page clustering parameters')
        self.eps=eps;self.metric=metric

    def fit(self, values):
        points=np.asarray(values,dtype=float)
        if points.ndim!=2 or points.shape[1] not in (1,2) or not np.isfinite(points).all():
            raise ValueError('Expected finite 1D or 2D page positions')
        parent=list(range(len(points)))
        def root(index):
            while parent[index]!=index:
                parent[index]=parent[parent[index]];index=parent[index]
            return index
        cells={};neighbors=list(product((-1,0,1),repeat=points.shape[1]))
        for i,point in enumerate(points):
            cell=tuple(np.floor(point/self.eps).astype(int))
            for delta in neighbors:
                for j in cells.get(tuple(a+b for a,b in zip(cell,delta)),()):
                    distance=np.abs(point-points[j])
                    close=distance.sum()<=self.eps if self.metric=='manhattan' else np.dot(distance,distance)<=self.eps**2
                    if close:parent[root(i)]=root(j)
            cells.setdefault(cell,[]).append(i)
        groups={};labels=[]
        for i in range(len(points)):
            component=root(i)
            if component not in groups:groups[component]=len(groups)
            labels.append(groups[component])
        self.labels_=np.asarray(labels,dtype=int)
        return self


def structural_similarity(first, second):
    """Default SSIM: uint8 grayscale, 7x7 uniform window, sample covariance."""
    import cv2
    if first.shape!=second.shape or first.ndim!=2 or min(first.shape)<7 or first.dtype!=np.uint8 or second.dtype!=np.uint8:
        raise ValueError('Expected matching uint8 grayscale page images, at least 7x7')
    x,y=first.astype(np.float64),second.astype(np.float64)
    def mean(value):return cv2.blur(value,(7,7),borderType=cv2.BORDER_REFLECT)
    ux,uy=mean(x),mean(y)
    vx,vy=(mean(x*x)-ux*ux)*49/48,(mean(y*y)-uy*uy)*49/48
    covariance=(mean(x*y)-ux*uy)*49/48
    c1,c2=(.01*255)**2,(.03*255)**2
    similarity=((2*ux*uy+c1)*(2*covariance+c2))/((ux*ux+uy*uy+c1)*(vx+vy+c2))
    return float(similarity[3:-3,3:-3].mean())
