import React, { useState, useEffect } from 'react';
import { bridge_canister } from '../../declarations/bridge_canister';

function BridgeStatus() {
  const [status, setStatus] = useState({ loading: true });
  const [transfers, setTransfers] = useState([]);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  // Fetch bridge status data
  const fetchData = async () => {
    try {
      setError(null);
      
      // Fetch pending transfers from the bridge canister
      const pendingTransfers = await bridge_canister.getPendingTransfers();
      setTransfers(pendingTransfers || []);
      
      // Optional: If you have a validator status API endpoint
      try {
        const response = await fetch('http://localhost:3000/status');
        if (!response.ok) {
          throw new Error(`Status API returned ${response.status}`);
        }
        const validatorStatus = await response.json();
        setStatus({ loading: false, ...validatorStatus });
      } catch (validatorError) {
        console.warn("Could not fetch validator status:", validatorError);
        // Still consider the operation successful if we got transfers
        setStatus({ 
          loading: false,
          base: { connected: "Unknown", chainId: "Unknown", address: "Unknown" },
          icp: { connected: "Unknown", cycleBalance: "Unknown" }
        });
      }
      
      setLastUpdated(new Date());
    } catch (err) {
      console.error("Failed to fetch bridge status:", err);
      setError(err.message);
      setStatus({ loading: false });
    }
  };

  // Initial data fetch and periodic updates
  useEffect(() => {
    fetchData();
    
    // Update every 30 seconds
    const interval = setInterval(fetchData, 30000);
    
    // Cleanup interval on component unmount
    return () => clearInterval(interval);
  }, []);

  // Format timestamp for display
  const formatTime = (date) => {
    if (!date) return 'Never';
    return date.toLocaleTimeString();
  };

  return (
    <div className="bridge-status-container">
      <div className="status-header">
        <h2>Bridge Status</h2>
        <button 
          onClick={fetchData} 
          disabled={status.loading}
          className="refresh-button"
        >
          {status.loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>
      
      {error && (
        <div className="error-message">
          Error fetching status: {error}
        </div>
      )}
      
      {status.loading ? (
        <div className="loading">Loading bridge status...</div>
      ) : (
        <div className="status-content">
          <div className="status-section">
            <h3>Base Connection</h3>
            <div className="status-info">
              <div className="status-item">
                <span className="label">Connected:</span>
                <span className="value">{status.base?.connected === true ? 'Yes' : 
                                         status.base?.connected === false ? 'No' : 'Unknown'}</span>
              </div>
              <div className="status-item">
                <span className="label">Chain ID:</span>
                <span className="value">{status.base?.chainId || 'Unknown'}</span>
              </div>
              <div className="status-item">
                <span className="label">Validator Address:</span>
                <span className="value address">{status.base?.address || 'Unknown'}</span>
              </div>
            </div>
          </div>
          
          <div className="status-section">
            <h3>ICP Connection</h3>
            <div className="status-info">
              <div className="status-item">
                <span className="label">Connected:</span>
                <span className="value">{status.icp?.connected === true ? 'Yes' : 
                                         status.icp?.connected === false ? 'No' : 'Unknown'}</span>
              </div>
              <div className="status-item">
                <span className="label">Cycle Balance:</span>
                <span className="value">{status.icp?.cycleBalance || 'Unknown'}</span>
              </div>
            </div>
          </div>
          
          <div className="status-section">
            <h3>Pending Transfers ({transfers.length})</h3>
            {transfers.length === 0 ? (
              <p className="no-transfers">No pending transfers</p>
            ) : (
              <ul className="transfers-list">
                {transfers.map(transfer => (
                  <li key={transfer.id} className="transfer-item">
                    <div className="transfer-detail">
                      <span className="label">ID:</span>
                      <span className="value">{transfer.id}</span>
                    </div>
                    <div className="transfer-detail">
                      <span className="label">Amount:</span>
                      <span className="value">{transfer.amount.toString()}</span>
                    </div>
                    <div className="transfer-detail">
                      <span className="label">Recipient:</span>
                      <span className="value address">{transfer.recipient}</span>
                    </div>
                    {transfer.timestamp && (
                      <div className="transfer-detail">
                        <span className="label">Timestamp:</span>
                        <span className="value">
                          {new Date(Number(transfer.timestamp)).toLocaleString()}
                        </span>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
          
          {lastUpdated && (
            <div className="last-updated">
              Last updated: {formatTime(lastUpdated)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default BridgeStatus;