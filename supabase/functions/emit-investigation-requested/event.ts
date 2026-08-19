export interface WebhookPayload { type: string; table: string; record: { id?: string } }
export interface InngestEvent { name: string; id: string; data: { investigation_id: string } }

export function buildInngestEvent(p: WebhookPayload): InngestEvent {
  const id = p.record?.id;
  if (!id) throw new Error("webhook payload missing record.id");
  return { name: "investigation.requested", id, data: { investigation_id: id } };
}
