import json
import shlex
from typing import Optional, Union
from urllib.parse import urlencode

import requests


def request_to_curl(response: requests.Response) -> str:
    req = response.request
    if not req.url:
        raise ValueError("Request URL cannot be None")

    parts = ["curl"]

    # Add method if not GET
    if req.method != "GET":
        parts.append(f"-X {req.method}")

    # Add headers
    for header, value in req.headers.items():
        # Skip the content-length header as curl adds it automatically
        if header.lower() == "content-length":
            continue
        parts.append(f"-H {shlex.quote(f'{header}: {value}')}")

    # Handle request body
    if req.body:
        body: str
        if isinstance(req.body, bytes):
            body = req.body.decode("utf-8")
        else:
            body = str(req.body)

        # Try to detect if body is JSON
        try:
            json.loads(body)
            parts.append(f"--data '{body}'")
            if "content-type" not in {h.lower() for h in req.headers}:
                parts.append("-H 'Content-Type: application/json'")
        except json.JSONDecodeError:
            # If not JSON, assume regular form data
            parts.append(f"--data '{body}'")

    # Add URL (must be last)
    parts.append(shlex.quote(req.url))

    return " ".join(parts)
