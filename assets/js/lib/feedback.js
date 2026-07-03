/* ===========================================================
   CertHub — feedback report builders (pure, no DOM / no network)
   Single source of truth shared by the browser app (loaded as a
   module, exposed on window.CertHubFeedback) and the Node unit
   tests (imported directly). Keep this file side-effect free
   except for the guarded window assignment at the bottom.
   =========================================================== */

/** Feedback categories a user can pick from.
    cat drives the send channels: "issue" | "suggest" | "feedback". */
export var TYPES = [
  { v: "content", label: "Content error (wrong / outdated info, typo)", cat: "issue" },
  { v: "question", label: "Question or answer issue", cat: "issue" },
  { v: "bug", label: "Site or app bug", cat: "issue" },
  { v: "suggest-topic", label: "Suggest a new topic / module", cat: "suggest" },
  { v: "suggest-question", label: "Suggest a new question & answer", cat: "suggest" },
  { v: "suggest-domain", label: "Suggest a domain / weighting update", cat: "suggest" },
  { v: "feedback", label: "General feedback — share your thoughts or experience", cat: "feedback" },
  { v: "other", label: "Something else", cat: "issue" },
];

/** Human label for a type value (falls back to the raw value). */
export function typeLabel(v) {
  for (var i = 0; i < TYPES.length; i++) {
    if (TYPES[i].v === v) return TYPES[i].label;
  }
  return v;
}

/** Category ("issue" | "suggest" | "feedback") for a type value. */
export function typeCategory(v) {
  for (var i = 0; i < TYPES.length; i++) {
    if (TYPES[i].v === v) return TYPES[i].cat;
  }
  return "issue";
}

/** Plain-text report body. `data.diagnostics` is a pre-rendered string
    that the caller supplies (kept out of here to stay DOM-free). */
export function reportText(data) {
  data = data || {};
  var out = [
    "CertHub feedback",
    "Type: " + typeLabel(data.type),
    data.email ? "From: " + data.email : "",
    "----------------------------------------",
    data.message || "(no description)",
  ].filter(Boolean);
  if (data.includeDiag && data.diagnostics) {
    out.push("");
    out.push("=== Diagnostics (included by reporter) ===");
    out.push(data.diagnostics);
  }
  return out.join("\n");
}

/** Markdown report body, used for pre-filled GitHub issues. */
export function reportMarkdown(data) {
  data = data || {};
  var out = ["**Type:** " + typeLabel(data.type), ""];
  if (data.email) out.push("**Contact:** " + data.email, "");
  out.push(data.message || "_(no description)_");
  if (data.includeDiag && data.diagnostics) {
    out.push("", "<details><summary>Diagnostics</summary>", "", "```");
    out.push(data.diagnostics);
    out.push("```", "", "</details>");
  }
  return out.join("\n");
}

/** Pre-filled "new GitHub issue" URL for a repo like "owner/name". */
export function githubUrl(repo, data, titleChars) {
  data = data || {};
  var n = titleChars || 60;
  var title =
    "[" + data.type + "] " + (data.message || "").slice(0, n).replace(/\s+/g, " ").trim();
  return (
    "https://github.com/" +
    repo +
    "/issues/new?title=" +
    encodeURIComponent(title || "CertHub feedback") +
    "&body=" +
    encodeURIComponent(reportMarkdown(data))
  );
}

/** mailto: URL that opens the user's mail app pre-filled with the report.
    `email` may be empty — the mail app still opens with subject + body. */
export function mailtoUrl(email, data) {
  data = data || {};
  return (
    "mailto:" +
    encodeURIComponent(email || "") +
    "?subject=" +
    encodeURIComponent("CertHub feedback: " + typeLabel(data.type)) +
    "&body=" +
    encodeURIComponent(reportText(data))
  );
}

/* Expose on the browser global. Module scripts run before
   DOMContentLoaded, so app.js can read this during init. */
if (typeof window !== "undefined") {
  window.CertHubFeedback = {
    TYPES: TYPES,
    typeLabel: typeLabel,
    typeCategory: typeCategory,
    reportText: reportText,
    reportMarkdown: reportMarkdown,
    githubUrl: githubUrl,
    mailtoUrl: mailtoUrl,
  };
}
