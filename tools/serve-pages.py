"""Serve dist/ at /shanhe-xiangqi/ to mirror GitHub Pages project hosting."""
import functools
import http.server

ROOT = "dist"
PREFIX = "/shanhe-xiangqi"


class Handler(http.server.SimpleHTTPRequestHandler):
    def translate_path(self, path):
        if path.startswith(PREFIX):
            path = path[len(PREFIX):] or "/"
        return super().translate_path(path)


handler = functools.partial(Handler, directory=ROOT)
http.server.ThreadingHTTPServer(("127.0.0.1", 4180), handler).serve_forever()
