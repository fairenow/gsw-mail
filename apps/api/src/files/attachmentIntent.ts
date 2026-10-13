/**
 * Decide whether an attached file needs to be inspected before the AI turn.
 * Includes natural questions like "tell me what this CSV file is about".
 */
export function shouldPreAnalyzeAttachments(content: string): boolean {
  return /\b(analy[sz]e|read|review|summari[sz]e|extract|understand|inspect|what(?:'s| is) (?:in|inside)|tell me about|scope|requirements?|dates?|pricing|spreadsheet|workbook|csv|xlsx|xls|file|pdf|document|presentation|image|chart|table|clean|data)\b/i.test(content);
}
