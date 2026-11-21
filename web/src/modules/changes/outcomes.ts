/**
 * The outcomes a change can be completed with: every value of the outcome list except "Canceled",
 * which only the Cancel change action sets (the server refuses it on completion).
 */
export const completionOutcomes = (values: { value: string }[]): string[] => values.map((v) => v.value).filter((v) => v !== 'cancelled');
