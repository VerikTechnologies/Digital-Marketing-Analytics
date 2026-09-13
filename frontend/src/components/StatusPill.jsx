const VARIANTS = {
  active:    "pill--green",
  enabled:   "pill--green",
  draft:     "pill--gray",
  paused:    "pill--amber",
  completed: "pill--blue",
  archived:  "pill--gray",
  disabled:  "pill--red",
  false:     "pill--red",
  true:      "pill--green",
};

export default function StatusPill({ status, active }) {
  const key = active !== undefined ? String(active) : String(status || "").toLowerCase();
  const variant = VARIANTS[key] || "pill--gray";
  const label   = active !== undefined
    ? (active ? "Active" : "Disabled")
    : (status ? String(status).charAt(0).toUpperCase() + String(status).slice(1) : "—");

  return <span className={`pill ${variant}`}>{label}</span>;
}
