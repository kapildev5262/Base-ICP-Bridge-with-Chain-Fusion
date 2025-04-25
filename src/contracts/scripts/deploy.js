// scripts/deploy.js
const { ethers } = require("hardhat");

async function main() {
  console.log("Deploying BaseBridge contract...");
  
  const BaseBridge = await ethers.getContractFactory("BaseBridge");
  const bridge = await BaseBridge.deploy();
  
  console.log("Waiting for deployment...");
  await bridge.waitForDeployment();
  
  const address = await bridge.getAddress();
  console.log("Base Bridge deployed to:", address);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });