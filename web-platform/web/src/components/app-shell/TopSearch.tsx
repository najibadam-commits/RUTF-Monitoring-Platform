"use client";

import { useState } from "react";

export function TopSearch({ onSubmit }: { onSubmit: (query: string) => void }) {
  const [value, setValue] = useState("");

  return (
    <div style={{ flex: 1, maxWidth: 360, marginLeft: 16, position: "relative" }}>
      <i className="ph ph-magnifying-glass" style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", opacity: 0.5, fontSize: 14 }} />
      <input
        className="input"
        style={{ paddingLeft: 30 }}
        placeholder="Search issue ID, state, sector…"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && value.trim()) onSubmit(value.trim());
        }}
      />
    </div>
  );
}
