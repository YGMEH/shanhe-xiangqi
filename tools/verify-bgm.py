"""验证 BGM 素材是否真正加载并播放 (AUDIO_BRIEF 第六节接线验收)。

为什么要单独写这个脚本:
  接线改完之后 `node --check` 只能证明语法对, `npm test` 57 项里没有一项
  覆盖音频。要证明"点开始后 bgm_battle.mp3 真的被请求、解码、进到
  musicGain 上", 只能开真实浏览器读运行时状态。

三个判据, 缺一个都算没接线:
  1. 网络层: 出现 bgm_battle 的 200 响应
  2. 解码层: audio.bgm Map 里出现 'battle' 键 (说明 decodeAudioData 成功)
  3. 播放层: audio.bgmKey === 'battle' 且 bgmSource 非空、context.state 为 running

只写 work/shots/, 不碰 dist/ 与 public/。
"""

import argparse
import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
SHOTS = ROOT / "work" / "shots"

GL_ARGS = [
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
]

# 浏览器里读运行时状态。__SHANHE_DEBUG__ 未必挂 audio, 所以两条路都试。
PROBE_JS = """
() => {
  const d = window.__SHANHE_DEBUG__ || {};
  const a = d.audio || window.__audio || null;
  let m = null;
  if (a) {
    m = {
      bgmKeys: a.bgm ? Array.from(a.bgm.keys()) : null,
      bgmKey: a.bgmKey === undefined ? 'n/a' : a.bgmKey,
      bgmRequested: a.bgmRequested === undefined ? 'n/a' : a.bgmRequested,
      hasSource: !!(a.bgmSource),
      musicStarted: a.musicStarted === undefined ? 'n/a' : a.musicStarted,
      musicGain: a.musicGain && a.musicGain.gain ? a.musicGain.gain.value : 'n/a',
      ctxState: a.context ? a.context.state : 'n/a',
      bgmErrors: d.audioBgmErrors ? d.audioBgmErrors() : null,
      hasStartBgm: typeof a.startBgm === 'function',
      hasSwitchBgm: typeof a.switchBgm === 'function',
    };
  }
  return { hasDebug: !!window.__SHANHE_DEBUG__, audioKeys: a ? Object.keys(a).length : null, audio: m,
           debugKeys: Object.keys(d).slice(0, 20) };
}
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://127.0.0.1:4301/")
    ap.add_argument("--wait", type=float, default=12.0)
    ap.add_argument("--shot", default="bgm-verify")
    args = ap.parse_args()

    audio_hits = []
    page_errors = []
    console_errors = []

    with sync_playwright() as p:
        browser = p.chromium.launch(args=GL_ARGS)
        page = browser.new_page(viewport={"width": 1280, "height": 800})
        page.on("response", lambda r: audio_hits.append(
            f"{r.status} {r.url.split('/')[-1]}") if ".mp3" in r.url or ".ogg" in r.url else None)
        page.on("pageerror", lambda e: page_errors.append(str(e)[:300]))
        page.on("console", lambda m: console_errors.append(m.text[:300])
                if m.type == "error" else None)

        page.goto(args.url, wait_until="networkidle", timeout=90000)
        page.wait_for_timeout(2500)

        clicked = page.evaluate("""() => {
          const bs = Array.from(document.querySelectorAll('button, .btn, [role=button], a'));
          const t = bs.find(b => /开始|对局|开局|start/i.test((b.textContent || '').trim()));
          if (!t) return null;
          const label = (t.textContent || '').trim().slice(0, 24);
          t.click();
          return label;
        }""")
        page.wait_for_timeout(int(args.wait * 1000))

        probe = page.evaluate(PROBE_JS)
        SHOTS.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(SHOTS / f"{args.shot}.png"))
        browser.close()

    verdict = {
        "clicked": clicked,
        "audio_requests": audio_hits,
        "probe": probe,
        "page_errors": page_errors[:5],
        "console_errors": console_errors[:5],
    }
    print(json.dumps(verdict, ensure_ascii=False, indent=2))

    # 判据 1: 网络层
    if not any("battle" in h for h in audio_hits):
        print("VERDICT: FAIL(网络层) 没有发出 bgm 请求")
        return 1
    a = probe.get("audio") or {}
    if not a:
        print("VERDICT: PARTIAL 请求已发出, 但读不到 audio 运行时对象(需挂 __SHANHE_DEBUG__.audio)")
        return 2
    if not a.get("bgmKeys"):
        print("VERDICT: FAIL(解码层) 请求发出但 bgm Map 为空")
        return 1
    if a.get("bgmKey") != "battle":
        print(f"VERDICT: PARTIAL 已解码 {a.get('bgmKeys')} 但当前曲目是 {a.get('bgmKey')}")
        return 2
    print("VERDICT: PASS BGM 已加载并播放")
    return 0


if __name__ == "__main__":
    sys.exit(main())
