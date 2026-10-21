/** Fail-closed workspace role check, independent of mailbox accounts. */
export function isActiveAdminMembership(row: { role: string; status: string }): boolean {
  return row.status === "active" && (row.role === "owner" || row.role === "admin");
}
