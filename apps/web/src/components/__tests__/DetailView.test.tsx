import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DetailView, isEvidence } from '../DetailView';

describe('DetailView — §16.5 rule suggestion evidence', () => {
  const detail = {
    key: 'supplierSeasonMarkups', suggestionKind: 'supplier_season_markup', confidence: 0.82, sampleSize: 8,
    evidence: {
      columns: [{ key: 'date', label: 'Tarih', format: 'date' }, { key: 'ref', label: 'Proje', format: 'text' }, { key: 'advantage', label: 'Kanal avantajı', format: 'pct' }],
      rows: [{ date: '2026-01-10', ref: 'PRJ-0001', advantage: 0.18 }, { date: '2026-02-11', ref: null, advantage: 0.2 }],
      truncated: 3, summary: { meanAdvantage: 0.19 },
    },
  };
  it('renders evidence rows as a labelled table with formatted cells', () => {
    expect(isEvidence(detail.evidence)).toBe(true);
    expect(isEvidence({ rows: [] })).toBe(false);
    const html = renderToStaticMarkup(<DetailView data={detail} />);
    expect(html).toContain('<th scope="col">Tarih</th>');
    expect(html).toContain('Kanal avantajı');
    expect(html).toContain('PRJ-0001');
    expect(html).toMatch(/5 veri noktası \(ilk 2 gösteriliyor\)/);
    expect(html).toContain('Dayanak veri');
    expect(html).toContain('Tedarikçi × sezon markup');
    expect(html).toContain('Tedarikçi/sezon markup');
    expect((html.match(/<tr>/g) ?? []).length).toBe(3);
  });
});
