export type PaymentStatus =
  | "DRAFT"
  | "POLICY_REJECTED"
  | "POLICY_APPROVED"
  | "DRY_RUN_FAILED"
  | "PENDING_APPROVAL"
  | "APPROVED"
  | "EXECUTING"
  | "SUCCESS"
  | "FAILED"
  | "CANCELLED"
  | "EXPIRED"
  | "INTENT_CHANGED";

const transitions: Record<PaymentStatus, PaymentStatus[]> = {
  DRAFT: ["POLICY_REJECTED", "POLICY_APPROVED", "CANCELLED", "EXPIRED"],
  POLICY_REJECTED: [],
  POLICY_APPROVED: ["PENDING_APPROVAL", "APPROVED", "DRY_RUN_FAILED", "CANCELLED", "EXPIRED"],
  DRY_RUN_FAILED: ["CANCELLED"],
  PENDING_APPROVAL: ["APPROVED", "CANCELLED", "EXPIRED", "INTENT_CHANGED"],
  APPROVED: ["EXECUTING", "CANCELLED", "EXPIRED", "INTENT_CHANGED"],
  EXECUTING: ["SUCCESS", "FAILED"],
  SUCCESS: [],
  FAILED: [],
  CANCELLED: [],
  EXPIRED: [],
  INTENT_CHANGED: [],
};

export function canTransition(from: PaymentStatus, to: PaymentStatus): boolean {
  return transitions[from]?.includes(to) ?? false;
}

export function assertTransition(from: PaymentStatus, to: PaymentStatus): void {
  if (!canTransition(from, to)) throw new Error(`Invalid state transition ${from} -> ${to}`);
}
