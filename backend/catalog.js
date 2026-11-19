import catalog from '../data/catalog.json' with { type: 'json' };
import policies from '../data/policy.json' with { type: 'json' };

export const DAY = 86400000;
export const surfaces = ['listening_ai', 'playlist_ai', 'podcast_ai'];
export const entities = new Map(catalog.entities.map(entity => [entity.entity_id, entity]));
export const policy = new Map(policies.map(row => [row.memory_type, row]));
export const words = text => String(text ?? '').normalize('NFKC').toLowerCase()
  .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ').trim();
export const plusDays = (date, days) => new Date(Date.parse(date) + days * DAY).toISOString().replace('.000Z', 'Z');
export const passed = (end, at) => end && Date.parse(end) <= Date.parse(at);
export const split = value => value ? value.split('|') : [];

const aliases = new Map();
for (const e of entities.values()) {
  for (const name of [e.entity_id, e.canonical_name, ...split(e.aliases)]) {
    aliases.set(words(name), e.entity_id);
  }
}
// A few Hindi aliases are covered by the separate language tests.
for (const [name, id] of [['अरिजीत सिंह','artist_01'], ['श्रेया घोषाल','artist_02'],
                          ['अलका याग्निक','artist_05'], ['किशोर कुमार','artist_09']]) {
  aliases.set(words(name), id);
}
export const resolve = reference => aliases.get(words(reference));
export function mentioned(text) {
  const phrase = ' ' + words(text) + ' ';
  return [...new Set([...aliases].filter(([name]) => phrase.includes(' ' + name + ' '))
    .sort((a,b) => b[0].length - a[0].length).map(([,id]) => id))];
}

const neighbors = new Map();
for (const edge of catalog.relationships) {
  const links = neighbors.get(edge.catalog_entity_id) || [];
  links.push(edge);
  neighbors.set(edge.catalog_entity_id, links);
}
export function related(id) {
  const direct = (neighbors.get(id) || []).map(e => e.entity_id);
  // Two hops connect a podcast episode to the singer through its topic.
  const topics = direct.filter(key => entities.get(key)?.entity_type === 'topic');
  return new Set([id, ...direct, ...topics.flatMap(key => (neighbors.get(key) || []).map(e => e.entity_id))]);
}
export function singerFor(id) {
  return [...related(id)].find(key => entities.get(key)?.entity_type === 'artist');
}
export function itemFor(id, type) {
  const singer = singerFor(id);
  return [...entities.values()].find(e => e.entity_type === type && singer && singerFor(e.entity_id) === singer);
}

// A small TF–IDF vector space fitted on public catalog descriptions only.
// Canonical names and their relations give equivalent catalog aliases shared features.
const descriptions = [...entities.keys()].map(id => approvedWords(id));
const docs = descriptions.length;
const counts = new Map();
for (const terms of descriptions) for (const t of new Set(terms)) counts.set(t, (counts.get(t) || 0) + 1);
const vocabulary = [...new Set([...counts.keys(), 'prefers', 'excludes', 'played', 'completed', 'progress', 'positive', 'negative'])].sort();
const indices = new Map(vocabulary.map((term, i) => [term, i]));
export const vectorVersion = 'catalog-tfidf-v1';
export const dimensions = vocabulary.length;
function approvedWords(id) {
  return [...related(id)].flatMap(key => words(entities.get(key)?.canonical_name).split(' ')).filter(Boolean);
}
function vectorize(terms) {
  const weights = {};
  for (const term of terms) {
    const i = indices.get(term);
    if (i !== undefined) weights[i] = (weights[i] || 0) + 1;
  }
  let length = 0;
  for (const i of Object.keys(weights)) {
    weights[i] *= Math.log((docs + 1) / ((counts.get(vocabulary[i]) || 0) + 1)) + 1;
    length += weights[i] ** 2;
  }
  for (const i of Object.keys(weights)) weights[i] /= Math.sqrt(length);
  return weights;
}
export const memoryVector = m => vectorize([...approvedWords(m.entity_id), ...words(m.predicate).split(' '), m.polarity]);
export const intentVector = (text, ids) => vectorize([...words(text).split(' '), ...ids.flatMap(approvedWords)]);
export const cosine = (a,b) => Object.entries(a).reduce((sum, [key, value]) => sum + value * (b[key] || 0), 0);
