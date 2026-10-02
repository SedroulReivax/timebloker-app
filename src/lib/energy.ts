// Daily energy rating (reviews.energy, day reflections only): 1 = drained ... 7 = buzzing.
// Separate from sleep_logs.energy, which is a 1-5 "how did you feel on waking" rating.
export const ENERGY_MAX = 7;
export const ENERGY_LABELS: Record<number, string> = {
  1: 'Drained', 2: 'Very low', 3: 'Low', 4: 'Okay', 5: 'Good', 6: 'High', 7: 'Buzzing',
};
