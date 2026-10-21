// Points rules (for display), levels and badges.
// The points themselves are calculated in the database by public.point_events(); keep RULES
// and DAILY_CAP below in step with that function when rebalancing.

export const RULES = [
  { id: "verdict", pts: 5, label: "Give a verdict" },
  { id: "review", pts: 15, label: "Write a review of 100+ characters" },
  { id: "short", pts: 5, label: "Write a shorter review (30–99 characters)" },
  { id: "scores", pts: 3, label: "Score all six parts" },
  { id: "early", pts: 5, label: "Give a verdict within 7 days of UK release" },
  { id: "like", pts: 2, label: "Someone likes your review" },
  { id: "commented", pts: 1, label: "Someone comments on your review" },
  { id: "comment", pts: 1, label: "Comment on a review (up to 10 a day)" },
  { id: "chat", pts: 1, label: "Post in a discussion (up to 10 a day)" },
  { id: "watched", pts: 1, label: "Mark a title as watched (up to 20 a day)" },
  { id: "follower", pts: 3, label: "Gain a follower" },
];
const PTS = Object.fromEntries(RULES.map(r => [r.id, r.pts]));
const DAILY_CAP = { comment: 10, chat: 10, watched: 20 };

export const LEVELS = [
  { name: "Extra", min: 0 },
  { name: "Walk-on", min: 50 },
  { name: "Supporting", min: 150 },
  { name: "Lead", min: 400 },
  { name: "Star", min: 900 },
  { name: "Auteur", min: 2000 },
  { name: "Legend", min: 5000 },
];

export const BADGES = [
  { id: "first", name: "First Verdict", desc: "Give your first verdict", test: s => s.verdicts >= 1 },
  { id: "critic", name: "Critic", desc: "Write 10 reviews of 100+ characters", test: s => s.longReviews >= 10 },
  { id: "topcritic", name: "Top Critic", desc: "Write 50 reviews of 100+ characters", test: s => s.longReviews >= 50 },
  { id: "binge", name: "Binge Watcher", desc: "Mark 50 titles as watched", test: s => s.watched >= 50 },
  { id: "boxset", name: "Box Set Hero", desc: "Mark 200 titles as watched", test: s => s.watched >= 200 },
  { id: "early", name: "First Night", desc: "Give 5 verdicts within a week of UK release", test: s => s.early >= 5 },
  { id: "crowd", name: "Crowd Pleaser", desc: "Get 10 likes on one review", test: s => s.bestReviewLikes >= 10 },
  { id: "fair", name: "Fair Judge", desc: "Use every verdict at least 3 times", test: s => s.verdictSplit.every(n => n >= 3) },
  { id: "chatty", name: "Talk of the Town", desc: "Post 25 discussion messages", test: s => s.chats >= 25 },
  { id: "curator", name: "Curator", desc: "Build a collection of 10+ titles", test: s => s.biggestCollection >= 10 },
  { id: "tastemaker", name: "Tastemaker", desc: "Reach 25 followers", test: s => s.followers >= 25 },
];

export function levelFor(points) {
  let i = LEVELS.length - 1;
  while (i > 0 && points < LEVELS[i].min) i--;
  const next = LEVELS[i + 1] || null;
  return {
    level: i + 1, name: LEVELS[i].name, points,
    next: next ? { name: next.name, at: next.min } : null,
    progress: next ? (points - LEVELS[i].min) / (next.min - LEVELS[i].min) : 1,
  };
}
