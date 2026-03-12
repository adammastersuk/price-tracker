import { getSettingsConfig } from "@/lib/db";
import { withAliases } from "@/lib/matching";

function mapByNormalized(values: string[]) {
  return new Map(values.map((value) => [withAliases(value), value]));
}

export async function normalizeBuyerDepartmentAndCompetitor(input: { buyer?: string; department?: string; competitorName?: string; }) {
  const settings = await getSettingsConfig();
  const buyerMap = mapByNormalized(settings.buyers.map((buyer) => buyer.name));
  const departmentMap = mapByNormalized(settings.departments.map((department) => department.name));
  const competitorMap = mapByNormalized(settings.competitors.map((competitor) => competitor.name));

  const buyer = input.buyer ? (buyerMap.get(withAliases(input.buyer)) ?? input.buyer.trim()) : undefined;
  const department = input.department ? (departmentMap.get(withAliases(input.department)) ?? input.department.trim()) : undefined;
  const competitorName = input.competitorName ? (competitorMap.get(withAliases(input.competitorName)) ?? input.competitorName.trim()) : undefined;

  return { buyer, department, competitorName };
}
