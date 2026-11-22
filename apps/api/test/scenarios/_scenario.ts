// Shared scenario builder for the business-scenario suite (docs/10-senaryolar.md).
//
// A *world* = one fresh tenant (seeded users / suppliers / customers / rules) + logged-in clients for every role.
// A *flow* = a fluent, awaitable chain of business steps on ONE project:
//
//   const p = await w.flow().intake(TEXT).assign().rfqs('accommodation', ['moda', 'kalamis', 'bomonti']).approveRfqs()
//     .offers({ accommodation: { moda: 105, kalamis: 150 }, hall: { moda: 1300 } }).quote().approveQuote().send().accept()
//     .contract('moda').approveContract().sign();
//   await p.flow().amend({ pax: 90 }, 'kişi sayısı arttı');      // continue later on the same project
//
// Every step goes through the public HTTP API (app.inject) — nothing is written behind the API's back except where a test
// explicitly arranges state with ownerSql(). A failing step throws with the HTTP status + body, so a broken happy path is
// obvious. Edge cases call the API directly with `p.id`, `p.items`, `p.offers`, … and assert the refusal themselves.
import { afterAll, beforeAll, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  accLines, client, clock, closeApp, hallLines, login, makeApp, newTenant, ownerSql, REQUEST_TEXT, resetClock, rng,
  type Client, type TestApp,
} from '../helpers.js';
import { signWebhook } from '../../src/services/inbound/normalize.js';
import { runFollowupsForTenant } from '../../src/worker.js';

export { REQUEST_TEXT, accLines, hallLines, clock, ownerSql, rng, client };

export type UserKey = 'admin' | 'clerk' | 'ops' | 'field' | 'finance';
export type Kind = 'accommodation' | 'hall' | 'fnb' | 'transfer' | 'technical' | 'activity' | 'ticket' | 'other';
export const BIO = { method: 'dev' } as const;

/** Istanbul local time → Date (UTC+3, no DST in Türkiye). */
export const ist = (local: string): Date => new Date(`${local.length === 10 ? `${local}T09:00` : local}:00+03:00`);
export function setClock(d: Date | string): void {
  clock.now = typeof d === 'string' ? ist(d) : d;
}

// ------------------------------------------------------------------ suite lifecycle
export interface Suite { T: TestApp }
/** One Fastify app per test file (mock AI, capturing e-mail provider, test clock / rng). */
export function scenarioSuite(opts: { env?: Record<string, string> } = {}): Suite {
  const s = {} as Suite;
  beforeAll(async () => {
    for (const [k, v] of Object.entries(opts.env ?? {})) process.env[k] = v;
    s.T = await makeApp();
  });
  beforeEach(() => {
    resetClock();
    rng.value = 0.99;
  });
  afterAll(async () => {
    for (const k of Object.keys(opts.env ?? {})) delete process.env[k];
    await closeApp(s.T);
  });
  return s;
}

// ------------------------------------------------------------------ world (one tenant)
export type Tenant = Awaited<ReturnType<typeof newTenant>>;

export class World {
  readonly pub: Client;
  constructor(readonly T: TestApp, readonly t: Tenant, readonly slug: string, readonly as: Record<UserKey, Client>, readonly tokens: Record<UserKey, string>) {
    this.pub = client(T.app);
  }
  get admin() { return this.as.admin; }
  get clerk() { return this.as.clerk; }
  get ops() { return this.as.ops; }
  get field() { return this.as.field; }
  get finance() { return this.as.finance; }
  get mails() { return this.T.email.sent; }
  user(k: UserKey) { return this.t.users[k]; }
  supplier(k: string): string {
    const id = this.t.suppliers[k];
    if (!id) throw new Error(`unknown supplier key ${k}`);
    return id;
  }
  customer(k: keyof Tenant['customers']) { return this.t.customers[k]; }

  /** New project flow. */
  flow(): Flow { return new Flow(this, new P(this)); }

  /** Re-login (e.g. after a role / authority change revoked the sessions, G-17). */
  async relogin(k: UserKey): Promise<Client> {
    this.tokens[k] = await login(this.T.app, this.t.users[k].email);
    this.as[k] = client(this.T.app, this.tokens[k]);
    return this.as[k];
  }

  /** Open decision cards visible to `who` (default admin), optionally filtered. */
  async cards(f: { kind?: string; entityId?: string; projectId?: string; who?: UserKey; status?: string } = {}): Promise<any[]> {
    const qs = new URLSearchParams();
    if (f.projectId) qs.set('projectId', f.projectId);
    if (f.status) qs.set('status', f.status);
    const r = await this.as[f.who ?? 'admin'].get(`/api/decisions${qs.size ? `?${qs}` : ''}`);
    if (r.status !== 200) throw new Error(`decisions ${r.status} ${JSON.stringify(r.body)}`);
    return (r.body.items as any[]).filter((d) => (!f.kind || d.kind === f.kind) && (!f.entityId || d.entityId === f.entityId));
  }
  async card(kind: string, f: { entityId?: string; projectId?: string; who?: UserKey } = {}): Promise<any> {
    const c = (await this.cards({ ...f, kind }))[0];
    if (!c) throw new Error(`no open ${kind} card (${JSON.stringify(f)})`);
    return c;
  }
  /** Decides a card; money / contract / quote approvals get the dev biometric automatically. */
  async decide(card: any, action: 'approve' | 'edit' | 'reject' = 'approve', extra: { edits?: any; reason?: string; who?: UserKey; device?: string; bio?: boolean } = {}) {
    const body: any = { action };
    if (extra.edits) body.edits = extra.edits;
    if (extra.reason) body.reason = extra.reason;
    if (extra.device) body.device = extra.device;
    if (extra.bio ?? card.requiresBiometric) body.biometric = BIO;
    return this.as[extra.who ?? 'admin'].post(`/api/decisions/${card.id}/decide`, body);
  }

  async rules(patch: Record<string, unknown>): Promise<void> {
    const r = await this.admin.patch('/api/rules', patch);
    if (r.status !== 200) throw new Error(`rules ${r.status} ${JSON.stringify(r.body)}`);
  }
  async worker(at: Date | string): Promise<string[]> {
    return runFollowupsForTenant(this.T.app.deps, this.t.tenantId, typeof at === 'string' ? ist(at) : at);
  }
  /** Signed generic e-mail webhook (per-tenant secret, created on first use). */
  private emailSecret: string | null = null;
  async inboundEmail(body: Record<string, unknown>, o: { key?: string; secret?: string } = {}) {
    if (!this.emailSecret) {
      const ch = await this.admin.post('/api/inbound-channels', { channel: 'email' });
      this.emailSecret = ch.body.secret;
    }
    const raw = JSON.stringify(body);
    const ts = Math.floor(clock.now.getTime() / 1000);
    const sig = `sha256=${signWebhook(o.secret ?? this.emailSecret!, ts, raw)}`;
    const r = await this.T.app.inject({
      method: 'POST', url: `/api/inbound/email/${o.key ?? this.slug}`, payload: raw,
      headers: { 'content-type': 'application/json', 'x-mice-timestamp': String(ts), 'x-mice-signature': sig },
    });
    return { status: r.statusCode, body: r.json() };
  }
  get secret(): string | null { return this.emailSecret; }
  async whatsapp(msgs: unknown[], phoneNumberId: string, appSecret: string, name = 'Müşteri') {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [{ id: 'WABA', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: phoneNumberId }, contacts: [{ wa_id: (msgs[0] as any).from, profile: { name } }], messages: msgs } }] }],
    };
    const raw = JSON.stringify(payload);
    const r = await this.T.app.inject({
      method: 'POST', url: '/api/inbound/whatsapp', payload: raw,
      headers: { 'content-type': 'application/json', 'x-hub-signature-256': `sha256=${createHmac('sha256', appSecret).update(raw).digest('hex')}` },
    });
    return { status: r.statusCode, body: r.json() };
  }
  /** Mails sent since index `from` (CapturingEmailProvider keeps the unredacted copies). */
  mailsSince(from: number) { return this.T.email.sent.slice(from); }
}

export async function makeWorld(s: Suite, label: string): Promise<World> {
  const t = await newTenant(label);
  const slug = (await ownerSql('SELECT slug FROM tenants WHERE id = $1', [t.tenantId]))[0].slug as string;
  const tokens = {} as Record<UserKey, string>;
  const as = {} as Record<UserKey, Client>;
  for (const k of ['admin', 'clerk', 'ops', 'field', 'finance'] as UserKey[]) {
    tokens[k] = await login(s.T.app, t.users[k].email);
    as[k] = client(s.T.app, tokens[k]);
  }
  return new World(s.T, t, slug, as, tokens);
}

// ------------------------------------------------------------------ project state
export class P {
  id = '';
  code = '';
  intake: any = null;
  /** kind → service item id */
  items: Record<string, string> = {};
  /** `${kind}:${supplierKey}` → latest offer id */
  offers: Record<string, string> = {};
  /** kind → selected supplier key */
  selected: Record<string, string> = {};
  /** kind → supplierKey → rfq id */
  rfqs: Record<string, Record<string, string>> = {};
  /** kind → supplierKey → one-time supplier link token (from the sent RFQ e-mail) */
  rfqTokens: Record<string, Record<string, string>> = {};
  quote: any = null;
  quoteToken = '';
  contract: any = null;
  /** supplierKey → contract id */
  contracts: Record<string, string> = {};
  last: any = null;
  constructor(readonly w: World) {}
  flow(): Flow { return new Flow(this.w, this); }
  offer(kind: string, supplier: string): string {
    const id = this.offers[`${kind}:${supplier}`];
    if (!id) throw new Error(`no offer ${kind}:${supplier}`);
    return id;
  }
  item(kind: string): string {
    const id = this.items[kind];
    if (!id) throw new Error(`no ${kind} item in ${this.code}`);
    return id;
  }
  async detail(who: UserKey = 'admin'): Promise<any> {
    const r = await this.w.as[who].get(`/api/projects/${this.id}`);
    if (r.status !== 200) throw new Error(`detail ${r.status} ${JSON.stringify(r.body)}`);
    return r.body;
  }
  async project(): Promise<any> { return (await this.detail()).project; }
  async tasks(kind?: string): Promise<any[]> {
    const items = (await this.w.admin.get(`/api/tasks?projectId=${this.id}`)).body.items as any[];
    return kind ? items.filter((x) => x.kind === kind) : items;
  }
  async docs(): Promise<any[]> { return (await this.w.admin.get(`/api/projects/${this.id}/documents`)).body.items; }
  async drafts(kind?: string): Promise<any[]> {
    const items = (await this.w.admin.get(`/api/drafts?projectId=${this.id}`)).body.items as any[];
    return kind ? items.filter((x) => x.kind === kind) : items;
  }
  async finance(kind?: string): Promise<any[]> {
    return (await this.w.finance.get(`/api/finance/entries?projectId=${this.id}${kind ? `&kind=${kind}` : ''}`)).body.items;
  }
}

// ------------------------------------------------------------------ default offer lines per kind
export interface OfferSpec {
  price?: number;
  sgl?: number;
  lines?: any[];
  currency?: string;
  optionUntil?: string | null;
  prepaymentRate?: number | null;
  paymentTerms?: string | null;
  cancellationTerms?: string | null;
  guaranteePax?: number | null;
  source?: string;
}
export function defaultLines(kind: Kind, price?: number, sgl?: number): any[] {
  switch (kind) {
    case 'accommodation': return accLines(price ?? 105, sgl ?? Math.round((price ?? 105) * 0.857));
    case 'hall': return hallLines(price ?? 1300);
    case 'fnb': return [{ description: 'Öğle yemeği + 2 coffee break', kind: 'fnb', quantity: 80, unit: 'pax_day', unitPrice: price ?? 36, vatIncluded: false, vatRate: 0.1 }];
    case 'transfer': return [{ description: 'Havalimanı transferi (midibüs)', kind: 'transfer', quantity: 4, unit: 'vehicle', unitPrice: price ?? 65, vatIncluded: false, vatRate: 0.2 }];
    case 'technical': return [{ description: 'Ses-ışık + projeksiyon', kind: 'technical', quantity: 1, unit: 'lump_sum', unitPrice: price ?? 1900, vatIncluded: false, vatRate: 0.2 }];
    default: return [{ description: `${kind} hizmeti`, kind, quantity: 1, unit: 'lump_sum', unitPrice: price ?? 1000, vatIncluded: false, vatRate: 0.2 }];
  }
}

type Step = (w: World, p: P) => Promise<void>;
export interface QuoteOptionSpec { title?: string; lines: { kind: string; supplier?: string; markup?: number; unitPriceEur?: number }[] }

/** Awaitable fluent chain. `await flow` runs the queued steps in order and resolves to the project state `P`. */
export class Flow implements PromiseLike<P> {
  private q: { name: string; fn: Step }[] = [];
  private actor: UserKey = 'clerk';
  constructor(private w: World, private p: P) {}

  private push(name: string, fn: (api: Client, w: World, p: P) => Promise<void>): this {
    const who = () => this.actor;
    this.q.push({ name, fn: (w, p) => fn(w.as[who()], w, p) });
    return this;
  }
  then<A = P, B = never>(onOk?: ((v: P) => A | PromiseLike<A>) | null, onErr?: ((e: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return this.run().then(onOk, onErr);
  }
  private async run(): Promise<P> {
    for (const s of this.q) {
      try {
        await s.fn(this.w, this.p);
      } catch (e) {
        throw new Error(`[scenario step ${s.name}] ${(e as Error).message}`);
      }
    }
    this.q = [];
    return this.p;
  }

  /** Subsequent steps are performed by this role. */
  as(who: UserKey): this {
    this.q.push({ name: `as:${who}`, fn: async () => { this.actor = who; } });
    return this;
  }
  /** Arbitrary step (arrange / assert in the middle of a chain). */
  step(name: string, fn: (w: World, p: P) => Promise<void>): this {
    this.q.push({ name, fn });
    return this;
  }
  at(local: Date | string): this {
    this.q.push({ name: 'clock', fn: async () => setClock(local) });
    return this;
  }

  // ---------------- Adım 0
  intake(text: string = REQUEST_TEXT, o: { channel?: string; customer?: keyof Tenant['customers'] | null; fromAddress?: string; subject?: string; receivedAt?: string } = {}): this {
    return this.push('intake', async (api, w, p) => {
      const body: any = { channel: o.channel ?? 'email', body: text };
      if (o.fromAddress) body.fromAddress = o.fromAddress;
      if (o.subject) body.subject = o.subject;
      if (o.receivedAt) body.receivedAt = o.receivedAt;
      if (o.customer) body.customerId = w.customer(o.customer);
      const r = await api.post('/api/intake', body);
      if (r.status !== 200) throw new Error(`intake ${r.status} ${JSON.stringify(r.body)}`);
      p.intake = r.body;
      p.id = r.body.project.id;
      p.code = r.body.project.code;
      await loadItems(w, p);
    });
  }
  /** Admin one-tap approval of the AI assignment suggestion (optionally re-assigned to another user via Düzelt). */
  assign(to?: UserKey): this {
    return this.push('assign', async (_api, w, p) => {
      const c = await w.card('assignment', { projectId: p.id });
      const r = to && c.detail.userId !== w.user(to).id
        ? await w.decide(c, 'edit', { edits: { userId: w.user(to).id } })
        : await w.decide(c, 'approve');
      if (r.status !== 200) throw new Error(`assign ${r.status} ${JSON.stringify(r.body)}`);
    });
  }
  patch(fields: Record<string, unknown>): this {
    return this.push('patch', async (api, _w, p) => {
      const r = await api.patch(`/api/projects/${p.id}`, fields);
      if (r.status !== 200) throw new Error(`patch ${r.status} ${JSON.stringify(r.body)}`);
      p.code = r.body.code;
    });
  }
  addItem(kind: Kind, o: { description?: string; quantity?: number; unit?: string; nights?: number; valueAdd?: boolean; dateFrom?: string; dateTo?: string } = {}): this {
    return this.push(`item:${kind}`, async (api, w, p) => {
      const r = await api.post(`/api/projects/${p.id}/items`, {
        kind, description: o.description ?? `${kind} kalemi`, quantity: o.quantity ?? 1, unit: o.unit ?? 'lump_sum', ...(o.nights != null ? { nights: o.nights } : {}),
        ...(o.valueAdd ? { valueAdd: true } : {}), ...(o.dateFrom ? { dateFrom: o.dateFrom } : {}), ...(o.dateTo ? { dateTo: o.dateTo } : {}),
      });
      if (r.status !== 200) throw new Error(`item ${r.status} ${JSON.stringify(r.body)}`);
      p.items[o.valueAdd ? `${kind}:valueAdd` : kind] = r.body.id;
      void w;
    });
  }

  // ---------------- Adım 1
  rfqs(kind: string, suppliers: string[], o: { overrideReason?: string; deadlineHours?: number; language?: string } = {}): this {
    return this.push(`rfqs:${kind}`, async (api, w, p) => {
      const r = await api.post(`/api/items/${p.item(kind)}/rfqs`, { supplierIds: suppliers.map((s) => w.supplier(s)), ...o });
      if (r.status !== 200) throw new Error(`rfqs ${r.status} ${JSON.stringify(r.body)}`);
      p.rfqs[kind] = Object.fromEntries(suppliers.map((s) => [s, r.body.items.find((x: any) => x.supplierId === w.supplier(s)).id]));
      p.last = r.body;
    });
  }
  /** The rfq_send card (approved by the clerk — requiredRole clerk_sales) → e-mails out; captures the one-time links. */
  approveRfqs(kind: string, o: { who?: UserKey } = {}): this {
    return this.push(`approveRfqs:${kind}`, async (_api, w, p) => {
      const c = await w.card('rfq_send', { entityId: p.item(kind), who: o.who ?? 'clerk' });
      const before = w.mails.length;
      const r = await w.decide(c, 'approve', { who: o.who ?? 'clerk' });
      if (r.status !== 200) throw new Error(`rfq approve ${r.status} ${JSON.stringify(r.body)}`);
      p.rfqTokens[kind] ??= {};
      for (const m of w.mailsSince(before)) {
        const key = /satis@([a-z]+)\.example\.com/.exec(m.to)?.[1];
        const tok = /\/s\/rfq\/([A-Za-z0-9_-]{43})/.exec(m.body)?.[1];
        if (key && tok) p.rfqTokens[kind][key] = tok;
      }
    });
  }
  /** Supplier answers through the no-login link (structured form). */
  portalOffer(kind: string, supplier: string, spec: OfferSpec = {}): this {
    return this.push(`portal:${kind}:${supplier}`, async (_api, w, p) => {
      const tok = p.rfqTokens[kind]?.[supplier];
      if (!tok) throw new Error(`no rfq link for ${kind}:${supplier}`);
      const r = await w.pub.post(`/api/public/rfq/${tok}`, offerBody(kind as Kind, spec));
      if (r.status !== 200) throw new Error(`portal ${r.status} ${JSON.stringify(r.body)}`);
      await refreshOffers(w, p);
    });
  }

  // ---------------- Adım 2
  /** Manual (verified) offer typed in by the team. */
  offer(kind: string, supplier: string, spec: OfferSpec | number = {}): this {
    return this.push(`offer:${kind}:${supplier}`, async (api, w, p) => {
      const s = typeof spec === 'number' ? { price: spec } : spec;
      const r = await api.post(`/api/items/${p.item(kind)}/offers`, { supplierId: w.supplier(supplier), source: s.source ?? 'email', ...offerBody(kind.split(':')[0] as Kind, s) });
      if (r.status !== 200) throw new Error(`offer ${r.status} ${JSON.stringify(r.body)}`);
      p.offers[`${kind}:${supplier}`] = r.body.id;
      p.last = r.body;
    });
  }
  /** Several manual offers; the FIRST supplier of each kind is selected. `{ accommodation: { moda: 105, kalamis: 150 }, hall: { moda: 1300 } }` */
  offers(spec: Record<string, Record<string, OfferSpec | number>>, o: { select?: boolean } = {}): this {
    for (const [kind, bySupplier] of Object.entries(spec)) {
      for (const [supplier, s] of Object.entries(bySupplier)) this.offer(kind, supplier, s);
      if (o.select !== false) this.select(kind, Object.keys(bySupplier)[0]);
    }
    return this;
  }
  select(kind: string, supplier: string): this {
    return this.push(`select:${kind}`, async (api, _w, p) => {
      const r = await api.post(`/api/items/${p.item(kind)}/select-offer`, { offerId: p.offer(kind, supplier) });
      if (r.status !== 200) throw new Error(`select ${r.status} ${JSON.stringify(r.body)}`);
      p.selected[kind] = supplier;
      p.code = (await p.project()).code;
    });
  }

  // ---------------- Adım 3
  /** Builds a quote. Default: option A = selected offers, option B = A with the 2nd accommodation offer (if any), markup 0.2. */
  quote(options?: QuoteOptionSpec[], o: { markup?: number; optionUntil?: string; currency?: string; marginOverrideReason?: string; expect?: number } = {}): this {
    return this.push('quote', async (api, _w, p) => {
      const markup = o.markup ?? 0.2;
      const line = (l: QuoteOptionSpec['lines'][number]) => {
        const valueAdd = l.kind.endsWith(':valueAdd');
        return {
          serviceItemId: p.item(l.kind),
          ...(valueAdd ? { offerId: null } : { offerId: p.offer(l.kind, l.supplier ?? p.selected[l.kind]) }),
          ...(l.unitPriceEur != null ? { unitPriceEur: l.unitPriceEur } : { markup: l.markup ?? markup }),
        };
      };
      const specs = options ?? defaultOptions(p);
      const body: any = { options: specs.map((s, i) => ({ title: s.title ?? `Seçenek ${String.fromCharCode(65 + i)}`, lines: s.lines.map(line) })) };
      if (o.optionUntil) body.optionUntil = o.optionUntil;
      if (o.currency) body.currency = o.currency;
      if (o.marginOverrideReason) body.marginOverrideReason = o.marginOverrideReason;
      const r = await api.post(`/api/projects/${p.id}/quotes`, body);
      if (r.status !== (o.expect ?? 200)) throw new Error(`quote ${r.status} ${JSON.stringify(r.body)}`);
      p.quote = r.body;
    });
  }
  /** Admin approval (Face ID) when the quote waits for it; no-op when the author's authority already approved it. */
  approveQuote(): this {
    return this.push('approveQuote', async (_api, w, p) => {
      if (p.quote.status !== 'pending_approval') return;
      const c = await w.card('quote_approval', { entityId: p.quote.id });
      const r = await w.decide(c, 'approve');
      if (r.status !== 200) throw new Error(`quote approve ${r.status} ${JSON.stringify(r.body)}`);
      p.quote = (await w.admin.get(`/api/quotes/${p.quote.id}`)).body;
    });
  }
  send(): this {
    return this.push('send', async (api, _w, p) => {
      const r = await api.post(`/api/quotes/${p.quote.id}/send`);
      if (r.status !== 200) throw new Error(`send ${r.status} ${JSON.stringify(r.body)}`);
      p.quote = r.body;
      p.quoteToken = r.body.approvalLink.split('/q/')[1];
    });
  }

  // ---------------- Adım 4
  accept(optionNo = 1, o: { poNumber?: string; approverName?: string } = { poNumber: 'PO-1' }): this {
    return this.push('accept', async (_api, w, p) => {
      const r = await w.pub.post(`/api/public/quotes/${p.quoteToken}/accept`, { optionNo, approverName: o.approverName ?? 'Müşteri Temsilcisi', ...(o.poNumber ? { poNumber: o.poNumber } : {}) });
      if (r.status !== 200) throw new Error(`accept ${r.status} ${JSON.stringify(r.body)}`);
      p.last = r.body;
    });
  }
  lost(reason = 'Fiyat yüksek bulundu'): this {
    return this.push('lost', async (api, _w, p) => {
      const r = await api.post(`/api/projects/${p.id}/outcome`, { outcome: 'lost', lostReason: reason });
      if (r.status !== 200) throw new Error(`lost ${r.status} ${JSON.stringify(r.body)}`);
    });
  }

  // ---------------- Adım 5
  contract(supplier = 'moda', o: { kinds?: string[]; template?: 'agency' | 'supplier'; text?: string; compare?: boolean } = {}): this {
    return this.push(`contract:${supplier}`, async (_api, w, p) => {
      const kinds = o.kinds ?? Object.entries(p.selected).filter(([, s]) => s === supplier).map(([k]) => k);
      const r = await w.admin.post(`/api/projects/${p.id}/contracts`, { supplierId: w.supplier(supplier), serviceItemIds: kinds.map((k) => p.item(k)), template: o.template ?? 'agency' });
      if (r.status !== 200) throw new Error(`contract ${r.status} ${JSON.stringify(r.body)}`);
      p.contracts[supplier] = r.body.id;
      p.contract = r.body;
      if (o.text) {
        const parsed = await w.admin.post(`/api/contracts/${r.body.id}/parse`, { text: o.text });
        if (parsed.status !== 200) throw new Error(`parse ${parsed.status} ${JSON.stringify(parsed.body)}`);
      }
      if (o.compare !== false) p.contract = (await w.admin.post(`/api/contracts/${r.body.id}/compare`)).body;
    });
  }
  /** Accepts the condition risk (if any) and approves the clean contract (Face ID). */
  approveContract(supplier = 'moda'): this {
    return this.push(`approveContract:${supplier}`, async (_api, w, p) => {
      const id = p.contracts[supplier];
      const risk = (await w.cards({ kind: 'condition_risk', entityId: id }))[0];
      if (risk) await w.decide(risk, 'approve');
      const c = await w.card('contract_approval', { entityId: id });
      const r = await w.decide(c, 'approve');
      if (r.status !== 200) throw new Error(`contract approve ${r.status} ${JSON.stringify(r.body)}`);
    });
  }
  sign(supplier = 'moda', signer: UserKey = 'admin'): this {
    return this.push(`sign:${supplier}`, async (_api, w, p) => {
      const r = await w.admin.post(`/api/contracts/${p.contracts[supplier]}/sign`, { signedBy: w.user(signer).id, scanFileName: 'imzali.pdf' });
      if (r.status !== 200) throw new Error(`sign ${r.status} ${JSON.stringify(r.body)}`);
      p.contract = r.body;
      p.code = (await p.project()).code;
    });
  }
  amend(changes: Record<string, unknown>, reason: string, supplier = 'moda'): this {
    return this.push('amend', async (_api, w, p) => {
      const r = await w.admin.post(`/api/contracts/${p.contracts[supplier]}/amend`, { changes, reason });
      if (r.status !== 200) throw new Error(`amend ${r.status} ${JSON.stringify(r.body)}`);
      p.contracts[`${supplier}:amendment`] = r.body.id;
      p.last = r.body;
    });
  }
  /** Shortcut: offers (moda acc + hall, kalamış acc) → quote → approval → send → accept(PO) → moda contract → approve → sign. */
  signed(o: { customer?: keyof Tenant['customers']; text?: string } = {}): this {
    return this.intake(o.text ?? REQUEST_TEXT, { customer: o.customer ?? 'trusted' })
      .offers({ accommodation: { moda: 105, kalamis: 150 }, hall: { moda: 1300 } })
      .as('admin').quote().send().accept().contract('moda').approveContract().sign();
  }
}

function offerBody(kind: Kind, s: OfferSpec) {
  return {
    currency: s.currency ?? 'EUR', lines: s.lines ?? defaultLines(kind, s.price, s.sgl),
    optionUntil: s.optionUntil === undefined ? '2027-01-20' : s.optionUntil,
    ...(s.prepaymentRate !== undefined ? { prepaymentRate: s.prepaymentRate } : kind === 'accommodation' ? { prepaymentRate: 0.3 } : {}),
    ...(s.paymentTerms !== undefined ? { paymentTerms: s.paymentTerms } : kind === 'accommodation' ? { paymentTerms: '%30 ön ödeme' } : {}),
    ...(s.cancellationTerms ? { cancellationTerms: s.cancellationTerms } : {}),
    ...(s.guaranteePax !== undefined ? { guaranteePax: s.guaranteePax } : kind === 'accommodation' ? { guaranteePax: 70 } : {}),
  };
}

function defaultOptions(p: P): QuoteOptionSpec[] {
  const kinds = Object.keys(p.selected);
  const a: QuoteOptionSpec = { title: 'Seçenek A', lines: kinds.map((k) => ({ kind: k })) };
  const altAcc = Object.keys(p.offers).map((k) => k.split(':')).find(([k, s]) => k === 'accommodation' && s !== p.selected.accommodation);
  const b: QuoteOptionSpec = {
    title: 'Seçenek B',
    lines: kinds.map((k) => (k === 'accommodation' && altAcc ? { kind: k, supplier: altAcc[1] } : { kind: k, markup: 0.25 })),
  };
  return [a, b];
}

async function loadItems(w: World, p: P): Promise<void> {
  const d = await p.detail();
  for (const it of d.items) if (!p.items[it.kind]) p.items[it.kind] = it.id;
  void w;
}
async function refreshOffers(w: World, p: P): Promise<void> {
  const d = await p.detail();
  const keyOf = Object.fromEntries(Object.entries(w.t.suppliers).map(([k, id]) => [id, k]));
  for (const it of d.items) for (const o of it.offers) p.offers[`${it.kind}:${keyOf[o.supplierId]}`] = o.id;
}

/** Minimal multipart builder (file + string fields). */
export function multipart(fields: Record<string, string>, file: { name: string; type: string; content: Buffer | string }) {
  const boundary = '----micescn' + Math.random().toString(16).slice(2);
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`));
  parts.push(Buffer.isBuffer(file.content) ? file.content : Buffer.from(file.content, 'utf8'));
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  return { payload: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}
export async function upload(w: World, who: UserKey, url: string, fields: Record<string, string>, file: { name: string; type: string; content: Buffer | string }) {
  const mp = multipart(fields, file);
  const r = await w.T.app.inject({ method: 'POST', url, payload: mp.payload, headers: { ...mp.headers, authorization: `Bearer ${w.tokens[who]}` } });
  return { status: r.statusCode, body: r.json() };
}
