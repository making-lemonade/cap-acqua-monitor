"""Deterministic gzip for reproducible versioned data artifacts.

mtime=0 and an empty embedded source filename prevent unchanged source data from
generating new multi-megabyte Git blobs on every scheduled GitHub Actions run.
"""
from contextlib import contextmanager
import gzip
import io

@contextmanager
def deterministic_text_gzip(path, compresslevel=6):
    with open(path, "wb") as binary:
        with gzip.GzipFile(fileobj=binary, filename="", mode="wb",
                           compresslevel=compresslevel, mtime=0) as compressed:
            with io.TextIOWrapper(compressed, encoding="utf-8", newline="\n") as output:
                yield output
