// Server configuration. Every secret comes from the environment and is never sent to the browser.

export const env = {
  memwalKey: process.env.MEMWAL_PRIVATE_KEY || process.env.MEMWAL_KEY || '',
  memwalAccount: process.env.MEMWAL_ACCOUNT_ID || '',
  memwalServer: process.env.MEMWAL_SERVER_URL || 'https://relayer.memory.walrus.xyz',
  tatumKey: process.env.TATUM_API_KEY || '',
  tatumSuiUrl: process.env.TATUM_SUI_URL || 'https://sui-mainnet.gateway.tatum.io',
  geminiKey: process.env.GEMINI_API_KEY || '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
  blobToken: process.env.BLOB_READ_WRITE_TOKEN || '',
  dataDir: process.env.ORASENTRA_DATA_DIR || 'server/data',
  demoAddress: process.env.DEMO_SUI_ADDRESS || '',
  demoKey: process.env.DEMO_KEEPER_KEY || '',
}

export const memoryMode = (): 'mainnet' | 'testnet' | 'mock' =>
  !env.memwalKey || !env.memwalAccount ? 'mock' : env.memwalServer.includes('dev.') ? 'testnet' : 'mainnet'
