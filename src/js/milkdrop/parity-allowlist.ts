import allowlistJson from '../../data/milkdrop-parity/allowlist.json' with {
  type: 'json',
};

export type MilkdropParityAllowlistEntry = {
  id: string;
  reason: string;
  category: string;
  constructSignatures?: string[];
};

export type MilkdropParityAllowlist = {
  version: number;
  entries: MilkdropParityAllowlistEntry[];
};

type MilkdropParityAllowlistConstruct = {
  presetId?: string;
  signature: string;
};

const MILKDROP_PARITY_ALLOWLIST = allowlistJson as MilkdropParityAllowlist;

export function loadMilkdropParityAllowlist(): MilkdropParityAllowlist {
  return MILKDROP_PARITY_ALLOWLIST;
}

export function isMilkdropParityConstructAllowlisted({
  presetId,
  signature,
}: MilkdropParityAllowlistConstruct): boolean {
  return MILKDROP_PARITY_ALLOWLIST.entries.some((entry) => {
    if (entry.id !== presetId) {
      return false;
    }
    return (entry.constructSignatures ?? []).includes(signature);
  });
}
