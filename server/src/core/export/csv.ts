// The spreadsheet formula guard every CSV export uses (W17-5). The rules live in shared/csv-guard.ts,
// which the web application uses too for the CSV files it makes in the browser (W19).
export { csvCell, csvQuote, FORMULA_START, guardFormula } from '../../../../shared/csv-guard.ts';
