"""Tiny static server with correct MIME types for ES modules.

Python's stdlib http.server uses the system mimetypes registry, which on
Windows often maps .js to text/plain — and browsers refuse to execute
ES modules served with the wrong MIME type. This shim forces the right
ones for the file extensions this project actually serves.

Run: python serve.py [port]
"""
import sys
import mimetypes
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("text/javascript", ".mjs")
mimetypes.add_type("application/json", ".json")
mimetypes.add_type("text/css", ".css")
mimetypes.add_type("text/html", ".html")
mimetypes.add_type("image/svg+xml", ".svg")


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        # Disable caching during development so edits are picked up.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    with ThreadingHTTPServer(("127.0.0.1", port), Handler) as httpd:
        print(f"Serving on http://127.0.0.1:{port}/")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
