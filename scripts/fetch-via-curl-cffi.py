#!/usr/bin/env python3
"""
Fallback fetch using curl_cffi to bypass Cloudflare.
Impersonates Safari 17 to avoid JS challenges.
Usage: python3 fetch-via-curl-cffi.py <url>
Outputs raw HTML to stdout, exits non-zero on failure.
"""
import sys
from curl_cffi import requests


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: fetch-via-curl-cffi.py <url>", file=sys.stderr)
        sys.exit(1)

    url = sys.argv[1]

    try:
        r = requests.get(
            url,
            impersonate="safari17_0",
            timeout=20,
        )
        if r.status_code >= 400:
            print(f"HTTP {r.status_code}", file=sys.stderr)
            sys.exit(1)
        print(r.text)
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
