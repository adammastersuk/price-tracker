import { getSettingsConfig } from "@/lib/db";

function normalizeKey(value: string) {
  return value.trim().toLowerCase();
}

export async function normalizeBuyerDepartmentAndCompetitor(input: { buyer?: string; department?: string; competitorName?: string; }) {
  const settings = await getSettingsConfig();
  const buyerMap = new Map(settings.buyers.map((buyer) => [normalizeKey(buyer.name), buyer.name]));
  const departmentMap = new Map(settings.departments.map((department) => [normalizeKey(department.name), department.name]));
  const competitorMap = new Map(settings.competitors.map((competitor) => [normalizeKey(competitor.name), competitor.name]));

  const buyer = input.buyer ? (buyerMap.get(normalizeKey(input.buyer)) ?? input.buyer.trim()) : undefined;
  const department = input.department ? (departmentMap.get(normalizeKey(input.department)) ?? input.department.trim()) : undefined;
  const competitorName = input.competitorName ? (competitorMap.get(normalizeKey(input.competitorName)) ?? input.competitorName.trim()) : undefined;

  return { buyer, department, competitorName };
}
