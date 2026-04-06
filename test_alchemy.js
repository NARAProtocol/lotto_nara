const { createPublicClient, http, parseAbiItem } = require('viem');
const { base } = require('viem/chains');

async function test() {
  const client = createPublicClient({
    chain: base,
    transport: http('https://base-mainnet.g.alchemy.com/v2/2SfPih6j2ng_UXyrD4Ceq')
  });

  try {
    const current = await client.getBlockNumber();
    console.log('Current block:', current);
    
    const logs = await client.getLogs({
      address: '0xd0138Bd1859422A6E7E77165e3300A93Cd389343',
      event: parseAbiItem('event WinnerDrawn(address indexed winner, uint256 potNara, uint256 potEth, uint256 protocolCutEth)'),
      fromBlock: current - 5000n,
      toBlock: 'latest'
    });
    
    console.log('Logs:', logs);
  } catch (e) {
    console.error('Error:', e.details || e.message);
  }
}

test();
