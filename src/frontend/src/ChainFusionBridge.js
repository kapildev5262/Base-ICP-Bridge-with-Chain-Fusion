// src/frontend/src/ChainFusionBridge.js

// File: chain_fusion_bridge.js

// ***********************************************
// Bridge Implementation between Base and ICP
// ***********************************************


import { Actor } from "@dfinity/agent";
import { Principal } from "@dfinity/principal";
import { ethers } from "ethers";
import { BRIDGE_ABI, ERC20_ABI } from "./constanst";
import { idlFactory } from "./bridge.did";

import { HttpAgent } from "@dfinity/agent";


// Configuration for both chains
const CONFIG = {
  icp: {
    host: "https://ic0.app",
    canisterId: "ufxgi-4p777-77774-qaadq-cai" // Updated with the deployed canister ID
  },
  base: {
    rpc: "https://base-sepolia.g.alchemy.com/v2/gc8LPqeXM7ZGja289ivR7YoerEUSEDLF",
    bridgeContract: "0x3506bDaDB1a7C7649180Be7C0A10B4b0806DC111"
  }
};

// Bridge Interface - Main functionality
class ChainFusionBridge {
  constructor(icpIdentity, ethWallet) {
    this.icpIdentity = icpIdentity;
    this.ethWallet = ethWallet;
    this.icpAgent = null;
    this.bridgeActor = null;
    this.bridgeContract = null;
  }

  // Initialize connections to both chains
  async initialize() {
    try {
      // Initialize ICP connection with identity
      this.icpAgent = new HttpAgent({
        host: CONFIG.icp.host,
        identity: this.icpIdentity
      });
      
      // When not in production (localhost), fetch root key
      if (CONFIG.icp.host !== "https://ic0.app") {
        await this.icpAgent.fetchRootKey();
      }
      
      // Create bridge Actor
      this.bridgeActor = Actor.createActor(idlFactory, {
        agent: this.icpAgent,
        canisterId: CONFIG.icp.canisterId
      });
      
      // Initialize Base contract connection with ethers.js (modern approach)
      this.bridgeContract = new ethers.Contract(
        CONFIG.base.bridgeContract,
        BRIDGE_ABI,
        this.ethWallet.signer
      );
      
      console.log("ChainFusion Bridge initialized successfully");
      return true;
    } catch (error) {
      console.error("Failed to initialize bridge:", error);
      return false;
    }
  }

  // Transfer tokens from Base to ICP
  async transferBaseToICP(tokenAddress, amount, icpRecipientPrincipal) {
    try {
      // Convert amount to BigNumber to handle large numbers properly
      const amountBN = ethers.parseUnits(amount, 18); // Assuming 18 decimals, adjust as needed
      
      // Convert ICP principal to bytes32 format for Ethereum
      const principalBytes = this._principalToBytes32(icpRecipientPrincipal);
      
      // Create token contract instance with ethers
      const tokenContract = new ethers.Contract(
        tokenAddress,
        ERC20_ABI,
        this.ethWallet.signer
      );
      
      // Approve ERC20 tokens for the bridge contract
      const approveTx = await tokenContract.approve(CONFIG.base.bridgeContract, amountBN);
      await approveTx.wait();
      
      // Lock tokens in the bridge contract
      const lockTx = await this.bridgeContract.lockTokens(
        tokenAddress,
        amountBN,
        principalBytes
      );
      
      // Wait for transaction to be mined
      const receipt = await lockTx.wait();
      
      console.log("Tokens locked on Base:", receipt.hash);
      
      return {
        success: true,
        txHash: receipt.hash
      };
    } catch (error) {
      console.error("Failed to transfer from Base to ICP:", error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Transfer tokens from ICP to Base
  async transferICPToBase(tokenCanisterId, amount, ethRecipientAddress) {
    try {
      // Call the canister to lock tokens on ICP side
      const result = await this.bridgeActor.lockTokens({
        token: Principal.fromText(tokenCanisterId),
        amount: BigInt(amount),
        recipient: ethRecipientAddress
      });
      
      console.log("Tokens locked on ICP, transaction ID:", result.txId);
      
      return {
        success: true,
        txId: result.txId
      };
    } catch (error) {
      console.error("Failed to transfer from ICP to Base:", error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Check status of a cross-chain transfer
  async checkTransferStatus(txId, sourceChain) {
    try {
      if (sourceChain === 'base') {
        // Query Base bridge contract for status
        const status = await this.bridgeContract.getTransferStatus(txId);
        return {
          completed: status.completed,
          timestamp: status.timestamp.toNumber()
        };
      } else if (sourceChain === 'icp') {
        // Query ICP canister for status
        const status = await this.bridgeActor.getTransferStatus(txId);
        return {
          completed: status.completed,
          timestamp: Number(status.timestamp)
        };
      }
      
      throw new Error("Invalid source chain specified");
    } catch (error) {
      console.error("Failed to check transfer status:", error);
      return {
        error: error.message
      };
    }
  }

  // Utility: Convert ICP Principal to bytes32 format
  _principalToBytes32(principal) {
    // Ensure we're working with a Principal object
    const principalId = typeof principal === 'string' 
      ? Principal.fromText(principal) 
      : principal;
    
    const bytes = [...principalId.toUint8Array()];
    
    // Pad to 32 bytes
    while (bytes.length < 32) {
      bytes.push(0);
    }
    
    return '0x' + bytes.map(b => b.toString(16).padStart(2, '0')).join('');
  }
}

export default ChainFusionBridge;