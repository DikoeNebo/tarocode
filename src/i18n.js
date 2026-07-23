/**
 * Renderer i18n helper. Pack comes from getState().i18n or locale-changed.
 */
(function () {
  let messages = {};
  let tarot = { cards: {}, groups: {} };
  let uiLocale = "en";
  let arcanaLocale = "en";

  function formatMessage(template, vars) {
    let s = String(template ?? "");
    if (!vars || typeof vars !== "object") return s;
    for (const [k, v] of Object.entries(vars)) {
      s = s.split(`{${k}}`).join(String(v ?? ""));
    }
    return s;
  }

  function t(key, vars) {
    const template = messages[key];
    if (template == null) return key;
    return formatMessage(template, vars);
  }

  function setPack(pack) {
    if (!pack) return;
    messages = pack.messages && typeof pack.messages === "object" ? pack.messages : {};
    tarot =
      pack.tarot && typeof pack.tarot === "object"
        ? pack.tarot
        : { cards: {}, groups: {} };
    if (!tarot.cards) tarot.cards = {};
    if (!tarot.groups) tarot.groups = {};
    uiLocale = pack.uiLocale || "en";
    arcanaLocale = pack.arcanaLocale || "en";
    document.documentElement.lang = uiLocale;
  }

  function tarotName(id) {
    return (tarot.cards && tarot.cards[id]) || id;
  }

  function tarotGroup(groupId) {
    return (tarot.groups && tarot.groups[groupId]) || groupId;
  }

  function applyDom(root) {
    const scope = root || document;
    scope.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.getAttribute("data-i18n");
      if (key) el.textContent = t(key);
    });
    scope.querySelectorAll("[data-i18n-html]").forEach((el) => {
      const key = el.getAttribute("data-i18n-html");
      if (key) el.innerHTML = t(key);
    });
    scope.querySelectorAll("[data-i18n-title]").forEach((el) => {
      const key = el.getAttribute("data-i18n-title");
      if (key) el.setAttribute("title", t(key));
    });
    scope.querySelectorAll("[data-i18n-aria]").forEach((el) => {
      const key = el.getAttribute("data-i18n-aria");
      if (key) el.setAttribute("aria-label", t(key));
    });
    scope.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
      const key = el.getAttribute("data-i18n-placeholder");
      if (key) el.setAttribute("placeholder", t(key));
    });
  }

  function getUiLocale() {
    return uiLocale;
  }

  function getArcanaLocale() {
    return arcanaLocale;
  }

  window.I18n = {
    t,
    setPack,
    applyDom,
    tarotName,
    tarotGroup,
    getUiLocale,
    getArcanaLocale,
  };
})();
