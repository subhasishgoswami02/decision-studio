// Runs before first paint so the page never flashes the wrong theme.
// Dark is the default; a visitor's own choice is remembered.
(function () {
  var t = "dark";
  try {
    if (window.localStorage.getItem("ds-theme") === "light") t = "light";
  } catch (e) {}
  document.documentElement.setAttribute("data-theme", t);
  if (t === "light") {
    document.addEventListener("DOMContentLoaded", function () {
      var m = document.querySelector('meta[name="theme-color"]');
      if (m) m.setAttribute("content", "#F7F9FC");
    });
  }
})();
