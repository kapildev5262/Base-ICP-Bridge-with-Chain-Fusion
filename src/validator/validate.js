require("dotenv").config();
const { Actor, HttpAgent } = require("@dfinity/agent");
const { Ed25519KeyIdentity } = require("@dfinity/identity");
const { Principal } = require("@dfinity/principal");
const { Web3 } = require("web3");
const ethers = require("ethers");
const fs = require("fs");
const express = require("express");
const { BRIDGE_ABI, ERC20_ABI } = require("./constanst");

// Constants
const LAST_BLOCK_FILE = "last_processed_block.txt";
const PROCESSED_TRANSFERS_FILE = "processed_transfers.json";
const CACHE_TTL = 300000; // 5 minutes in milliseconds

// Environment variables and configuration
const ICP_HOST = process.env.ICP_HOST || "http://localhost:4943";
const BRIDGE_CANISTER_ID = process.env.BRIDGE_CANISTER_ID || "ufxgi-4p777-77774-qaadq-cai";
const BASE_RPC = process.env.BASE_RPC || "https://sepolia.base.org";
const BASE_BRIDGE_ADDRESS = process.env.BASE_BRIDGE_ADDRESS || "0x4f3c365693B6555C99e9528d6958A8B686BD41B2";
const VALIDATOR_PRIVATE_KEY = process.env.VALIDATOR_PRIVATE_KEY;
const TOKEN_MAPPINGS = {
  "umunu-kh777-77774-qaaca-cai": process.env.BASE_TOKEN_ADDRESS || "0x0038e47E67bf538E62C95387Bf80B3f1CF14340f",
};

// ICP bridge canister IDL - Updated to handle optional return type
const idlFactory = ({ IDL }) => {
  return IDL.Service({
    lockTokens: IDL.Func(
      [IDL.Record({ token: IDL.Principal, amount: IDL.Nat, recipient: IDL.Text })],
      [IDL.Record({ txId: IDL.Text })],
      []
    ),
    getTransferStatus: IDL.Func(
      [IDL.Text],
      [IDL.Opt(IDL.Record({ completed: IDL.Bool, timestamp: IDL.Nat64 }))],
      ["query"]
    ),
    processBaseToICPTransfer: IDL.Func(
      [IDL.Text, IDL.Principal, IDL.Principal, IDL.Nat, IDL.Vec(IDL.Vec(IDL.Nat8))],
      [IDL.Variant({ ok: IDL.Null, err: IDL.Text })],
      []
    ),
    getPendingTransfers: IDL.Func(
      [],
      [IDL.Vec(IDL.Record({
        id: IDL.Text,
        token: IDL.Principal,
        amount: IDL.Nat,
        sender: IDL.Principal,
        recipient: IDL.Text,
        timestamp: IDL.Nat64,
        completed: IDL.Bool,
        signature: IDL.Opt(IDL.Vec(IDL.Nat8))
      }))],
      ["query"]
    ),
    markTransferProcessed: IDL.Func(
      [IDL.Text],
      [IDL.Variant({ ok: IDL.Null, err: IDL.Text })],
      []
    ),
    getCycleBalance: IDL.Func([], [IDL.Nat], ["query"]),
    getTokenBalance: IDL.Func([IDL.Principal, IDL.Principal], [IDL.Nat], []),
  });
};

// State variables
let transferStatusCache = new Map();
let processedTransfers = new Set();
let currentNonce = null;
const BASE_TOKEN_DECIMALS = {};

// Initialize web3, ethers and wallets
if (!VALIDATOR_PRIVATE_KEY) {
  console.error("VALIDATOR_PRIVATE_KEY not found in environment variables");
  process.exit(1);
}

const web3 = new Web3(BASE_RPC);
const ethersProvider = new ethers.JsonRpcProvider(BASE_RPC);
const wallet = new ethers.Wallet(VALIDATOR_PRIVATE_KEY, ethersProvider);

// Initialize ICP identity
let icpIdentity;
try {
  if (process.env.ICP_IDENTITY_PEM) {
    const { Secp256k1KeyIdentity } = require("@dfinity/identity-secp256k1");
    icpIdentity = Secp256k1KeyIdentity.fromPem(process.env.ICP_IDENTITY_PEM);
  } else if (process.env.ICP_IDENTITY_JSON) {
    icpIdentity = Ed25519KeyIdentity.fromJSON(JSON.parse(process.env.ICP_IDENTITY_JSON));
  } else {
    console.warn("No ICP identity specified, using default identity");
    icpIdentity = Ed25519KeyIdentity.generate();
  }
} catch (error) {
  console.error("Failed to initialize ICP identity:", error);
  process.exit(1);
}

console.log("Using ICP principal:", icpIdentity.getPrincipal().toString());

// Initialize ICP agent and actors
const agent = new HttpAgent({ host: ICP_HOST, identity: icpIdentity });
if (ICP_HOST !== "https://ic0.app") {
  agent.fetchRootKey().catch((err) => {
    console.error("Error fetching root key:", err);
  });
}

const bridgeActor = Actor.createActor(idlFactory, {
  agent,
  canisterId: BRIDGE_CANISTER_ID,
});

// Initialize Ethereum contracts
const bridgeContract = new web3.eth.Contract(BRIDGE_ABI, BASE_BRIDGE_ADDRESS);
const ethersBridgeContract = new ethers.Contract(BASE_BRIDGE_ADDRESS, BRIDGE_ABI, wallet);

// File utility functions
function loadProcessedTransfers() {
  try {
    if (fs.existsSync(PROCESSED_TRANSFERS_FILE)) {
      return new Set(JSON.parse(fs.readFileSync(PROCESSED_TRANSFERS_FILE, "utf8")));
    }
  } catch (error) {
    console.error("Error loading processed transfers:", error);
  }
  return new Set();
}

function saveProcessedTransfers() {
  try {
    fs.writeFileSync(PROCESSED_TRANSFERS_FILE, JSON.stringify([...processedTransfers]));
  } catch (error) {
    console.error("Error saving processed transfers:", error);
  }
}

async function getLastProcessedBlock() {
  try {
    if (fs.existsSync(LAST_BLOCK_FILE)) {
      return parseInt(fs.readFileSync(LAST_BLOCK_FILE, "utf8").trim());
    }
  } catch (error) {
    console.error("Error reading last processed block:", error);
  }

  const currentBlock = await web3.eth.getBlockNumber();
  return Math.max(0, Number(currentBlock) - 20000);
}

function saveLastProcessedBlock(blockNumber) {
  try {
    fs.writeFileSync(LAST_BLOCK_FILE, blockNumber.toString());
  } catch (error) {
    console.error("Error saving last processed block:", error);
  }
}

// Token utility functions
async function getTokenDecimals(tokenAddress) {
  if (BASE_TOKEN_DECIMALS[tokenAddress]) {
    return BASE_TOKEN_DECIMALS[tokenAddress];
  }
  
  try {
    const tokenContract = new web3.eth.Contract(ERC20_ABI, tokenAddress);
    const decimals = await tokenContract.methods.decimals().call();
    const parsedDecimals = parseInt(decimals);
    BASE_TOKEN_DECIMALS[tokenAddress] = parsedDecimals;
    return parsedDecimals;
  } catch (error) {
    console.error(`Error getting token decimals for ${tokenAddress}:`, error);
    BASE_TOKEN_DECIMALS[tokenAddress] = 18;
    return 18;
  }
}

async function checkBridgeTokenBalance(tokenAddress) {
  try {
    const tokenContract = new web3.eth.Contract(ERC20_ABI, tokenAddress);
    return await tokenContract.methods.balanceOf(BASE_BRIDGE_ADDRESS).call();
  } catch (error) {
    console.error("Error checking bridge token balance:", error);
    return "0";
  }
}

// Bridge status functions - Updated to handle optional return type
async function getTransferStatus(txId, forceRefresh = false) {
  const cachedItem = transferStatusCache.get(txId);
  if (!forceRefresh && cachedItem && Date.now() - cachedItem.timestamp < CACHE_TTL) {
    return cachedItem.status;
  }

  try {
    const status = await bridgeActor.getTransferStatus(txId);
    // Status is now an optional type, could be null
    if (status === null || status.length === 0) {
      return null;
    }
    
    // Extract the value from the optional if it exists
    // The format depends on how the IDL transforms the Motoko option type
    const actualStatus = status[0] || null;
    
    if (actualStatus) {
      transferStatusCache.set(txId, {
        status: actualStatus,
        timestamp: Date.now(),
      });
    }
    
    return actualStatus;
  } catch (error) {
    console.error(`Error fetching transfer status for ${txId}:`, error);
    return null;
  }
}

async function checkValidatorStatus() {
  try {
    const isValidator = await bridgeContract.methods.validators(wallet.address).call();
    console.log(`Is registered validator: ${isValidator}`);
    return isValidator;
  } catch (error) {
    console.error("Error checking validator status:", error);
    return false;
  }
}

// Signature functions
async function signTransferMessage(token, amount, recipient, timestamp) {
  // Convert the principal to its raw bytes representation and pad to 32 bytes
  const principalBytes = Principal.fromText(recipient.toString()).toUint8Array();
  const paddedPrincipalBytes = ethers.zeroPadBytes(principalBytes, 32);

  const messageHash = ethers.solidityPackedKeccak256(
    ["address", "uint256", "bytes32", "uint256"], 
    [token, amount, paddedPrincipalBytes, timestamp]
  );

  return await wallet.signMessage(ethers.getBytes(messageHash));
}

// Core Bridge Functions - Base to ICP
async function processBaseToICPTransfer(txHash, recipientPrincipal, icpTokenId, baseAmount) {
  try {
    console.log(`Processing Base->ICP transfer ${txHash} for recipient ${recipientPrincipal.toString()}`);

    if (processedTransfers.has(txHash)) {
      console.log(`Transfer ${txHash} already in processed transfers, skipping`);
      return true;
    }

    const baseTokenAddress = TOKEN_MAPPINGS[icpTokenId];
    if (!baseTokenAddress) {
      console.error(`No Base token mapping found for ICP token: ${icpTokenId}`);
      return false;
    }

    const baseTokenDecimals = await getTokenDecimals(baseTokenAddress);
    const icpAmount = BigInt(baseAmount) / BigInt(10 ** baseTokenDecimals);
    
    console.log(`Amount conversion: Original=${baseAmount}, Adjusted for ICP=${icpAmount}`);

    const timestamp = Date.now();
    const signature = await signTransferMessage(
      baseTokenAddress,
      baseAmount, 
      recipientPrincipal,
      timestamp
    );

    try {
      const result = await bridgeActor.processBaseToICPTransfer(
        txHash, 
        Principal.fromText(icpTokenId), 
        recipientPrincipal, 
        icpAmount, 
        [ethers.getBytes(signature)]
      );
    
      if ("err" in result) {
        console.error(`Error processing transfer: ${result.err}`);
        return false;
      }

      console.log(`Transfer ${txHash} processed successfully`);
      
      processedTransfers.add(txHash);
      saveProcessedTransfers();
      
      return true;
    } catch (callError) {
      console.error(`Error calling processBaseToICPTransfer: ${callError}`);
      return false;
    }
  } catch (error) {
    console.error("Error processing Base->ICP transfer:", error);
    return false;
  }
}

// Historical event processing
async function processHistoricalEvents() {
  const lastProcessedBlock = await getLastProcessedBlock();
  const currentBlock = await web3.eth.getBlockNumber();

  const lastProcessedBlockNum = Number(lastProcessedBlock);
  const currentBlockNum = Number(currentBlock);

  console.log(`Processing historical events from block ${lastProcessedBlockNum} to ${currentBlockNum}`);

  const CHUNK_SIZE = 5000;
  let fromBlock = lastProcessedBlockNum;

  while (fromBlock < currentBlockNum) {
    const toBlock = Math.min(fromBlock + CHUNK_SIZE, currentBlockNum);

    try {
      console.log(`Querying events from block ${fromBlock} to ${toBlock}`);
      const events = await bridgeContract.getPastEvents("TokensLocked", {
        fromBlock: fromBlock,
        toBlock: toBlock,
      });

      console.log(`Found ${events.length} historical events`);

      for (const event of events) {
        await processEvent(event);
      }
    } catch (error) {
      console.error(`Error fetching events from ${fromBlock} to ${toBlock}:`, error);
    }

    fromBlock = toBlock + 1;
  }

  saveLastProcessedBlock(currentBlockNum);
  console.log(`Historical event processing complete up to block ${currentBlockNum}`);
}

// Listen for new events
async function listenForBaseEvents() {
  console.log("Listening for Base bridge events...");

  bridgeContract.events.TokensLocked({}, async (error, event) => {
    if (error) {
      console.error("Error in event listener:", error);
      return;
    }

    try {
      console.log("TokensLocked event detected:", event);
      saveLastProcessedBlock(event.blockNumber);
      await processEvent(event);
    } catch (err) {
      console.error("Error processing Base->ICP transfer:", err);
    }
  });
}

// Shared event processing logic - Updated to handle null status return
async function processEvent(event) {
  if (processedTransfers.has(event.transactionHash)) {
    console.log(`Already processed event from tx ${event.transactionHash}, skipping`);
    return;
  }

  // Check if it's already completed on the ICP side
  try {
    const status = await getTransferStatus(event.transactionHash);
    // If status is null, it means the transfer doesn't exist on ICP side yet
    if (status !== null && status.completed) {
      console.log(`Transfer ${event.transactionHash} already completed on ICP, skipping`);
      processedTransfers.add(event.transactionHash);
      saveProcessedTransfers();
      return;
    }
  } catch (err) {
    console.log(`Status check for ${event.transactionHash} failed: ${err.message || err}`);
    // Continue with processing since a failure here shouldn't block the transfer
  }

  const { token, amount, recipient } = event.returnValues;
  const principalArray = web3.utils.hexToBytes(recipient).slice(0, 29);
  const principalBlob = new Uint8Array(principalArray);
  const recipientPrincipal = Principal.fromUint8Array(principalBlob);

  console.log("Recipient Principal:", recipientPrincipal.toString());

  const icpTokenId = Object.keys(TOKEN_MAPPINGS).find(
    (key) => TOKEN_MAPPINGS[key].toLowerCase() === token.toLowerCase()
  );

  if (!icpTokenId) {
    console.error(`No ICP token mapping found for Base token: ${token}`);
    return;
  }

  const verified = await processBaseToICPTransfer(
    event.transactionHash,
    recipientPrincipal,
    icpTokenId,
    BigInt(amount)
  );

  if (verified) {
    console.log(`Transfer ${event.transactionHash} verified and processed`);
    processedTransfers.add(event.transactionHash);
    saveProcessedTransfers();
  } else {
    console.log(`Transfer ${event.transactionHash} could not be verified`);
  }
}

// Core Bridge Functions - ICP to Base
async function monitorICPTransfers() {
  console.log("Starting monitoring of ICP transfers...");

  setInterval(async () => {
    try {
      const pendingTransfers = await bridgeActor.getPendingTransfers();
      console.log(`Found ${pendingTransfers.length} pending transfers`);

      if (currentNonce === null) {
        currentNonce = await ethersProvider.getTransactionCount(wallet.address);
        console.log(`Current nonce: ${currentNonce}`);
      }

      for (const transfer of pendingTransfers) {
        await processIcpToBaseTransfer(transfer);
      }
    } catch (err) {
      console.error("Error monitoring ICP transfers:", err);
    }
  }, 30000);
}

async function processIcpToBaseTransfer(transfer) {
  console.log("Processing ICP transfer:", transfer);

  if (processedTransfers.has(transfer.id)) {
    console.log(`Transfer ${transfer.id} already processed, skipping`);
    return;
  }

  const baseToken = TOKEN_MAPPINGS[transfer.token.toString()];
  if (!baseToken) {
    console.error(`No Base token mapping found for ICP token: ${transfer.token.toString()}`);
    return;
  }

  if (!ethers.isAddress(transfer.recipient)) {
    console.error(`Invalid Ethereum address: ${transfer.recipient}`);
    return;
  }

  try {
    const bridgeBalance = await checkBridgeTokenBalance(baseToken);
    const baseTokenDecimals = await getTokenDecimals(baseToken);

    // Convert from ICP (no decimals) to Base token decimals
    const baseAmount = BigInt(transfer.amount.toString()) * BigInt(10 ** baseTokenDecimals);

    console.log("Token amount conversion:", {
      icpAmount: transfer.amount.toString(),
      baseAmount: baseAmount.toString(),
      tokenDecimals: baseTokenDecimals,
    });

    if (BigInt(bridgeBalance) < baseAmount) {
      console.error(`Insufficient balance in bridge contract: ${bridgeBalance} < ${baseAmount.toString()}`);
      return;
    }

    const txHash = ethers.solidityPackedKeccak256(
      ["string", "address", "uint256"], 
      [transfer.id, transfer.recipient, baseAmount.toString()]
    );

    const signature = await wallet.signMessage(ethers.getBytes(txHash));

    console.log("Releasing tokens on Base network:", {
      baseToken,
      recipient: transfer.recipient,
      amount: baseAmount.toString(),
      rawAmount: transfer.amount.toString(),
      txId: transfer.id,
    });

    const tx = await ethersBridgeContract.releaseTokens(
      baseToken, 
      transfer.recipient, 
      baseAmount.toString(), 
      transfer.id, 
      [signature], 
      {
        gasLimit: 500000,
        maxFeePerGas: ethers.parseUnits("1.5", "gwei"),
        maxPriorityFeePerGas: ethers.parseUnits("1", "gwei"),
        nonce: currentNonce++,
      }
    );

    console.log("Transaction sent with hash:", tx.hash);

    const receipt = await tx.wait();
    console.log("Transaction confirmed in block:", receipt.blockNumber);

    processedTransfers.add(transfer.id);
    saveProcessedTransfers();

    try {
      const result = await bridgeActor.markTransferProcessed(transfer.id);
      if ("err" in result) {
        console.log(`Warning: Could not mark transfer as processed on canister: ${result.err}`);
      } else {
        console.log("Transfer marked as processed on canister");
      }
    } catch (markError) {
      console.error("Error marking transfer as processed on canister:", markError);
    }
  } catch (err) {
    console.error("Error sending Base transaction:", err);

    if (
      err.code === "NONCE_EXPIRED" || 
      (err.info && err.info.error && err.info.error.message && err.info.error.message.includes("nonce"))
    ) {
      console.log("Nonce issue detected, refreshing nonce");
      currentNonce = await ethersProvider.getTransactionCount(wallet.address);
      console.log(`Refreshed nonce: ${currentNonce}`);
    }
  }
}

// Periodic checks for missed events
async function periodicBaseEventsCheck() {
  console.log("Starting periodic Base events check...");
  
  setInterval(async () => {
    try {
      const lastProcessedBlock = await getLastProcessedBlock();
      const currentBlock = await web3.eth.getBlockNumber();
      
      if (Number(currentBlock) <= Number(lastProcessedBlock)) {
        return;
      }

      console.log(`Periodic check: Processing events from block ${lastProcessedBlock} to ${currentBlock}`);
      
      const events = await bridgeContract.getPastEvents("TokensLocked", {
        fromBlock: lastProcessedBlock,
        toBlock: currentBlock
      });
      
      console.log(`Periodic check: Found ${events.length} events`);
      
      for (const event of events) {
        await processEvent(event);
      }
      
      saveLastProcessedBlock(currentBlock);
    } catch (error) {
      console.error("Error in periodic Base events check:", error);
    }
  }, 30000); 
}

// API endpoints and server setup
function setupApiServer() {
  const app = express();
  const PORT = process.env.PORT || 3000;

  // Status endpoint
  app.get("/status", async (req, res) => {
    try {
      const chainId = await web3.eth.getChainId();
      const currentBlock = await web3.eth.getBlockNumber();
      const isValidator = await checkValidatorStatus();
      const lastBlock = await getLastProcessedBlock();

      let icpStatus;
      try {
        const cycleBalance = await bridgeActor.getCycleBalance();
        icpStatus = { connected: true, cycleBalance: cycleBalance.toString() };
      } catch (err) {
        icpStatus = { connected: false, error: err.message };
      }

      const tokenBalances = {};
      for (const [icpToken, baseToken] of Object.entries(TOKEN_MAPPINGS)) {
        try {
          const bridgeBalance = await checkBridgeTokenBalance(baseToken);
          tokenBalances[icpToken] = { bridgeBalance: bridgeBalance.toString() };
        } catch (err) {
          tokenBalances[icpToken] = { error: err.message };
        }
      }

      const status = {
        base: {
          connected: true,
          chainId: chainId.toString(),
          currentBlock: currentBlock.toString(),
          address: wallet.address,
          bridgeAddress: BASE_BRIDGE_ADDRESS,
          isValidator,
          lastProcessedBlock: lastBlock.toString(),
        },
        icp: icpStatus,
        tokens: tokenBalances,
        processedTransfersCount: processedTransfers.size,
        currentNonce: currentNonce?.toString() || "Not initialized",
      };

      res.send(JSON.stringify(status, (key, value) => (typeof value === "bigint" ? value.toString() : value)));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Processed transfers endpoint
  app.get("/processed", (req, res) => {
    try {
      const processedData = {
        processedCount: processedTransfers.size,
        processed: Array.from(processedTransfers),
      };

      res.send(JSON.stringify(processedData, (key, value) => (typeof value === "bigint" ? value.toString() : value)));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Verify transfer endpoint - Updated to handle null status
  app.get("/verify/:txHash", async (req, res) => {
    try {
      const { txHash } = req.params;

      if (!txHash) {
        return res.status(400).json({ error: "Transaction hash is required" });
      }

      const events = await bridgeContract.getPastEvents("TokensLocked", {
        filter: { transactionHash: txHash },
        fromBlock: 0,
        toBlock: "latest",
      });

      if (!events || events.length === 0) {
        return res.status(404).json({ error: "Transaction not found" });
      }

      const event = events[0];
      const { token, amount, recipient } = event.returnValues;

      const principalArray = web3.utils.hexToBytes(recipient).slice(0, 29);
      const principalBlob = new Uint8Array(principalArray);
      const recipientPrincipal = Principal.fromUint8Array(principalBlob);

      const icpTokenId = Object.keys(TOKEN_MAPPINGS).find(
        (key) => TOKEN_MAPPINGS[key].toLowerCase() === token.toLowerCase()
      );

      if (!icpTokenId) {
        return res.status(400).json({ error: `No ICP token mapping found for Base token: ${token}` });
      }

      let status = null;
      try {
        status = await getTransferStatus(txHash, true);
      } catch (statusError) {
        console.error(`Error getting status for ${txHash}:`, statusError);
      }

      let balanceResult = "0";
      try {
        balanceResult = await bridgeActor.getTokenBalance(
          Principal.fromText(icpTokenId), 
          recipientPrincipal
        );
      } catch (balanceError) {
        console.error(`Error getting balance for ${recipientPrincipal.toString()}:`, balanceError);
      }

      res.json({
        txHash,
        baseToken: token,
        icpToken: icpTokenId,
        recipient: recipient,
        icpRecipient: recipientPrincipal.toString(),
        amount: amount,
        status: status
          ? {
              completed: status.completed,
              timestamp: status.timestamp.toString(),
            }
          : "Not found on ICP",
        currentBalance: balanceResult.toString(),
        isProcessed: processedTransfers.has(txHash),
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Reprocess blocks endpoint
  app.use(express.json());
  app.post("/reprocess", async (req, res) => {
    try {
      const { fromBlock, toBlock } = req.body;

      if (!fromBlock || !toBlock) {
        return res.status(400).json({ error: "Missing fromBlock or toBlock parameters" });
      }

      console.log(`Manual reprocessing requested from block ${fromBlock} to ${toBlock}`);

      setTimeout(async () => {
        try {
          console.log(`Starting manual reprocessing of blocks ${fromBlock} to ${toBlock}`);

          const events = await bridgeContract.getPastEvents("TokensLocked", {
            fromBlock: parseInt(fromBlock),
            toBlock: parseInt(toBlock),
          });

          console.log(`Found ${events.length} events to reprocess`);

          let processed = 0;
          for (const event of events) {
            await processEvent(event);
            processed++;
          }

          console.log(`Manual reprocessing complete. Processed ${processed} out of ${events.length} events.`);
        } catch (err) {
          console.error("Error during manual reprocessing:", err);
        }
      }, 0);

      res.json({
        message: `Reprocessing of blocks ${fromBlock} to ${toBlock} queued successfully`,
        eventsWillBeProcessed: true,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.listen(PORT, () => {
    console.log(`Status server running on port ${PORT}`);
  });
}

async function startValidator() {
  try {
    console.log("Starting Chain Fusion Bridge validator...");
    console.log("Configuration:");
    console.log(`- ICP Host: ${ICP_HOST}`);
    console.log(`- Bridge Canister ID: ${BRIDGE_CANISTER_ID}`);
    console.log(`- Base RPC: ${BASE_RPC}`);
    console.log(`- Base Bridge Address: ${BASE_BRIDGE_ADDRESS}`);
    console.log(`- Validator Address: ${wallet.address}`);

    processedTransfers = loadProcessedTransfers();
    
    const isValidator = await checkValidatorStatus();
    if (!isValidator) {
      console.warn("WARNING: This wallet is not registered as a validator in the bridge contract!");
    }

    currentNonce = await ethersProvider.getTransactionCount(wallet.address);
    console.log(`Initial nonce: ${currentNonce}`);

    // Start HTTP server
    setupApiServer();

    // Start core bridge processes
    await processHistoricalEvents();
    await listenForBaseEvents();
    await monitorICPTransfers();
    periodicBaseEventsCheck();
    
    console.log("Validator started successfully");
  } catch (error) {
    console.error("Error starting validator:", error);
    process.exit(1);
  }
}

startValidator();