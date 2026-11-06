#!/usr/bin/env python3
import http.server
import socketserver
import os

PORT = 8083
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)
    def log_message(self, format, *args):
        pass

with socketserver.TCPServer(("", PORT), Handler) as httpd:
    print(f"Serving HTTP on port {PORT} from {DIRECTORY}")
    httpd.serve_forever()
