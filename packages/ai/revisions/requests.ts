const ordinal = "(?:first|second|third|fourth|1st|2nd|3rd|4th)";
export const audioRevision = (s: string) =>
  /\b(?:remove (?:the )?ducking|music louder|music (?:loud|powerful).*voice clear|lower (?:the )?music when I speak|keep (?:the )?original gym sounds)\b/i.test(
    s,
  );
export const replaceRequest = new RegExp(
  `replace (?:the )?(${ordinal}) (?:shot|clip)`,
  "i",
);
export const removeRequest = new RegExp(
  `remove (?:the )?(${ordinal}|final|last) (?:shot|clip)`,
  "i",
);
export const strongestRequest =
  /move (?:the )?strongest shot to (?:the )?beginning/i;
export const tighterMusicRequest =
  /(?:make (?:the )?cuts tighter|tighten (?:the )?cuts).*music/i;
export const visualRevision = (s: string) =>
  replaceRequest.test(s) ||
  /use more|(?:use )?less bench/i.test(s) ||
  strongestRequest.test(s);
export const musicRevision = (s: string) =>
  /sync (?:the )?ending/i.test(s) || tighterMusicRequest.test(s);
export const ordinalIndex = (s: string) =>
  ({
    first: 0,
    "1st": 0,
    second: 1,
    "2nd": 1,
    third: 2,
    "3rd": 2,
    fourth: 3,
    "4th": 3,
  })[s.toLowerCase()];
