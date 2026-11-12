# llm_app — the public, read-only Frontal Lobe app on Relate.
#
# This package is self-contained: it never imports the private `app.*`
# modules. The read functions that used to live in `app/graph.py` are
# vendored into `read_api.py` and run through `api/mgapp/storage.py`.
