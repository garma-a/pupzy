export interface GlossaryViolation {
  line: number;
  term: string;
  content: string;
}

export function findForbiddenGlossaryTerms(lines: string[]): GlossaryViolation[];
