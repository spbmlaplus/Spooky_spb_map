/* Логика карты. Тексты и цвета — в settings.js, оформление — в style.css, подложка — в basemap.js */
(function () {
  "use strict";
  var S = window.SETTINGS, D = window.MAPDATA;
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  var isMobile = function () { return window.innerWidth <= 720; };
  var plural = function (n, one, few, many) { var a = n % 10, b = n % 100; return a === 1 && b !== 11 ? one : a >= 2 && a <= 4 && (b < 12 || b > 14) ? few : many; };
  var rnd = function (arr) { return arr[Math.floor(Math.random() * arr.length)]; };

  // ------------------------------------------------------------------ карта и подложка
  var HOME = { center: S.map.center, zoom: S.map.zoom };
  var map = L.map("map", {
    center: HOME.center, zoom: HOME.zoom, minZoom: S.map.minZoom, maxZoom: S.map.maxZoom,
    zoomControl: false, zoomSnap: 0.25, wheelPxPerZoomLevel: 90
  });
  window.MAP = map;
  map.attributionControl.setPrefix(false);
  map.attributionControl.setPosition("topright");
  var hasWebGL = (function () { try { var c = document.createElement("canvas"); return !!(c.getContext("webgl2") || c.getContext("webgl")); } catch (e) { return false; } })();
  if (window.maplibregl && L.maplibreGL && hasWebGL && window.BASEMAP_STYLE) {
    L.maplibreGL({ style: window.BASEMAP_STYLE, attribution: S.basemap.attribution, interactive: false }).addTo(map);
  } else {
    L.tileLayer(S.basemap.fallback_url, { key: S.basemap.fallback_key || "", subdomains: "abcd", maxNativeZoom: 18, maxZoom: 20,
      attribution: "&copy; OpenStreetMap &copy; CARTO" }).addTo(map);
  }
  function pane(name, z, passive) { var p = map.createPane(name); p.style.zIndex = z; if (passive) p.style.pointerEvents = "none"; }
  pane("bubbles", 410); pane("heat", 420, true); pane("svc", 430); pane("labels", 450, true); pane("pins", 600);

  var TYPES = {};
  S.legend.items.forEach(function (it) { TYPES[it.type] = it; });
  var locById = {};
  D.location.features.forEach(function (f) { locById[f.properties.fid] = f; });
  var CALM = "Спокойный район";
  var canHover = window.matchMedia ? window.matchMedia("(hover: hover)").matches : true;

  // ------------------------------------------------------------------ состояние
  var selected = null;          // открытый район
  var level = S.slider_start;   // уровень страха 0..2
  var solo = {};                // выбранные в легенде типы (подсвечены только они)
  var focusType = null;         // тип под курсором в легенде
  var soloOn = function () { return Object.keys(solo).length > 0; };

  // ------------------------------------------------------------------ районы
  function isDim(f) {
    var t = f.properties.type;
    return (selected && selected.feature !== f) || (focusType && t !== focusType) || (soloOn() && !solo[t]);
  }
  var heatMode = false;
  function bubbleStyle(f) {
    var t = TYPES[f.properties.type] || { color: "rgba(120,120,120,.5)", stroke: "#777" };
    if (heatMode) return { fillColor: t.color, fillOpacity: 0.18, color: t.stroke, weight: 1, opacity: 0.3 };
    var faint = soloOn() && !solo[f.properties.type];
    var other = selected && selected.feature !== f;
    var hoverDim = focusType && f.properties.type !== focusType;
    if (faint) return { fillColor: t.color, fillOpacity: 0.05, color: t.stroke, weight: 1, opacity: 0.1 };
    if (other) return { fillColor: t.color, fillOpacity: 0.16, color: t.stroke, weight: 1, opacity: 0.22 };
    if (hoverDim) return { fillColor: t.color, fillOpacity: 0.22, color: t.stroke, weight: 1.2, opacity: 0.3 };
    return { fillColor: t.color, fillOpacity: 1, color: t.stroke, weight: 1.7, opacity: 1 };
  }
  var bubbleGroup = L.layerGroup().addTo(map);
  var bubbleLayers = [];
  L.geoJSON(D.bubbles, {
    pane: "bubbles", renderer: L.svg({ pane: "bubbles" }), style: bubbleStyle,
    onEachFeature: function (f, l) {
      bubbleLayers.push(l);
      l.on("mouseover", function () { if (!canHover || heatMode) return; if (l._path) l._path.classList.add("hov"); l.bringToFront(); });
      l.on("mouseout", function () { if (l._path) l._path.classList.remove("hov"); if (selected && selected !== l) selected.bringToFront(); });
      l.on("click", function (e) { if (heatMode) return; L.DomEvent.stopPropagation(e); openDistrict(l); });
    }
  });
  var byId = {};
  bubbleLayers.forEach(function (l) { byId[l.feature.properties._id] = l; });

  // ------------------------------------------------------------------ подписи: только те, что помещаются в район
  // перенос только между словами, не больше 3 строк, размер зависит от района; если не влезает или налезает на соседа — скрыта
  var LABEL = { minSize: 8, maxSize: 22, k: 0.28, maxLines: 4, lineHeight: 1.12 };
  var labels = [];
  var labelGroup = L.layerGroup().addTo(map);
  bubbleLayers.forEach(function (l) {
    var p = l.feature.properties, txt = p.name_2 || p.name;
    if (!txt || !p._lp) return;
    var m = L.marker(p._lp, { pane: "labels", interactive: false, keyboard: false,
      icon: L.divIcon({ className: "lbl-wrap", iconSize: [0, 0], html: '<div class="lbl' + (p.type === CALM ? " calm" : "") + '">' + esc(txt) + "</div>" }) });
    labels.push({ m: m, owner: l, r: p._lr, lat: p._lp[0] });
  });
  function fitLabels() {
    var z = map.getZoom(), shown = [];
    labels.forEach(function (o) {
      if (!labelGroup.hasLayer(o.m)) return;
      var d = o.m.getElement() && o.m.getElement().firstChild; if (!d) return;
      o.d = d;
      var mpp = 156543.03392 * Math.cos(o.lat * Math.PI / 180) / Math.pow(2, z);
      var r = o.r / mpp, w = 1.95 * r, h = 1.6 * r;
      var s = Math.round(Math.max(LABEL.minSize, Math.min(LABEL.maxSize, r * LABEL.k)));
      d.style.width = Math.max(w, 1) + "px"; d.style.fontSize = s + "px";
      var bad = function () { return d.scrollHeight > Math.min(h, s * LABEL.lineHeight * LABEL.maxLines) + 2 || d.scrollWidth > w + 1; };
      while (s > LABEL.minSize && bad()) { s -= 1; d.style.fontSize = s + "px"; }
      o.ok = w >= 30 && !bad();
      var t = o.owner.feature.properties.type;
      if (soloOn() && !solo[t]) o.ok = false;
      if (o.ok) shown.push(o);
    });
    // убираем наложения: приоритет у крупных районов
    var rects = [];
    shown.sort(function (a, b) { return b.r - a.r; }).forEach(function (o) {
      var r = o.d.getBoundingClientRect();
      for (var i = 0; i < rects.length; i++) {
        var q = rects[i];
        if (r.left < q.right + 2 && r.right + 2 > q.left && r.top < q.bottom + 2 && r.bottom + 2 > q.top) { o.ok = false; break; }
      }
      if (o.ok) rects.push(r);
    });
    labels.forEach(function (o) { if (o.d) o.d.classList.toggle("hide", !o.ok); });
    restyleLabels();
  }
  function restyleLabels() {
    labels.forEach(function (o) {
      if (!o.d) return;
      var dim = (selected && selected !== o.owner) || (focusType && o.owner.feature.properties.type !== focusType);
      o.d.classList.toggle("dim", !!dim);
    });
  }
  map.on("zoomend", fitLabels);

  function restyle() {
    bubbleLayers.forEach(function (l) { l.setStyle(bubbleStyle(l.feature)); });
    restyleLabels();
    if (selected) selected.bringToFront();
  }

  // ------------------------------------------------------------------ фильтр по уровню страха
  function applyFilter() {
    bubbleGroup.clearLayers(); labelGroup.clearLayers();
    bubbleLayers.forEach(function (l) { if (Number(l.feature.properties.top) <= level) bubbleGroup.addLayer(l); });
    labels.forEach(function (o) { if (bubbleGroup.hasLayer(o.owner)) labelGroup.addLayer(o.m); });
    if (selected && !bubbleGroup.hasLayer(selected)) closePanel();
    restyle(); fitLabels(); renderChips();
  }
  function ensureVisible(l) {   // если район скрыт ползунком — поднимаем уровень
    var t = Number(l.feature.properties.top);
    if (t > level) setLevel(t, false);
    if (soloOn() && !solo[l.feature.properties.type]) clearSolo(true);
  }

  // ------------------------------------------------------------------ отступы под панели
  function pads() {
    if (isMobile()) return { tl: [16, 130], br: [16, Math.round(window.innerHeight * 0.64) + 16] };
    var pw = $("panel").classList.contains("open") || selected ? $("panel").offsetWidth + 32 : 0;
    return { tl: [40, $("fear").offsetHeight + 40], br: [pw + 40, $("hud").offsetHeight + 40] };
  }
  function flyToPoint(latlng, z) {
    var p = pads(), off = L.point((p.tl[0] - p.br[0]) / 2, (p.tl[1] - p.br[1]) / 2);
    map.flyTo(map.unproject(map.project(latlng, z).subtract(off), z), z, { duration: 0.9 });
  }

  // ------------------------------------------------------------------ панель района
  function visibleList() { return bubbleLayers.filter(function (l) { return bubbleGroup.hasLayer(l) && (!soloOn() || solo[l.feature.properties.type]); }); }
  function openDistrict(l, opts) {
    opts = opts || {};
    if (heatMode) setHeat(false);
    if (allHidden) setAllHidden(false);
    ensureVisible(l);
    map.closePopup();
    if (selected && selected._path) selected._path.classList.remove("sel");
    bubbleLayers.forEach(function (x) { if (x._path && x !== l) x._path.classList.remove("hov"); });
    selected = l;
    if (l._path) l._path.classList.add("sel");
    restyle();
    var p = l.feature.properties, t = TYPES[p.type] || {};
    var dot = $("p-type").querySelector("i");
    dot.style.background = t.color || "#888"; dot.style.borderColor = t.stroke || "#888";
    $("p-type").querySelector("b").textContent = p.type || "";
    $("p-type").querySelector("b").style.fontWeight = "400";
    var lv = Number(p.top);
    $("p-fear").textContent = S.fear_names[lv] || ""; $("p-fear").className = "fearchip l" + lv;
    $("p-title").textContent = p.name_2 || p.name || "";
    $("p-sub").textContent = p.name_2 ? (p.name || "") : "";
    var desc = $("p-desc");
    if (p.description) { desc.className = "p-desc"; desc.textContent = p.description; }
    else { desc.className = "p-desc empty"; desc.innerHTML = '<img src="ghost.svg" alt=""><span>' + esc(S.no_story) + "</span>"; }
    var objs = (p.objects || []).map(function (id) { return locById[id]; }).filter(Boolean);
    $("p-objects").hidden = !objs.length;
    $("p-objects-title").textContent = S.objects_title;
    $("p-list").innerHTML = "";
    objs.forEach(function (f) {
      var q = f.properties, li = document.createElement("li");
      li.className = "obj"; li.tabIndex = 0;
      li.innerHTML = '<span class="ph">' + (q.thumb ? '<img src="' + esc(q.thumb) + '" alt="" width="128" height="128" decoding="async">' : "") + "</span>" +
        "<span><b>" + esc(q.name) + "</b><small>" + esc([q.address, q.year].filter(Boolean).join(" · ")) + "</small></span>";
      var go = function () { focusObject(q.fid); };
      li.addEventListener("click", go);
      li.addEventListener("keydown", function (e) { if (e.key === "Enter") go(); });
      $("p-list").appendChild(li);
    });
    renderCrowd(p);
    renderNear(l);
    markVisited(p._id);
    var sw = $("p-swap"); sw.classList.remove("anim"); void sw.offsetWidth; sw.classList.add("anim");
    $("panel-inner").scrollTop = 0;
    $("panel").classList.add("open"); $("panel").setAttribute("aria-hidden", "false");
    document.body.classList.add("panel-open");
    if (!opts.noHash) { if (location.hash === "#d=" + p._id) {} else if (/#d=/.test(location.hash)) history.replaceState(null, "", "#d=" + p._id); else history.pushState(null, "", "#d=" + p._id); }
    var p2 = pads();
    map.flyToBounds(l.getBounds(), { paddingTopLeft: p2.tl, paddingBottomRight: p2.br, duration: 0.8, maxZoom: 15 });
    setTimeout(placeBubble, 480);
  }
  // соседние районы — чтобы продолжать прогулку
  function renderNear(l) {
    var c = l.feature.properties._lp;
    var near = bubbleLayers.filter(function (x) { return x !== l && bubbleGroup.hasLayer(x); })
      .map(function (x) { var q = x.feature.properties._lp; return { x: x, d: Math.pow(q[0] - c[0], 2) + Math.pow((q[1] - c[1]) * 0.5, 2) }; })
      .sort(function (a, b) { return a.d - b.d; }).slice(0, 4);
    var box = $("near-list"); box.innerHTML = "";
    $("p-near").hidden = !near.length;
    near.forEach(function (n) {
      var q = n.x.feature.properties, t = TYPES[q.type] || {};
      var b = document.createElement("button"); b.type = "button"; b.className = "near-item" + (visited[q._id] ? " seen" : "");
      b.innerHTML = '<i style="background:' + t.color + ";border-color:" + t.stroke + '"></i><span>' + esc(q.name_2 || q.name) + "</span>";
      b.addEventListener("click", function () { openDistrict(n.x); });
      box.appendChild(b);
    });
  }
  // сколько районов уже открыто (хранится только в этом браузере)
  var visited = {};
  try { visited = JSON.parse(localStorage.getItem("spb-dark-visited") || "{}") || {}; } catch (e) { visited = {}; }
  function markVisited(id) {
    if (visited[id]) return;
    visited[id] = 1;
    try { localStorage.setItem("spb-dark-visited", JSON.stringify(visited)); } catch (e) {}
    var n = Object.keys(visited).length, m = (S.visited_milestones || {})[String(n)];
    if (m) setTimeout(function () { say(esc(m), { secs: 5 }); }, 900);
  }
  window.addEventListener("popstate", function () {
    var d = /#d=(\d+)/.exec(location.hash);
    if (d && byId[d[1]]) openDistrict(byId[d[1]], { noHash: true }); else closePanel();
  });

  function closePanel() {
    if (!selected && !$("panel").classList.contains("open")) return;
    $("panel").classList.remove("open"); $("panel").setAttribute("aria-hidden", "true");
    document.body.classList.remove("panel-open");
    if (selected && selected._path) selected._path.classList.remove("sel");
    selected = null; restyle();
    if (/#d=/.test(location.hash)) history.replaceState(null, "", location.pathname + location.search);
    setTimeout(placeBubble, 480);
  }
  function step(dir) {
    var list = visibleList(); if (!list.length) return;
    var i = list.indexOf(selected);
    openDistrict(list[(i + dir + list.length) % list.length]);
  }
  $("p-prev").addEventListener("click", function () { step(-1); });
  $("p-next").addEventListener("click", function () { step(1); });
  $("p-share").addEventListener("click", function () {
    var url = location.href.split("#")[0] + "#d=" + selected.feature.properties._id;
    var done = function () { say(esc(S.copied), { secs: 4, short: true }); };
    if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, function () { prompt("Ссылка:", url); });
    else prompt("Ссылка:", url);
  });

  // свайп вниз по панели на телефоне — закрыть
  (function () {
    var panel = $("panel"), y0 = null, dy = 0;
    panel.addEventListener("touchstart", function (e) {
      if ($("panel-inner").scrollTop > 0 && !e.target.closest(".grab")) return;
      y0 = e.touches[0].clientY; dy = 0; panel.classList.add("dragging");
    }, { passive: true });
    panel.addEventListener("touchmove", function (e) {
      if (y0 === null) return;
      dy = Math.max(0, e.touches[0].clientY - y0);
      if (dy > 0) panel.style.transform = "translateY(" + dy + "px)";
    }, { passive: true });
    panel.addEventListener("touchend", function () {
      if (y0 === null) return;
      panel.classList.remove("dragging"); panel.style.transform = "";
      if (dy > 90) closePanel();
      y0 = null;
    });
  })();

  // ------------------------------------------------------------------ истории жителей (краудсорсинг + модерация)
  var C = S.crowd || {}, STORIES = {}, crowdFor = null;
  function parseCSV(t) {
    var rows = [], row = [], cur = "", q = false;
    for (var i = 0; i < t.length; i++) {
      var ch = t[i];
      if (q) { if (ch === '"' && t[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
      else if (ch === '"') q = true;
      else if (ch === ",") { row.push(cur); cur = ""; }
      else if (ch === "\n" || ch === "\r") { if (ch === "\r" && t[i + 1] === "\n") i++; row.push(cur); rows.push(row); row = []; cur = ""; }
      else cur += ch;
    }
    if (cur || row.length) { row.push(cur); rows.push(row); }
    return rows;
  }
  if (C.enabled && C.stories_csv) {
    fetch(C.stories_csv).then(function (r) { return r.text(); }).then(function (t) {
      var rows = parseCSV(t); if (!rows.length) return;
      var h = rows[0].map(function (x) { return x.trim().toLowerCase(); });
      var col = function (names, def) { for (var i = 0; i < names.length; i++) { var k = h.indexOf(names[i]); if (k >= 0) return k; } return def; };
      var ci = col(["district_id", "id района", "район_id"], 0), cs = col(["story", "история"], 2), ca = col(["author", "автор", "подпись"], 3);
      rows.slice(1).forEach(function (r) {
        var id = (r[ci] || "").trim(), st = (r[cs] || "").trim(); if (!id || !st) return;
        (STORIES[id] = STORIES[id] || []).push({ story: st, author: (r[ca] || "").trim() });
      });
      if (selected) renderCrowd(selected.feature.properties);
    }).catch(function () { /* таблица недоступна — просто не показываем истории */ });
  }
  function renderCrowd(p) {
    var box = $("crowd");
    if (!C.enabled) { box.hidden = true; return; }
    box.hidden = false; crowdFor = p;
    $("crowd-title").textContent = C.title;
    var list = STORIES[String(p._id)] || [];
    $("stories").innerHTML = list.length ? list.map(function (x) {
      return "<li><p>" + esc(x.story) + "</p>" + (x.author ? "<small>— " + esc(x.author) + "</small>" : "") + "</li>";
    }).join("") : '<li class="none">' + esc(C.empty) + "</li>";
    $("crowd-open").textContent = C.cta; $("crowd-open").hidden = false;
    resetStoryForm(); $("crowd-msg").hidden = true;
  }
  // Load the external form only after the visitor gives consent.
  function resetStoryForm() {
    $("crowd-embed").hidden = true; $("crowd-open").setAttribute("aria-expanded", "false");
    $("story-frame").removeAttribute("src"); $("story-frame-wrap").hidden = true;
    $("story-consent").checked = false; $("story-consent-go").disabled = true;
    $("story-consent-go").hidden = false;
  }
  $("crowd-open").addEventListener("click", function () {
    var opening = $("crowd-embed").hidden;
    if(!opening) { resetStoryForm(); return; }
    $("crowd-embed").hidden = false; this.setAttribute("aria-expanded", "true");
  });
  $("story-consent").addEventListener("change", function () {
    $("story-consent-go").disabled = !this.checked;
    if(!this.checked) { $("story-frame").removeAttribute("src"); $("story-frame-wrap").hidden = true; $("story-consent-go").hidden = false; }
  });
  $("story-consent-go").addEventListener("click", function () {
    if(!$("story-consent").checked) return;
    var url;
    try { url = new URL(C.public_form_url); if(url.protocol !== "https:" || url.hostname !== "docs.google.com" || url.pathname.indexOf("/forms/") !== 0) return; } catch(e) { return; }
    url.searchParams.set("embedded", "true");
    $("story-district-name").textContent = crowdFor ? (crowdFor.name_2 || crowdFor.name) : "";
    $("story-frame").src = url.toString(); $("story-frame-wrap").hidden = false; this.hidden = true;
  });
  $("story-close").addEventListener("click", resetStoryForm);

  // ------------------------------------------------------------------ фото-точки
  var pins = {}, pinGroup = L.layerGroup().addTo(map), pinsOn = true;
  var pinSize = function () { return parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--pin-size")) || 50; };
  D.location.features.forEach(function (f) {
    var q = f.properties, c = f.geometry.coordinates;
    var html = q.thumb ? '<div class="pin"><img src="' + esc(q.thumb) + '" alt="" width="128" height="128" decoding="async"></div>' : '<div class="pin empty"></div>';
    var m = L.marker([c[1], c[0]], { pane: "pins", title: q.name || "", icon: L.divIcon({ className: "pin-wrap", html: html, iconSize: [0, 0] }) });
    m.on("click", function (e) { L.DomEvent.stopPropagation(e); openPhoto(q.fid); });
    pinGroup.addLayer(m); pins[q.fid] = m;
  });
  function openPhoto(fid) {
    var q = locById[fid].properties, m = pins[fid], p = pads();
    if (!pinsOn) togglePins(true);
    var html = '<div class="pp-img">' + (q.photo ? '<img src="' + esc(q.photo) + '" alt="" decoding="async" fetchpriority="high">' : "") +
      '<button class="x" type="button" aria-label="Закрыть"></button></div>' +
      '<div class="pp-body"><b>' + esc(q.name) + "</b><small>" + esc([q.address, q.year].filter(Boolean).join(" · ")) + "</small>" +
      (q.description ? "<p>" + esc(q.description) + "</p>" : "") + "</div>";
    L.popup({ className: "photo-pop", closeButton: false, maxWidth: Math.min(238, window.innerWidth - 48), minWidth: Math.min(210, window.innerWidth - 48), offset: [0, -pinSize() / 2 - 4],
      autoPanPaddingTopLeft: L.point(p.tl[0], 20), autoPanPaddingBottomRight: L.point(p.br[0], p.br[1]) })
      .setLatLng(m.getLatLng()).setContent(html).openOn(map);
    Object.keys(pins).forEach(function (k) { var el = pins[k].getElement(); if (el && el.firstChild) el.firstChild.classList.toggle("active", k == fid); });
  }
  function focusObject(fid) {
    var m = pins[fid]; if (!m) return;
    map.closePopup(); flyToPoint(m.getLatLng(), 16);
    map.once("moveend", function () { openPhoto(fid); });
  }
  map.on("popupopen", function (e) {
    var b = e.popup.getElement().querySelector(".x");
    if (b) b.addEventListener("click", function () { map.closePopup(); });
  });
  var lastPopupClose = 0;
  map.on("popupclose", function () {
    lastPopupClose = Date.now();
    Object.keys(pins).forEach(function (k) { var el = pins[k].getElement(); if (el && el.firstChild) el.firstChild.classList.remove("active"); });
  });
  function togglePins(on) { pinsOn = on; if (on) pinGroup.addTo(map); else { map.removeLayer(pinGroup); map.closePopup(); } renderChips(); }

  // клик по пустому месту карты: по очереди закрывает фото → панель → выбор в легенде
  map.on("click", function () {
    if (Date.now() - lastPopupClose < 400) return;
    closeSearch();
    if (selected) { closePanel(); return; }
    if (soloOn()) clearSolo();
  });

  // ------------------------------------------------------------------ легенда внизу (сворачивается)
  function blob(fill, stroke) {
    return '<svg viewBox="0 0 22 18" aria-hidden="true"><path d="M4 9.5C3 5 6.5 2 11 2.4s8.6 1.8 8.6 6.4-3.4 7.4-8.4 7.2S5 14 4 9.5z" fill="' + fill + '" stroke="' + stroke + '"/></svg>';
  }
  function renderChips() {
    var box = $("chips"); box.innerHTML = "";
    box.classList.toggle("solo", soloOn());
    S.legend.items.forEach(function (it) {
      var n = bubbleLayers.filter(function (l) { return l.feature.properties.type === it.type && Number(l.feature.properties.top) <= level; }).length;
      var c = document.createElement("button");
      c.type = "button"; c.className = "ch" + (solo[it.type] ? " on" : "");
      c.innerHTML = blob(it.color, it.stroke) + "<span>" + esc(it.type) + "</span><b>" + n + "</b>";
      c.addEventListener("mouseenter", function () { if (!soloOn()) { focusType = it.type; restyle(); } });
      c.addEventListener("mouseleave", function () { focusType = null; restyle(); });
      c.addEventListener("click", function () { toggleSolo(it.type); });
      box.appendChild(c);
    });
    var pinsChip = document.createElement("button");
    pinsChip.type = "button"; pinsChip.className = "ch pins" + (pinsOn ? "" : " off");
    var th = (D.location.features.filter(function (f) { return f.properties.thumb; })[0] || { properties: {} }).properties.thumb;
    pinsChip.innerHTML = '<img src="' + esc(th || "") + '" alt=""><span>Жуткие локации</span><b>' + D.location.features.length + "</b>";
    pinsChip.addEventListener("click", function () { togglePins(!pinsOn); });
    box.appendChild(pinsChip);
    var allChip = document.createElement("button");
    allChip.type = "button"; allChip.className = "ch all" + (allHidden ? " on" : "");
    allChip.setAttribute("aria-pressed", allHidden);
    allChip.innerHTML = (allHidden
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg><span>Показать всё</span>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18M10.6 5.1A10.6 10.6 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6C3.9 8.4 2 12 2 12s3.6 7 10 7a10 10 0 0 0 5.4-1.6"/></svg><span>Скрыть всё</span>');
    allChip.addEventListener("click", function () { setAllHidden(!allHidden); });
    box.appendChild(allChip);
    box.querySelectorAll(".ch").forEach(function (c) { if (!c.hasAttribute("aria-pressed")) c.setAttribute("aria-pressed", c.classList.contains("on")); });
    var names = Object.keys(solo);
    $("solo-hint").hidden = !names.length;
    $("solo-hint").textContent = names.length ? "клик по пустому месту карты — вернуть все районы" : "";
  }
  var allHidden = false;
  function setAllHidden(h) {
    allHidden = h;
    [bubbleGroup, labelGroup, pinGroup].forEach(function (g) { if (h) map.removeLayer(g); else if (g !== pinGroup || pinsOn) g.addTo(map); });
    if (h) { closePanel(); map.closePopup(); } else fitLabels();
    renderChips();
  }
  function toggleSolo(type, only) {
    if (allHidden) setAllHidden(false);
    if (only) solo = {};
    if (solo[type] && !only) delete solo[type]; else solo[type] = true;
    focusType = null;
    if (selected && soloOn() && !solo[selected.feature.properties.type]) closePanel();
    restyle(); fitLabels(); renderChips();
    if (soloOn()) {
      var b = null;
      bubbleLayers.forEach(function (l) { if (bubbleGroup.hasLayer(l) && solo[l.feature.properties.type]) b = b ? b.extend(l.getBounds()) : L.latLngBounds(l.getBounds().getSouthWest(), l.getBounds().getNorthEast()); });
      if (b) { var p = pads(); map.flyToBounds(b, { paddingTopLeft: p.tl, paddingBottomRight: p.br, duration: 0.8, maxZoom: 13 }); }
    }
  }
  function clearSolo(silent) {
    solo = {}; restyle(); fitLabels(); renderChips();
    if (!silent) map.flyTo(HOME.center, HOME.zoom, { duration: 0.8 });
  }
  $("strip-title").textContent = S.dock_title;
  $("strip-toggle").addEventListener("click", function () {
    var st = $("strip"); st.classList.toggle("closed"); this.setAttribute("aria-expanded", !st.classList.contains("closed"));
  });
  if (isMobile()) $("strip").classList.add("closed");

  // ------------------------------------------------------------------ плотность + кладбища
  function heatRange(v) { var rs = S.heatmap.ranges; for (var i = 0; i < rs.length; i++) if (v >= rs[i].from && v <= rs[i].to) return rs[i]; return null; }
  var heat = L.geoJSON(D.heatmap, {
    pane: "heat", renderer: L.canvas({ pane: "heat", padding: 0.4 }), interactive: false,
    style: function (f) { var r = heatRange(f.properties.ELEV); return { stroke: false, fillColor: r ? r.color : "#000", fillOpacity: r ? S.heatmap.opacity : 0 }; }
  });
  var svc = L.layerGroup();
  D.servises.features.forEach(function (f) {
    var c = f.geometry.coordinates;
    var m = L.marker([c[1], c[0]], { pane: "svc", icon: L.divIcon({ className: "svc-wrap", iconSize: [0, 0],
      html: '<img src="servises.svg" alt="" style="height:22px;transform:translate(-50%,-50%);display:block">' }) });
    svc.addLayer(m);
  });
  // шкала плотности: видна вся; наведение на класс подсвечивает его, клик — шутка призрака
  var heatOnly = null;
  function restyleHeat() {
    heat.setStyle(function (f) {
      var r = heatRange(f.properties.ELEV), i = S.heatmap.ranges.indexOf(r);
      var op = !r ? 0 : (heatOnly === null || heatOnly === i) ? S.heatmap.opacity : 0.12;
      return { stroke: false, fillColor: r ? r.color : "#000", fillOpacity: op };
    });
    $("heatbar").querySelectorAll(".hb-seg").forEach(function (el, i) { el.classList.toggle("on", heatOnly === i); });
  }
  function markSeg(i) { $("heatbar").querySelectorAll(".hb-seg").forEach(function (el, k) { el.classList.toggle("here", k === i); }); }
  $("heatbar").innerHTML = '<div class="hb-wrap"><div class="hb-cap">' + esc(S.heatmap.caption || "") + '</div><div class="hb-scale">' + S.heatmap.ranges.map(function (r, i) {
    return '<button type="button" class="hb-seg" data-i="' + i + '"><i style="background:' + r.color + '"></i><span>' + esc(r.name) + "</span><small>" + esc(r.label) + "</small></button>";
  }).join("") + '</div></div><div class="hb-svc"><img src="servises.svg" alt="">' + esc(S.servises_label) + " · " + D.servises.features.length + "</div>";
  $("heatbar").querySelectorAll(".hb-seg").forEach(function (el) {
    var i = Number(el.getAttribute("data-i"));
    var on = function () { heatOnly = i; restyleHeat(); }, off = function () { heatOnly = null; restyleHeat(); };
    el.addEventListener("mouseenter", on); el.addEventListener("focus", on);
    el.addEventListener("mouseleave", off); el.addEventListener("blur", off);
    el.addEventListener("click", function () {
      if (!canHover) { heatOnly = heatOnly === i ? null : i; restyleHeat(); }
      say(esc(S.heatmap.ranges[i].say || ""), { secs: 4 });
    });
  });
  // где под курсором плотнее всего (сами пятна не перехватывают клики — районы остаются кликабельными)
  var heatIdx = D.heatmap.features.map(function (f) {
    var g = f.geometry, polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates, b = [180, 90, -180, -90];
    polys.forEach(function (p) { p[0].forEach(function (c) { b[0] = Math.min(b[0], c[0]); b[1] = Math.min(b[1], c[1]); b[2] = Math.max(b[2], c[0]); b[3] = Math.max(b[3], c[1]); }); });
    return { polys: polys, b: b, v: f.properties.ELEV };
  });
  function inRing(x, y, ring) {
    var ins = false;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      var a = ring[i], c = ring[j];
      if ((a[1] > y) !== (c[1] > y) && x < (c[0] - a[0]) * (y - a[1]) / (c[1] - a[1]) + a[0]) ins = !ins;
    }
    return ins;
  }
  function heatAt(ll) {
    var x = ll.lng, y = ll.lat, best = null;
    heatIdx.forEach(function (h) {
      if (x < h.b[0] || x > h.b[2] || y < h.b[1] || y > h.b[3] || (best !== null && h.v <= best)) return;
      for (var k = 0; k < h.polys.length; k++) {
        var p = h.polys[k];
        if (inRing(x, y, p[0])) { var hole = false; for (var m = 1; m < p.length; m++) if (inRing(x, y, p[m])) hole = true; if (!hole) { best = h.v; return; } }
      }
    });
    return best === null ? null : heatRange(best);
  }
  var lastHeatSay = { i: -1, t: 0 }, heatMoveT = 0;
  function heatJoke(ll, force) {
    var r = heatAt(ll); if (!r) return;
    var i = S.heatmap.ranges.indexOf(r);
    if (!force && (i < (S.heatmap.hover_from || 3) || (i === lastHeatSay.i && Date.now() - lastHeatSay.t < 8000) || Date.now() - lastHeatSay.t < 2500)) return;
    markSeg(i);
    lastHeatSay = { i: i, t: Date.now() };
    say(esc(r.say || r.name), { secs: 4 });
  }
  map.on("mousemove", function (e) {
    if (!map.hasLayer(heat) || Date.now() - heatMoveT < 150) return;
    heatMoveT = Date.now(); heatJoke(e.latlng, false);
  });
  map.on("click", function (e) { if (map.hasLayer(heat)) heatJoke(e.latlng, true); });
  function setHeat(on) {
    heatMode = on;
    if (on) { heat.addTo(map); svc.addTo(map); closePanel(); map.closePopup(); if (allHidden) setAllHidden(false); }
    else { map.removeLayer(heat); map.removeLayer(svc); heatOnly = null; restyleHeat(); markSeg(-1); }
    $("btn-heat").classList.toggle("on", on); $("btn-heat").setAttribute("aria-pressed", on);
    document.body.classList.toggle("heat-on", on);
    $("heatbar").hidden = !on; $("chips").hidden = on; $("heat-back").hidden = !on; $("strip").classList.remove("closed");
    $("strip-title").textContent = on ? "Плотность жути" : S.dock_title;
    $("solo-hint").hidden = on || !soloOn();
    restyle();
    if (on) say(esc(S.heatmap.hint || ""), { secs: 6 });
  }
  $("btn-heat").addEventListener("click", function () { setHeat(!heatMode); });
  $("heat-back").addEventListener("click", function () { setHeat(false); });

  // ------------------------------------------------------------------ случайный район и поиск
  $("btn-random").addEventListener("click", function () {
    var pool = bubbleLayers.filter(function (l) { return l.feature.properties.description && l !== selected && (!soloOn() || solo[l.feature.properties.type]); });
    if (!pool.length) return;
    say(esc(S.random_say), { secs: 2, short: true });
    openDistrict(rnd(pool));
  });
  var searchItems = bubbleLayers.map(function (l) {
    var p = l.feature.properties;
    return { l: l, text: ((p.name_2 || "") + " " + (p.name || "") + " " + (p.type || "")).toLowerCase().replace(/ё/g, "е") };
  });
  function closeSearch() { $("search").hidden = true; $("btn-search").classList.remove("on"); }
  function renderSearch() {
    var q = $("search-input").value.trim().toLowerCase().replace(/ё/g, "е");
    var list = $("search-list"); list.innerHTML = "";
    if (!q) return;
    var res = searchItems.filter(function (it) { return it.text.indexOf(q) >= 0; }).slice(0, 8);
    if (!res.length) { list.innerHTML = '<li class="none">Здесь пусто. Даже призраков нет</li>'; return; }
    res.forEach(function (it, i) {
      var p = it.l.feature.properties, t = TYPES[p.type] || {};
      var li = document.createElement("li"); if (i === 0) li.className = "act";
      li.innerHTML = '<i style="background:' + t.color + ";border-color:" + t.stroke + '"></i><span>' + esc(p.name_2 || p.name) + "<small>" + esc(p.name_2 ? p.name : p.type) + (visited[p._id] ? " · уже был" : "") + "</small></span>";
      li.addEventListener("click", function () { closeSearch(); openDistrict(it.l); });
      list.appendChild(li);
    });
  }
  $("btn-search").addEventListener("click", function () {
    var s = $("search"), open = s.hidden;
    s.hidden = !open; this.classList.toggle("on", open);
    if (open) { $("search-input").value = ""; renderSearch(); setTimeout(function () { $("search-input").focus(); }, 30); }
  });
  $("search-input").addEventListener("input", renderSearch);
  $("search-input").addEventListener("keydown", function (e) {
    if (e.key === "Enter") { var li = $("search-list").querySelector("li.act"); if (li) li.click(); }
    if (e.key === "Escape") { closeSearch(); e.stopPropagation(); }
  });

  // ------------------------------------------------------------------ окна
  var stack = [];
  function openModal(id) { $("scrim").hidden = false; $(id).hidden = false; stack.push(id); if(id === "intro") { $("ghost").style.visibility="hidden"; } }
  function closeModal(id) {
    if(id === "intro") window.introGhostRect = $("intro-ghost").getBoundingClientRect();
    $(id).hidden = true; stack = stack.filter(function (x) { return x !== id; });
    if (!stack.length) $("scrim").hidden = true;
    if (id === "intro") {
      try { localStorage.setItem("spb-dark-intro-v2", "1"); } catch(e) {}
      var start = window.introGhostRect, target = $("ghost").getBoundingClientRect();
      var traveler = document.createElement("img"); traveler.src = "ghost.svg"; traveler.className = "ghost-traveler";
      traveler.style.cssText = "position:fixed;z-index:2500;pointer-events:none;transform-origin:top left;left:"+start.left+"px;top:"+start.top+"px;width:"+start.width+"px;height:"+start.height+"px";
      document.body.appendChild(traveler);
      var finish = function(){ traveler.remove(); $("ghost").style.visibility=""; say(esc(S.ghost.hint), { secs: 7 }); };
      if (traveler.animate && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        $("ghost").style.visibility="hidden";
        traveler.animate([{transform:"translate(0,0) scale(1)",opacity:1},{transform:"translate("+((target.left-start.left)*.45)+"px,"+(target.top-start.top-70)+"px) scale(.8)",opacity:1},{transform:"translate("+(target.left-start.left)+"px,"+(target.top-start.top)+"px) scale("+(target.width/start.width)+")",opacity:1}],{duration:1150,easing:"cubic-bezier(.2,.7,.2,1)",fill:"forwards"}).finished.then(finish,finish);
      } else finish();
    }
  }
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-close]"); if (!b) return;
    var id = b.getAttribute("data-close");
    if (id === "panel") closePanel(); else closeModal(id);
  });
  $("scrim").addEventListener("click", function () { stack.slice().forEach(closeModal); });
  document.addEventListener("keydown", function (e) {
    var typing = e.target && /INPUT|TEXTAREA/.test(e.target.tagName);
    if (e.key === "Escape") {
      if (!$("search").hidden) closeSearch();
      else if (map._popup && map.hasLayer(map._popup)) map.closePopup();
      else if (stack.length) closeModal(stack[stack.length - 1]);
      else if (selected) closePanel();
      else if (soloOn()) clearSolo();
    }
    if (!typing && selected && !stack.length && e.target !== $("ghost")) {
      if (e.key === "ArrowRight") step(1);
      if (e.key === "ArrowLeft") step(-1);
    }
  });

  // интро
  $("intro-title").textContent = S.intro.title;
  $("intro-text").innerHTML = S.intro.paragraphs.map(function (p) { return "<p>" + esc(p) + "</p>"; }).join("");
  $("intro-go").textContent = S.intro.button;
  $("howto").innerHTML = (S.intro.howto || []).map(function (h, i) { return "<li><b>" + (i + 1) + "</b><span><strong>" + esc(h[0]) + "</strong> — " + esc(h[1]) + "</span></li>"; }).join("");
  $("intro-go").addEventListener("click", function () { closeModal("intro"); });

  // ------------------------------------------------------------------ «Что на карте»: статистика + кликабельные типы
  function buildStats() {
    var F = D.bubbles.features, N = F.length;
    var byLv = [0, 0, 0], byType = {}, withStory = 0, best = null;
    F.forEach(function (f) {
      var p = f.properties; byLv[Number(p.top)]++; byType[p.type] = (byType[p.type] || 0) + 1;
      if (p.description) withStory++;
      if (!best || (p.objects || []).length > (best.objects || []).length) best = p;
    });
    var lvColors = ["#8C8C8C", "#AC8ECE", "#E0445A"];
    var types = S.legend.items.slice().sort(function (a, b) { return (byType[b.type] || 0) - (byType[a.type] || 0); });
    var max = byType[types[0].type] || 1, pct = Math.round(byLv[2] / N * 100);
    var discovered = Math.min(N, Object.keys(visited).length), progress = Math.round(discovered / N * 100);
    $("stats").innerHTML = '<h3 class="st-h">Твой след в тёмном городе</h3><div class="mini-stats"><div class="explore-ring" style="--progress:'+progress+'%"><b>'+discovered+'<small> / '+N+'</small></b><span>районов открыто</span></div><div class="stat-stories"><b>'+withStory+'</b><span>районов хранят страшилки</span><b>'+D.location.features.length+'</b><span>локаций для жуткой прогулки</span></div></div><div class="fear-ribbon">'+byLv.map(function(n,i){return '<span style="flex:'+Math.max(1,n)+';background:'+lvColors[i]+'" title="'+esc(S.fear_names[i])+': '+n+'">'+n+'</span>';}).join('')+'</div><div class="lv-names">'+S.fear_names.map(function(n){return '<span>'+esc(n)+'</span>';}).join('')+'</div>';
    $("legend-title").textContent = S.stats_title;
    var list = $("legend-list"); list.innerHTML = "";
    S.legend.items.forEach(function (it) {
      var row = document.createElement("div");
      row.className = "lg-row"; row.tabIndex = 0;
      row.innerHTML = '<span class="lg-sw" style="background:' + it.color + ";border-color:" + it.stroke + '">' +
        (it.icon ? '<img src="' + esc(it.icon) + '" alt="">' : "") + "</span>" +
        '<div><div class="lg-name">' + esc(it.type) + "<small>" + (byType[it.type] || 0) + " " + plural(byType[it.type] || 0, "район", "района", "районов") + "</small></div>" +
        '<div class="lg-text">' + esc(it.text) + '</div><span class="lg-go">Показать на карте →</span></div>';
      var go = function () {
        closeModal("legend"); closePanel();
        if (Number(level) < 2) setLevel(2, false);
        toggleSolo(it.type, true);
      };
      row.addEventListener("click", go);
      row.addEventListener("keydown", function (e) { if (e.key === "Enter") go(); });
      row.setAttribute("role", "button");
      var matches = D.location.features.filter(function(f){ return (f.properties.districts || []).some(function(id){return byId[id] && byId[id].feature.properties.type === it.type;}); }).slice(0,6);
      if(matches.length){
        var circles = document.createElement("div"); circles.className="legend-locations";
        matches.forEach(function(f){ var q=f.properties, btn=document.createElement("button"); btn.type="button"; btn.title=q.name; btn.setAttribute("aria-label",q.name); btn.innerHTML=(q.thumb?'<img src="'+esc(q.thumb)+'" alt="" loading="lazy">':'<span>⌖</span>'); btn.addEventListener("keydown",function(e){e.stopPropagation();}); btn.addEventListener("click",function(e){e.stopPropagation();closeModal("legend");focusObject(q.fid);}); circles.appendChild(btn); });
        row.lastElementChild.appendChild(circles);
      }
      list.appendChild(row);
    });
  }
  $("btn-legend").addEventListener("click", function () { buildStats(); openModal("legend"); });

  // ------------------------------------------------------------------ ползунок с привидением
  var track = $("fear-track"), ghost = $("ghost"), fill = $("fear-fill"), bubble = $("bubble"), fear = $("fear");
  var curFrac = level / 2, sayT1, sayT2, bubbleAction = null, lastFact = null, lastActive = Date.now();
  function placeBubble() {
    if (bubble.hidden) return;
    var fr = fear.getBoundingClientRect(), tr = track.getBoundingClientRect();
    var gx = tr.left + tr.width * curFrac, bw = bubble.offsetWidth;
    var cx = Math.min(Math.max(gx, bw / 2 + 10), window.innerWidth - bw / 2 - 10);
    bubble.style.left = (cx - fr.left) + "px";
    bubble.style.setProperty("--tail", Math.max(16, Math.min(bw - 16, gx - (cx - bw / 2))) + "px");
  }
  function say(html, opt) {
    opt = opt || {};
    clearTimeout(sayT1); clearTimeout(sayT2);
    bubble.innerHTML = html; bubble.hidden = false;
    bubble.classList.toggle("link", !!opt.action); bubble.classList.toggle("short", !!opt.short);
    bubbleAction = opt.action || null;
    bubble.classList.remove("out"); bubble.style.animation = "none"; void bubble.offsetWidth; bubble.style.animation = "";
    placeBubble();
    var ms = (opt.secs || S.ghost.seconds || 5) * 1000;
    sayT1 = setTimeout(function () { bubble.classList.add("out"); }, ms);
    sayT2 = setTimeout(function () { bubble.hidden = true; bubble.classList.remove("out"); bubbleAction = null; }, ms + 350);
  }
  bubble.addEventListener("click", function () { if (!bubbleAction) return; var a = bubbleAction; bubble.hidden = true; bubbleAction = null; a(); });

  // короткие факты (settings.js → ghost.facts)
  var FACTS = (S.ghost.facts || []).map(function (f) {
    var l = bubbleLayers.filter(function (x) { return x.feature.properties.name_2 === f.district; })[0];
    return l ? { text: f.text, l: l } : null;
  }).filter(Boolean);
  function tellFact() {
    var pool = FACTS.filter(function (f) { return f !== lastFact && bubbleGroup.hasLayer(f.l); });
    if (!pool.length) pool = FACTS.filter(function (f) { return f !== lastFact; });
    if (!pool.length) return;
    var f = rnd(pool); lastFact = f;
    say(esc(f.text) + "<u>" + esc(S.ghost.fact_link) + "</u>", { secs: S.ghost.fact_seconds || 9, action: function () { openDistrict(f.l); } });
  }
  function place(frac) { curFrac = frac; ghost.style.left = frac * 100 + "%"; fill.style.width = frac * 100 + "%"; placeBubble(); }
  function setLevel(i, talk) {
    i = Math.max(0, Math.min(2, i));
    var changed = i !== level; level = i;
    place(i / 2); ghost.setAttribute("aria-valuenow", i); ghost.setAttribute("aria-valuetext", S.ghost.levels[i]);
    if (changed) applyFilter();
    if (talk) say(esc(S.ghost.levels[i]), { short: true });
  }
  var frac = function (e) { var r = track.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); };
  var drag = null;
  fear.addEventListener("pointerdown", function (e) {
    if (e.target.closest(".bubble")) return;
    drag = { x: e.clientX, onGhost: !!e.target.closest(".ghost"), moved: false };
    fear.classList.add("drag"); fear.setPointerCapture(e.pointerId); e.preventDefault();
    if (!drag.onGhost) place(frac(e));
  });
  fear.addEventListener("pointermove", function (e) {
    if (!drag) return;
    if (Math.abs(e.clientX - drag.x) > 4) drag.moved = true;
    if (drag.moved || !drag.onGhost) place(frac(e));
  });
  var end = function (e) {
    if (!drag) return;
    var d = drag; drag = null; fear.classList.remove("drag");
    if (d.onGhost && !d.moved) { place(level / 2); tellFact(); return; }   // нажали на призрака — короткий факт
    setLevel(Math.round(frac(e) * 2), true);
  };
  fear.addEventListener("pointerup", end); fear.addEventListener("pointercancel", end);
  ghost.addEventListener("keydown", function (e) {
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") { setLevel(level - 1, true); e.preventDefault(); e.stopPropagation(); }
    if (e.key === "ArrowRight" || e.key === "ArrowUp") { setLevel(level + 1, true); e.preventDefault(); e.stopPropagation(); }
    if (e.key === "Enter" || e.key === " ") { tellFact(); e.preventDefault(); }
  });
  ["pointerdown", "wheel", "keydown"].forEach(function (ev) { document.addEventListener(ev, function () { lastActive = Date.now(); }, { passive: true }); });
  setInterval(function () {   // если пользователь задумался — призрак сам подскажет
    if (Date.now() - lastActive > 15000 && bubble.hidden && !stack.length && !selected) tellFact();
  }, (S.ghost.fact_every_seconds || 40) * 1000);
  window.addEventListener("resize", function () { placeBubble(); fitLabels(); });

  document.querySelectorAll(".tool").forEach(function (b) { var t = b.querySelector(".tip"); if (t) b.title = t.textContent; });
  ["hud", "panel", "strip"].forEach(function (id) { L.DomEvent.disableClickPropagation($(id)); L.DomEvent.disableScrollPropagation($(id)); });
  L.DomEvent.disableClickPropagation($("logo"));

  // ------------------------------------------------------------------ кнопки карты
  $("z-in").addEventListener("click", function () { map.zoomIn(); });
  $("z-out").addEventListener("click", function () { map.zoomOut(); });
  $("z-home").addEventListener("click", function () { closePanel(); map.closePopup(); map.flyTo(HOME.center, HOME.zoom, { duration: 0.8 }); });
  var meMarker = null;
  function districtAt(ll) {
    var x = ll.lng, y = ll.lat, hit = null;
    bubbleLayers.forEach(function (l) {
      if (hit || !bubbleGroup.hasLayer(l) || !l.getBounds().contains(ll)) return;
      var g = l.feature.geometry, polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
      polys.forEach(function (p) { if (!hit && inRing(x, y, p[0])) hit = l; });
    });
    return hit;
  }
  $("z-loc").addEventListener("click", function () {
    var btn = this;
    if (!navigator.geolocation) { say(esc(S.locate_fail), { secs: 5 }); return; }
    btn.classList.add("busy");
    navigator.geolocation.getCurrentPosition(function (pos) {
      btn.classList.remove("busy");
      var ll = L.latLng(pos.coords.latitude, pos.coords.longitude);
      if (meMarker) map.removeLayer(meMarker);
      meMarker = L.marker(ll, { pane: "pins", interactive: false, icon: L.divIcon({ className: "me-wrap", iconSize: [0, 0], html: '<div class="me"></div>' }) }).addTo(map);
      var l = districtAt(ll);
      if (l) { say(esc(S.locate_found), { secs: 4 }); openDistrict(l); }
      else { flyToPoint(ll, 14); say(esc(S.locate_outside), { secs: 5 }); }
    }, function () { btn.classList.remove("busy"); say(esc(S.locate_fail), { secs: 6 }); }, { enableHighAccuracy: true, timeout: 10000 });
  });
  L.DomEvent.disableClickPropagation($("mapctl"));
  document.addEventListener("keydown", function (e) {
    if (e.key === "/" && !/INPUT|TEXTAREA/.test(e.target.tagName) && !stack.length) { e.preventDefault(); if ($("search").hidden) $("btn-search").click(); else $("search-input").focus(); }
  });

  // ------------------------------------------------------------------ старт
  place(level / 2);
  applyFilter();
  var deep = /#d=(\d+)/.exec(location.hash);
  if (deep && byId[deep[1]]) { openDistrict(byId[deep[1]], { noHash: true }); setTimeout(function () { say(esc(S.ghost.hint), { secs: 6 }); }, 900); }
  else if (location.hash === "#nointro") say(esc(S.ghost.hint), { secs: 7 });
  else openModal("intro");
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitLabels);
})();
