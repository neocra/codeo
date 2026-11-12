import type { ReviewComment } from '@codeo/contracts';

/** Longest excerpt of a commented line quoted back to the agent. */
const EXCERPT_MAX_CHARS = 300;

/**
 * The agent's next turn when a reviewer sends its work back: general feedback first, then the inline comments
 * grouped by file and ordered by line, each with the line it is anchored on. Written in French like every other
 * prompt the runtime composes.
 */
export function changeRequestPrompt(input: {
  feedback: string;
  comments: readonly ReviewComment[];
  round: number;
}): string {
  const lines: string[] = [
    `Revue humaine — modifications demandées (tour ${input.round}).`,
    'Applique ces retours dans ce même dossier de travail et sur la même branche, puis résume ce que tu as changé.',
  ];
  const feedback = input.feedback.trim();
  if (feedback) lines.push('', 'Retour général :', feedback);
  if (input.comments.length) {
    lines.push('', 'Commentaires sur le diff :');
    const byFile = new Map<string, ReviewComment[]>();
    for (const c of input.comments) byFile.set(c.path, [...(byFile.get(c.path) ?? []), c]);
    for (const [file, comments] of [...byFile].sort(([a], [b]) => a.localeCompare(b))) {
      lines.push('', `### ${file}`);
      for (const c of [...comments].sort((a, b) => a.line - b.line)) {
        const where = c.side === 'old' ? `ligne ${c.line} (supprimée)` : `ligne ${c.line}`;
        const excerpt = c.excerpt.trim();
        const quoted = excerpt.length > EXCERPT_MAX_CHARS ? `${excerpt.slice(0, EXCERPT_MAX_CHARS)}…` : excerpt;
        lines.push(`- ${where}${quoted ? ` : \`${quoted.replace(/`/g, "'")}\`` : ''}`);
        for (const l of c.body.trim().split('\n')) lines.push(`  ${l}`);
      }
    }
  }
  return lines.join('\n');
}
