// ─── Hover explanations for every Analysis card and headline number ─────────────
// Three parts each: what the number is, exactly how it is calculated, and what to make of it.
// Cards are keyed by their Section id (or title when a card has no id); headline tiles and review rows by label.
// The formulas describe what the code actually computes (lib/analysis.ts, focusModel.ts, waste.ts, flow.ts,
// execution.ts and the SQL in supabase/migrations); keep them in step when a formula changes.

export interface Explanation {
  what: string;
  how: string;
  read: string;
}

// Shared phrases, so the same idea is always worded the same way
const COUNTED = 'Counted time = tracked minutes minus sleep and ignored activities (timer-only minutes count).';
const CHANGE = 'The "vs before" line only shows an arrow when the change is bigger than your normal day-to-day swing (80% interval over finished days).';
const DEEP = 'Deep focus = focus-work minutes inside an unbroken run of 30+ minutes on one activity (any gap or change of activity ends the run).';
const FOCUS_WORK = 'Focus work = activities weighted by your focus demand (or Work 100% / Admin 80% until any demand is set), plus task-linked blocks and timer sessions.';
const DEPTH = 'Depth per 10-minute block: warms up over the first 20 minutes of a run, stays high, eases off after 90 minutes; an interruption drops it back to warm-up, and recent switches lower it.';

const t = (what: string, how: string, read: string): Explanation => ({ what, how, read });

/** Headline tiles, attention boxes and review rows, by label. */
const BY_LABEL: Record<string, Explanation> = {
  'Tracked': t(
    'How much of the time you logged anything at all, sleep included.',
    'Tracked = 10 min × blocks with an activity (+ timer-session minutes on otherwise empty blocks). For today, only time that has already passed counts.',
    'This measures logging, not effort. Low tracked time means every other number rests on less data.',
  ),
  'Tracked / day': t(
    'Average logged time per day.',
    'Sum of tracked minutes ÷ finished days that have any tracking. Days with nothing logged are left out, not counted as zero.',
    `Higher means the picture is more complete. ${CHANGE}`,
  ),
  'Deep focus': t(
    'Focus work you did in long, unbroken stretches.',
    `${DEEP} ${FOCUS_WORK}`,
    'The best single number for "real work got done". 1-3 h a day is a strong day for most people; short scattered focus counts as focus but not as deep.',
  ),
  'Deep focus / day': t(
    'Average deep focus per tracked day.',
    `The mean of each finished day's deep focus, over days with any tracking (today, still in progress, is left out). ${DEEP}`,
    `Use it to compare periods, not to judge a single day. ${CHANGE}`,
  ),
  'Focus quality': t(
    'How deep your focus work was, 0-100.',
    `Average depth of all focus-work blocks × 100. ${DEPTH}`,
    'Above ~70 means long settled stretches; below ~40 means focus work kept getting broken up. It says nothing about how much you did; pair it with deep focus.',
  ),
  'Logged': t(
    'Share of elapsed time that has something recorded.',
    'Logged % = tracked minutes ÷ elapsed minutes × 100 (only time that has passed; future time is never counted).',
    'This is a data-quality number, not a productivity one. Below ~70% the other cards are guessing more than they should.',
  ),
  'Productivity': t(
    'How valuable your counted time was, by your own ratings.',
    `Score = productivity points ÷ counted minutes, where points = Σ minutes × the activity's multiplier (-5 to +5, set per activity). ${COUNTED}`,
    `+1 pts/min would mean every minute was on an activity you rated +1. Near 0 means good and bad time cancel out, or nothing has a multiplier. ${CHANGE}`,
  ),
  'Waste': t(
    'Time on activities you rated as costly.',
    'Waste = minutes on non-ignored activities with a negative multiplier. Untracked time is never waste.',
    'Look at the trend and the triggers rather than one day. The Waste tab shows when it starts and what leads to it.',
  ),
  'Waste / day': t(
    'Average waste per day.',
    'Waste minutes ÷ finished days with counted time. Waste = minutes on activities with a negative multiplier.',
    `Compare it with your own past, not an ideal of zero. ${CHANGE}`,
  ),
  'Share of your time': t(
    'What fraction of your counted time went to waste.',
    `Waste share = waste minutes ÷ counted minutes × 100. ${COUNTED}`,
    'Steadier than waste minutes when you track more or less on some days.',
  ),
  'Weighted waste': t(
    'Waste weighted by how bad you rated it.',
    'Weighted waste = Σ minutes × |multiplier| over waste activities. 30 min at -0.5 = 15 pts; 30 min at -2 = 60 pts.',
    'Tells you whether the waste was mostly mild or mostly the stuff you rated as really costly.',
  ),
  'Days with waste': t(
    'How many finished days had any waste.',
    'Count of finished days with waste > 0 ÷ finished days with counted time.',
    'Rare-but-big waste and small-but-daily waste call for different fixes; this separates them.',
  ),
  'Tasks done': t(
    'Tasks completed in the range.',
    'Count of tasks whose completion time falls inside the range. Tasks completed before completion times were recorded cannot be placed.',
    'A count, not a quality measure: one big task and five small ones look different here.',
  ),
  'Peak window': t(
    'The time of day you most reliably do deep work.',
    'From the focus model: deep-focus density per 30-min slot over working days, recency-weighted (45-day half-life), smoothed and shrunk toward your average; the window is the run of slots above halfway between your average and your peak (1-5 h).',
    'Protect this window for your hardest work. "Tentative" means too few days to be sure.',
  ),
  'Timer': t(
    'Minutes recorded with the focus timer.',
    'Sum of timer-session minutes per day (analytics_daily.task_focus_minutes).',
    'Only counts when you use the timer, so it undercounts focus unless the timer is a habit.',
  ),
  'Switches': t(
    'How often you changed activity.',
    'Count of changes from one activity to a different one with less than 30 minutes of untracked time between them.',
    'A raw count grows with tracked time; the Switching card on Trends shows it per hour.',
  ),
  'Switches / hour': t(
    'How often you changed activity per hour of counted time.',
    `Switches ÷ counted hours. A gap of 30+ minutes ends a sequence instead of counting as a switch. ${COUNTED}`,
    'Lower is calmer. Above ~2 per hour, focus rarely has time to warm up.',
  ),
  'Most common next step': t(
    'The activity you most reliably go to after another one.',
    'For each pair A → B: times B started within 30 min of A ending ÷ all switches out of A, ranked by the lower end of an 80% interval so thin data cannot win.',
    'Strong habits are visible here; a waste activity as the "next step" is a trigger worth breaking.',
  ),
  'Untracked': t(
    'Share of time with nothing logged, on days you tracked anything.',
    'Untracked % = (elapsed − tracked) ÷ elapsed × 100, over days with at least one block. Days with no tracking at all are counted separately.',
    'Untracked is unknown, not idle. The heatmap below shows where you usually forget.',
  ),
  'Open tasks': t(
    'Tasks not completed yet.',
    'Count of tasks with completed = false; overdue = those whose deadline has passed.',
    'Watch the trend in "created vs done" rather than the count itself.',
  ),
  'Created vs done / week': t(
    'Tasks added vs tasks finished per week.',
    'Average tasks created per week / completed per week, over the weeks since completion times started being recorded.',
    'If more arrive than leave for weeks, the list grows no matter how hard you work: cut or delegate, not just do more.',
  ),
  'Typical time to done': t(
    'How long a task usually takes from creation to completion.',
    'Median hours between created_at and completed_at over completed tasks.',
    'A median, so a few ancient tasks do not distort it. Rising means tasks sit longer before you act.',
  ),
  'How scattered days are': t(
    'After a switch, how many different places you typically go.',
    'Per day: conditional entropy H(next | current) of activity switches, shown as 2^H; the tile is the median day.',
    '1 = your switches follow fixed paths; 3+ = the day scatters. Scattered days usually come with less deep focus.',
  ),
  'Goal hours': t(
    'Hours spent on activities linked to your goals.',
    'Σ minutes on each goal\'s linked activities while the goal was active (analytics_goal_daily) ÷ 60.',
    'Compare with what the goals need; the Goals page shows the pace required.',
  ),
  'Attention spent': t(
    'How much of your attention the period took.',
    'Attention points = Σ counted minutes × the activity\'s focus demand ÷ 5, so demand works as a 0-1 weight: 60 min at demand 5 = 60 pts, at demand 4 = 48 pts.',
    'A capacity number, not a score: more is not better. Compare it with your typical day to spot overloaded or light days.',
  ),
  'Productivity value': t(
    'What that time was worth by your own ratings.',
    'Productivity points = Σ counted minutes × the activity\'s multiplier (-5 to +5).',
    'Positive means valuable time outweighed costly time.',
  ),
  'Attention efficiency': t(
    'Value bought per point of attention.',
    'Efficiency = productivity points ÷ attention points, where attention = minutes × demand ÷ 5 (each day\'s value is stored only once it has 6+ attention points). Each activity on its own scores multiplier ÷ (demand ÷ 5): multiplier 0.8 at demand 5 = 0.8; at demand 3 = 1.33. Neutral and costly activities pull it down.',
    'Around your best activity\'s multiplier (about 0.5-1) means your attention mostly went to valuable work; near 0 means a lot of it went to neutral or costly things. Compare it with your own other periods: 0.5 → 0.7 is a real improvement.',
  ),
};

// Review rows reuse the tile explanations under their own wording
const ROW_ALIASES: Record<string, string> = {
  'Tracked time': 'Tracked',
  'Deep focus (30+ min runs)': 'Deep focus',
  'Time waste': 'Waste',
};
BY_LABEL['Timer focus'] = BY_LABEL['Timer'];
BY_LABEL['Tasks completed'] = BY_LABEL['Tasks done'];
BY_LABEL['Average sleep'] = t(
  'Average sleep per night.',
  'For each night waking inside the period: consecutive blocks on your sleep activity (across midnight), summed; then the mean over nights with any sleep logged.',
  '7-9 h is the usual adult range. Nights without sleep blocks are left out, not counted as zero.',
);
BY_LABEL['Habit consistency'] = t(
  'How often you did your daily habits on the days they were due.',
  'Done ÷ due habit-days (daily and weekday habits), with an 80% interval; today counts only once logged.',
  'The interval matters with few days: 3 of 4 is "somewhere between 45% and 95%".',
);

/** Cards, by Section id (or title for cards without an id). */
const BY_SECTION: Record<string, Explanation> = {
  // ── Day ──
  'day-summary': t(
    'How the day\'s 24 hours split up, by category or by activity.',
    'Minutes per category = 10 × blocks on its activities. Untracked = elapsed minutes − tracked. For today the rest of the day shows as remaining.',
    'Untracked is unknown, not wasted. A big untracked slice means the rest of the analysis is working from less.',
  ),
  'day-timeline': t(
    'The day as a list of stretches.',
    'Consecutive blocks with the same activity are merged into one segment; empty blocks become untracked segments.',
    'Many short segments = a fragmented day. Long segments on focus work are where deep focus comes from.',
  ),
  'day-review': t(
    'Plain answers built from the day\'s data.',
    'Completed = tasks with a completion time on this date. Most time = biggest category (sleep and untracked excluded). Productivity = points ÷ counted minutes. Move to tomorrow = open tasks due today.',
    'A quick end-of-day check; the reflection below is for what the data cannot know.',
  ),
  'day-reflection': t(
    'Your own rating and notes for the day.',
    'Nothing is calculated: the 1-7 energy rating and the four prompts are stored as you write them.',
    'After 14+ rated days, energy can be compared with sleep, focus and waste.',
  ),
  'dv-hourly': t(
    'What you did in each hour of the day.',
    'Minutes per activity in every clock hour (top 6 activities; the rest grouped as Other).',
    'Shows the shape of the day: when you started, where it got busy, where it went quiet.',
  ),
  'dv-where': t(
    'The day\'s share by activity.',
    'Minutes per activity ÷ elapsed minutes.',
    'Compare with what you meant the day to be about.',
  ),
  'dv-runs': t(
    'Every stretch of 30+ minutes on one activity this day.',
    'Runs of 3+ consecutive blocks on the same activity that counted as focus work. Any gap or change of activity ends a run, the same rule as the Deep focus tile.',
    'These are your real focus blocks. A day with none had no sustained work, whatever the total says.',
  ),
  'dv-depth': t(
    'How deep focus was through the day, per half hour, and what you were doing at each point.',
    `Height = average depth (0-100) of each half hour's blocks (non-focus time counts as 0), smoothed over neighbouring half hours; colour = the activity with the most blocks in that half hour (sleep left out), blended where it changes. ${DEPTH}`,
    'A dip with another colour under it is a switch to something else; a dip in the same colour is an interruption or a long run tiring. A rising curve after a switch shows warm-up.',
  ),
  'dv-waste-stretches': t(
    'Each waste stretch of the day.',
    'Consecutive waste blocks (one untracked block inside is tolerated). "After" = the activity that ended within 20 min before it, or waking / an untracked gap. "Back in" = minutes until the next positive-multiplier block.',
    'The "after" column is where to intervene; a long "back in" means waste ended the productive day.',
  ),
  'dv-waste-when': t(
    'When in the day the waste happened.',
    'Waste minutes per activity in each 30-minute slot.',
    'Clusters at the same time across days point to a routine, not a lapse.',
  ),
  'dv-flow': t(
    'The day as a strip of flows.',
    'Each block is one flow: an unbroken stretch of a single activity. Changing activity starts a new flow, and so does 20 minutes or more untracked. Sleep is grey and the rest of today is faded.',
    'Long flows = continuous days; many short ones = a stop-start day.',
  ),
  'dv-gaps': t(
    'Which hours had nothing logged.',
    'Untracked minutes per clock hour (elapsed time only).',
    'Fill these in while you still remember; every other card gets more honest.',
  ),

  // ── Trends ──
  'trends-over-time': t(
    'Tracked time and deep focus, day by day (or week by week on long ranges).',
    `Tracked = minutes with an activity per day. ${DEEP} 6-month and 1-year ranges show weekly averages per tracked day.`,
    'The gap between the two areas is time that was tracked but not deep work.',
  ),
  'trends-distribution': t(
    'Where the range\'s time went, by category or by individual activity (switch at the top right).',
    'Minutes per category or per activity (analytics_activity_daily) ÷ elapsed minutes; Untracked = elapsed − tracked. In the activity view, beyond 12 activities the smallest are merged into "Other activities".',
    'Compare with what you want the split to be.',
  ),
  'trends-quality': t(
    'Focus quality day by day.',
    `Average depth × 100 per day; days with under 30 minutes of focus work are left blank. ${DEPTH}`,
    'A falling line with steady deep focus means you are working as long but more broken up.',
  ),
  'trends-productivity': t(
    'Productivity score day by day.',
    `Points ÷ counted minutes per day, points = Σ minutes × multiplier. ${COUNTED}`,
    'Look at the direction over weeks; single days swing a lot.',
  ),
  'productivity-points-history': t(
    'The productivity points you earned each day of the range, and their running total.',
    `Points per day = Σ minutes × the activity's multiplier (-5 to +5), from the backend's daily totals. ${COUNTED} Days with nothing tracked show as 0. On 6m and 1y each bar is one week's sum. Per tracked day = range total ÷ days with counted time.`,
    `Green bars gained points, red bars lost them; the running total shows whether the range adds up. ${CHANGE}`,
  ),
  'trends-fragmentation': t(
    'How long you stay on one thing and how often you change.',
    `Typical stretch = mean length of runs on one activity. Switches per hour = activity changes ÷ counted hours (a 30+ min gap breaks the sequence). Category switches = the subset that also changes category.`,
    'Fewer, longer stretches usually mean better focus. Category switches cost more than switches within a category.',
  ),
  'trends-estimates': t(
    'How your task estimates compare with the time tasks really took.',
    'Per completed task with a real estimate (minutes, or 2+ pomodoros) and 10+ tracked minutes: ratio = tracked ÷ estimated. Combined as a geometric mean with an 80% bootstrap range.',
    '×1.5 means tasks take 1.5× what you plan. Multiply future estimates by it until it drifts back toward ×1.',
  ),
  'trends-planning': t(
    'Estimated vs scheduled vs actual time on tasks with an estimate.',
    'Sums over estimated tasks: your estimates; future blocks linked to them (scheduled); past linked blocks (tracked); timer minutes.',
    'Shown side by side, not scored. Scheduled far below estimated means plans have no time reserved.',
  ),
  'trends-deadlines': t(
    'How often you finish tasks by their deadline.',
    'On time = completed at or before the deadline (date-only deadlines count until the end of that day) ÷ completed tasks with a deadline, with an 80% interval; lateness is the median of the late ones.',
    'Few tasks = wide interval; read the range, not just the percentage.',
  ),
  'trends-goals': t(
    'Hours on each active goal.',
    'Σ minutes on the goal\'s linked activities since it started (analytics_goal_daily). Recent pace = recency-weighted hours per week; needed = remaining hours ÷ weeks left.',
    'If recent pace is below needed, either the goal or the week has to change.',
  ),
  'attention-budget': t(
    'Attention spent next to the value it bought.',
    'Attention = Σ counted minutes × focus demand ÷ 5 (an hour at full demand = 60); value = Σ counted minutes × multiplier; efficiency = value ÷ attention (only above 6 attention points). The split colours each activity\'s attention by the sign of its multiplier.',
    'Attention is a capacity, not a score. Efficiency near your best activity\'s multiplier means attention went to valuable work; compare it with your own past.',
  ),
  'focus-curve': t(
    'When in the day you are productive.',
    'Per 30-min slot: "Per minute" = productivity points ÷ counted minutes in that slot; "Points" = points per day with tracking. Points = minutes × multiplier.',
    'Above the line is productive time, below is waste. Plan demanding work where the curve is highest.',
  ),
  'day-points': t(
    "Where this day's productivity points came from, half hour by half hour.",
    `Points per half hour = Σ minutes × the activity's multiplier (-5 to +5) for the counted blocks in it. ${COUNTED} Running total = points from midnight to the end of each half hour; its last value is the day's total, the same number as everywhere else. Typical (dashed) = the median running total of your last 28 days at each half hour, cut at the same time of day for today.`,
    'Green bars earned points, red bars lost them. Where the solid line climbs above the dashed one you are ahead of a usual day; flat or falling stretches are where the day leaked. The lists name the activities behind each gain and loss.',
  ),
  'day-focus-curve': t(
    'When in this day you were productive.',
    'Per 30-min slot: productivity points ÷ counted minutes (per minute) or the points themselves. Points = minutes × multiplier.',
    'Above the line is productive time, below is waste.',
  ),

  // ── Focus ──
  'focus-peak': t(
    'The model\'s best guess at your peak focus time, and how sure it is.',
    'Deep-focus density per 30-min slot over working days (1h+ of focus work), recency-weighted (45-day half-life), smoothed and shrunk toward your average; the window = slots above halfway between average and peak (1-5 h). Stability = how often a bootstrap over days finds the same window.',
    'A model, not a record. Trust it more as days and stability grow.',
  ),
  'focus-heatmap': t(
    'Deep-focus density by weekday and hour.',
    'Per weekday × hour: average depth of all observed blocks (non-focus time counts as 0), recency-weighted with a 60-day half-life, over every day (not only working days); blank cells have too little data.',
    'Bright cells are your reliable focus slots. Compare weekdays: some days may simply not have a focus slot. The peak window above uses a shorter 45-day memory and working days only, so the two can differ slightly.',
  ),
  'focus-quality': t(
    'Focus quality over time.',
    `Average depth × 100 per day (or week); blank when under 30 min of focus work. ${DEPTH}`,
    'Quality and quantity are separate: check deep focus alongside it.',
  ),
  'focus-runs': t(
    'How long your focus stretches are.',
    'Each focus-work block is assigned to the length of the unbroken run it belongs to; the bars are the share of focus minutes in each length bucket.',
    'Most focus in "under 30 min" means it never gets deep. Shifting time into 30-90 min runs is usually the biggest win.',
  ),
  'focus-timer': t(
    'Focus-timer minutes over time.',
    'Sum of timer-session minutes per day (or week).',
    'Only shows what you timed; it is a lower bound on focus.',
  ),
  'What you actually focused on': t(
    'Your logged 30+ minute unbroken runs, by activity and time of day.',
    'Runs of 3+ consecutive blocks on one activity (one 10-min interruption tolerated after 20 clean minutes), drawn where they happened.',
    'This is the record; the peak window above is the model.',
  ),
  '24-hour focus window by activity': t(
    'When in the day each activity\'s focused time happens.',
    'Per activity: focused minutes in each 30-min slot; the marked window is the core where half of its focused time falls.',
    'Activities with a tight window are routines; spread-out ones happen whenever.',
  ),
  'Focused time by activity': t(
    'Hours of 30+ minute runs per activity.',
    'Focused hours = minutes inside 30+ min runs; "focused" % = that ÷ all minutes on the activity.',
    'A low % means the activity mostly happens in short bursts.',
  ),

  // ── Waste ──
  'Time waste': t(
    'Time on activities you rated as costly.',
    'Waste = minutes on non-ignored activities with a negative multiplier.',
    'Set a negative multiplier on the activities you want less of to see this.',
  ),
  'waste-over-time': t(
    'Waste per day, split by activity.',
    'Minutes per waste activity per day (analytics_activity_daily.waste_minutes); long ranges show weekly averages per tracked day. The dashed line is the average per tracked day.',
    'Empty days had nothing tracked, not zero waste.',
  ),
  'waste-when': t(
    'When in the day waste happens.',
    'For each half hour: share of your tracked days that had that waste activity in that slot.',
    'A peak at the same time every day is a routine to replace, not a willpower problem.',
  ),
  'waste-weekday': t(
    'Waste by day of the week.',
    'Average waste minutes per tracked day of each weekday.',
    'Some weekdays are often structurally worse (weekends, lighter days).',
  ),
  'waste-by-activity': t(
    'Which activities make up your waste.',
    'Per activity: total minutes and weighted waste (analytics_activity_daily), number of stretches, median and longest stretch (from the blocks).',
    'Many short stretches vs few long ones need different fixes: blocking vs time limits.',
  ),
  'waste-triggers': t(
    'What you were doing right before waste started.',
    'For each waste stretch: the activity that ended within 20 minutes before it (or waking / an untracked gap). Rate = share of that activity\'s runs followed by waste, with an 80% interval; needs 3+ runs.',
    'A high rate after one activity is your best lever: plan what comes next after it.',
  ),
  'waste-longest': t(
    'Your longest waste stretches.',
    'Consecutive waste blocks (one untracked block tolerated), with what led into them and how long until productive work resumed.',
    'Look for the common starting point of the longest ones.',
  ),

  // ── Patterns ──
  'patterns-flow': t(
    'What usually follows what.',
    'Row → column: when the row activity ends and something else starts within 30 minutes, the share of those switches that go to the column activity (analytics_transition_daily). Rows add up to 100%.',
    'Strong cells are habits. A strong arrow into a waste activity is a trigger.',
  ),
  'patterns-gaps': t(
    'Where you usually forget to track.',
    'For each weekday × hour: untracked minutes ÷ elapsed minutes, over days with any tracking (3+ days needed).',
    'The darkest cells are where a reminder would help most.',
  ),
  'patterns-sleep': t(
    'Sleep against how the next day went.',
    'Each dot is one night: how long you slept (from your sleep blocks) and how the following finished day went. We check whether short nights and long nights lead to different days, and only call it a real pattern when luck is an unlikely explanation.',
    'With fewer than about 14 nights, treat results as hints. A link is not a cause: a busy week can cause both short sleep and a bad day.',
  ),

  // ── Execution ──
  'exec-funnel': t(
    'How many tasks make it from created to done on time.',
    'Each stage counts tasks that reached it (created → given a day → worked on → completed → done by the deadline); the % is the share of the previous measurable stage, with an 80% interval.',
    'The biggest drop between two stages is where intentions get lost.',
  ),
  'exec-flow': t(
    'Your task list as a queue.',
    'Tasks created per week against tasks completed per week, since completion times started being recorded.',
    'If more arrive than leave for weeks, the backlog grows regardless of effort.',
  ),
  'exec-done': t(
    'Time from creating a task to finishing it.',
    'Hours between created_at and completed_at: quartiles and the share done the same day.',
    'A long tail of old tasks is normal; watch the median.',
  ),
  'exec-calibration': t(
    'Estimates vs reality, by task size.',
    'Tracked time ÷ your estimate per task, combined as a geometric mean per size bucket (2× over and 2× under count as equally wrong). Only real estimates count (minutes or 2+ pomodoros).',
    'If big tasks run over more than small ones, split them before estimating.',
  ),
  'exec-turbulence': t(
    'How scattered your days are.',
    'Per day: entropy of where you go after each switch, shown as 2^H (the number of equally likely next places).',
    '1 = fixed paths; 3+ = scattered. The activities after which days scatter most are listed.',
  ),
  'exec-goals': t(
    'Whether each goal is speeding up or slowing down.',
    'Velocity = recency-weighted hours per week; acceleration = robust (Theil–Sen) slope of weekly hours over up to 8 complete weeks, judged against the goal\'s own typical week.',
    '"Slowing" or "stalled" is an early warning, relative to your own pace for that goal.',
  ),

  // ── Review ──
  'review-days': t(
    'Each day of the period.',
    `Tracked and deep focus per day. ${DEEP}`,
    'Shows whether the period was even or a few big days.',
  ),
  'review-energy': t(
    'Your daily energy ratings for the period.',
    'Average of the 1-7 ratings you gave in Day → Reflection; unrated days are left out.',
    'Needs 14+ rated days before comparing it with sleep or focus means anything.',
  ),
  'review-numbers': t(
    'Every number for the period, against the previous one.',
    `Totals over the period. ${CHANGE}`,
    '"No clear change" is an answer: the difference is within normal variation.',
  ),
  'review-where': t(
    'Where the period\'s time went, by category.',
    'Minutes per category ÷ elapsed minutes over the period.',
    'Compare with what the period was supposed to be about.',
  ),
  'review-goals': t(
    'Goal hours and your best focus window for the period.',
    'Goal hours = minutes on each goal\'s linked activities in the period ÷ 60. The focus window comes from the focus model over the period\'s days.',
    'Few days make the window tentative.',
  ),
  'review-compare': t(
    'This period vs the previous one, per day.',
    'Per-day averages over days with tracking: tracked, deep focus and timer minutes.',
    'The bars behind the change arrows in the table above.',
  ),
  'review-reflection': t(
    'Your written review of the period.',
    'Nothing is calculated; saved as you write it.',
    'The carry-over answer is a good start for next period\'s plan.',
  ),
};

export const explainLabel = (label: string): Explanation | undefined => BY_LABEL[ROW_ALIASES[label] ?? label];
export const explainSection = (idOrTitle: string | undefined): Explanation | undefined => (idOrTitle ? BY_SECTION[idOrTitle] : undefined);
