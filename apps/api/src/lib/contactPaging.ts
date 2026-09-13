export interface ContactPage<T> {
  contacts: T[];
  total: number;
  limit: number;
  offset: number;
}

export function paginateContacts<T>(items: T[], limit: number, offset: number): ContactPage<T> {
  return {
    contacts: items.slice(offset, offset + limit),
    total: items.length,
    limit,
    offset,
  };
}
