const reticle = document.getElementById("reticle");

document.addEventListener("mousemove", (e) => {
  reticle.style.left = `${e.clientX}px`;
  reticle.style.top = `${e.clientY}px`;
});

document.addEventListener(
  "mousedown",
  async (e) => {
    e.preventDefault();
    e.stopPropagation();
    // Use screen coordinates for WindowFromPoint
    await window.keycode.pickClick(e.screenX, e.screenY);
  },
  true
);

document.addEventListener("keydown", async (e) => {
  if (e.key === "Escape") {
    e.preventDefault();
    await window.keycode.pickCancel();
  }
});
