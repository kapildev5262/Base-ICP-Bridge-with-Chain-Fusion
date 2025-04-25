require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const BASESCAN_API_KEY = process.env.BASESCAN_API_KEY;
const BASE_SEPOLIA_RPC_URL = process.env.BASE_SEPOLIA_RPC_URL;
const BASE_MAINNET_RPC_URL = process.env.BASE_MAINNET_RPC_URL;
const PRIVATE_KEY = process.env.PRIVATE_KEY;

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
    solidity: {
        version: "0.8.28",
        settings: {
            optimizer: {
                enabled: true,
                runs: 200,
            },
        },
    },
    defaultNetwork: "hardhat",
    networks: {
        base_sepolia: {
            url: BASE_SEPOLIA_RPC_URL,
            accounts: [PRIVATE_KEY],
            chainId: 84532,
            blockConfirmations: 5,
            gasPrice: "auto",
        },
        base: {
            url: BASE_MAINNET_RPC_URL,
            accounts: [PRIVATE_KEY],
            chainId: 8453,
            blockConfirmations: 5,
            gasPrice: "auto",
        },
        localhost: {
            url: "http://127.0.0.1:8545/",
            chainId: 31337,
        },
    },
    etherscan: {
        apiKey: {
            base_sepolia: BASESCAN_API_KEY,
            base: BASESCAN_API_KEY,
        },
        customChains: [
            {
                network: "base_sepolia",
                chainId: 84532,
                urls: {
                    apiURL: "https://api-sepolia.basescan.org/api",
                    browserURL: "https://sepolia.basescan.org",
                },
            },
            {
                network: "base",
                chainId: 8453,
                urls: {
                    apiURL: "https://api.basescan.org/api",
                    browserURL: "https://basescan.org",
                },
            },
        ],
    },
    mocha: {
        timeout: 500000,
    },
};