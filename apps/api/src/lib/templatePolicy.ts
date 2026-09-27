export const BRANDED_TEMPLATE_DOMAIN = "team.guidedstepswellness.com";

export type MailTemplatePolicyKey = "none" | "gsw_default" | "bible_reader";

export const templateKeyAllowedForAddress = (key: MailTemplatePolicyKey, address: string): boolean => {
  if (key === "none") return true;
  const domain = address.trim().toLowerCase().split("@").pop() ?? "";
  return domain === BRANDED_TEMPLATE_DOMAIN;
};

export const userHasBrandedTemplateAccess = (addresses: string[]): boolean =>
  addresses.some((address) => templateKeyAllowedForAddress("gsw_default", address));
