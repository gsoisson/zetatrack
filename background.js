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
    const score = arr.filter((x) => (x?.timeMs ?? -1) >= 0).length;
    const ts = Date.now();

    console.log(`Zetalog: score=${score}`);

    addValuesToSheet(ts, score)
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

// ---------- Webhook writer ----------
const WEB_APP_URL =
  "https://script.google.com/macros/s/AKfycbwz4qmbKrslzgk4qMeP9wC_QtVxzKiykypgKw0WalRmQvEZpsv1WYcdovu2oTy4ZrH_sw/exec";
const SECRET = "choose-a-long-random-string"; // must match Apps Script

function addValuesToSheet(ts, score) {
  return new Promise((resolve, reject) => {
    chrome.storage.sync.get(["zetatrackSheetId"], (res) => {
      const sheetId = res.zetatrackSheetId;
      if (!sheetId) return reject(new Error("No SheetID found (zetatrackSheetId)"));

      fetch(WEB_APP_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" }, // avoid preflight
        body: JSON.stringify({ ts, score, sheetId, secret: SECRET }),
      })
        .then((r) => {
          // Optional: surface non-200 errors
          if (!r.ok) {
            return r.text().then((t) =>
              reject(new Error(`Webhook failed (${r.status}): ${t || "no body"}`))
            );
          }
          resolve(r);
        })
        .catch(reject);
    });
  });
}