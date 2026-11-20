// Shared arrangement for phase B tests: a project won by the customer with a SIGNED contract (moda: accommodation + hall).
import type { FastifyInstance } from 'fastify';
import { client, quotableProject, twoOptions, type Client, type Quotable } from './helpers.js';
import type { SeededTenant } from '../src/db/seed-data.js';

export interface SignedProject extends Quotable { contractId: string; code: string }

export async function wonProject(app: FastifyInstance, admin: Client, t: SeededTenant, customer: 'trusted' | 'new' = 'trusted'): Promise<Quotable> {
  const q = await quotableProject(admin, t, customer);
  const quote = await admin.post(`/api/projects/${q.projectId}/quotes`, twoOptions(q));
  if (quote.status !== 200) throw new Error(`quote ${quote.status} ${JSON.stringify(quote.body)}`);
  const sent = await admin.post(`/api/quotes/${quote.body.id}/send`);
  if (sent.status !== 200) throw new Error(`send ${sent.status} ${JSON.stringify(sent.body)}`);
  const token = sent.body.approvalLink.split('/q/')[1];
  const acc = await client(app).post(`/api/public/quotes/${token}/accept`, { optionNo: 1, approverName: 'Müşteri', poNumber: 'PO-9' });
  if (acc.status !== 200) throw new Error(`accept ${acc.status} ${JSON.stringify(acc.body)}`);
  return q;
}

export async function signedProject(app: FastifyInstance, admin: Client, t: SeededTenant): Promise<SignedProject> {
  const q = await wonProject(app, admin, t);
  const c = await admin.post(`/api/projects/${q.projectId}/contracts`, { supplierId: t.suppliers.moda, serviceItemIds: [q.accItemId, q.hallItemId], template: 'agency' });
  if (c.status !== 200) throw new Error(`contract ${c.status} ${JSON.stringify(c.body)}`);
  await admin.post(`/api/contracts/${c.body.id}/compare`);
  const decisions = async () => (await admin.get(`/api/decisions?projectId=${q.projectId}`)).body.items as any[];
  const risk = (await decisions()).find((d) => d.kind === 'condition_risk' && d.entityId === c.body.id);
  if (risk) await admin.post(`/api/decisions/${risk.id}/decide`, { action: 'approve' });
  const appr = (await decisions()).find((d) => d.kind === 'contract_approval' && d.entityId === c.body.id);
  if (!appr) throw new Error('no contract approval decision');
  await admin.post(`/api/decisions/${appr.id}/decide`, { action: 'approve', biometric: { method: 'dev' } });
  const signed = await admin.post(`/api/contracts/${c.body.id}/sign`, { signedBy: t.users.admin.id });
  if (signed.status !== 200) throw new Error(`sign ${signed.status} ${JSON.stringify(signed.body)}`);
  const code = (await admin.get(`/api/projects/${q.projectId}`)).body.project.code;
  return { ...q, contractId: c.body.id, code };
}
