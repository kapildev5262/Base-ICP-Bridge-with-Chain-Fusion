// BaseBridgeInterface.jsx - Fixed
import React, { useState, useEffect } from "react";
import { ethers } from "ethers";
import { abi, contractAddress, erc20Abi } from "./constants";
import { Principal } from "@dfinity/principal";
import { Buffer } from 'buffer';
import "./BaseBridgeInterface.css";

const BaseBridgeInterface = () => {
  // State variables
  const [provider, setProvider] = useState(null);
  const [signer, setSigner] = useState(null);
  const [contract, setContract] = useState(null);
  const [account, setAccount] = useState("");
  const [isOwner, setIsOwner] = useState(false);
  const [tokenAddress, setTokenAddress] = useState("");
  const [amount, setAmount] = useState("");
  const [icpRecipient, setIcpRecipient] = useState("");
  const [recipient, setRecipient] = useState("");
  const [icpTxId, setIcpTxId] = useState("");
  const [signatures, setSignatures] = useState("");
  const [validatorAddress, setValidatorAddress] = useState("");
  const [signaturesRequired, setSignaturesRequired] = useState(0);
  const [icpCanisterId, setIcpCanisterId] = useState("");
  const [tokenPairings, setTokenPairings] = useState({});
  const [validators, setValidators] = useState({});
  const [loading, setLoading] = useState(false);
  const [notification, setNotification] = useState({ message: "", type: "" });
  const [approvedAmount, setApprovedAmount] = useState("0");
  const [tokenBalance, setTokenBalance] = useState("0");
  const [networkName, setNetworkName] = useState("");

  // Connect to wallet and contract
  const connectWallet = async () => {
    try {
      setLoading(true);

      if (!window.ethereum) {
        showNotification("Please install MetaMask or another web3 provider", "error");
        return;
      }

      // Request account access
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
      const account = accounts[0];
      setAccount(account);

      // Create ethers provider
      const provider = new ethers.BrowserProvider(window.ethereum);
      setProvider(provider);

      // Get network information
      const network = await provider.getNetwork();
      setNetworkName(network.name);

      // Get signer
      const signer = await provider.getSigner();
      setSigner(signer);

      // Verify contract exists on this network
      try {
        const code = await provider.getCode(contractAddress);
        if (code === "0x") {
          showNotification(`Contract not found at ${contractAddress} on ${network.name}. Please check the contract address or switch networks.`, "error");
          return;
        }
      } catch (err) {
        showNotification(`Invalid contract address or network issue. Please check your configuration.`, "error");
        return;
      }

      // Create contract instance
      const contract = new ethers.Contract(contractAddress, abi, signer);
      setContract(contract);

      // Try to get required signatures first as a test call
      try {
        const requiredSigs = await contract.requiredSignatures();
        setSignaturesRequired(Number(requiredSigs));
      } catch (error) {
        console.error("Error calling requiredSignatures:", error);
        showNotification(`Contract method call failed. Please verify the ABI matches the deployed contract.`, "error");
        return;
      }

      // Check if connected account is owner
      try {
        const owner = await contract.owner();
        setIsOwner(owner.toLowerCase() === account.toLowerCase());
      } catch (error) {
        console.error("Error calling owner method:", error);
        // Continue even if owner check fails
        setIsOwner(false);
      }

      showNotification(`Connected to wallet on ${network.name} network successfully`, "success");
    } catch (error) {
      console.error("Error connecting wallet:", error);
      showNotification(`Error connecting wallet: ${error.message}`, "error");
    } finally {
      setLoading(false);
    }
  };

  // Lock tokens to transfer to ICP
  const lockTokens = async () => {
    if (!contract || !signer) {
      showNotification("Please connect your wallet first", "error");
      return;
    }

    try {
      setLoading(true);

      // Create ERC20 token contract instance
      const tokenContract = new ethers.Contract(tokenAddress, erc20Abi, signer);

      // Check if token is supported
      try {
        const canisterId = await contract.tokenPairings(tokenAddress);
        if (!canisterId || canisterId === "") {
          showNotification("Token not supported by the bridge", "error");
          return;
        }
      } catch (error) {
        console.error("Error checking token pairing:", error);
        showNotification("Error checking if token is supported. Please check your contract interface.", "error");
        return;
      }

      // Get decimals for the token (default to 18 if not available)
      let decimals = 18;
      try {
        decimals = await tokenContract.decimals();
      } catch (error) {
        console.warn("Couldn't get decimals, using default of 18:", error);
      }

      // Convert amount to wei
      const amountWei = ethers.parseUnits(amount, decimals);

      // Approve token transfer first
      try {
        const approveTx = await tokenContract.approve(contractAddress, amountWei);
        showNotification("Approving token transfer...", "info");
        await approveTx.wait();
      } catch (error) {
        console.error("Error approving tokens:", error);
        showNotification(`Error approving tokens: ${error.message}`, "error");
        return;
      }

      // Format ICP recipient as bytes32
      // Format ICP recipient as bytes32
      let formattedRecipient;
      try {
        // Check if the icpRecipient is already in bytes32 format
        if (icpRecipient.startsWith("0x") && icpRecipient.length === 66) {
          formattedRecipient = icpRecipient;
        } else {
          // Convert Principal ID to its binary representation
          const principalObj = Principal.fromText(icpRecipient);
          const principalBytes = principalObj.toUint8Array();

          // Create a bytes32 value from this (pad with zeros if needed)
          // We need to create a Buffer that's exactly 32 bytes long
          const buffer = Buffer.alloc(32, 0); // Create a 32-byte buffer filled with zeros

          // Copy the principal bytes into our buffer (not exceeding buffer length)
          const bytesToCopy = Math.min(principalBytes.length, 32);
          Buffer.from(principalBytes).copy(buffer, 0, 0, bytesToCopy);

          // Convert to hex string with 0x prefix
          formattedRecipient = "0x" + buffer.toString("hex");
        }
      } catch (error) {
        console.error("Error formatting recipient:", error);
        showNotification(`Error formatting ICP recipient: ${error.message}`, "error");
        return;
      }

      // Lock tokens
      try {
        const tx = await contract.lockTokens(tokenAddress, amountWei, formattedRecipient);
        showNotification("Locking tokens...", "info");
        await tx.wait();

        showNotification(`Successfully locked ${amount} tokens for transfer to ICP`, "success");
      } catch (error) {
        console.error("Error locking tokens:", error);
        showNotification(`Error locking tokens: ${error.message}`, "error");
        return;
      }

      // Refresh token balance and approvals
      await checkTokenBalance();
    } catch (error) {
      console.error("Error in lockTokens flow:", error);
      showNotification(`An unexpected error occurred: ${error.message}`, "error");
    } finally {
      setLoading(false);
    }
  };

  // Release tokens that were locked on ICP side
  const releaseTokens = async () => {
    if (!contract || !signer) {
      showNotification("Please connect your wallet first", "error");
      return;
    }

    try {
      setLoading(true);

      // Get decimals for the token (default to 18 if not available)
      let decimals = 18;
      try {
        const tokenContract = new ethers.Contract(tokenAddress, erc20Abi, provider);
        decimals = await tokenContract.decimals();
      } catch (error) {
        console.warn("Couldn't get decimals, using default of 18:", error);
      }

      // Convert amount to wei
      const amountWei = ethers.parseUnits(amount, decimals);

      // Parse signatures string into array
      let signaturesArray;
      try {
        // Check if the signatures field contains proper hex strings
        signaturesArray = signatures.split(",").map((sig) => {
          sig = sig.trim();
          if (!sig.startsWith("0x")) {
            return `0x${sig}`;
          }
          return sig;
        });
      } catch (error) {
        console.error("Error parsing signatures:", error);
        showNotification(`Error parsing signatures: ${error.message}. Each signature must be a hex string.`, "error");
        return;
      }

      // Release tokens
      try {
        const tx = await contract.releaseTokens(tokenAddress, recipient, amountWei, icpTxId, signaturesArray);

        showNotification("Releasing tokens...", "info");
        await tx.wait();

        showNotification(`Successfully released ${amount} tokens to ${recipient}`, "success");
      } catch (error) {
        console.error("Error releasing tokens:", error);
        showNotification(`Error releasing tokens: ${error.message}`, "error");
        return;
      }
    } catch (error) {
      console.error("Error in releaseTokens flow:", error);
      showNotification(`An unexpected error occurred: ${error.message}`, "error");
    } finally {
      setLoading(false);
    }
  };

  // Add validator
  const addValidator = async () => {
    if (!contract || !isOwner) {
      showNotification("Only the owner can add validators", "error");
      return;
    }

    try {
      setLoading(true);

      const tx = await contract.addValidator(validatorAddress);
      showNotification("Adding validator...", "info");
      await tx.wait();

      showNotification(`Successfully added validator ${validatorAddress}`, "success");

      // Refresh validators
      await getValidators();
    } catch (error) {
      console.error("Error adding validator:", error);
      showNotification(`Error adding validator: ${error.message}`, "error");
    } finally {
      setLoading(false);
    }
  };

  // Remove validator
  const removeValidator = async () => {
    if (!contract || !isOwner) {
      showNotification("Only the owner can remove validators", "error");
      return;
    }

    try {
      setLoading(true);

      const tx = await contract.removeValidator(validatorAddress);
      showNotification("Removing validator...", "info");
      await tx.wait();

      showNotification(`Successfully removed validator ${validatorAddress}`, "success");

      // Refresh validators
      await getValidators();
    } catch (error) {
      console.error("Error removing validator:", error);
      showNotification(`Error removing validator: ${error.message}`, "error");
    } finally {
      setLoading(false);
    }
  };

  // Set required signatures
  const setRequiredSigs = async () => {
    if (!contract || !isOwner) {
      showNotification("Only the owner can set required signatures", "error");
      return;
    }

    try {
      setLoading(true);

      const tx = await contract.setRequiredSignatures(signaturesRequired);
      showNotification("Setting required signatures...", "info");
      await tx.wait();

      showNotification(`Successfully set required signatures to ${signaturesRequired}`, "success");
    } catch (error) {
      console.error("Error setting required signatures:", error);
      showNotification(`Error setting required signatures: ${error.message}`, "error");
    } finally {
      setLoading(false);
    }
  };

  // Add token pairing
  const addTokenPairing = async () => {
    if (!contract || !isOwner) {
      showNotification("Only the owner can add token pairings", "error");
      return;
    }

    try {
      setLoading(true);

      const tx = await contract.addTokenPairing(tokenAddress, icpCanisterId);
      showNotification("Adding token pairing...", "info");
      await tx.wait();

      showNotification(`Successfully paired ${tokenAddress} with ICP canister ${icpCanisterId}`, "success");

      // Refresh token pairings
      await getTokenPairings();
    } catch (error) {
      console.error("Error adding token pairing:", error);
      showNotification(`Error adding token pairing: ${error.message}`, "error");
    } finally {
      setLoading(false);
    }
  };

  // Check token balance and approvals
  const checkTokenBalance = async () => {
    if (!tokenAddress || !account || !provider) return;

    try {
      const tokenContract = new ethers.Contract(tokenAddress, erc20Abi, provider);

      let decimals = 18;
      try {
        decimals = await tokenContract.decimals();
      } catch (error) {
        console.warn("Couldn't get decimals, using default of 18:", error);
      }

      // Get token balance
      try {
        const balance = await tokenContract.balanceOf(account);
        setTokenBalance(ethers.formatUnits(balance, decimals));
      } catch (error) {
        console.error("Error getting token balance:", error);
        setTokenBalance("Error");
      }

      // Get approved amount
      try {
        const approved = await tokenContract.allowance(account, contractAddress);
        setApprovedAmount(ethers.formatUnits(approved, decimals));
      } catch (error) {
        console.error("Error getting token allowance:", error);
        setApprovedAmount("Error");
      }
    } catch (error) {
      console.error("Error checking token status:", error);
    }
  };

  // Check validator status
  const checkValidatorStatus = async (address) => {
    if (!contract || !address) return false;

    try {
      return await contract.validators(address);
    } catch (error) {
      console.error("Error checking validator status:", error);
      return false;
    }
  };

  // Get token pairings
  const getTokenPairings = async () => {
    if (!contract) return;

    // This is a simplified approach
    console.log("Would fetch token pairings here");
  };

  // Get validators
  const getValidators = async () => {
    if (!contract) return;

    console.log("Would fetch validators here");

    // Check if the current validator address is valid
    if (validatorAddress) {
      const isValidator = await checkValidatorStatus(validatorAddress);
      if (isValidator) {
        showNotification(`${validatorAddress} is a validator`, "info");
      }
    }
  };

  // Notification helper
  const showNotification = (message, type) => {
    setNotification({ message, type });

    // Clear notification after 5 seconds
    setTimeout(() => {
      setNotification({ message: "", type: "" });
    }, 5000);
  };

  // Listen for account changes
  useEffect(() => {
    if (window.ethereum) {
      window.ethereum.on("accountsChanged", (accounts) => {
        if (accounts.length > 0) {
          setAccount(accounts[0]);
        } else {
          setAccount("");
          setSigner(null);
        }
      });

      window.ethereum.on("chainChanged", () => {
        // Reload the page when chain changes
        window.location.reload();
      });
    }

    return () => {
      if (window.ethereum) {
        window.ethereum.removeAllListeners("accountsChanged");
        window.ethereum.removeAllListeners("chainChanged");
      }
    };
  }, []);

  // Check token balance when tokenAddress or account changes
  useEffect(() => {
    if (tokenAddress && account && provider) {
      checkTokenBalance();
    }
  }, [tokenAddress, account, provider]);

  return (
    <div className="bridge-container">
      <h1>Base Bridge Interface</h1>

      {notification.message && <div className={`notification ${notification.type}`}>{notification.message}</div>}

      <div className="connect-section">
        <h2>Connect Wallet</h2>
        <button onClick={connectWallet} disabled={loading} className="primary-button">
          {account ? `Connected: ${account.substring(0, 6)}...${account.substring(38)} (${networkName})` : "Connect Wallet"}
        </button>
      </div>

      {account && (
        <>
          <div className="card">
            <h2>Lock Tokens (Base to ICP)</h2>
            <div className="form-group">
              <label>Token Address</label>
              <input type="text" value={tokenAddress} onChange={(e) => setTokenAddress(e.target.value)} placeholder="ERC20 Token Address" />
            </div>

            {tokenAddress && (
              <div className="token-info">
                <p>Balance: {tokenBalance} tokens</p>
                <p>Approved: {approvedAmount} tokens</p>
              </div>
            )}

            <div className="form-group">
              <label>Amount</label>
              <input type="text" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Token Amount" />
            </div>

            <div className="form-group">
              <label>ICP Recipient</label>
              <input type="text" value={icpRecipient} onChange={(e) => setIcpRecipient(e.target.value)} placeholder="ICP Account ID" />
            </div>

            <button onClick={lockTokens} disabled={loading || !tokenAddress || !amount || !icpRecipient} className="action-button">
              Lock Tokens
            </button>
          </div>

          <div className="card">
            <h2>Release Tokens (ICP to Base)</h2>
            <div className="form-group">
              <label>Token Address</label>
              <input type="text" value={tokenAddress} onChange={(e) => setTokenAddress(e.target.value)} placeholder="ERC20 Token Address" />
            </div>

            <div className="form-group">
              <label>Amount</label>
              <input type="text" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Token Amount" />
            </div>

            <div className="form-group">
              <label>Recipient</label>
              <input type="text" value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="Base Address" />
            </div>

            <div className="form-group">
              <label>ICP Transaction ID</label>
              <input type="text" value={icpTxId} onChange={(e) => setIcpTxId(e.target.value)} placeholder="ICP Transaction ID" />
            </div>

            <div className="form-group">
              <label>Validator Signatures (comma-separated)</label>
              <textarea value={signatures} onChange={(e) => setSignatures(e.target.value)} placeholder="Validator Signatures" rows={3} />
            </div>

            <button onClick={releaseTokens} disabled={loading || !tokenAddress || !amount || !recipient || !icpTxId || !signatures} className="action-button">
              Release Tokens
            </button>
          </div>

          {isOwner && (
            <div className="admin-section">
              <h2>Admin Functions</h2>

              <div className="card">
                <h3>Validator Management</h3>
                <div className="form-group">
                  <label>Validator Address</label>
                  <input type="text" value={validatorAddress} onChange={(e) => setValidatorAddress(e.target.value)} placeholder="Validator Address" />
                </div>

                <div className="button-group">
                  <button onClick={addValidator} disabled={loading || !validatorAddress} className="admin-button">
                    Add Validator
                  </button>
                  <button onClick={removeValidator} disabled={loading || !validatorAddress} className="admin-button">
                    Remove Validator
                  </button>
                </div>
              </div>

              <div className="card">
                <h3>Required Signatures</h3>
                <div className="form-group">
                  <label>Signatures Required</label>
                  <input type="number" value={signaturesRequired} onChange={(e) => setSignaturesRequired(parseInt(e.target.value))} min="1" />
                </div>

                <button onClick={setRequiredSigs} disabled={loading || signaturesRequired < 1} className="admin-button">
                  Set Required Signatures
                </button>
              </div>

              <div className="card">
                <h3>Token Pairing</h3>
                <div className="form-group">
                  <label>Base Token Address</label>
                  <input type="text" value={tokenAddress} onChange={(e) => setTokenAddress(e.target.value)} placeholder="ERC20 Token Address" />
                </div>

                <div className="form-group">
                  <label>ICP Canister ID</label>
                  <input type="text" value={icpCanisterId} onChange={(e) => setIcpCanisterId(e.target.value)} placeholder="ICP Canister ID" />
                </div>

                <button onClick={addTokenPairing} disabled={loading || !tokenAddress || !icpCanisterId} className="admin-button">
                  Add Token Pairing
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default BaseBridgeInterface;