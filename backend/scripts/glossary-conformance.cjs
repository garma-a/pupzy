const IDENTIFIER_SEPARATOR = '[\\s_-]*';

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function phrasePattern(phrase) {
  const words = phrase
    .trim()
    .split(/[\s_-]+/)
    .map(escapeRegex);
  return new RegExp(words.join(IDENTIFIER_SEPARATOR), 'i');
}

const FORBIDDEN_DOMAIN_TERMS = [
  'City record',
  'location entry',
  'custom city creation',
  'operator-created city',
  'Google GPS',
  'Verified Location',
  'provider-validated address',
  'Legacy clinic',
  'unverified clinic',
  'Hidden Post',
  'deleted Post',
  'permanently removed Post',
].map((term) => ({ term, pattern: phrasePattern(term) }));

FORBIDDEN_DOMAIN_TERMS.push({
  term: 'raw coordinates',
  pattern: /raw[\s_-]*coordinates?/i,
});

function findForbiddenGlossaryTerms(lines) {
  return lines.flatMap((line, index) =>
    FORBIDDEN_DOMAIN_TERMS.flatMap(({ term, pattern }) => {
      pattern.lastIndex = 0;
      return pattern.test(line) ? [{ line: index + 1, term, content: line.trim() }] : [];
    }),
  );
}

module.exports = { findForbiddenGlossaryTerms };
