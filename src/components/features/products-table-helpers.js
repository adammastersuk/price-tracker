export const hasCompetitorData = (competitorData) => {
  if (competitorData == null) return false;
  if (Array.isArray(competitorData)) return competitorData.length > 0;
  if (typeof competitorData === "object") return Object.keys(competitorData).length > 0;
  return false;
};

export const shouldShowCompetitorInlineNote = (
  label,
  competitorData,
) => label !== "In line with competitor" || hasCompetitorData(competitorData);

export const checkedAtPill = (checkedAt) => {
  if (!checkedAt) return null;
  const checkedDate = new Date(checkedAt);
  const isOlderThanDay = Date.now() - checkedDate.getTime() > 24 * 60 * 60 * 1000;
  const label = isOlderThanDay
    ? `Checked ${checkedDate.toLocaleDateString([], { day: "2-digit", month: "short" })}, ${checkedDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
    : `Checked ${checkedDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;

  return {
    label,
    tone: isOlderThanDay
      ? "border border-rose-200 bg-rose-100 text-rose-700"
      : "border border-emerald-200 bg-emerald-100 text-emerald-800",
  };
};
