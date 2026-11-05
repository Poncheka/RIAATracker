// Deno entry point for reading any statement file: CSV/TSV/TXT (any encoding) or Excel.
import * as XLSX from "npm:xlsx@0.18.5";
import { parseStatementBytes, parseStatementTables, sniffBinary, type ParseOptions, type ParseResult } from "./statements.ts";
import { workbookTables } from "./workbook.ts";

export function readStatement(bytes: Uint8Array, opts: ParseOptions = {}): ParseResult {
  const kind = sniffBinary(bytes);
  if (kind === "xlsx" || kind === "xls") return parseStatementTables(workbookTables(XLSX, bytes), opts);
  return parseStatementBytes(bytes, opts);
}
