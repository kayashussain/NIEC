// Plain words for the Dashboard's visa target (window.DashText), used by dashboard.js. The other Dashboard pages (Decisions, Channels
// and events, Universities and partners, Intake plan) are no longer offered (the Dashboard is one page now), so their code was removed
// (the review of 21 Nov 2026).
(function () {
  // ---- plain words for the target ----
  const targetSentence = (t) => {
    if (!t || !t.visas) return 'No visa target set for this intake yet.';
    if (t.status === 'reached') return `The target of ${t.visas} visas is reached.`;
    if (t.status === 'missed') return `The target of ${t.visas} visas was not reached: ${t.visasNow} visas were issued.`;
    if (t.expectedTotal === null || t.expectedTotal === undefined) return `${t.visasNow} of ${t.visas} visas issued. Not enough history yet for a forecast.`;
    const end = Math.round(t.expectedTotal);
    const range = t.forecast ? ` (${t.visasNow + t.forecast.low} to ${t.visasNow + t.forecast.high})` : ''; // the forecast counts only the visas still to come
    // The forecast follows how students moved forward in the earlier intakes.
    return `Forecast: about ${end} visas${range}. ${t.status === 'behind' ? `About ${Math.max(1, t.visas - end)} short of the target.` : `Meets the target of ${t.visas}.`}`;
  };
  const sayStatus = (t) => ({ reached: ['Reached', 'green'], 'on-track': ['On track', 'green'], behind: ['Behind the target', 'red'], missed: ['Missed', 'red'], unknown: ['Not enough history yet', 'amber'], none: ['No target set', 'amber'] }[(t && t.status) || 'none']);

  window.DashText = { targetSentence, sayStatus };
})();
