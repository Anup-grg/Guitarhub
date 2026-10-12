/* GuitarHub — minimal vanilla behaviors: nav, tabs, votes, upload wizard. */
(function () {
  "use strict";

  var $ = function (s, c) { return (c || document).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };

  /* ---- mobile navigation ------------------------------------------------ */
  var navToggle = $("[data-nav-toggle]");
  var navMenu = $("[data-nav-menu]");
  if (navToggle && navMenu) {
    navToggle.addEventListener("click", function () {
      var open = navMenu.classList.toggle("is-open");
      navToggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
  }

  /* ---- tabs / segmented controls --------------------------------------- */
  $$("[data-tabs]").forEach(function (group) {
    var scope = group.getAttribute("data-tabs");
    $$("[data-tab]", group).forEach(function (btn) {
      btn.addEventListener("click", function () {
        var target = btn.getAttribute("data-tab");
        $$("[data-tab]", group).forEach(function (b) {
          var active = b === btn;
          b.classList.toggle("is-active", active);
          if (b.getAttribute("role") === "tab") b.setAttribute("aria-selected", active ? "true" : "false");
          else b.setAttribute("aria-pressed", active ? "true" : "false");
        });
        $$('[data-tab-panel][data-tab-scope="' + scope + '"]').forEach(function (panel) {
          panel.hidden = panel.getAttribute("data-tab-panel") !== target;
        });
      });
    });
  });

  /* ---- up / down vote widgets ------------------------------------------ */
  $$("[data-vote]").forEach(function (widget) {
    var scoreEl = $("[data-vote-score]", widget);
    var base = parseInt(widget.getAttribute("data-vote-base") || "0", 10);
    var state = 0;
    function render() {
      if (scoreEl) scoreEl.textContent = (base + state).toLocaleString();
      $$("[data-vote-dir]", widget).forEach(function (b) {
        var dir = parseInt(b.getAttribute("data-vote-dir"), 10);
        var active = dir === state;
        b.classList.toggle("is-active", active);
        b.setAttribute("aria-pressed", active ? "true" : "false");
      });
    }
    $$("[data-vote-dir]", widget).forEach(function (b) {
      b.addEventListener("click", function () {
        var dir = parseInt(b.getAttribute("data-vote-dir"), 10);
        state = state === dir ? 0 : dir;
        render();
      });
    });
    render();
  });

  /* ---- live character counters ----------------------------------------- */
  $$("[data-count]").forEach(function (el) {
    var out = document.getElementById(el.getAttribute("data-count"));
    var update = function () { if (out) out.textContent = el.value.length; };
    el.addEventListener("input", update);
    update();
  });

  /* ---- upload wizard ---------------------------------------------------- */
  var wizard = $("[data-wizard]");
  if (!wizard) return;

  var pedalSelect = $("#wizard-pedal");
  var sectionSelect = $("#wizard-section");
  var cloudField = $("[data-cloud-field]");
  var fileField = $("[data-file-field]");
  var songFields = $("[data-song-fields]");
  var fileInput = $("#wizard-file");
  var dropzone = $("[data-dropzone]");
  var inspection = $("[data-inspection]");
  var irInput = $("#wizard-ir");
  var irList = $("[data-ir-list]");
  var irCount = $("[data-ir-count]");
  var form = $("[data-wizard-form]");
  var success = $("[data-success]");

  function isCloud() {
    if (!pedalSelect) return false;
    var opt = pedalSelect.options[pedalSelect.selectedIndex];
    return !!opt && opt.getAttribute("data-sharing") === "cloud";
  }
  function syncSharing() {
    var cloud = isCloud();
    if (cloudField) cloudField.hidden = !cloud;
    if (fileField) fileField.hidden = cloud;
  }
  function syncSection() {
    if (sectionSelect && songFields) songFields.hidden = sectionSelect.value !== "songs";
  }
  function fmtSize(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / 1048576).toFixed(2) + " MB";
  }
  function inspect(file) {
    if (!inspection || !file) return;
    var nameOut = $("[data-ins-name]", inspection);
    var sizeOut = $("[data-ins-size]", inspection);
    var extOut = $("[data-ins-ext]", inspection);
    var deviceOut = $("[data-ins-device]", inspection);
    var dupOut = $("[data-ins-duplicate]", inspection);
    if (nameOut) nameOut.textContent = file.name;
    if (sizeOut) sizeOut.textContent = fmtSize(file.size);
    if (extOut) {
      var dot = file.name.lastIndexOf(".");
      extOut.textContent = dot > -1 ? file.name.slice(dot).toLowerCase() : "—";
    }
    if (deviceOut && pedalSelect) deviceOut.textContent = pedalSelect.value;
    if (dupOut) dupOut.hidden = !/(eruption|numb|ambient|metal)/i.test(file.name);
    inspection.hidden = false;
  }
  function renderIRs() {
    if (!irList) return;
    var items = $$("[data-ir-item]", irList);
    if (irCount) irCount.textContent = items.length;
    if (irInput) irInput.disabled = items.length >= 4;
    var empty = $("[data-ir-empty]", irList.parentNode);
    if (empty) empty.hidden = items.length > 0;
  }

  if (pedalSelect) pedalSelect.addEventListener("change", syncSharing);
  if (sectionSelect) sectionSelect.addEventListener("change", syncSection);
  if (fileInput) fileInput.addEventListener("change", function () { inspect(fileInput.files[0]); });

  if (dropzone) {
    ["dragenter", "dragover"].forEach(function (ev) {
      dropzone.addEventListener(ev, function (e) { e.preventDefault(); dropzone.classList.add("is-drag"); });
    });
    ["dragleave", "drop"].forEach(function (ev) {
      dropzone.addEventListener(ev, function (e) { e.preventDefault(); dropzone.classList.remove("is-drag"); });
    });
    dropzone.addEventListener("drop", function (e) {
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) inspect(f);
    });
  }

  if (irInput && irList) {
    irInput.addEventListener("change", function () {
      var room = 4 - irList.querySelectorAll("[data-ir-item]").length;
      Array.prototype.slice.call(irInput.files).slice(0, Math.max(0, room)).forEach(function (f) {
        var li = document.createElement("li");
        li.className = "ir-item";
        li.setAttribute("data-ir-item", "");
        li.innerHTML =
          '<span class="ir-name"><span class="mono">' + f.name.replace(/[<>&]/g, "") + '</span></span>' +
          '<button class="icon-btn" type="button" data-ir-remove aria-label="Remove impulse response file">' +
          '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>' +
          '</button>';
        li.querySelector("[data-ir-remove]").addEventListener("click", function () { li.remove(); renderIRs(); });
        irList.appendChild(li);
      });
      irInput.value = "";
      renderIRs();
    });
  }

  if (form && success) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      form.hidden = true;
      success.hidden = false;
      window.scrollTo({ top: 0, behavior: "smooth" });
      if (typeof success.focus === "function") { success.setAttribute("tabindex", "-1"); success.focus(); }
    });
  }

  syncSharing();
  syncSection();
  renderIRs();
})();
