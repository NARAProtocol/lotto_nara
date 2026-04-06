export function buildEditMessage(wallet: string, nonce: string) {
  return [
    "NARA Degen Board OG card edit",
    `Wallet: ${wallet}`,
    `Nonce: ${nonce}`,
    "This signature only updates your OG card.",
  ].join("\n");
}
