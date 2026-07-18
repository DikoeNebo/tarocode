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

window.keycode.onPickHint?.((data) => {
  if (data?.text && hint) {
    hint.innerHTML = data.text
      .replace(/Esc/g, "<kbd>Esc</kbd>")
      .replace(/полю ввода/g, "<strong>полю ввода</strong>")
      .replace(/агенту\/вкладке/g, "<strong>агенту/вкладке</strong>");
  }
  document.body.classList.toggle("phase-focus", data?.phase === "focus");
});
