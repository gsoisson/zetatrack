chrome.webRequest.onBeforeRequest.addListener(
  zetaLogCallback,
  { urls: ["https://arithmetic.zetamac.com/log"] },
  ["requestBody"]
);

// ---------- UI error banner on Zetamac tab(s) ----------
function displayErrorOnZetaTabs(error) {
  findZetaTabs()
    .then((tabs) => tabs.forEach((t) => displayErrorOnTab(t.id, String(error))))
    .catch(console.error);
}

function findZetaTabs() {
  return chrome.tabs.query({ url: "https://arithmetic.zetamac.com/*" });
}

function displayErrorOnTab(tabId, error) {
  chrome.scripting.executeScript(
    { target: { tabId }, func: displayError, args: [error] },
    () => console.log("Displayed Error")
  );
}

function displayError(error) {
  const div = document.createElement("div");
  div.style.display = "inline-block";
  div.style.backgroundColor = "red";
  div.style.color = "white";
  div.style.fontSize = "15px";
  div.style.borderRadius = "10px";
  div.style.position = "absolute";
  div.style.bottom = "20px";
  div.style.left = "20px";
  div.style.fontWeight = "bold";
  div.style.padding = "10px";
  div.innerText = error;
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 5000);
}

// ---------- Zetatrack callback ----------
function zetaLogCallback(logDetails) {
  try {
    const fd = logDetails?.requestBody?.formData;

    const key = fd?.key?.[0];
    if (!key) return;

    // Only default Zetamac (original Zetatrack behavior)
    if (key !== "a7220a92") return;

    const problemLogStr = fd?.problemLog?.[0];
    if (!problemLogStr) return;

    let arr;
    try {
      arr = JSON.parse(problemLogStr);
    } catch {
      console.warn("Zetatrack: couldn't parse problemLog JSON");
      return;
    }

    // Count only completed problems (last entry often has timeMs = -1 / incomplete)
    const completed = arr.filter((x) => (x?.timeMs ?? -1) >= 0);
    const score = completed.length;
    const ts = Date.now();

    const stats = computeStats(completed);
    const { keystrokeErrorRate, attemptErrorRate } = computeErrorRates(completed, score);

    console.log(
      `Zetalog: score=${score} keystrokeErrorRate=${keystrokeErrorRate} attemptErrorRate=${attemptErrorRate}`,
      stats
    );

    addValuesToSheet(ts, score, keystrokeErrorRate, attemptErrorRate, stats)
      .then((res) => console.log("Webhook status:", res.status))
      .catch((err) => {
        console.error(err);
        displayErrorOnZetaTabs(err.message ?? String(err));
      });
  } catch (err) {
    console.error("Zetatrack: zetaLogCallback crashed", err);
    displayErrorOnZetaTabs(err.message ?? String(err));
  }
}

// ---------- Stats ----------
function detectOp(problem) {
  if (typeof problem !== "string") return null;
  if (problem.includes("+")) return "add";
  if (problem.includes("\u00d7") || problem.includes("*")) return "mul";
  if (problem.includes("\u00f7") || problem.includes("/")) return "div";
  // "-" last so it doesn't catch negative-looking things in other ops
  if (problem.includes("-")) return "sub";
  return null;
}

function computeErrorRates(completed, score) {
  let totalErrors = 0;
  let wrongAttempts = 0;
  for (const x of completed) {
    const typed = Array.isArray(x?.entry) ? x.entry.length : 0;
    const expected = String(x?.answer ?? "").length;
    const errs = Math.max(0, typed - expected);
    totalErrors += errs;
    if (errs > 0) wrongAttempts += 1;
  }
  const keyDenom = score + totalErrors;
  const keystrokeErrorRate = keyDenom ? Number((totalErrors / keyDenom).toFixed(4)) : 0;
  const attemptErrorRate = score ? Number((wrongAttempts / score).toFixed(4)) : 0;
  return { keystrokeErrorRate, attemptErrorRate };
}

function computeStats(completed) {
  const buckets = { add: [], sub: [], mul: [], div: [] };
  for (const x of completed) {
    const op = detectOp(x?.problem);
    if (op && Number.isFinite(x?.timeMs)) buckets[op].push(x);
  }
  const mean = (xs) =>
    xs.length ? Math.round(xs.reduce((s, e) => s + e.timeMs, 0) / xs.length) : "";

  const top3 = [...completed]
    .filter((x) => Number.isFinite(x?.timeMs))
    .sort((a, b) => b.timeMs - a.timeMs)
    .slice(0, 3)
    .map((x) => x.problem);

  return {
    meanAdd: mean(buckets.add),
    meanSub: mean(buckets.sub),
    meanMul: mean(buckets.mul),
    meanDiv: mean(buckets.div),
    top1: top3[0] ?? "",
    top2: top3[1] ?? "",
    top3: top3[2] ?? "",
  };
}

// ---------- Webhook writer ----------
const WEB_APP_URL =
  "https://script.google.com/macros/s/AKfycbyFiI8Hsp2eQ5UzAESkrbvP2qIPmdpLEIZSICsd-BsYSc8MIsCYDdaPpqtYOVxH1MaQ/exec";
const SECRET = "choose-a-long-random-string"; // must match Apps Script

function addValuesToSheet(ts, score, keystrokeErrorRate, attemptErrorRate, stats) {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.get(["zetatrackSheetId"], (res) => {
      const sheetId = res.zetatrackSheetId;
      if (!sheetId) return reject(new Error("No SheetID found (zetatrackSheetId)"));

      fetch(WEB_APP_URL, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({
          ts,
          score,
          keystrokeErrorRate,
          attemptErrorRate,
          sheetId,
          secret: SECRET,
          ...stats,
        }),
      })
        .then(() => resolve({ status: "sent" }))
        .catch(reject);
    });
  });
}
