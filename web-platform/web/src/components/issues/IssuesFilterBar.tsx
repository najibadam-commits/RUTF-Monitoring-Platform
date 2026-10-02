"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useRef } from "react";

export function IssuesFilterBar({
  statuses,
  categories,
  states,
  priorities,
  findingTypes,
}: {
  statuses: { value: string; label: string }[];
  categories: { id: string; name: string }[];
  states: { id: string; name: string }[];
  priorities: { value: string; label: string }[];
  /** RUTF Finding types (migration 0102) — filters by the rule that raised a Finding. */
  findingTypes: { value: string; label: string }[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function update(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value && value !== "All") params.set(key, value);
    else params.delete(key);
    params.delete("page");
    router.push(`/issues?${params.toString()}`);
  }

  const hasActiveFilters = ["search", "status", "category", "state", "priority", "source", "type"].some((k) => searchParams.get(k));
  // Keys the uncontrolled search input + selects to the active filter set, so they properly
  // remount (and re-apply their defaultValue) whenever filters change via something other than
  // typing/selecting directly in them — e.g. "Clear Filters" below, or browser back/forward.
  const remountKey = searchParams.toString();

  return (
    <div className="filter-bar" key={remountKey}>
      <input
        className="input"
        style={{ maxWidth: 220 }}
        placeholder="Search…"
        defaultValue={searchParams.get("search") ?? ""}
        onChange={(e) => {
          if (searchTimer.current) clearTimeout(searchTimer.current);
          const value = e.target.value;
          searchTimer.current = setTimeout(() => update("search", value), 350);
        }}
      />
      <select className="input" style={{ maxWidth: 170 }} defaultValue={searchParams.get("status") ?? "All"} onChange={(e) => update("status", e.target.value)}>
        <option value="All">All Status</option>
        {statuses.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>
      <select className="input" style={{ maxWidth: 210 }} defaultValue={searchParams.get("category") ?? "All"} onChange={(e) => update("category", e.target.value)}>
        <option value="All">All Sectors</option>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <select className="input" style={{ maxWidth: 170 }} defaultValue={searchParams.get("state") ?? "All"} onChange={(e) => update("state", e.target.value)}>
        <option value="All">All States</option>
        {states.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      <select className="input" style={{ maxWidth: 150 }} defaultValue={searchParams.get("priority") ?? "All"} onChange={(e) => update("priority", e.target.value)}>
        <option value="All">All Priorities</option>
        {priorities.map((p) => (
          <option key={p.value} value={p.value}>
            {p.label}
          </option>
        ))}
      </select>
      <select className="input" style={{ maxWidth: 170 }} defaultValue={searchParams.get("source") ?? "All"} onChange={(e) => update("source", e.target.value)}>
        <option value="All">Any source</option>
        <option value="auto">Automatic checks</option>
        <option value="manual">Registered by a person</option>
      </select>
      <select className="input" style={{ maxWidth: 200 }} defaultValue={searchParams.get("type") ?? "All"} onChange={(e) => update("type", e.target.value)}>
        <option value="All">All Finding types</option>
        {findingTypes.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </select>
      {hasActiveFilters && (
        <button className="btn btn-secondary" style={{ marginLeft: "auto" }} onClick={() => router.push("/issues")}>
          <i className="ph ph-x-circle" />
          Clear Filters
        </button>
      )}
    </div>
  );
}
