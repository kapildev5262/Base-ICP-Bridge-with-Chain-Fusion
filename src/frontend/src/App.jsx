import { useState, useEffect } from 'react';
import { bridge_canister } from "../../declarations/bridge_canister";
import { token_canister } from "../../declarations/token_canister";
import BridgeComponent from './BridgeComponent';
import BridgeStatus from './BridgeStatus';
import './App.css';

// Add this import at the top of App.js
import { AuthClient } from '@dfinity/auth-client';
import { ethers } from 'ethers';

function App() {
  const [icpIdentity, setIcpIdentity] = useState(null);
  const [ethWallet, setEthWallet] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState('Not connected');
  const [tokenBalance, setTokenBalance] = useState(0);

  // Connect to ICP (Internet Identity)
  const connectICP = async () => {
    try {
      const authClient = await AuthClient.create();
      if (await authClient.isAuthenticated()) {
        const identity = authClient.getIdentity();
        setIcpIdentity(identity);
        return identity;
      }
      await authClient.login({
        identityProvider: process.env.DFX_NETWORK === "ic" 
          ? "https://identity.ic0.app"
          : `http://localhost:4943?canisterId=rdmx6-jaaaa-aaaaa-aaadq-cai`
      });
      const identity = authClient.getIdentity();
      setIcpIdentity(identity);
      return identity;
    } catch (err) {
      console.error("ICP login failed:", err);
      throw err;
    }
  };

  // Connect to Ethereum (MetaMask)
  const connectEthereum = async () => {
    try {
      if (!window.ethereum) throw new Error("MetaMask not installed");
      
      const accounts = await window.ethereum.request({ 
        method: 'eth_requestAccounts' 
      });
      
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      
      setEthWallet({
        address: accounts[0],
        provider,
        signer
      });
      
      return accounts[0];
    } catch (err) {
      console.error("Ethereum connection failed:", err);
      throw err;
    }
  };

  // Connect both wallets
  const connectWallets = async () => {
    setConnectionStatus('Connecting...');
    
    try {
      const [icpId, ethAddr] = await Promise.all([
        connectICP(),
        connectEthereum()
      ]);
      
      setConnectionStatus(`Connected (ICP: ${icpId.getPrincipal().toString()}, ETH: ${ethAddr})`);
      
      // Fetch token balance
      const balance = await token_canister.balanceOf(icpId.getPrincipal());
      setTokenBalance(Number(balance));
    } catch (error) {
      console.error('Connection failed:', error);
      setConnectionStatus(`Connection failed: ${error.message}`);
    }
  };

  return (
    <div className="app-container">
      <header>
        <img src="/logo2.svg" alt="Chain Fusion Logo" className="logo" />
        <h1>Base-ICP Bridge</h1>
      </header>

      <div className="connection-status">
        <button onClick={connectWallets} disabled={connectionStatus.includes('Connecting')}>
          {connectionStatus.startsWith('Connected') ? 'Connected' : 
           connectionStatus.includes('Connecting') ? 'Connecting...' : 'Connect Wallets'}
        </button>
        <p className="status-text">{connectionStatus}</p>
        {tokenBalance > 0 && <p>Your Token Balance: {tokenBalance}</p>}
      </div>

      <div className="bridge-content">
        {icpIdentity && ethWallet ? (
          <>
            <BridgeComponent 
              icpIdentity={icpIdentity} 
              ethWallet={ethWallet} 
              onTransferComplete={() => {
                // Refresh balance after transfer
                token_canister.balanceOf(icpIdentity.getPrincipal())
                  .then(bal => setTokenBalance(Number(bal)));
              }}
            />
            <BridgeStatus />
          </>
        ) : (
          <div className="wallet-prompt">
            <p>Please connect your wallets to use the bridge</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default App;