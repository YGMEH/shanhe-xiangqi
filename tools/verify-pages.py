"""Verify the production build the way GitHub Pages will serve it.

Serves dist/ under a /shanhe-xiangqi/ subdirectory so that any root-absolute
asset URL or missing relative base shows up as a 404 before deployment.
"""
from playwright.sync_api import sync_playwright

import sys

URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:4180/shanhe-xiangqi/"
SHOT_PREFIX = "work/pages-verify" if len(sys.argv) <= 1 else "work/live-verify"
PROXY = sys.argv[2] if len(sys.argv) > 2 else None

with sync_playwright() as p:
    browser = p.chromium.launch(
        headless=True,
        proxy={"server": PROXY} if PROXY else None,
        args=["--disable-http2", "--disable-quic", "--ignore-certificate-errors"],
    )
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    failures = []
    page.on(
        "response",
        lambda r: failures.append(f"{r.status} {r.url}")
        if r.status >= 400
        else None,
    )
    page.on("console", lambda m: failures.append(f"console.{m.type} {m.text}")
            if m.type == "error" else None)

    page.goto(URL)
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(2500)
    page.screenshot(path=f"{SHOT_PREFIX}-start.png")

    start_visible = page.locator("#start-screen.is-visible").count()
    page.locator("#start-button").click()
    page.wait_for_timeout(2500)
    page.screenshot(path=f"{SHOT_PREFIX}-board.png")

    canvas_box = page.locator("#battlefield").bounding_box()
    print("start_screen_visible:", start_visible)
    print("canvas_box:", canvas_box)
    print("turn_label:", page.locator("#turn-label").inner_text())
    print("failures:", len(failures))
    for item in failures[:40]:
        print("  ", item)
    browser.close()
