import React, { useState, useEffect } from 'react';
import ChainFusionBridge from './ChainFusionBridge';
import { TOKEN_ADDRESSES } from "./constanst";

const BridgeComponent = ({ icpIdentity, ethWallet, onTransferComplete }) => {
  const [bridge, setBridge] = useState(null);
  const [amount, setAmount] = useState('');
  const [recipient, setRecipient] = useState('');
  const [direction, setDirection] = useState('baseToIcp');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [tokenAddress, setTokenAddress] = useState(TOKEN_ADDRESSES.base);
  const [tokenCanisterId, setTokenCanisterId] = useState(TOKEN_ADDRESSES.icp);
  
  // Initialize bridge on component mount
  useEffect(() => {
    async function initBridge() {
      try {
        setStatus('Initializing bridge...');
        const bridgeInstance = new ChainFusionBridge(icpIdentity, ethWallet);
        await bridgeInstance.initialize();
        setBridge(bridgeInstance);
        setStatus('Bridge initialized and ready');
      } catch (error) {
        console.error('Failed to initialize bridge:', error);
        setStatus('Failed to initialize bridge: ' + error.message);
      }
    }
    
    if (icpIdentity && ethWallet) {
      initBridge();
    }
  }, [icpIdentity, ethWallet]);

  // Update recipient placeholder based on direction
  useEffect(() => {
    // Clear recipient when changing direction
    setRecipient('');
    
    // Set token addresses based on direction
    if (direction === 'baseToIcp') {
      setTokenAddress(TOKEN_ADDRESSES.base);
      setTokenCanisterId(TOKEN_ADDRESSES.icp);
    } else {
      setTokenAddress(TOKEN_ADDRESSES.base);
      setTokenCanisterId(TOKEN_ADDRESSES.icp);
    }
  }, [direction]);

  // Handle amount input validation
  const handleAmountChange = (e) => {
    const value = e.target.value;
    // Only allow numbers and decimals
    if (value === '' || /^\d*\.?\d*$/.test(value)) {
      setAmount(value);
    }
  };

  // Handle bridge transfer
  const handleTransfer = async () => {
    if (!bridge) {
      setStatus('Bridge not initialized');
      return;
    }
    
    if (!amount || parseFloat(amount) <= 0) {
      setStatus('Please enter a valid amount');
      return;
    }
    
    if (!recipient) {
      setStatus('Please enter a recipient address');
      return;
    }
    
    setLoading(true);
    setStatus('Processing transfer...');
    
    try {
      let result;
      
      if (direction === 'baseToIcp') {
        // Base -> ICP transfer
        result = await bridge.transferBaseToICP(
          tokenAddress,
          amount,
          recipient
        );
      } else {
        // ICP -> Base transfer
        result = await bridge.transferICPToBase(
          tokenCanisterId,
          amount,
          recipient
        );
      }
      
      if (result.success) {
        const txIdentifier = result.txHash || result.txId;
        setStatus(`Transfer initiated! ${direction === 'baseToIcp' ? 'Transaction Hash' : 'Transaction ID'}: ${txIdentifier}`);
        
        // Clear form
        setAmount('');
        setRecipient('');
        
        // Notify parent component
        if (onTransferComplete) {
          onTransferComplete();
        }
      } else {
        setStatus(`Error: ${result.error}`);
      }
    } catch (error) {
      console.error('Transfer error:', error);
      setStatus('Transfer failed: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bridge-container">
      <h2>Cross-Chain Token Bridge</h2>
      
      <div className="bridge-form">
        <div className="form-group">
          <label>Transfer Direction:</label>
          <select
            value={direction}
            onChange={(e) => setDirection(e.target.value)}
            disabled={loading}
            className="direction-select"
          >
            <option value="baseToIcp">Base → ICP</option>
            <option value="icpToBase">ICP → Base</option>
          </select>
        </div>
        
        <div className="form-group">
          <label>Amount:</label>
          <input
            type="text"
            value={amount}
            onChange={handleAmountChange}
            disabled={loading}
            placeholder="Enter amount"
            className="amount-input"
          />
        </div>
        
        <div className="form-group">
          <label>Recipient:</label>
          <input
            type="text"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            disabled={loading}
            placeholder={direction === 'baseToIcp' ? 'ICP Principal ID' : 'Ethereum Address (0x...)'}
            className="recipient-input"
          />
        </div>
        
        <button
          onClick={handleTransfer}
          disabled={!bridge || loading || !amount || !recipient}
          className="transfer-button"
        >
          {loading ? 'Processing...' : 'Transfer Tokens'}
        </button>
      </div>
      
      {status && (
        <div className={`status-message ${status.includes('Error') ? 'error' : 
                                        status.includes('initiated') ? 'success' : ''}`}>
          {status}
        </div>
      )}
    </div>
  );
};

export default BridgeComponent;