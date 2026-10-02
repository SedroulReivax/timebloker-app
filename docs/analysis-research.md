# Analysis research and method

Audit of every algorithm behind Analysis, done by running the old code on constructed scenarios whose right answer is
known, then rebuilding what failed. All numbers below were measured (see the tests named in each row).

## Findings about the old algorithms

| # | Old behaviour | Measured | Consequence |
|---|---|---|---|
| Consistency ("Avg Consistency") | Category-switching score averaged over all non-sleep blocks, with untracked blocks scored 0 | 4 h of perfect, uninterrupted work scored **19.8**. Tracking 2 h of extra leisure raised it to **29.6**, 6 h to **54.1**. Leisure scored higher than work (22.5 vs 19.8). | It measured how much of the day was tracked, not focus. It also could not see switches between two activities of the same category. |
| "Prod. Score" | Share of blocks in Work/Health/Admin | Identical for 8 h in two long runs and 8 h in 30 fragments | Category label only; blind to depth and fragmentation |
| Peak productivity hour | Hour bins; category-weighted (Admin x1.5 hard-coded); no uncertainty | Window edges bled into unobserved time | No sense of reliability |
| Trend percentages | `(a-b)/b` | 10 min -> 20 min reported **+100%** | Noise reported as change |
| Sleep correlations | Pearson with fixed cut-offs | On **pure noise, 25.1%** of 10-night datasets were called "moderate or strong" | Chance patterns reported as findings |
| Estimation accuracy | Ratio of sums | One huge accurate task + six small tasks that ran 3x: reported **+46%**; typical task **+200%** | Dominated by the biggest task; hid the planning fallacy |
| Goal pace | Flat 28-day mean | 8 days after stopping work it still showed **10.0 h/week** | Kept reporting a pace that no longer existed |
| Export "consistency" | Same flawed score, written into exported files | - | Bad numbers left the app |

## What replaced them

Shared toolkit `src/lib/stats.ts` (seeded, so results are reproducible): Wilson interval, percentile bootstrap,
bootstrap comparison of two samples, rank (Spearman) correlation with a permutation test, median difference with a
bootstrap interval, Theil-Sen slope, EWMA, geometric mean.

Canonical per-day profile `src/lib/analysis.ts` (every tab reads it, so a day cannot show two different numbers):

- **Three focus measures, not one blended score.** Focus share (focus-eligible share of tracked awake time), focus
  quality (depth 0-100), deep time (minutes in uninterrupted 30+ minute focus runs). Tracking more leisure now changes
  share, not quality (it moved 34 points before, at most 2 now).
- **Observed time only.** Untracked, sleep and future blocks are never judged. Timer-session blocks count as tracked
  focus time even if unpainted.
- **Measured fragmentation.** Run lengths, longest stretch, switches per tracked hour, and switches that also change
  category. A 30+ minute gap breaks a stretch instead of counting as a switch.
- **Comparisons with intervals.** Finished days only, days with no tracking excluded (a logging gap is not zero),
  bootstrap interval of the difference of means. Shown as up/down only when the 80% interval excludes zero; otherwise
  "no clear change" or "not enough days".
- **Weekday x hour heatmap** of deep-focus density, recency-weighted and shrunk toward the baseline, with blank cells
  where there is too little data.
- **Estimation accuracy per task on a multiplicative scale**: geometric mean of tracked/estimated with a bootstrap
  interval, share over estimate with a Wilson interval, median ratio. The scenario above now reports x2.56 (interval
  above 1) instead of +46%.
- **Deadline reliability** with a Wilson interval and how late late tasks were.

Peak focus (`src/lib/focusModel.ts`): per-block depth (warm-up, plateau, vigilance decrement, interruption tolerance,
fragmentation, timer/task boosts), working days only, recency weights, 30-minute slots, smoothing plus shrinkage,
half-maximum window restricted to observed slots, bootstrap stability, confidence label, weekday/weekend variants and a
second-wind window.

Sleep (`src/lib/sleepAnalysis.ts`): session segmentation into main sleep, naps and wake-ups; score built from four
visible parts; Sleep Regularity Index; sample standard deviation of bed/wake times; sleep-effect verdicts from a rank
correlation with a permutation test (`clear` needs p < 0.05 and an interval excluding zero). Simulated pure noise is
called "clear" less than 10% of the time (was about 25% "moderate or strong").

Goals (`src/lib/goals.ts`): recency-weighted weekly pace (EWMA of weekly totals), last-7-days figure, typical range
(25th-75th percentile), weeks-to-target range, and stall detection. The stall scenario now reports under 8 h/week and 8
stalled days.

Habits (`src/lib/habits.ts`): streaks unchanged; adds habit strength (recency-weighted, forgives one miss) and a Wilson
interval on the completion rate.

## Ideas these follow (inspirations, not validations)

- Wilson (1927) score interval for proportions; Efron (1979) bootstrap; permutation tests (Fisher); Spearman (1904).
- Theil-Sen robust slope; exponentially weighted averages.
- Empirical-Bayes shrinkage toward a group mean (Efron and Morris, 1973) for thin data.
- Full width at half maximum as the definition of a peak's extent.
- Vigilance decrement over prolonged tasks (Mackworth, 1948) for the fatigue part of focus depth.
- Planning fallacy (Kahneman and Tversky, 1979; Buehler, Griffin and Ross, 1994): estimates are systematically
  optimistic, so the natural correction is a multiplier.
- Sleep Regularity Index (Phillips et al., 2017); social jet lag (Wittmann et al., 2006).
- Loop Habit Tracker's exponentially smoothed habit score.
- "Deep work" (Newport, 2016) as the motivation for separating sustained focus from busy time.

## Checked against research (Sept 2026)

The per-block depth score in `scoreDay` was compared with current findings. What changed and what did not:

| Assumption | Research | Result |
|---|---|---|
| Warm-up to full depth over 30 min (0.6 / 0.8 / 0.92) | Getting into deep focus or flow is usually quoted at about 15-20 uninterrupted minutes (a practitioner figure, not a lab constant) | Changed to 0.6 / 0.85 / 1.0: full depth from 20 min |
| A single interrupting block keeps the run at full depth | Attention residue: part of your attention stays on the interrupting task (Leroy 2009). Mark measured ~23-25 min to resume an interrupted task | Changed: the run survives, but the resumed block scores at the 10-20 min level and climbs again |
| Switch penalty counts switches in a symmetric ±30 min window | Residue follows a switch; the time before it is barely affected | Changed: 0.08 per switch in the previous 30 min, 0.03 if a switch follows right after, cap 0.4 |
| Mild decline after 90 min (floor 0.75) | The time-on-task (vigilance) decrement is real, but its size depends on task and sleep pressure. A universal 90-min cycle is not well supported | Kept as a convention; documented as such |
| Peak window learned from your own data, not clock norms | Chronotype shifts peak times; the "synchrony effect" is real on average but inconsistent across studies. Most people dip ~1-4 PM | Kept. The peak card now adds context (hours after your usual wake, sleep-midpoint chronotype, overlap with 1-4 PM); it explains the window and never changes it |
| Depth comes from logged structure, not measured attention | Studies measure flow with EEG or experience sampling | A known limit. A 1-tap "how focused were you?" rating after timer sessions would let us check the proxy (backlog) |

Sources: Leroy 2009 (researchgate.net/publication/46489122); Mark's interruption research (contextcost.com/the-research,
freedom.to/blog/attention-spans-gloria-mark); vigilance and time-on-task (en.wikipedia.org/wiki/Vigilance_(psychology),
pmc.ncbi.nlm.nih.gov/articles/PMC3944366); 90-min cycle critique (scienceblog.com, Sept 2026); chronotype synchrony
review (tandfonline.com/doi/full/10.1080/07420528.2025.2490495; Collabra 2023, online.ucpress.edu/collabra/article/9/1/88337);
post-lunch dip (pubmed.ncbi.nlm.nih.gov/15892914).

## Release 10: activity focus, waste, ignored activities, patterns

**Record, not model.** The peak-focus card answers "when can I focus?" with a model (weights, shrinkage, bootstrap).
The new activity-focus cards (`src/lib/activityFocus.ts`) answer "when have I focused, and on what?" and are purely
descriptive: counts of logged time, no recency weighting, smoothing, shrinkage or prediction.

- Focused = inside a run of one activity holding 30+ minutes of it. One 10-minute blip between two blocks of the
  activity keeps the run alive but is not counted as that activity (so 20 + blip + 10 = 30 focused minutes, not 40).
  Any activity can be focused on, not only Work/Admin.
- "% of days" uses days with any judged tracking as the denominator. Fully untracked days are left out, not counted as
  zero focus.
- Core window = the shortest span of half-hour slots holding 50% of an activity's focused minutes (80% span also
  reported): a plain description of where it happened, not a prediction.

**Ignored activities** (`activities.analysis_ignored`, plus sleep always) are tracked but never judged. They count
toward coverage, the distribution donut and the Day timeline. They are left out of awake time, focus, waste and
productivity, and the focus scorer treats them as unobserved, like sleep. The flow map still shows them, because
ignoring is about judgement, not description.

**Productivity denominator fix.** The score used to divide by all assigned blocks, including sleep, so a night of
sleep pulled every day toward 0. It now divides by judged time (awake, non-ignored, plus timer-only blocks).

**Waste** (`src/lib/waste.ts`) = time on a non-ignored activity with a negative multiplier. Cost = minutes x
|multiplier|. Untracked time is never waste, and days with no judged tracking are not "zero waste" days (the daily
value is null).

- Stretches join consecutive waste blocks across waste activities, tolerating one untracked block.
- What led into a stretch: the activity that ended at most 20 minutes earlier, else "after waking" (the last thing
  logged was sleep), "after an untracked gap" or "start of the tracked day".
- Trigger rate: the share of an activity's runs followed by waste within 20 minutes, with an 80% Wilson interval. A
  raw count would blame whatever you do most often, and the interval stops two runs from being read as a habit.
- Return time: the median minutes from the end of a stretch to the next positive-multiplier block that day, plus the
  share of stretches with no return that day.

**Flow** (`src/lib/flow.ts`): transitions between runs with a gap under 30 minutes; a row-normalised probability
matrix; links shown as "habits" only with n >= 5.

**Logging gaps** (`loggingGaps` in `src/lib/insights.ts`): the untracked share per weekday hour, counted from the first
tracked day in the range, with cells needing 3+ days. It makes visible where every other graph is blind.

**Sleep vs next day** adds next-day waste and productivity and a scatter plot. The verdict still comes from the
permutation-tested rank correlation, never from the look of the dots.

## Known limits

- Focus-eligible categories default to Work (1.0) and Admin (0.8), plus task-linked blocks and timer sessions. Not yet
  configurable.
- The depth curve constants (warm-up 20 min, resume cost after a blip, decline after 90 min to a floor of 0.75) follow
  the research above, but they are not personalised or clinically validated.
- Everything is limited by what is tracked. Small samples are labelled tentative rather than hidden.
- Waste depends entirely on the multipliers you choose; the app never guesses which activities are waste.
- The flow map uses plain runs (no blip tolerance), so a 10-minute check of email in the middle of work counts as two
  transitions. That is intended: it is a real switch.
- Sleep nights use an 18:00-18:00 window; a gap over 2 hours splits the main sleep from a nap.
- Associations are never presented as causes.
