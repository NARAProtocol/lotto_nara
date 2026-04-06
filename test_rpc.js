async function test() {
  try {
    const payload = {
      jsonrpc: "2.0",
      id: 1,
      method: "eth_getLogs",
      params: [{
        address: "0xd0138Bd1859422A6E7E77165e3300A93Cd389343",
        fromBlock: "0x0",
        toBlock: "latest"
      }]
    };
    
    console.log("Sending...");
    const res = await fetch("https://base-mainnet.g.alchemy.com/v2/2SfPih6j2ng_UXyrD4Ceq", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    
    console.log("Status:", res.status);
    const text = await res.text();
    console.log("Response:", text);
  } catch(e) {
    console.error(e);
  }
}
test();
