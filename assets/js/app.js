/* ===========================================================
   CertHub — client application
   Vanilla JS, no dependencies. Powers navigation, search,
   theming, progress tracking, and all interactive tools.
   Data comes from window.CERTHUB (data + meta + searchIndex).
   =========================================================== */
(function () {
  "use strict";

  var CERTHUB = window.CERTHUB || {};
  var body = document.body;
  var ROOT = body.getAttribute("data-root") || "./";
  var PAGE_URL = body.getAttribute("data-url") || "";
  var PAGE_TITLE = body.getAttribute("data-title") || document.title;
  var CERT = body.getAttribute("data-cert") || "gh-300";

  // Centralised display text & limits (see content/site.json → ui / limits).
  var SITE_UI = (CERTHUB.site && CERTHUB.site.ui) || {};
  var SITE_LIMITS = (CERTHUB.site && CERTHUB.site.limits) || {};
  // Shared, DOM-free report builders (assets/js/lib/feedback.js).
  function fbLib() {
    return window.CertHubFeedback || {};
  }

  /* ---------------- Storage helpers ---------------- */
  var Store = {
    get: function (key, fallback) {
      try {
        var v = localStorage.getItem("certhub:" + key);
        return v ? JSON.parse(v) : fallback;
      } catch (e) {
        return fallback;
      }
    },
    set: function (key, value) {
      try {
        localStorage.setItem("certhub:" + key, JSON.stringify(value));
      } catch (e) {}
    },
    remove: function (key) {
      try {
        localStorage.removeItem("certhub:" + key);
      } catch (e) {}
    },
  };

  var $ = function (sel, root) {
    return (root || document).querySelector(sel);
  };
  var $$ = function (sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  };
  var el = function (tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  };
  var esc = function (s) {
    var d = document.createElement("div");
    d.textContent = s == null ? "" : String(s);
    return d.innerHTML;
  };
  var shuffle = function (arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
    return a;
  };

  function certData() {
    return (CERTHUB.data && CERTHUB.data[CERT]) || {};
  }
  function certMeta() {
    return (CERTHUB.meta && CERTHUB.meta[CERT]) || { domains: [], passScore: 0.7 };
  }
  function domainName(id) {
    var d = certMeta().domains.filter(function (x) {
      return x.id === id;
    })[0];
    return d ? d.name : id;
  }

  /* ---------------- Theme ---------------- */
  function toggleTheme() {
    var cur = document.documentElement.getAttribute("data-theme") || "dark";
    var next = cur === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    Store.set("theme", next);
  }

  /* ---------------- Mobile nav ---------------- */
  function toggleNav() {
    body.classList.toggle("nav-open");
  }

  /* ---------------- Global action delegation ---------------- */
  document.addEventListener("click", function (e) {
    var t = e.target.closest("[data-action]");
    if (!t) return;
    var action = t.getAttribute("data-action");
    switch (action) {
      case "toggle-theme":
        toggleTheme();
        break;
      case "toggle-nav":
        toggleNav();
        break;
      case "open-search":
        Search.open();
        break;
      case "print":
        window.print();
        break;
      case "toggle-bookmark":
        Bookmarks.toggle(t);
        break;
      case "open-feedback":
        Feedback.open(t.getAttribute("data-feedback-type") || "");
        break;
    }
  });

  document.addEventListener("keydown", function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      Search.open();
    }
  });

  /* ---------------- Code copy buttons ---------------- */
  function initCodeCopy() {
    $$(".doc pre").forEach(function (pre) {
      var btn = el("button", "copy-btn", "Copy");
      btn.type = "button";
      btn.addEventListener("click", function () {
        var code = pre.querySelector("code");
        var text = code ? code.innerText : pre.innerText;
        navigator.clipboard &&
          navigator.clipboard.writeText(text).then(function () {
            btn.textContent = "Copied";
            btn.classList.add("copied");
            setTimeout(function () {
              btn.textContent = "Copy";
              btn.classList.remove("copied");
            }, 1500);
          });
      });
      pre.appendChild(btn);
    });
  }

  /* ---------------- TOC scrollspy ---------------- */
  function initScrollSpy() {
    var links = $$(".on-this-page a");
    if (!links.length) return;
    var map = {};
    links.forEach(function (a) {
      var id = a.getAttribute("href").slice(1);
      var target = document.getElementById(id);
      if (target) map[id] = a;
    });
    var ids = Object.keys(map);
    if (!ids.length) return;
    var obs = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) {
            links.forEach(function (l) {
              l.classList.remove("active");
            });
            var a = map[en.target.id];
            if (a) a.classList.add("active");
          }
        });
      },
      { rootMargin: "-70px 0px -70% 0px" }
    );
    ids.forEach(function (id) {
      obs.observe(document.getElementById(id));
    });
  }

  /* ---------------- Search ---------------- */
  var Search = (function () {
    var overlay, input, results, index, active = -1, current = [];
    function ready() {
      overlay = $('[data-role="search-overlay"]');
      input = $('[data-role="search-input"]');
      results = $('[data-role="search-results"]');
      index = CERTHUB.searchIndex || [];
      if (!overlay) return;
      input.addEventListener("input", run);
      input.addEventListener("keydown", onKey);
      overlay.addEventListener("click", function (e) {
        if (e.target === overlay) close();
      });
      document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && !overlay.hidden) close();
      });
    }
    function open() {
      if (!overlay) return;
      overlay.hidden = false;
      input.value = "";
      results.innerHTML = "";
      active = -1;
      current = [];
      setTimeout(function () {
        input.focus();
      }, 20);
    }
    function close() {
      if (overlay) overlay.hidden = true;
    }
    function score(entry, terms) {
      var s = 0;
      var title = entry.title.toLowerCase();
      var heads = (entry.headings || []).join(" ").toLowerCase();
      var text = (entry.text || "").toLowerCase();
      terms.forEach(function (term) {
        if (!term) return;
        if (title.indexOf(term) !== -1) s += 12;
        if (heads.indexOf(term) !== -1) s += 5;
        var idx = text.indexOf(term);
        if (idx !== -1) s += 2;
      });
      return s;
    }
    function snippet(entry, terms) {
      var text = entry.text || "";
      var low = text.toLowerCase();
      var pos = -1;
      for (var i = 0; i < terms.length; i++) {
        pos = low.indexOf(terms[i]);
        if (pos !== -1) break;
      }
      var startPos = pos > 40 ? pos - 40 : 0;
      var frag = text.slice(startPos, startPos + 150);
      var safe = esc(frag);
      terms.forEach(function (term) {
        if (!term) return;
        var re = new RegExp("(" + term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")", "ig");
        safe = safe.replace(re, "<mark>$1</mark>");
      });
      return (startPos > 0 ? "… " : "") + safe + " …";
    }
    function run() {
      var q = input.value.trim().toLowerCase();
      active = -1;
      if (!q) {
        results.innerHTML = "";
        current = [];
        return;
      }
      var terms = q.split(/\s+/);
      current = index
        .map(function (entry) {
          return { entry: entry, s: score(entry, terms) };
        })
        .filter(function (r) {
          return r.s > 0;
        })
        .sort(function (a, b) {
          return b.s - a.s;
        })
        .slice(0, 8);
      if (!current.length) {
        results.innerHTML = '<div class="search-empty">No results found.</div>';
        return;
      }
      results.innerHTML = "";
      current.forEach(function (r, i) {
        var a = el("a", "search-result");
        a.href = ROOT + r.entry.url;
        a.innerHTML =
          '<div class="sr-title">' +
          esc(r.entry.title) +
          "</div>" +
          '<div class="sr-module">' +
          esc(r.entry.module || "") +
          "</div>" +
          '<div class="sr-snippet">' +
          snippet(r.entry, terms) +
          "</div>";
        a.addEventListener("mouseenter", function () {
          setActive(i);
        });
        results.appendChild(a);
      });
    }
    function setActive(i) {
      var nodes = $$(".search-result", results);
      nodes.forEach(function (n) {
        n.classList.remove("active");
      });
      active = i;
      if (nodes[i]) nodes[i].classList.add("active");
    }
    function onKey(e) {
      var nodes = $$(".search-result", results);
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive(Math.min(active + 1, nodes.length - 1));
        if (nodes[active]) nodes[active].scrollIntoView({ block: "nearest" });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive(Math.max(active - 1, 0));
        if (nodes[active]) nodes[active].scrollIntoView({ block: "nearest" });
      } else if (e.key === "Enter") {
        if (active >= 0 && current[active]) {
          window.location.href = ROOT + current[active].entry.url;
        } else if (current[0]) {
          window.location.href = ROOT + current[0].entry.url;
        }
      }
    }
    return { open: open, ready: ready };
  })();

  /* ---------------- Reading progress ---------------- */
  var Progress = {
    key: "progress:read",
    all: function () {
      return Store.get(this.key, {});
    },
    isRead: function (url) {
      return !!this.all()[url];
    },
    set: function (url, val) {
      var a = this.all();
      if (val) a[url] = true;
      else delete a[url];
      Store.set(this.key, a);
    },
    count: function () {
      return Object.keys(this.all()).length;
    },
  };

  function initReadState() {
    var checkbox = $('[data-action="mark-read"]');
    var status = $('[data-role="read-status"]');
    if (!checkbox) return;
    var read = Progress.isRead(PAGE_URL);
    checkbox.checked = read;
    if (status) status.textContent = read ? "Completed" : "";
    checkbox.addEventListener("change", function () {
      Progress.set(PAGE_URL, checkbox.checked);
      if (status) status.textContent = checkbox.checked ? "Completed" : "";
    });
  }

  /* ---------------- Bookmarks ---------------- */
  var Bookmarks = {
    key: "bookmarks",
    all: function () {
      return Store.get(this.key, []);
    },
    has: function (url) {
      return this.all().some(function (b) {
        return b.url === url;
      });
    },
    toggle: function (btn) {
      var list = this.all();
      if (this.has(PAGE_URL)) {
        list = list.filter(function (b) {
          return b.url !== PAGE_URL;
        });
      } else {
        list.push({ url: PAGE_URL, title: PAGE_TITLE, ts: Date.now() });
      }
      Store.set(this.key, list);
      this.reflect(btn);
    },
    reflect: function (btn) {
      btn = btn || $('[data-action="toggle-bookmark"]');
      if (!btn) return;
      var has = this.has(PAGE_URL);
      btn.classList.toggle("is-active", has);
      btn.innerHTML = has ? "\u2605" : "\u2606";
      btn.title = has ? "Remove bookmark" : "Bookmark this page";
    },
  };

  /* ---------------- Recently viewed ---------------- */
  function recordVisit() {
    if (!PAGE_URL) return;
    if (body.dataset.page && /tool/.test(body.className) === false) {
      // record content + landing pages
    }
    var key = "recent";
    var list = Store.get(key, []).filter(function (r) {
      return r.url !== PAGE_URL;
    });
    list.unshift({ url: PAGE_URL, title: PAGE_TITLE, ts: Date.now() });
    Store.set(key, list.slice(0, 12));
  }

  /* ---------------- Notes ---------------- */
  var Notes = {
    key: "notes",
    all: function () {
      return Store.get(this.key, {});
    },
    get: function (url) {
      return this.all()[url] || null;
    },
    save: function (url, note) {
      var a = this.all();
      if (note && note.text) a[url] = note;
      else delete a[url];
      Store.set(this.key, a);
    },
  };

  function initNotesWidget() {
    var toolbar = $(".doc-toolbar-actions");
    if (!toolbar) return;
    var wrap = el("div", "note-widget");
    var btn = el("button", "btn btn-ghost note-toggle", "\u270E Notes");
    btn.type = "button";
    toolbar.insertBefore(btn, toolbar.firstChild);

    var panel = el("div", "note-panel");
    panel.hidden = true;
    var existing = Notes.get(PAGE_URL);
    var ta = el("textarea");
    ta.placeholder = "Your private notes for this page…";
    ta.value = existing ? existing.text : "";
    var save = el("button", "btn btn-primary", "Save note");
    save.type = "button";
    panel.appendChild(ta);
    panel.appendChild(save);

    var doc = $(".doc");
    if (doc) doc.parentNode.insertBefore(panel, doc);

    if (existing && existing.text) btn.classList.add("is-active");

    btn.addEventListener("click", function () {
      panel.hidden = !panel.hidden;
      if (!panel.hidden) ta.focus();
    });
    save.addEventListener("click", function () {
      Notes.save(PAGE_URL, { title: PAGE_TITLE, text: ta.value.trim() });
      btn.classList.toggle("is-active", !!ta.value.trim());
      save.textContent = "Saved";
      setTimeout(function () {
        save.textContent = "Save note";
      }, 1200);
    });
  }

  /* ---------------- Question rendering (shared) ---------------- */
  function renderQuestion(q, opts) {
    opts = opts || {};
    var card = el("div");
    var isMulti = q.type === "multi" || Array.isArray(q.answer);
    var answerArr = Array.isArray(q.answer) ? q.answer : [q.answer];

    var meta =
      '<div class="q-meta">' +
      '<span class="q-tag diff-' +
      esc(q.difficulty) +
      '">' +
      esc(q.difficulty) +
      "</span>" +
      '<span class="q-tag">' +
      esc(domainName(q.domain)) +
      "</span>" +
      (isMulti ? '<span class="q-tag">select all that apply</span>' : "") +
      "</div>";

    card.innerHTML = meta + '<p class="q-stem">' + esc(q.question) + "</p>";

    var ul = el("ul", "q-options");
    var chosen = [];
    var revealed = false;

    q.options.forEach(function (optText, i) {
      var li = el("li", "q-option");
      li.setAttribute("data-i", i);
      li.innerHTML =
        '<span class="opt-key">' +
        String.fromCharCode(65 + i) +
        '</span><span class="opt-text">' +
        esc(optText) +
        "</span>";
      ul.appendChild(li);
    });
    card.appendChild(ul);

    var actionBar = el("div");
    var checkBtn;
    if (isMulti) {
      checkBtn = el("button", "btn btn-primary", "Check answer");
      checkBtn.type = "button";
      checkBtn.style.marginTop = "14px";
      actionBar.appendChild(checkBtn);
      card.appendChild(actionBar);
    }

    var explainBox = el("div");
    card.appendChild(explainBox);

    function reveal() {
      if (revealed) return;
      revealed = true;
      var correct =
        chosen.length === answerArr.length &&
        chosen.every(function (c) {
          return answerArr.indexOf(c) !== -1;
        });
      $$(".q-option", ul).forEach(function (li) {
        var i = Number(li.getAttribute("data-i"));
        li.classList.add("disabled");
        if (answerArr.indexOf(i) !== -1) li.classList.add("correct");
        else if (chosen.indexOf(i) !== -1) li.classList.add("incorrect");
      });
      var whyList = "";
      if (q.distractors) {
        whyList =
          "<ul>" +
          Object.keys(q.distractors)
            .map(function (k) {
              return (
                "<li><strong>" +
                String.fromCharCode(65 + Number(k)) +
                ".</strong> " +
                esc(q.distractors[k]) +
                "</li>"
              );
            })
            .join("") +
          "</ul>";
      }
      explainBox.innerHTML =
        '<div class="q-explain">' +
        '<span class="verdict ' +
        (correct ? "right" : "wrong") +
        '">' +
        (correct ? "Correct" : "Not quite") +
        "</span>" +
        "<h4>Explanation</h4><p>" +
        esc(q.explanation) +
        "</p>" +
        (whyList ? "<h4>Why the other options are wrong</h4>" + whyList : "") +
        (q.objective
          ? '<span class="obj-link">Related objective: <strong>' +
            esc(q.objective) +
            "</strong></span>"
          : "") +
        "</div>";
      if (opts.onAnswer) opts.onAnswer(correct, chosen);
    }

    $$(".q-option", ul).forEach(function (li) {
      li.addEventListener("click", function () {
        if (revealed) return;
        var i = Number(li.getAttribute("data-i"));
        if (isMulti) {
          var pos = chosen.indexOf(i);
          if (pos === -1) {
            chosen.push(i);
            li.classList.add("selected");
          } else {
            chosen.splice(pos, 1);
            li.classList.remove("selected");
          }
        } else {
          chosen = [i];
          reveal();
        }
      });
    });
    if (checkBtn) {
      checkBtn.addEventListener("click", function () {
        if (chosen.length) {
          checkBtn.disabled = true;
          reveal();
        }
      });
    }

    return card;
  }

  /* ---------------- Question bank tool ---------------- */
  var QB_KEY = "qb:" + CERT;
  function qbStats() {
    return Store.get(QB_KEY, {});
  }
  function qbSave(s) {
    Store.set(QB_KEY, s);
  }

  function initQuestionBank() {
    var root = $(".qb");
    if (!root) return;
    var data = certData().questions || [];
    var domainSel = $('[data-role="qb-domain"]');
    var diffSel = $('[data-role="qb-difficulty"]');
    var modeSel = $('[data-role="qb-mode"]');
    var stage = $('[data-role="qb-stage"]');
    var emptyBox = $('[data-role="qb-empty"]');
    var cardBox = $('[data-role="qb-card"]');
    var posEl = $('[data-role="qb-position"]');
    var scoreEl = $('[data-role="qb-score"]');
    var nextBtn = $('[data-role="qb-next"]');
    var favBtn = $('[data-role="qb-favorite"]');

    certMeta().domains.forEach(function (d) {
      var o = el("option");
      o.value = d.id;
      o.textContent = d.name;
      domainSel.appendChild(o);
    });

    var queue = [],
      pointer = 0,
      right = 0,
      done = 0;

    function filtered() {
      var stats = qbStats();
      return data.filter(function (q) {
        if (domainSel.value && q.domain !== domainSel.value) return false;
        if (diffSel.value && q.difficulty !== diffSel.value) return false;
        var st = stats[q.id] || {};
        if (modeSel.value === "unseen" && st.answered) return false;
        if (modeSel.value === "wrong" && st.correct !== false) return false;
        if (modeSel.value === "favorites" && !st.favorite) return false;
        return true;
      });
    }

    $('[data-action="qb-start"]').addEventListener("click", function () {
      queue = shuffle(filtered());
      pointer = 0;
      right = 0;
      done = 0;
      if (!queue.length) {
        stage.hidden = true;
        emptyBox.hidden = false;
        return;
      }
      emptyBox.hidden = true;
      stage.hidden = false;
      showCurrent();
    });

    nextBtn.addEventListener("click", function () {
      pointer++;
      if (pointer >= queue.length) {
        cardBox.innerHTML =
          '<div class="score-hero"><p class="score-big">' +
          Math.round((right / Math.max(done, 1)) * 100) +
          "%</p><p>You answered " +
          right +
          " of " +
          done +
          " correctly.</p></div>";
        nextBtn.disabled = true;
        favBtn.disabled = true;
        posEl.textContent = "Session complete";
        return;
      }
      showCurrent();
    });

    favBtn.addEventListener("click", function () {
      var q = queue[pointer];
      var stats = qbStats();
      stats[q.id] = stats[q.id] || {};
      stats[q.id].favorite = !stats[q.id].favorite;
      qbSave(stats);
      reflectFav(q);
    });

    function reflectFav(q) {
      var fav = (qbStats()[q.id] || {}).favorite;
      favBtn.innerHTML = (fav ? "\u2605" : "\u2606") + " Favorite";
      favBtn.classList.toggle("is-active", !!fav);
    }

    function showCurrent() {
      var q = queue[pointer];
      nextBtn.disabled = true;
      favBtn.disabled = false;
      posEl.textContent = "Question " + (pointer + 1) + " of " + queue.length;
      scoreEl.textContent = done ? right + "/" + done + " correct" : "";
      reflectFav(q);
      cardBox.innerHTML = "";
      cardBox.setAttribute("data-qid", q.id);
      cardBox.appendChild(
        renderQuestion(q, {
          onAnswer: function (correct) {
            done++;
            if (correct) right++;
            scoreEl.textContent = right + "/" + done + " correct";
            nextBtn.disabled = false;
            var stats = qbStats();
            stats[q.id] = stats[q.id] || {};
            stats[q.id].answered = true;
            stats[q.id].correct = correct;
            qbSave(stats);
          },
        })
      );
    }
  }

  /* ---------------- Mock exams tool ---------------- */
  var MOCK_KEY = "mock:" + CERT;
  function initMockExams() {
    var root = $(".mock");
    if (!root) return;
    var exams = certData()["mock-exams"] || [];
    var bank = certData().questions || [];
    var meta = certMeta();
    var listBox = $('[data-role="mock-list"]');
    var stage = $('[data-role="mock-stage"]');
    var report = $('[data-role="mock-report"]');
    var cardBox = $('[data-role="mock-card"]');
    var titleEl = $('[data-role="mock-title"]');
    var posEl = $('[data-role="mock-position"]');
    var timerEl = $('[data-role="mock-timer"]');
    var paletteEl = $('[data-role="mock-palette"]');
    var flagBtn = $('[data-role="mock-flag"]');

    var attempts = Store.get(MOCK_KEY, { history: [] });

    function pickQuestions(exam) {
      if (exam.questionIds && exam.questionIds.length) {
        return exam.questionIds
          .map(function (id) {
            return bank.filter(function (q) {
              return q.id === id;
            })[0];
          })
          .filter(Boolean);
      }
      // Auto-select by domain weighting.
      var count = exam.questionCount || 25;
      var byDomain = {};
      bank.forEach(function (q) {
        (byDomain[q.domain] = byDomain[q.domain] || []).push(q);
      });
      var picked = [];
      meta.domains.forEach(function (d) {
        var n = Math.round(count * d.weight);
        var pool = shuffle(byDomain[d.id] || []);
        picked = picked.concat(pool.slice(0, n));
      });
      // Top up / trim to count.
      if (picked.length < count) {
        var remaining = shuffle(
          bank.filter(function (q) {
            return picked.indexOf(q) === -1;
          })
        );
        picked = picked.concat(remaining.slice(0, count - picked.length));
      }
      return shuffle(picked).slice(0, count);
    }

    function renderList() {
      listBox.innerHTML = "";
      exams.forEach(function (exam) {
        var hist = attempts.history.filter(function (h) {
          return h.examId === exam.id;
        });
        var best = hist.reduce(function (m, h) {
          return Math.max(m, h.score);
        }, 0);
        var card = el("div", "mock-summary-card");
        card.innerHTML =
          "<div><h3>" +
          esc(exam.title) +
          "</h3><p class='muted'>" +
          (exam.questionCount || 25) +
          " questions · " +
          exam.timeLimitMin +
          " min · pass " +
          Math.round((exam.passScore || meta.passScore) * 100) +
          "%" +
          (hist.length
            ? " · best " + Math.round(best * 100) + "% (" + hist.length + " taken)"
            : "") +
          "</p></div>";
        var btn = el("button", "btn btn-primary", hist.length ? "Retake" : "Start exam");
        btn.type = "button";
        btn.addEventListener("click", function () {
          startExam(exam);
        });
        card.appendChild(btn);
        listBox.appendChild(card);
      });
    }

    var session = null;
    var timerId = null;

    function startExam(exam) {
      var qs = pickQuestions(exam);
      session = {
        exam: exam,
        questions: qs,
        answers: {},
        flags: {},
        pointer: 0,
        remaining: (exam.timeLimitMin || 60) * 60,
      };
      listBox.parentNode && (listBox.style.display = "none");
      report.hidden = true;
      stage.hidden = false;
      titleEl.textContent = exam.title;
      buildPalette();
      showQuestion();
      startTimer();
      window.scrollTo(0, 0);
    }

    function startTimer() {
      clearInterval(timerId);
      timerId = setInterval(function () {
        session.remaining--;
        renderTimer();
        if (session.remaining <= 0) {
          clearInterval(timerId);
          finishExam();
        }
      }, 1000);
      renderTimer();
    }
    function renderTimer() {
      var m = Math.floor(session.remaining / 60);
      var s = session.remaining % 60;
      timerEl.textContent =
        (m < 10 ? "0" : "") + m + ":" + (s < 10 ? "0" : "") + s;
      timerEl.classList.toggle("low", session.remaining <= 60);
    }

    function buildPalette() {
      paletteEl.innerHTML = "";
      session.questions.forEach(function (q, i) {
        var b = el("button", "pal-btn", String(i + 1));
        b.type = "button";
        b.addEventListener("click", function () {
          session.pointer = i;
          showQuestion();
        });
        paletteEl.appendChild(b);
      });
    }
    function refreshPalette() {
      $$(".pal-btn", paletteEl).forEach(function (b, i) {
        var q = session.questions[i];
        b.classList.toggle("answered", session.answers[q.id] != null);
        b.classList.toggle("flagged", !!session.flags[q.id]);
        b.classList.toggle("current", i === session.pointer);
      });
    }

    function showQuestion() {
      var q = session.questions[session.pointer];
      posEl.textContent =
        "Question " + (session.pointer + 1) + " of " + session.questions.length;
      flagBtn.classList.toggle("is-active", !!session.flags[q.id]);
      cardBox.innerHTML = "";
      cardBox.setAttribute("data-qid", q.id);
      var isMulti = q.type === "multi" || Array.isArray(q.answer);
      var stem =
        '<div class="q-meta"><span class="q-tag">' +
        esc(domainName(q.domain)) +
        "</span>" +
        (isMulti ? '<span class="q-tag">select all that apply</span>' : "") +
        '</div><p class="q-stem">' +
        esc(q.question) +
        "</p>";
      var wrap = el("div");
      wrap.innerHTML = stem;
      var ul = el("ul", "q-options");
      var saved = session.answers[q.id] || [];
      q.options.forEach(function (opt, i) {
        var li = el("li", "q-option" + (saved.indexOf(i) !== -1 ? " selected" : ""));
        li.setAttribute("data-i", i);
        li.innerHTML =
          '<span class="opt-key">' +
          String.fromCharCode(65 + i) +
          '</span><span class="opt-text">' +
          esc(opt) +
          "</span>";
        li.addEventListener("click", function () {
          var cur = session.answers[q.id] || [];
          if (isMulti) {
            var pos = cur.indexOf(i);
            if (pos === -1) cur.push(i);
            else cur.splice(pos, 1);
          } else {
            cur = [i];
          }
          session.answers[q.id] = cur;
          showQuestion();
          refreshPalette();
        });
        ul.appendChild(li);
      });
      wrap.appendChild(ul);
      cardBox.appendChild(wrap);
      refreshPalette();
    }

    $('[data-action="mock-next"]').addEventListener("click", function () {
      if (session.pointer < session.questions.length - 1) {
        session.pointer++;
        showQuestion();
      }
    });
    $('[data-action="mock-prev"]').addEventListener("click", function () {
      if (session.pointer > 0) {
        session.pointer--;
        showQuestion();
      }
    });
    flagBtn.addEventListener("click", function () {
      var q = session.questions[session.pointer];
      session.flags[q.id] = !session.flags[q.id];
      flagBtn.classList.toggle("is-active", !!session.flags[q.id]);
      refreshPalette();
    });
    $('[data-action="mock-submit"]').addEventListener("click", function () {
      var unanswered = session.questions.filter(function (q) {
        return session.answers[q.id] == null;
      }).length;
      var msg = unanswered
        ? "You have " + unanswered + " unanswered question(s). Submit anyway?"
        : "Submit your exam for grading?";
      if (confirm(msg)) finishExam();
    });

    function finishExam() {
      clearInterval(timerId);
      var qs = session.questions;
      var domainAgg = {};
      var correctCount = 0;
      qs.forEach(function (q) {
        var ans = session.answers[q.id] || [];
        var answerArr = Array.isArray(q.answer) ? q.answer : [q.answer];
        var correct =
          ans.length === answerArr.length &&
          ans.every(function (a) {
            return answerArr.indexOf(a) !== -1;
          });
        if (correct) correctCount++;
        var da = (domainAgg[q.domain] = domainAgg[q.domain] || { c: 0, t: 0 });
        da.t++;
        if (correct) da.c++;
      });
      var score = correctCount / qs.length;
      var passScore = session.exam.passScore || meta.passScore;
      var pass = score >= passScore;

      attempts.history.push({
        examId: session.exam.id,
        score: score,
        pass: pass,
        ts: Date.now(),
        domains: domainAgg,
      });
      Store.set(MOCK_KEY, attempts);

      stage.hidden = true;
      report.hidden = false;
      var domainRows = Object.keys(domainAgg)
        .map(function (d) {
          var a = domainAgg[d];
          var pct = Math.round((a.c / a.t) * 100);
          return (
            '<div class="dr-row"><span class="dr-name">' +
            esc(domainName(d)) +
            "</span><span class='num'>" +
            a.c +
            "/" +
            a.t +
            " (" +
            pct +
            '%)</span><div class="dr-bar"><span style="width:' +
            pct +
            '%"></span></div></div>'
          );
        })
        .join("");
      var weak = Object.keys(domainAgg)
        .map(function (d) {
          return { d: d, pct: domainAgg[d].c / domainAgg[d].t };
        })
        .filter(function (x) {
          return x.pct < 0.7;
        })
        .sort(function (a, b) {
          return a.pct - b.pct;
        });
      report.innerHTML =
        '<div class="score-hero"><p class="score-big ' +
        (pass ? "pass" : "fail") +
        '">' +
        Math.round(score * 100) +
        "%</p><p>" +
        correctCount +
        " of " +
        qs.length +
        " correct — " +
        (pass ? "Pass" : "Below passing (" + Math.round(passScore * 100) + "%)") +
        "</p></div>" +
        "<h2>Domain breakdown</h2><div class='domain-readiness'>" +
        domainRows +
        "</div>" +
        (weak.length
          ? "<h2>Focus areas</h2><p>Prioritise revision in:</p><ul>" +
            weak
              .map(function (w) {
                return "<li>" + esc(domainName(w.d)) + "</li>";
              })
              .join("") +
            "</ul>"
          : "<h2>Focus areas</h2><p>Strong across all domains — great work!</p>") +
        '<div class="btn-row" style="margin-top:18px"><button class="btn btn-primary" data-action="mock-restart">Back to exams</button></div>';
    }

    report.addEventListener("click", function (e) {
      if (e.target.closest('[data-action="mock-restart"]')) {
        report.hidden = true;
        listBox.style.display = "";
        attempts = Store.get(MOCK_KEY, { history: [] });
        renderList();
        window.scrollTo(0, 0);
      }
    });

    renderList();
  }

  /* ---------------- Flashcards tool ---------------- */
  var FC_KEY = "fc:" + CERT;
  function initFlashcards() {
    var root = $(".fc");
    if (!root) return;
    var cards = certData().flashcards || [];
    var deckSel = $('[data-role="fc-deck"]');
    var filterSel = $('[data-role="fc-filter"]');
    var shuffleCb = $('[data-role="fc-shuffle"]');
    var stage = $('[data-role="fc-stage"]');
    var emptyBox = $('[data-role="fc-empty"]');
    var cardEl = $('[data-role="fc-card"]');
    var frontEl = $('[data-role="fc-front"]');
    var backEl = $('[data-role="fc-back"]');
    var posEl = $('[data-role="fc-position"]');
    var deckNameEl = $('[data-role="fc-deck-name"]');

    var decks = {};
    cards.forEach(function (c) {
      decks[c.deck] = true;
    });
    Object.keys(decks).forEach(function (d) {
      var o = el("option");
      o.value = d;
      o.textContent = d;
      deckSel.appendChild(o);
    });

    function status() {
      return Store.get(FC_KEY, {});
    }
    var queue = [],
      pointer = 0;

    function filtered() {
      var st = status();
      return cards.filter(function (c) {
        if (deckSel.value && c.deck !== deckSel.value) return false;
        var s = st[c.id];
        if (filterSel.value === "review" && s !== "review") return false;
        if (filterSel.value === "unseen" && s) return false;
        return true;
      });
    }

    $('[data-action="fc-start"]').addEventListener("click", function () {
      queue = filtered();
      if (shuffleCb.checked) queue = shuffle(queue);
      pointer = 0;
      if (!queue.length) {
        stage.hidden = true;
        emptyBox.hidden = false;
        return;
      }
      emptyBox.hidden = true;
      stage.hidden = false;
      show();
    });

    function show() {
      var c = queue[pointer];
      cardEl.classList.remove("flipped");
      frontEl.innerHTML = esc(c.front);
      backEl.innerHTML = esc(c.back);
      posEl.textContent = "Card " + (pointer + 1) + " of " + queue.length;
      deckNameEl.textContent = c.deck;
    }
    function mark(state) {
      var c = queue[pointer];
      var st = status();
      st[c.id] = state;
      Store.set(FC_KEY, st);
      pointer++;
      if (pointer >= queue.length) {
        stage.hidden = true;
        emptyBox.hidden = false;
        emptyBox.innerHTML = "<p>Deck complete! " + queue.length + " cards reviewed.</p>";
        return;
      }
      show();
    }

    cardEl.addEventListener("click", function () {
      cardEl.classList.toggle("flipped");
    });
    $('[data-action="fc-known"]').addEventListener("click", function () {
      mark("known");
    });
    $('[data-action="fc-review"]').addEventListener("click", function () {
      mark("review");
    });
  }

  /* ---------------- Labs tool ---------------- */
  function initLabs() {
    var root = $(".labs");
    if (!root) return;
    var labs = certData().labs || [];
    var trackSel = $('[data-role="lab-track"]');
    var levelSel = $('[data-role="lab-level"]');
    var listBox = $('[data-role="labs-list"]');
    var detail = $('[data-role="lab-detail"]');
    var bodyBox = $('[data-role="lab-body"]');

    var tracks = {};
    labs.forEach(function (l) {
      tracks[l.track] = true;
    });
    Object.keys(tracks).forEach(function (t) {
      var o = el("option");
      o.value = t;
      o.textContent = t;
      trackSel.appendChild(o);
    });

    function renderList() {
      var items = labs.filter(function (l) {
        if (trackSel.value && l.track !== trackSel.value) return false;
        if (levelSel.value && l.level !== levelSel.value) return false;
        return true;
      });
      listBox.innerHTML = "";
      if (!items.length) {
        listBox.innerHTML = '<p class="muted">No labs match those filters.</p>';
        return;
      }
      items.forEach(function (l) {
        var card = el("div", "lab-card");
        card.innerHTML =
          "<h3>" +
          esc(l.title) +
          "</h3><p class='muted'>" +
          esc(l.objective) +
          '</p><div class="lab-tags"><span class="q-tag">' +
          esc(l.track) +
          '</span><span class="q-tag">' +
          esc(l.level) +
          "</span></div>";
        card.addEventListener("click", function () {
          openLab(l);
        });
        listBox.appendChild(card);
      });
    }

    function block(title, content, isCode) {
      if (!content) return "";
      var inner = isCode
        ? "<pre><code>" + esc(content) + "</code></pre>"
        : "<p>" + esc(content) + "</p>";
      return '<div class="lab-section"><h2>' + esc(title) + "</h2>" + inner + "</div>";
    }
    function listBlock(title, arr) {
      if (!arr || !arr.length) return "";
      return (
        '<div class="lab-section"><h2>' +
        esc(title) +
        "</h2><ul>" +
        arr
          .map(function (x) {
            return "<li>" + esc(x) + "</li>";
          })
          .join("") +
        "</ul></div>"
      );
    }
    function promptBlock(arr) {
      if (!arr || !arr.length) return "";
      return (
        '<div class="lab-section"><h2>Prompt examples</h2>' +
        arr
          .map(function (p) {
            return "<pre><code>" + esc(p) + "</code></pre>";
          })
          .join("") +
        "</div>"
      );
    }

    function openLab(l) {
      listBox.style.display = "none";
      $(".labs-controls").style.display = "none";
      detail.hidden = false;
      bodyBox.innerHTML =
        '<header class="doc-head"><div class="eyebrow">' +
        esc(l.track) +
        " · " +
        esc(l.level) +
        "</div><h1>" +
        esc(l.title) +
        "</h1></header>" +
        block("Objective", l.objective) +
        block("Scenario", l.scenario) +
        block("Starter code", l.starterCode, true) +
        promptBlock(l.prompts) +
        block("Expected output", l.expectedOutput, true) +
        block("Explanation", l.explanation) +
        listBlock("Variations", l.variations) +
        listBlock("Best practices", l.bestPractices);
      initCodeCopy();
      window.scrollTo(0, 0);
    }

    $('[data-action="lab-back"]').addEventListener("click", function () {
      detail.hidden = true;
      listBox.style.display = "";
      $(".labs-controls").style.display = "";
    });
    trackSel.addEventListener("change", renderList);
    levelSel.addEventListener("change", renderList);
    renderList();
  }

  /* ---------------- Dashboard tool ---------------- */
  function initDashboard() {
    var grid = $(".dash-grid");
    if (!grid) return;
    var data = certData();
    var questions = data.questions || [];
    var flashcards = data.flashcards || [];

    // Reading progress
    var totalPages = (CERTHUB.searchIndex || []).filter(function (e) {
      return e.url.indexOf(CERT + "/") === 0;
    }).length;
    var readCount = Object.keys(Progress.all()).filter(function (u) {
      return u.indexOf(CERT + "/") === 0;
    }).length;
    var readPct = totalPages ? Math.round((readCount / totalPages) * 100) : 0;
    var ring = $('[data-role="reading-ring"]');
    if (ring) ring.style.setProperty("--pct", readPct);
    setText("reading-pct", readPct + "%");
    setText("reading-done", readCount);
    setText("reading-total", totalPages);

    // Question bank
    var qstats = Store.get("qb:" + CERT, {});
    var answered = 0,
      correct = 0;
    Object.keys(qstats).forEach(function (id) {
      if (qstats[id].answered) {
        answered++;
        if (qstats[id].correct) correct++;
      }
    });
    setText("qb-answered", answered);
    setText("qb-accuracy", answered ? Math.round((correct / answered) * 100) + "%" : "0%");

    // Mock exams
    var mock = Store.get("mock:" + CERT, { history: [] });
    var best = mock.history.reduce(function (m, h) {
      return Math.max(m, h.score);
    }, 0);
    setText("mock-best", mock.history.length ? Math.round(best * 100) + "%" : "—");
    setText("mock-count", mock.history.length);

    // Flashcards
    var fc = Store.get("fc:" + CERT, {});
    var known = Object.keys(fc).filter(function (k) {
      return fc[k] === "known";
    }).length;
    setText("fc-known", known);

    // Domain readiness
    var drBox = $('[data-role="domain-readiness"]');
    if (drBox) {
      var byDomain = {};
      questions.forEach(function (q) {
        byDomain[q.domain] = byDomain[q.domain] || { c: 0, t: 0 };
      });
      Object.keys(qstats).forEach(function (id) {
        var q = questions.filter(function (x) {
          return x.id === id;
        })[0];
        if (!q || !qstats[id].answered) return;
        byDomain[q.domain] = byDomain[q.domain] || { c: 0, t: 0 };
        byDomain[q.domain].t++;
        if (qstats[id].correct) byDomain[q.domain].c++;
      });
      drBox.innerHTML = certMeta().domains
        .map(function (d) {
          var a = byDomain[d.id] || { c: 0, t: 0 };
          var pct = a.t ? Math.round((a.c / a.t) * 100) : 0;
          return (
            '<div class="dr-row"><span class="dr-name">' +
            esc(d.name) +
            "</span><span class='num'>" +
            (a.t ? a.c + "/" + a.t : "not started") +
            '</span><div class="dr-bar"><span style="width:' +
            pct +
            '%"></span></div></div>'
          );
        })
        .join("");
    }

    fillLinkList("bookmark-list", Bookmarks.all(), "No bookmarks yet.");
    fillLinkList("recent-list", Store.get("recent", []), "Nothing viewed yet.");
    var notes = Notes.all();
    var noteItems = Object.keys(notes).map(function (u) {
      return { url: u, title: notes[u].title, text: notes[u].text };
    });
    var notesBox = $('[data-role="notes-list"]');
    if (notesBox) {
      if (!noteItems.length) {
        notesBox.innerHTML = '<li class="muted">No notes yet. Add notes from any content page.</li>';
      } else {
        notesBox.innerHTML = noteItems
          .map(function (n) {
            return (
              '<li><a href="' +
              ROOT +
              esc(n.url) +
              '">' +
              esc(n.title) +
              "</a><p class='muted'>" +
              esc(n.text.slice(0, 140)) +
              "</p></li>"
            );
          })
          .join("");
      }
    }

    // Data management
    bindClick("export-progress", function () {
      var dump = {};
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k.indexOf("certhub:") === 0) dump[k] = localStorage.getItem(k);
      }
      var blob = new Blob([JSON.stringify(dump, null, 2)], { type: "application/json" });
      var a = el("a");
      a.href = URL.createObjectURL(blob);
      a.download = "certhub-progress.json";
      a.click();
    });
    bindClick("import-progress", function () {
      var input = el("input");
      input.type = "file";
      input.accept = "application/json";
      input.addEventListener("change", function () {
        var file = input.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function () {
          try {
            var obj = JSON.parse(reader.result);
            Object.keys(obj).forEach(function (k) {
              localStorage.setItem(k, obj[k]);
            });
            alert("Progress imported. Reloading.");
            location.reload();
          } catch (e) {
            alert("Could not read that file.");
          }
        };
        reader.readAsText(file);
      });
      input.click();
    });
    bindClick("reset-all", function () {
      if (!confirm("This clears all CertHub progress, bookmarks, and notes on this device. Continue?"))
        return;
      var keys = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k.indexOf("certhub:") === 0 && k !== "certhub:theme") keys.push(k);
      }
      keys.forEach(function (k) {
        localStorage.removeItem(k);
      });
      location.reload();
    });

    function setText(role, val) {
      var e = $('[data-role="' + role + '"]');
      if (e) e.textContent = val;
    }
    function fillLinkList(role, items, emptyMsg) {
      var box = $('[data-role="' + role + '"]');
      if (!box) return;
      if (!items.length) {
        box.innerHTML = '<li class="muted">' + emptyMsg + "</li>";
        return;
      }
      box.innerHTML = items
        .map(function (b) {
          return '<li><a href="' + ROOT + esc(b.url) + '">' + esc(b.title) + "</a></li>";
        })
        .join("");
    }
    function bindClick(action, fn) {
      var b = $('[data-action="' + action + '"]');
      if (b) b.addEventListener("click", fn);
    }
  }

  /* ---------------- Easter egg: creator card ---------------- */
  function creatorInfo() {
    return (CERTHUB.site && CERTHUB.site.author) || { name: "the CertHub maker" };
  }

  function showCreatorCard() {
    if (document.querySelector(".creator-overlay")) return;
    var a = creatorInfo();
    var overlay = el("div", "creator-overlay");
    var links = "";
    if (a.linkedin) {
      links +=
        '<a class="creator-link" href="' +
        esc(a.linkedin) +
        '" target="_blank" rel="noopener noreferrer">LinkedIn &rarr;</a>';
    }
    overlay.innerHTML =
      '<div class="creator-card" role="dialog" aria-modal="true" aria-label="About the creator">' +
      '<button class="creator-close" aria-label="Close">&times;</button>' +
      '<div class="creator-badge" aria-hidden="true">&#10003;</div>' +
      "<h2>" +
      esc(a.name || "CertHub") +
      "</h2>" +
      (a.handle ? '<p class="creator-handle">@' + esc(a.handle) + "</p>" : "") +
      '<p class="creator-role">' +
      esc(a.role || "Creator of CertHub") +
      "</p>" +
      '<p class="creator-msg">You found a hidden easter egg &#129370; Thanks for exploring CertHub!</p>' +
      (links ? '<div class="creator-links">' + links + "</div>" : "") +
      '<p class="creator-hint">Ways in: Konami code &middot; type &ldquo;certhub&rdquo; &middot; click the logo mark 5&times; &middot; open the console</p>' +
      "</div>";
    function close() {
      overlay.remove();
      document.removeEventListener("keydown", onEsc);
    }
    function onEsc(ev) {
      if (ev.key === "Escape") close();
    }
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay || (e.target.closest && e.target.closest(".creator-close"))) close();
    });
    document.addEventListener("keydown", onEsc);
    document.body.appendChild(overlay);
  }

  function initEasterEggs() {
    // 1) Console art + greeting
    try {
      var a = creatorInfo();
      var big = "color:#5b9bff;font-size:22px;font-weight:800;";
      var sub = "color:#9db0d0;font-size:12px;";
      console.log("%cCertHub", big);
      console.log(
        "%cCreated by " + (a.name || "") + (a.handle ? " (@" + a.handle + ")" : ""),
        sub
      );
      if (a.linkedin) console.log("%c" + a.linkedin, sub);
      console.log(
        '%cPsst\u2026 try the Konami code, type "certhub", or click the logo mark 5\u00d7.',
        sub
      );
    } catch (e) {}

    // 2) Konami code: up up down down left right left right B A
    var seq = [38, 38, 40, 40, 37, 39, 37, 39, 66, 65];
    var pos = 0;
    document.addEventListener("keydown", function (e) {
      pos = e.keyCode === seq[pos] ? pos + 1 : e.keyCode === seq[0] ? 1 : 0;
      if (pos === seq.length) {
        pos = 0;
        showCreatorCard();
      }
    });

    // 3) Type the secret word "certhub"
    var typed = "";
    document.addEventListener("keydown", function (e) {
      var tag = (e.target && e.target.tagName) || "";
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target && e.target.isContentEditable)) return;
      if (e.key && e.key.length === 1) {
        typed = (typed + e.key.toLowerCase()).slice(-7);
        if (typed === "certhub") {
          typed = "";
          showCreatorCard();
        }
      }
    });

    // 4) Click the logo mark 5x quickly (keeps the text link navigating home)
    var mark = $(".brand-mark");
    if (mark) {
      var clicks = 0;
      var timer = null;
      mark.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        clicks++;
        if (clicks >= 5) {
          clicks = 0;
          showCreatorCard();
        }
        clearTimeout(timer);
        timer = setTimeout(function () {
          clicks = 0;
        }, 1500);
      });
    }
  }

  /* ---------------- Progressive Web App ---------------- */
  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    if (location.protocol !== "http:" && location.protocol !== "https:") return;
    window.addEventListener("load", function () {
      navigator.serviceWorker.register(ROOT + "sw.js").catch(function () {});
    });
  }

  /* ---------------- Activity trace (attached to bug reports) ----------
     A short, in-session breadcrumb of what the user did, kept only in
     sessionStorage (cleared when the tab closes) and only ever shared if
     the user chooses to include diagnostics in a report. No network,
     no third parties, no personal data beyond what the user types. */
  var Trace = {
    KEY: "certhub:trace",
    MAX: SITE_LIMITS.traceMax || 40,
    DETAIL: SITE_LIMITS.traceDetailChars || 120,
    read: function () {
      try {
        return JSON.parse(sessionStorage.getItem(this.KEY)) || [];
      } catch (e) {
        return [];
      }
    },
    write: function (list) {
      try {
        sessionStorage.setItem(this.KEY, JSON.stringify(list.slice(-this.MAX)));
      } catch (e) {}
    },
    log: function (kind, detail) {
      try {
        var list = this.read();
        var last = list[list.length - 1];
        var d = (detail == null ? "" : String(detail)).slice(0, this.DETAIL);
        if (last && last.k === kind && last.d === d) return; // de-dupe repeats
        list.push({ t: Date.now(), k: kind, d: d });
        this.write(list);
      } catch (e) {}
    },
    clear: function () {
      this.write([]);
    },
  };

  function initTrace() {
    Trace.log("view", PAGE_TITLE + " (" + (PAGE_URL || "home") + ")");

    window.addEventListener("error", function (e) {
      var where = e && e.filename
        ? " @" + String(e.filename).split("/").pop() + ":" + (e.lineno || "?")
        : "";
      Trace.log("error", ((e && e.message) || "script error") + where);
    });
    window.addEventListener("unhandledrejection", function (e) {
      var r = e && e.reason;
      Trace.log("error", "promise: " + ((r && (r.message || r)) || "rejected"));
    });

    // Capture-phase so we still see clicks that stop propagation.
    document.addEventListener(
      "click",
      function (e) {
        var t = e.target.closest("button, a[href], [data-action], .q-option, .fc-card");
        if (!t || t.closest(".feedback-overlay")) return;
        var action = t.getAttribute("data-action");
        var label = (t.getAttribute("aria-label") || t.textContent || "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 60);
        var kind = t.tagName === "A" ? "nav" : "click";
        Trace.log(kind, (action ? "[" + action + "] " : "") + label);
      },
      true
    );
  }

  /* ---------------- Feedback & suggestions (serverless) --------------
     Collects issue reports and suggestions with zero backend. The report
     is handed off through user-chosen channels: a pre-filled GitHub issue,
     a pre-filled email, copy-to-clipboard, or a downloaded file. */
  var Feedback = {
    // Report shapes live in the shared, testable lib (assets/js/lib/feedback.js).
    types: function () {
      return (
        fbLib().TYPES || [
          { v: "content", label: "Content error", cat: "issue" },
          { v: "feedback", label: "General feedback", cat: "feedback" },
          { v: "other", label: "Something else", cat: "issue" },
        ]
      );
    },
    cfg: function () {
      return (CERTHUB.site && CERTHUB.site.feedback) || { enabled: true };
    },
    version: function () {
      return (CERTHUB.site && CERTHUB.site.version) || "";
    },
    typeLabel: function (v) {
      return fbLib().typeLabel ? fbLib().typeLabel(v) : v;
    },
    typeCategory: function (v) {
      if (fbLib().typeCategory) return fbLib().typeCategory(v);
      var m = this.types().filter(function (x) {
        return x.v === v;
      })[0];
      return m ? m.cat : "issue";
    },
    currentQuestion: function () {
      var card = document.querySelector(
        '[data-role="qb-card"][data-qid], [data-role="mock-card"][data-qid]'
      );
      if (!card) return null;
      var stem = card.querySelector(".q-stem");
      var max = SITE_LIMITS.questionTextChars || 200;
      return {
        id: card.getAttribute("data-qid") || "",
        text: stem ? stem.textContent.replace(/\s+/g, " ").trim().slice(0, max) : "",
      };
    },
    context: function () {
      var h1 = document.querySelector(".doc h1, .hero h1, h1");
      var eyebrow = document.querySelector(".doc-eyebrow, .breadcrumbs");
      return {
        version: this.version(),
        page: PAGE_TITLE || (h1 ? h1.textContent.trim() : document.title),
        module: eyebrow ? eyebrow.textContent.replace(/\s+/g, " ").trim() : "",
        cert: CERT,
        url: location.href,
        path: PAGE_URL || "(home)",
        question: this.currentQuestion(),
        timestamp: new Date().toISOString(),
        theme: document.documentElement.getAttribute("data-theme") || "",
        language: navigator.language || "",
        viewport: window.innerWidth + "×" + window.innerHeight,
        screen: (screen.width || "?") + "×" + (screen.height || "?"),
        userAgent: navigator.userAgent,
      };
    },
    diagnosticsText: function (ctx) {
      var q = ctx.question;
      var lines = [
        "Version: " + (ctx.version || "n/a"),
        "Page: " + ctx.page + " (" + ctx.path + ")",
        ctx.module ? "Module: " + ctx.module : "",
        "URL: " + ctx.url,
        q ? "Question: " + q.id + " — " + q.text : "",
        "Time: " + ctx.timestamp,
        "Theme / language: " + ctx.theme + " / " + ctx.language,
        "Viewport / screen: " + ctx.viewport + " / " + ctx.screen,
        "User agent: " + ctx.userAgent,
      ].filter(Boolean);
      var trace = Trace.read();
      if (trace.length) {
        lines.push("");
        lines.push("Recent activity (most recent last):");
        trace.forEach(function (ev, i) {
          var ts = new Date(ev.t).toISOString().slice(11, 19);
          lines.push("  " + (i + 1) + ". " + ts + " [" + ev.k + "] " + ev.d);
        });
      }
      return lines.join("\n");
    },
    reportText: function (data) {
      return fbLib().reportText(data);
    },
    reportMarkdown: function (data) {
      return fbLib().reportMarkdown(data);
    },
    githubUrl: function (repo, data) {
      return fbLib().githubUrl(repo, data, SITE_LIMITS.issueTitleChars || 60);
    },
    mailtoUrl: function (email, data) {
      return fbLib().mailtoUrl(email, data);
    },
    download: function (data) {
      var blob = new Blob([this.reportText(data)], { type: "text/plain" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "certhub-feedback-" + Date.now() + ".txt";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () {
        URL.revokeObjectURL(a.href);
      }, 2000);
    },
    open: function (presetType) {
      if (this.cfg().enabled === false) return;
      if (document.querySelector(".feedback-overlay")) return;
      var self = this;
      var ctx = this.context();
      var cfg = this.cfg();

      var overlay = el("div", "feedback-overlay");
      var opts = this.types()
        .map(function (t) {
          var sel = t.v === presetType ? " selected" : "";
          return '<option value="' + t.v + '"' + sel + ">" + esc(t.label) + "</option>";
        })
        .join("");
      var fbTitle = SITE_UI.feedbackTitle || "Report an issue, suggest something, or share feedback";
      var fbIntro =
        SITE_UI.feedbackIntro ||
        "Help improve CertHub. Nothing is sent automatically — you choose how to send it.";

      overlay.innerHTML =
        '<div class="feedback-card" role="dialog" aria-modal="true" aria-labelledby="fb-title">' +
        '<button class="feedback-close" aria-label="Close">&times;</button>' +
        '<h2 id="fb-title">' + esc(fbTitle) + "</h2>" +
        '<p class="feedback-sub">' + esc(fbIntro) + "</p>" +
        '<label class="feedback-field"><span>What is this about?</span>' +
        '<select data-role="fb-type">' + opts + "</select></label>" +
        '<label class="feedback-field"><span>Details <em>(required)</em></span>' +
        '<textarea data-role="fb-message" rows="5" placeholder="Describe the issue or your suggestion. For a wrong answer, tell us which option you think is correct and why."></textarea></label>' +
        '<label class="feedback-field"><span>Your email <em>(optional, for follow-up)</em></span>' +
        '<input type="email" data-role="fb-email" autocomplete="email" placeholder="you@example.com" /></label>' +
        '<label class="feedback-check"><input type="checkbox" data-role="fb-diag" checked /> ' +
        "Include diagnostics (page, browser & recent activity)</label>" +
        '<details class="feedback-diag"><summary>Preview diagnostics</summary><pre data-role="fb-diag-preview"></pre></details>' +
        '<p class="feedback-error" data-role="fb-error" hidden>Please add a few words of detail first.</p>' +
        '<div class="feedback-actions" data-role="fb-actions"></div>' +
        '<p class="feedback-note" data-role="fb-note"></p>' +
        "</div>";

      var card = $(".feedback-card", overlay);
      var typeSel = $('[data-role="fb-type"]', overlay);
      var msgEl = $('[data-role="fb-message"]', overlay);
      var emailEl = $('[data-role="fb-email"]', overlay);
      var diagEl = $('[data-role="fb-diag"]', overlay);
      var diagPre = $('[data-role="fb-diag-preview"]', overlay);
      var errEl = $('[data-role="fb-error"]', overlay);
      var actions = $('[data-role="fb-actions"]', overlay);
      var noteEl = $('[data-role="fb-note"]', overlay);

      diagPre.textContent = this.diagnosticsText(ctx);

      function collect() {
        var includeDiag = diagEl.checked;
        return {
          type: typeSel.value,
          message: msgEl.value.trim(),
          email: emailEl.value.trim(),
          includeDiag: includeDiag,
          diagnostics: includeDiag ? self.diagnosticsText(ctx) : "",
          ctx: ctx,
        };
      }
      function validate() {
        if (!msgEl.value.trim()) {
          errEl.hidden = false;
          msgEl.focus();
          return false;
        }
        errEl.hidden = true;
        return true;
      }

      // Build the available send channels. Email is always offered: the
      // mail app opens pre-filled with the report (recipient comes from
      // config when set, otherwise the user fills it in). mailto can't
      // attach files, so diagnostics travel in the body — use Download
      // for a file to attach manually.
      var btns = [];
      if (cfg.githubRepo) {
        btns.push({
          cls: "btn btn-primary",
          label: "Open a GitHub issue",
          run: function () {
            if (!validate()) return;
            window.open(self.githubUrl(cfg.githubRepo, collect()), "_blank", "noopener");
          },
        });
      }
      btns.push({
        cls: "btn" + (cfg.githubRepo ? " btn-ghost" : " btn-primary"),
        label: "Email",
        run: function () {
          if (!validate()) return;
          window.location.href = self.mailtoUrl(cfg.email || "", collect());
          noteEl.textContent = cfg.email
            ? "Opening your mail app…"
            : "Opening your mail app — add a recipient to send.";
        },
      });
      btns.push({
        cls: "btn btn-ghost",
        label: "Copy report",
        run: function () {
          if (!validate()) return;
          var text = self.reportText(collect());
          if (navigator.clipboard) {
            navigator.clipboard.writeText(text).then(function () {
              noteEl.textContent = "Report copied to your clipboard — paste it wherever you like.";
            });
          } else {
            noteEl.textContent = "Clipboard unavailable — use Download instead.";
          }
        },
      });
      btns.push({
        cls: "btn btn-ghost",
        label: "Download",
        run: function () {
          if (!validate()) return;
          self.download(collect());
          noteEl.textContent = "Report downloaded. Attach it to an email or message.";
        },
      });

      function renderActions() {
        actions.innerHTML = "";
        var cat = self.typeCategory(typeSel.value);
        // Optional external suggestion form.
        if (cat === "suggest" && cfg.suggestionsUrl) {
          var s = el("button", "btn btn-primary", "Open suggestion form");
          s.type = "button";
          s.addEventListener("click", function () {
            window.open(cfg.suggestionsUrl, "_blank", "noopener");
          });
          actions.appendChild(s);
        }
        btns.forEach(function (b) {
          var el2 = el("button", b.cls, esc(b.label));
          el2.type = "button";
          el2.addEventListener("click", b.run);
          actions.appendChild(el2);
        });
        if (!cfg.githubRepo && !cfg.email) {
          noteEl.textContent =
            "Tip: set feedback.email or feedback.githubRepo in content/site.json for one-click sending.";
        } else {
          noteEl.textContent = "";
        }
      }
      renderActions();
      typeSel.addEventListener("change", renderActions);
      diagEl.addEventListener("change", function () {
        diagPre.textContent = diagEl.checked ? self.diagnosticsText(ctx) : "(diagnostics will not be included)";
      });

      function close() {
        overlay.remove();
        document.removeEventListener("keydown", onEsc);
      }
      function onEsc(ev) {
        if (ev.key === "Escape") close();
      }
      overlay.addEventListener("click", function (e) {
        if (e.target === overlay || (e.target.closest && e.target.closest(".feedback-close"))) close();
      });
      document.addEventListener("keydown", onEsc);
      document.body.appendChild(overlay);
      setTimeout(function () {
        msgEl.focus();
      }, 30);
    },
  };

  function initFeedbackLauncher() {
    if (Feedback.cfg().enabled === false) return;
    if (document.querySelector(".feedback-fab")) return;
    var label = SITE_UI.feedbackLabel || "Feedback";
    var fab = el(
      "button",
      "feedback-fab",
      '<span class="fab-ico" aria-hidden="true">\uD83D\uDCAC</span><span class="fab-label">' +
        esc(label) +
        "</span>"
    );
    fab.type = "button";
    fab.setAttribute("data-action", "open-feedback");
    fab.setAttribute("aria-label", "Report an issue or suggest something");
    fab.title = "Report an issue or suggest something";
    document.body.appendChild(fab);
  }

  /* ---------------- Init ---------------- */
  document.addEventListener("DOMContentLoaded", function () {
    var yr = $('[data-role="year"]');
    if (yr) yr.textContent = new Date().getFullYear();

    initTrace();
    Search.ready();
    initCodeCopy();
    initScrollSpy();
    initReadState();
    initNotesWidget();
    Bookmarks.reflect();
    recordVisit();

    initQuestionBank();
    initMockExams();
    initFlashcards();
    initLabs();
    initDashboard();

    initEasterEggs();
    registerServiceWorker();
    initFeedbackLauncher();
  });
})();
