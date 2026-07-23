const reticle = document.getElementById("reticle");
const hint = document.getElementById("hint");

document.addEventListener("mousemove", (e) => {
  reticle.style.left = `${e.clientX}px`;
  reticle.style.top = `${e.clientY}px`;
});

document.addEventListener(
  "mousedown",
  async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const result = await window.keycode.pickClick(e.screenX, e.screenY);
    // continue = two-step pick, keep overlay open
    if (result?.continue) return;
  },
  true
);

document.addEventListener("keydown", async (e) => {
  if (e.key === "Escape") {
    e.preventDefault();
    await window.keycode.pickCancel();
  }
});

function setHintText(text) {
  if (!hint) return;
  hint.textContent = "";
  const parts = String(text || "").split(/(Esc)/g);
  for (const part of parts) {
    if (part === "Esc") {
      const kbd = document.createElement("kbd");
      kbd.textContent = "Esc";
      hint.appendChild(kbd);
    } else if (part) {
      hint.appendChild(document.createTextNode(part));
    }
  }
}

(async () => {
  try {
    const data = await window.keycode.getState();
    if (data?.i18n) window.I18n.setPack(data.i18n);
    window.I18n.applyDom();
  } catch {
    /* ignore */
  }
})();

window.keycode.onPickHint?.((data) => {
  if (data?.text) setHintText(data.text);
  document.body.classList.toggle("phase-focus", data?.phase === "focus");
});
