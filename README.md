# Base-ICP Bridge with Chain Fusion

A cross-chain bridge connecting the Base blockchain (Ethereum L2) with the Internet Computer Protocol (ICP), enabling seamless token transfers between both ecosystems.

## Project Overview

This bridge allows tokens to be transferred bidirectionally between Base and the Internet Computer Protocol through a secure validation mechanism and smart contract architecture. It implements:

- Token locking and minting across chains
- Multi-signature validation for security
- Chain fusion interface for seamless interaction
- Oracle service for cross-chain event monitoring

## Architecture

The system consists of several key components:

1. **ICP Bridge Canister**: Manages token minting/burning on the ICP side
2. **Base Smart Contract**: Handles token locking/releasing on the Base blockchain
3. **Validator Service**: Monitors events on both chains and executes cross-chain transfers
4. **Chain Fusion Interface**: JavaScript library for interacting with both chains

## Technical Components

### ICP Canisters
- Bridge Canister (Motoko)
- Token Interface Canister (Motoko)

### Base Smart Contracts
- BaseBridge Contract (Solidity)
- ERC-20 Token Integration

### Bridge Services
- Validator/Oracle Service (Node.js)
- Chain Fusion JavaScript Interface

## Installation and Setup

### Prerequisites
- Internet Computer SDK (`dfx`)
- Node.js and npm
- Ethereum development tools (Truffle/Hardhat)

### Development Environment Setup

```bash
# Install the Internet Computer SDK (DFX)
sh -ci "$(curl -fsSL https://internetcomputer.org/install.sh)"

# Install Ethereum development tools
npm install -g truffle hardhat

# Create project and install dependencies
dfx new base_icp_bridge
cd base_icp_bridge
npm install @dfinity/agent @dfinity/principal web3 ethers @openzeppelin/contracts
```

### Deploy ICP Canisters

```bash
# Start the local ICP replica
dfx start --background

# Deploy the canisters
dfx deploy

# Test basic token operations
dfx canister call token_canister mint '(principal "YOUR_PRINCIPAL_ID", 1000)'
```

### Deploy Base Contract

```bash
# Compile the contract
npx hardhat compile

# Deploy to Base testnet (Sepolia)
npx hardhat run scripts/deploy.js --network base-sepolia
```

## Validator Setup

```bash
# Install validator dependencies
cd src/validator
npm install

# Configure environment variables
cp .env.example .env
# Edit .env with your configuration

# Start the validator
node validator.js
```

## Security Considerations

- Multi-signature validation for all cross-chain transfers
- Transaction hashing and signature verification
- Configurable validator threshold

## Future Improvements

- Add support for NFT bridging
- Implement transaction fee optimization
- Develop a decentralized validator network
- Add more token pairings

## License

This project is licensed under the MIT License - see the LICENSE file for details.