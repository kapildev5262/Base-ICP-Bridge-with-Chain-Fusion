// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract BaseBridge is Ownable {
    // Events
    event TokensLocked(address indexed token, uint256 amount, bytes32 recipient, uint256 timestamp);
    event TokensReleased(address indexed token, address recipient, uint256 amount, string icpTxId);
    
    // State variables
    mapping(address => bool) public validators;
    uint256 public requiredSignatures;
    
    // Token pairing (Base token address => ICP canister ID)
    mapping(address => string) public tokenPairings;
    
    constructor() Ownable(msg.sender) {
        requiredSignatures = 1;
    }
    
    // Lock tokens to transfer to ICP
    function lockTokens(address token, uint256 amount, bytes32 icpRecipient) external {
        require(amount > 0, "Amount must be greater than 0");
        require(bytes(tokenPairings[token]).length > 0, "Token not supported");
        
        // Transfer tokens from sender to this contract
        bool success = IERC20(token).transferFrom(msg.sender, address(this), amount);
        require(success, "Token transfer failed");
        
        // Emit event for bridge validators to pick up
        emit TokensLocked(token, amount, icpRecipient, block.timestamp);
    }
    
    // Release tokens that were locked on ICP side
    function releaseTokens(
        address token, 
        address recipient,
        uint256 amount,
        string calldata icpTxId,
        bytes[] calldata signatures
    ) external {
        require(amount > 0, "Amount must be greater than 0");
        require(recipient != address(0), "Invalid recipient");
        
        // Verify signatures (simplified - in production, use threshold signatures)
        require(signatures.length >= requiredSignatures, "Insufficient signatures");
        
        // Transfer tokens to recipient
        bool success = IERC20(token).transfer(recipient, amount);
        require(success, "Token transfer failed");
        
        // Emit event
        emit TokensReleased(token, recipient, amount, icpTxId);
    }
    
    // Admin functions
    function addValidator(address validator) external onlyOwner {
        validators[validator] = true;
    }
    
    function removeValidator(address validator) external onlyOwner {
        validators[validator] = false;
    }
    
    function setRequiredSignatures(uint256 count) external onlyOwner {
        requiredSignatures = count;
    }
    
    function addTokenPairing(address baseToken, string calldata icpCanisterId) external onlyOwner {
        tokenPairings[baseToken] = icpCanisterId;
    }
}