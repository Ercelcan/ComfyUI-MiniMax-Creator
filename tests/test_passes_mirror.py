"""`state.js` and `compile.py` still agree about what a pass is.

A pass — a run of merged segments generated as one clip — is decided twice: in
`state.js`, which draws the casing and counts the generations before anything is
queued, and in `compile.py`, which builds one payload per pass at queue time. The
duplication is the same deliberate one the other mirror tests cover, and the
failure it hides is quiet: a strip that says "2 generations" and queues 3, with
the cut times drawn against passes the compiler never made.

So this asserts the mirror through the blob, which is the only thing the two
halves actually share. `state.js` builds and serializes; `compile.py` reads what
it wrote. `compile.py` is authoritative.

    python3 tests/test_passes_mirror.py

Skips itself if node is not installed.
"""

import importlib.util
import json
import os
import shutil
import subprocess
import sys
import types

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MIRROR = os.path.join(ROOT, "js", "minimax_creator", "state.js")

if shutil.which("node") is None:
    print("skipped: node is not installed")
    sys.exit(0)

package = types.ModuleType("mmcpkg")
package.__path__ = [ROOT]
sys.modules["mmcpkg"] = package
for name in ("canvas", "contextir", "compile"):
    spec = importlib.util.spec_from_file_location(f"mmcpkg.{name}", os.path.join(ROOT, f"{name}.py"))
    module = importlib.util.module_from_spec(spec)
    sys.modules[f"mmcpkg.{name}"] = module
    spec.loader.exec_module(module)
compiler = sys.modules["mmcpkg.compile"]
canvas_mod = sys.modules["mmcpkg.canvas"]

# Every shape worth asking about, as (render, merge flags). The flags are what a
# saved blob carries; `render` is what one saved before they existed carries,
# and both have to come out the same passes on both sides.
CASES = [
    ["chained", [False]],
    ["chained", [False, False, False]],
    ["chained", [False, True, False]],
    ["chained", [False, True, True]],
    ["chained", [False, False, True, False, True]],
    ["chained", [True, False, False]],          # ignored on segment 1
    ["single", [False, False, False]],          # saved before the flags existed
    ["single", [False, True, True]],
]

SCRIPT = """
const s = await import(process.argv[1]);
const out = [];
for (const [render, flags] of JSON.parse(process.argv[2])) {
  // Built the way the node builds one: a blob in, `parseTimeline` out. That is
  // where a timeline saved as one pass grows its flags, so the case list can
  // hold both spellings of the same strip.
  const blob = JSON.stringify({
    version: 2, render, prompt: "p", aspect: "16:9", short_edge: 768,
    segments: flags.map((merge, index) => ({
      prompt: "shot " + (index + 1), duration_s: 5, assets: [], loras: [],
      ...(merge ? { merge: true } : {}),
    })),
  });
  const timeline = s.parseTimeline(blob);
  s.syncTimeline(timeline);
  out.push({
    passes: s.passes(timeline).map((pass) => [pass.start, pass.end]),
    frames: s.timelineFrames(timeline),
    render: timeline.render,
    // What the node writes back, and therefore all compile.py ever sees.
    blob: s.serializeTimeline(timeline),
  });
}
console.log(JSON.stringify(out));
"""

result = subprocess.run(
    ["node", "--input-type=module", "--eval", SCRIPT, MIRROR, json.dumps(CASES)],
    capture_output=True, text=True)
if result.returncode != 0:
    print("failed to read state.js:\n" + result.stderr.strip())
    sys.exit(1)
mirror = json.loads(result.stdout)

FAILURES = []


def check(label, got, want):
    if got != want:
        FAILURES.append(f"{label}: state.js says {got!r}, compile.py says {want!r}")


for (render, flags), seen in zip(CASES, mirror):
    name = f"{render} {''.join('m' if f else '.' for f in flags)}"
    data = json.loads(seen["blob"])
    runs = [list(run) for run in compiler.timeline_runs(data)]
    check(f"{name}: passes", seen["passes"], runs)
    # And the number the bar reports as the queue's cost is the number of
    # payloads the queue actually builds.
    payloads = compiler.timeline_payloads(data)
    check(f"{name}: generations", len(seen["passes"]), len(payloads))
    # The finished length, which is snapped per pass rather than per segment and
    # is the one number a merged run visibly changes.
    frames = sum(canvas_mod.frames_for_seconds(p["request"]["duration_s"]) for p in payloads)
    check(f"{name}: frames", seen["frames"], frames)
    # A strip that turned out to be one pass end to end is still called that, so
    # everything that reads the old key keeps working.
    check(f"{name}: render", seen["render"], compiler.render_mode(data))

if FAILURES:
    print(f"{len(FAILURES)} disagreement(s):")
    for failure in FAILURES:
        print("  -", failure)
    sys.exit(1)
print(f"state.js mirrors compile.py across {len(CASES)} strips")
