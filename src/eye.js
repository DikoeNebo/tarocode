const btn = document.getElementById("eye");

btn.addEventListener("click", async () => {
  const state = await window.keycode.toggleDeck();
  const visible = state?.visible ?? state;
  const pinned = state?.pinned;
  btn.classList.toggle("open", !!visible);
  btn.classList.toggle("pinned", !!pinned);
  btn.title = pinned
    ? "Закреплено — нажмите чтобы скрыть (F9)"
    : "F9 — закрепить / скрыть · или подведите курсор к краю";
});

window.keycode.onDeckVisibility((data) => {
  const visible = typeof data === "object" ? data.visible : data;
  const pinned = typeof data === "object" ? data.pinned : false;
  btn.classList.toggle("open", !!visible);
  btn.classList.toggle("pinned", !!pinned);
});
