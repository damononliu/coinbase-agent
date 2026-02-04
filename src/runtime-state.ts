/**
 * Runtime state shared across server and action providers
 * NOTE: This is in-memory and resets on server restart.
 */

let clientWalletAddress: string | null = null;
let serverWalletAddress: string | null = null;

export function setClientWalletAddress(address: string | null): void {
  if (!address) {
    clientWalletAddress = null;
    return;
  }

  const normalized = address.trim();
  if (/^0x[a-fA-F0-9]{40}$/.test(normalized)) {
    clientWalletAddress = normalized;
  }
}

export function getClientWalletAddress(): string | null {
  return clientWalletAddress;
}

export function setServerWalletAddress(address: string | null): void {
  if (!address) {
    serverWalletAddress = null;
    return;
  }

  const normalized = address.trim();
  if (/^0x[a-fA-F0-9]{40}$/.test(normalized)) {
    serverWalletAddress = normalized;
  }
}

export function getServerWalletAddress(): string | null {
  return serverWalletAddress;
}
