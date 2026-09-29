"""Smoke-check static and file previews in local Chrome, with no extra packages."""

import functools
import html
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import json
import re
import shutil
import subprocess
import tempfile
import threading


ROOT = Path(__file__).resolve().parents[1]
CHROME = shutil.which("chrome") or shutil.which("google-chrome") or r"C:\Program Files\Google\Chrome\Application\chrome.exe"
ERROR_HOOK = "<script>window.smokeErrors=[];addEventListener('error',e=>smokeErrors.push(e.message));addEventListener('unhandledrejection',e=>smokeErrors.push(String(e.reason)));</script>"
RESULT_HOOK = """<script>document.addEventListener('DOMContentLoaded', () => {
  const scope=window.RamnetRuntime.createScope(document);
  const frame=()=>{ window.smokeFrameCount++; scope.requestAnimationFrame(frame); };
  window.smokeFrameCount=0;
  scope.requestAnimationFrame(frame);
});setTimeout(() => {
  const figures=[...document.querySelectorAll('.embedded-exhibit[data-exhibit]')];
  const tables=[...document.querySelectorAll('.experiment-table')];
  const output={errors:smokeErrors, runtime:!!window.RamnetRuntime,
    reduced:matchMedia('(prefers-reduced-motion: reduce)').matches,
    frames:window.smokeFrameCount,
    figures:figures.map(host=>({name:host.dataset.exhibit,
      mounted:!!host.shadowRoot?.querySelector('.exhibit-root'),
      error:host.textContent.includes('Unable to load')})),
    tables:tables.map(table=>({name:table.dataset.benchmark,
      headers:table.tHead.rows.length, groups:table.tBodies.length,
      ranked:[...table.tBodies].every(body=>{
        const rows=[...body.rows].filter(row=>!row.classList.contains('experiment-scale'));
        return [...table.tHead.querySelectorAll('th[data-column-index]')].every((_,index)=>{
          const cells=rows.map(row=>row.cells[index+1]);
          const distinct=new Set(cells.map(cell=>Number.parseFloat(cell.textContent)));
          return cells.some(cell=>cell.querySelector('strong')) &&
            (distinct.size<2 || cells.some(cell=>cell.querySelector('.runner-up')));
        });
      })})),
    overflow:document.documentElement.scrollWidth>innerWidth+2,
    standalone:document.body.className,
    probeError:!!document.querySelector('.probe-error'),
    scene:!!document.querySelector('#scene, #slotField, .case-card')};
  const result=document.createElement('pre');result.id='smoke-result';
  result.textContent=JSON.stringify(output);document.body.append(result);
}, 2500);</script>"""


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


def check_page(source, url, width, profile, reduced=False):
    path = source.with_name(f"_smoke_{source.name}")
    markup = source.read_text(encoding="utf-8")
    markup = markup.replace("<head>", "<head>" + ERROR_HOOK, 1)
    markup = markup.replace("</body>", RESULT_HOOK + "</body>", 1)
    path.write_text(markup, encoding="utf-8")
    try:
        address = path.as_uri() if url is None else url + path.relative_to(ROOT).as_posix()
        command = [
            str(CHROME), "--headless=new", "--no-sandbox", "--disable-gpu",
            f"--window-size={width},900", "--virtual-time-budget=6500",
            f"--user-data-dir={profile}", "--dump-dom", address,
        ]
        if reduced:
            command.insert(-2, "--force-prefers-reduced-motion=reduce")
        result = subprocess.run(command, capture_output=True, text=True,
                                encoding="utf-8", errors="replace", timeout=50)
        match = re.search(r'<pre id="smoke-result">(.*?)</pre>', result.stdout, re.S)
        if not match:
            raise RuntimeError(f"Chrome returned no result for {source.name}: {result.stderr[-500:]}")
        state = json.loads(html.unescape(match.group(1)))
        if state["errors"] or not state["runtime"] or state["probeError"]:
            raise RuntimeError(f"{source.name}: {state}")
        if reduced and (not state["reduced"] or state["frames"] != 1):
            raise RuntimeError(f"Reduced-motion scheduling failed: {state}")
        if source.name == "index.html":
            if len(state["figures"]) != 8 or not all(item["mounted"] and not item["error"] for item in state["figures"]):
                raise RuntimeError(f"Figures failed: {state['figures']}")
            if [(item["headers"], item["groups"]) for item in state["tables"]] != [(1, 2), (2, 2), (1, 2)]:
                raise RuntimeError(f"Tables failed: {state['tables']}")
            if any(not item["ranked"] for item in state["tables"]):
                raise RuntimeError(f"Ranking failed: {state['tables']}")
            if width <= 500 and state["overflow"]:
                raise RuntimeError("The narrow page overflows horizontally")
        elif not state["scene"]:
            raise RuntimeError(f"Missing scene: {source.name}")
        mode = "reduced motion" if reduced else f"{width}px"
        print(f"OK {source.relative_to(ROOT)} ({'file' if url is None else 'HTTP'}, {mode})")
    finally:
        path.unlink(missing_ok=True)


def main():
    if not Path(CHROME).exists():
        raise SystemExit(f"Chrome not found: {CHROME}")
    server = ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(QuietHandler, directory=str(ROOT)))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        with tempfile.TemporaryDirectory(prefix="ramnet-smoke-") as profile:
            url = f"http://127.0.0.1:{server.server_port}/"
            check_page(ROOT / "index.html", url, 1366, profile)
            check_page(ROOT / "index.html", None, 500, profile)
            check_page(ROOT / "index.html", url, 1366, profile, reduced=True)
            for name in ("attn_cmp", "ramnet_arch", "product_softmax", "cape",
                         "gsu", "cal_pipeline", "niah_probe", "head_probe"):
                check_page(ROOT / "animations" / f"{name}.html", None, 900, profile)
    finally:
        server.shutdown()
        thread.join()


if __name__ == "__main__":
    main()
