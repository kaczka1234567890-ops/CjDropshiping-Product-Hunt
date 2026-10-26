window.chrome = {
  storage: { local: { get: async function () { return {}; }, set: async function () {} } },
  tabs: { create: function () {} },
  runtime: { getURL: function (p) { return p; } },
  windows: { create: function () {} }
};
window.addEventListener("load", function () {
  setTimeout(function () {
    try {
      queryInput.value = document.body.getAttribute("data-seed") || "gloves";
      runSearch();
      var sb = document.querySelector("#searchBox");
      if (sb && sb.open === false) sb.open = true;
    } catch (e) {}
  }, 400);
});
