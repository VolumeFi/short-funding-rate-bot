# Curve Lending Bot 🤖

## Table of Contents 📑

1. [Description](#description-)
2. [Prerequisites](#prerequisites-)
3. [Setup](#setup-)
4. [Environment Variables](#environment-variables-)
5. [Functions](#functions-)
6. [Database Schema](#database-schema-)
7. [Contributing](#contributing-)

## Description 📝

Curve Lending Bot is a decentralized application designed to monitor and manage your cryptocurrency deposits. It tracks the health of each deposit in a smart contract and triggers appropriate actions like withdrawal or notification when certain conditions are met. The bot is built using Node.js and leverages libraries like Web3, SQLite, and Paloma.js for various functionalities.

### Features 🌟

- Real-time Monitoring: Tracks your deposits 24/7.
- Multiple Network Support: Easily configurable to monitor multiple blockchain networks.
- Smart Contract Interactions: Automatically interacts with smart contracts to manage your deposits.

## Prerequisites 🛠

To run this project, you'll need the following software and libraries:

- Node.js
- SQLite3
- Web3
- axios
- Paloma.js

Run `npm install` to install all dependencies.

## Setup 🚀

1. Clone the repository: `git clone https://your-repo-url`
2. Navigate to the project directory: `cd your-project-folder`
3. Install dependencies: `npm install`
4. Create and configure your `.env` file with your own values following the `.env.example` file.
5. Run the bot: `node index.js`

## Environment Variables 🌍

The project uses several environment variables that you'll need to set up:

- `PALOMA_LCD`: The URL of your Paloma LCD.
- `PALOMA_CHAIN_ID`: The chain ID of your Paloma network.
- `PALOMA_KEY`: Your Paloma wallet private key.
- `TELEGRAM_ALERT_API`: Telegram API key for sending alerts.
- `DB_LOCATION`: The path to your SQLite database.

## Functions 📚

### setupConnections()

This function reads from `networks.json` and initializes web3 instances and contract objects for each specified network. It's the foundational setup step.

### getLastBlock()

Checks for new blocks starting from the last processed block and initializes the event fetching and processing. It ensures that only one instance of the bot is processing at a time to avoid duplications.

### getNewBlocks(fromBlock)

This function fetches new blocks starting from the specified `fromBlock`, finds all deposit and withdrawal events, and processes them accordingly.

## Database Schema 🗃

The SQLite database used in this project contains a table called `deposits` with the following columns:

- `withdrawer`: Address of the account initiating the withdrawal.
- `depositor`: Address of the account that has deposited assets.
- `amount0`: The initial deposited amount.
- `amount1`: The health of the deposit.
- `contract`: The smart contract address.
- `bot`: The bot name handling this deposit.

## Contributing 🤝

We welcome contributions from the community. Feel free to open issues for feature requests, bug reports, or even better, open pull requests!

