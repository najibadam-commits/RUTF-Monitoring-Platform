// The four steps every data request goes through (DECISIONS R93), shown to reviewers and requesters.

const STEPS = [
  { icon: "ph-paper-plane-tilt", title: "Request", body: "A Viewer asks for an export and says why they need it." },
  { icon: "ph-user-check", title: "Review", body: "An administrator approves or rejects it, with a note." },
  { icon: "ph-download-simple", title: "Download once", body: "An approved file is built for the requester's own access and can be fetched one time." },
  { icon: "ph-clock-counter-clockwise", title: "On record", body: "Who asked, who decided and when the file was taken stay in the history." },
];

export function AccessSteps() {
  return (
    <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
      {STEPS.map((s, i) => (
        <li key={s.title} className="card elev-sm" style={{ padding: 12, gap: 4, flexDirection: "row", alignItems: "flex-start", display: "flex" }}>
          <span style={{ width: 30, height: 30, borderRadius: 8, display: "grid", placeItems: "center", background: "var(--color-accent-100)", color: "var(--color-accent-700)", flex: "none" }}>
            <i className={`ph-fill ${s.icon}`} aria-hidden="true" style={{ fontSize: 16 }} />
          </span>
          <span>
            <span style={{ display: "block", fontWeight: 600, fontSize: 13 }}>{i + 1}. {s.title}</span>
            <span className="text-muted" style={{ display: "block", fontSize: 12 }}>{s.body}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}
