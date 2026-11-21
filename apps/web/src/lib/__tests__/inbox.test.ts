import { describe, expect, it } from 'vitest';
import { inboundKind } from '../../pages/project/InboxPanel';

describe('inbox kind labels', () => {
  it('maps router kinds to Turkish labels, unknown → generic', () => {
    expect(inboundKind('supplier_reply')).toEqual({ label: 'Tedarikçi yanıtı', tone: 'success' });
    expect(inboundKind('customer_acceptance').label).toBe('Kabul bildirimi');
    expect(inboundKind(null).label).toBe('Gelen ileti');
    expect(inboundKind('weird').tone).toBe('neutral');
  });
});
